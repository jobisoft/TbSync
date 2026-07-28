const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// Deep-merge `overlay` onto a clone of `base`: nested plain objects merge
// recursively, everything else (scalars, arrays) is replaced by the overlay.
// `base` is never mutated, and its key order is preserved (overlay-only keys
// are appended), which keeps a merged manifest's diff clean.
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function deepMerge(base, overlay) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    out[k] = isPlainObject(out[k]) && isPlainObject(v) ? deepMerge(out[k], v) : v;
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

function main() {
  // `npm run dev` (node build.js --dev) runs the same preparation steps but
  // emits an unpacked add-on in dev/ instead of packaged XPIs in dist/.
  const dev = process.argv.includes("--dev");

  // package.json is the single source of truth for the version, so `npm
  // version` drives the release and the manifest follows. The `version`
  // script re-runs this build and stages src/, which folds the rewritten
  // manifest into the version commit.
  const { name, version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(fs.readFileSync("src/manifest.json", "utf8"));
  manifest.version = version;
  fs.writeFileSync("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Set manifest version to ${version}`);

  const outDir = dev ? "dev" : "dist";
  console.log(`Cleaning output directory (${outDir}) ...`);
  rm(outDir);

  if (dev) {
    // Emit the live code unpacked, ready to load as a temporary add-on.
    console.log("Copying src to dev/ (unpacked) ...");
    fs.cpSync("src", "dev", { recursive: true });
    console.log("Dev build finished. Load the unpacked add-on from the 'dev' folder.");
    return;
  }

  const xpiVersion = version.replace(/\./g, "_");

  // ATN build: the on-disk manifest as-is (no update_url, plain name). ATN
  // serves its own updates, and a manifest carrying update_url is rejected.
  const atnName = `${name}_${xpiVersion}_atn.xpi`;
  console.log(`Creating ATN extension file (dist/${atnName}) ...`);
  zip("src", `dist/${atnName}`);

  // GitHub build (the beta release): same tree, but manifest.json deep-merged
  // with the overlay (adds gecko.update_url for self-hosted auto-update and
  // overrides the name so the beta is distinguishable once installed).
  const overlayPath = "manifest_beta.json";
  if (!fs.existsSync(overlayPath)) {
    throw new Error(`Missing ${overlayPath}, required for the beta XPI.`);
  }
  const overlay = JSON.parse(fs.readFileSync(overlayPath, "utf8"));
  const betaManifest = deepMerge(manifest, overlay);
  const betaManifestBuf = Buffer.from(JSON.stringify(betaManifest, null, 2) + "\n", "utf8");
  const betaName = `${name}_${xpiVersion}_beta.xpi`;
  console.log(`Creating beta (GitHub) extension file (dist/${betaName}) ...`);
  zip("src", `dist/${betaName}`, [], { "manifest.json": betaManifestBuf });

  console.log("Build finished. Output is in the 'dist' folder.");
}

main();
