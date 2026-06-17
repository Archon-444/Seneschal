// One-off asset keyer: remove the flat dark-navy background from the brand logo so
// the gold mark is transparent and floats on any surface (ivory login, navy sidebar).
//
// Dependency-free (no sharp/PIL/ImageMagick): decode PNG via zlib + PNG unfilter, set
// per-pixel alpha by a warm-vs-cool separator (R - B) — strongly negative for the navy
// (#02122a) → transparent, positive for gold → opaque, feathered across the thin edge —
// then trim transparent margins and re-pad to a centred square, and re-encode RGBA.
//
// Reads the navy original (kept as seneschal-logo-navy.png so re-runs are idempotent)
// and writes the transparent seneschal-logo.png. Run: node scripts/strip-logo-bg.mjs

import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import zlib from "node:zlib";

const SRC = "public/seneschal-logo.png";
const BACKUP = "public/seneschal-logo-navy.png";

// Keep the navy original once, then always key from it (idempotent across re-runs).
if (!existsSync(BACKUP)) copyFileSync(SRC, BACKUP);

function decode(buf) {
  let p = 8;
  let W, H, colorType;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { W = data.readUInt32BE(0); H = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (colorType !== 6) throw new Error(`expected RGBA (colorType 6), got ${colorType}`);
  const ch = 4;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * ch;
  const out = Buffer.alloc(H * stride);
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let pos = 0;
  for (let y = 0; y < H; y++) {
    const f = raw[pos++];
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const rb = raw[pos++];
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v;
      switch (f) { case 0: v = rb; break; case 1: v = rb + a; break; case 2: v = rb + b; break; case 3: v = rb + ((a + b) >> 1); break; case 4: v = rb + paeth(a, b, c); break; default: v = rb; }
      cur[x] = v & 0xff;
    }
  }
  return { W, H, data: out };
}

// smoothstep(lo, hi, x) → 0..1
const smooth = (lo, hi, x) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

function key({ W, H, data }) {
  // Separator: gold has R≫B, navy has R≪B. Feather the thin transition near s≈0..30.
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const s = data[o] - data[o + 2]; // R - B
    data[o + 3] = Math.round(255 * smooth(0, 30, s));
  }
  return { W, H, data };
}

function trimToSquare({ W, H, data }, alphaThreshold = 16, marginPct = 0.06) {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * 4 + 3] > alphaThreshold) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { W, H, data }; // nothing opaque — leave as-is
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const side = Math.round(Math.max(bw, bh) * (1 + 2 * marginPct));
  const dst = Buffer.alloc(side * side * 4); // zero-filled = transparent
  const offX = Math.floor((side - bw) / 2), offY = Math.floor((side - bh) / 2);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const so = ((minY + y) * W + (minX + x)) * 4;
    const dO = ((offY + y) * side + (offX + x)) * 4;
    dst[dO] = data[so]; dst[dO + 1] = data[so + 1]; dst[dO + 2] = data[so + 2]; dst[dO + 3] = data[so + 3];
  }
  return { W: side, H: side, data: dst };
}

function encode({ W, H, data }) {
  const stride = W * 4;
  const rawf = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) { rawf[y * (stride + 1)] = 0; data.copy(rawf, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const idat = zlib.deflateSync(rawf, { level: 9 });
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, body])) >>> 0);
    return Buffer.concat([len, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const img = trimToSquare(key(decode(readFileSync(BACKUP))));
writeFileSync(SRC, encode(img));
console.log(`✓ wrote transparent ${SRC}: ${img.W}×${img.H}`);
