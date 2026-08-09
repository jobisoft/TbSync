/**
 * Build script for the TbSync add-on family.
 *
 * **THIS FILE IS MIRRORED INTO EVERY ADD-ON.** The three copies MUST match
 * byte-for-byte. When you change one, re-copy it to the others and confirm:
 *     diff -q TbSync/build.js EAS-4-TbSync/build.js
 *     diff -q TbSync/build.js google-4-tbsync/build.js
 *
 * Two artifacts come out of `src/`:
 *   - the ATN xpi, which is `src/` and nothing else
 *   - the beta xpi, which is `src/` plus the `beta/` overlay
 *
 * A beta-only feature therefore lives entirely in `beta/` and cannot reach
 * ATN by accident: the ATN build has no exclude list to forget to update,
 * because it never looks anywhere but `src/`.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Root-level folder mirroring `src/`, applied on top of it for the beta
// build. See collectOverlay for the merge rules.
const OVERLAY_DIR = "beta";

// Deep-merge `overlay` onto a clone of `base`: nested plain objects merge
// recursively, arrays are unioned, everything else is replaced by the overlay.
// `base` is never mutated, and its key order is preserved (overlay-only keys
// are appended), which keeps a merged manifest's diff clean.
//
// Unioning arrays is what lets `beta/manifest.json` ask for the one or two
// extra permissions it needs by naming only those. Replacing would mean
// restating the whole `permissions` list, and the copy would then silently
// fall behind every time src/manifest.json gained an entry.
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function deepMerge(base, overlay) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (isPlainObject(out[k]) && isPlainObject(v)) out[k] = deepMerge(out[k], v);
    else if (Array.isArray(out[k]) && Array.isArray(v))
      out[k] = [...out[k], ...v.filter((item) => !out[k].includes(item))];
    else out[k] = v;
  }
  return out;
}

// CRC-32 lookup table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Zip files/folders into destFile.
 * @param {string|string[]} sources - Paths to zip
 * @param {string} destFile - Output zip file
 * @param {string[]} [exclude=[]] - Optional array of folder/file paths to exclude (relative paths)
 * @param {Object<string,Buffer>} [overrides={}] - Map of POSIX rel-path to Buffer whose bytes
 *   replace the on-disk file when zipping (e.g. a per-variant manifest.json), leaving the working
 *   tree untouched.
 */
function zip(sources, destFile, exclude = [], overrides = {}) {
  const files = [];

  // Ensure parent directory exists
  const parentDir = path.dirname(destFile);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  function collect(full, rel) {
    // skip if rel matches any exclude pattern
    if (exclude.some(e => rel === e || rel.startsWith(e + "/"))) return;

    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full)) {
        collect(path.join(full, name), rel + "/" + name);
      }
    } else {
      files.push({ full, rel });
    }
  }

  if (typeof sources === "string") {
    for (const name of fs.readdirSync(sources)) collect(path.join(sources, name), name);
  } else {
    for (const src of sources) collect(src, src);
  }

  // An override whose path was not collected has no file on disk under
  // `sources` - it is an overlay-only addition. Give it an entry of its own;
  // the read below takes its bytes from `overrides` and never touches `full`.
  for (const rel of Object.keys(overrides)) {
    if (!files.some((f) => f.rel === rel)) files.push({ full: null, rel });
  }

  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const { full, rel } of files) {
    const data = overrides[rel] ?? fs.readFileSync(full);
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const fileData = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const nameBytes = Buffer.from(rel, "utf8");

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(fileData.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(fileData.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBytes.copy(cd, 46);

    parts.push(local, fileData);
    centralDir.push(cd);
    offset += local.length + fileData.length;
  }

  const cdBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(destFile, Buffer.concat([...parts, cdBuf, eocd]));
}

function rm(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Read the overlay folder into a map of `src/`-relative path → bytes, ready
 * to hand to zip() as `overrides`.
 *
 *   *.json  - deep-merged onto its src/ counterpart when there is one, so an
 *             overlay file only has to carry what it changes: a manifest with
 *             just name + update_url, a messages.json with just the new keys.
 *             With no counterpart it is added whole.
 *   others  - added as-is, and only when src/ has no such file. A silent
 *             shadow is the one failure here that would be painful to track
 *             down later, so it is an error rather than a replace.
 *
 * Returns {} when the overlay folder is absent, which is what makes this
 * safe to mirror into an add-on that has nothing beta-only to ship.
 */
function collectOverlay(overlayDir, srcDir) {
  const out = {};
  if (!fs.existsSync(overlayDir)) return out;

  function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      // Running a Python helper from the overlay leaves one of these behind,
      // and it would then be packaged. Nothing else here is generated, so a
      // single name is enough of a guard.
      if (name === "__pycache__") continue;
      const full = path.join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) {
        walk(full, childRel);
        continue;
      }
      const srcPath = path.join(srcDir, childRel);
      const shadows = fs.existsSync(srcPath);
      if (name.endsWith(".json")) {
        const overlay = JSON.parse(fs.readFileSync(full, "utf8"));
        const merged = shadows
          ? deepMerge(JSON.parse(fs.readFileSync(srcPath, "utf8")), overlay)
          : overlay;
        out[childRel] = Buffer.from(JSON.stringify(merged, null, 2) + "\n", "utf8");
      } else {
        if (shadows) {
          throw new Error(
            `${overlayDir}/${childRel} would replace ${srcDir}/${childRel}. ` +
            `The overlay may add files and merge JSON, but never shadow a source file.`
          );
        }
        out[childRel] = fs.readFileSync(full);
      }
    }
  }

  walk(overlayDir, "");
  return out;
}

function main() {
  // package.json is the single source of truth for the version, so `npm
  // version` drives the release and the manifest follows. The `version`
  // script re-runs this build and stages src/, which folds the rewritten
  // manifest into the version commit.
  const { name, version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(fs.readFileSync("src/manifest.json", "utf8"));
  manifest.version = version;
  fs.writeFileSync("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Set manifest version to ${version}`);

  console.log("Cleaning output directory (dist) ...");
  rm("dist");

  const overlay = collectOverlay(OVERLAY_DIR, "src");
  const overlayCount = Object.keys(overlay).length;

  const xpiVersion = version.replace(/\./g, "_");

  // ATN build: the on-disk manifest as-is (no update_url, plain name). ATN
  // serves its own updates, and a manifest carrying update_url is rejected.
  const atnName = `${name}_${xpiVersion}_atn.xpi`;
  console.log(`Creating ATN extension file (dist/${atnName}) ...`);
  zip("src", `dist/${atnName}`);

  // GitHub build (the beta release): src/ with the overlay applied. At minimum
  // that is beta/manifest.json, which adds gecko.update_url for self-hosted
  // auto-update and overrides the name so the beta is distinguishable once
  // installed; anything else the overlay carries is beta-only by construction.
  if (!overlay["manifest.json"]) {
    throw new Error(`Missing ${OVERLAY_DIR}/manifest.json, required for the beta XPI.`);
  }
  const betaName = `${name}_${xpiVersion}_beta.xpi`;
  console.log(
    `Creating beta (GitHub) extension file (dist/${betaName}), ` +
    `${overlayCount} overlay file(s) ...`
  );
  zip("src", `dist/${betaName}`, [], overlay);

  console.log("Build finished. Output is in the 'dist' folder.");
}

main();
