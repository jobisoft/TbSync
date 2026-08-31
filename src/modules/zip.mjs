/**
 * A zip file, written by hand.
 *
 * Stored (uncompressed) entries only: the callers here pack a handful of
 * small text files, and a deflate implementation would be larger than what
 * it compresses. An add-on may not load a script from anywhere else, so the
 * alternative to this was vendoring a library to save a few kilobytes of
 * vCard.
 *
 * It lived in the bridge, which is beta-only. The migration window needs
 * the same thing and ships to everybody, so it lives here and the bridge
 * imports it - one implementation rather than two that drift.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const b of data) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {Array<{name: string, data: Uint8Array}>} entries
 *  @returns {Blob} */
export function buildZip(entries) {
  const enc = new TextEncoder();
  const u16 = (v, dv, o) => dv.setUint16(o, v, true);
  const u32 = (v, dv, o) => dv.setUint32(o, v, true);

  const localParts = [];
  const centralParts = [];
  let dataOffset = 0;

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(0x04034b50, lv, 0); // signature
    u16(20, lv, 4); // version needed
    u16(0, lv, 8); // compression: STORE
    u32(crc, lv, 14);
    u32(data.length, lv, 18); // compressed size
    u32(data.length, lv, 22); // uncompressed size
    u16(nameBytes.length, lv, 26);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    u32(0x02014b50, cv, 0); // signature
    u16(20, cv, 4); // version made by
    u16(20, cv, 6); // version needed
    u16(0, cv, 10); // compression: STORE
    u32(crc, cv, 16);
    u32(data.length, cv, 20);
    u32(data.length, cv, 24);
    u16(nameBytes.length, cv, 28);
    u32(dataOffset, cv, 42); // local header offset
    cd.set(nameBytes, 46);
    centralParts.push(cd);

    dataOffset += local.length + data.length;
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(0x06054b50, ev, 0); // signature
  u16(entries.length, ev, 8); // entries on this disk
  u16(entries.length, ev, 10); // total entries
  u32(cdSize, ev, 12);
  u32(dataOffset, ev, 16); // central directory offset

  return new Blob([...localParts, ...centralParts, eocd], {
    type: "application/zip",
  });
}
