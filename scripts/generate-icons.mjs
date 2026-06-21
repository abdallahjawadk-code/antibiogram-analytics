/**
 * Procedural icon generator for Antibiogram Analytics.
 *
 * Produces real branded assets without any external image dependency
 * (uses only Node's built-in zlib), so `npm run build:win` no longer
 * fails on missing build/* and electron/assets/* files:
 *
 *   build/icon.png              256x256 app icon (electron-builder derives the rest)
 *   build/icon.ico              ICO wrapping the 256x256 PNG (installer/app)
 *   build/uninstall.ico         red-accented variant for the uninstaller
 *   build/installer-sidebar.bmp 164x314 24-bit NSIS sidebar
 *   electron/assets/icon.png    runtime window/tray icon
 *   electron/assets/icon.ico    Windows runtime icon
 *
 * Run with: node scripts/generate-icons.mjs   (also runs automatically via prebuild)
 *
 * @copyright 2026 Abdallahjawadk
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- CRC32 (for PNG chunks) ----------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- Drawing: 256x256 RGBA antibiogram glyph ------------------------------
function drawIcon(size, accent /* [r,g,b] for the cross */) {
  const px = Buffer.alloc(size * size * 4); // RGBA
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.46;

  // teal -> cyan vertical gradient inside a circle, transparent outside
  const top = [0x14, 0xb8, 0xa6];
  const bot = [0x08, 0x91, 0xb2];

  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    const tg = y / (size - 1);
    const br = Math.round(top[0] + (bot[0] - top[0]) * tg);
    const bgc = Math.round(top[1] + (bot[1] - top[1]) * tg);
    const bb = Math.round(top[2] + (bot[2] - top[2]) * tg);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      // anti-aliased circle edge
      const edge = radius - d;
      const a = edge >= 1 ? 255 : edge <= 0 ? 0 : Math.round(edge * 255);
      if (a > 0) set(x, y, br, bgc, bb, a);
    }
  }

  // White ascending bar chart (3 bars) in the lower portion
  const bars = [
    { x: 0.30, h: 0.20 },
    { x: 0.46, h: 0.32 },
    { x: 0.62, h: 0.44 },
  ];
  const barW = size * 0.10;
  const baseY = size * 0.72;
  for (const b of bars) {
    const x0 = Math.round(size * b.x);
    const y0 = Math.round(baseY - size * b.h);
    const y1 = Math.round(baseY);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x0 + barW; x++) {
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, 255, 255, 255, 255);
      }
    }
  }

  // Medical cross (accent) in the upper area
  const crossT = size * 0.085;     // arm thickness
  const crossL = size * 0.26;      // arm length
  const ccx = size * 0.40;
  const ccy = size * 0.34;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inV = Math.abs(x - ccx) <= crossT / 2 && Math.abs(y - ccy) <= crossL / 2;
      const inH = Math.abs(y - ccy) <= crossT / 2 && Math.abs(x - ccx) <= crossL / 2;
      if (inV || inH) set(x, y, accent[0], accent[1], accent[2], 255);
    }
  }

  // Premium finish: a soft top-left gloss highlight and a thin inner ring,
  // blended only over the existing (opaque) circle pixels.
  const blend = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    if (px[i + 3] === 0) return; // don't paint outside the circle
    const k = a / 255;
    px[i] = Math.round(px[i] * (1 - k) + r * k);
    px[i + 1] = Math.round(px[i + 1] * (1 - k) + g * k);
    px[i + 2] = Math.round(px[i + 2] * (1 - k) + b * k);
  };
  const glossCx = size * 0.34;
  const glossCy = size * 0.30;
  const glossR = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - glossCx, y - glossCy);
      if (d < glossR) {
        const a = Math.round(70 * (1 - d / glossR)); // fades outward
        if (a > 0) blend(x, y, 255, 255, 255, a);
      }
      // thin lighter inner ring just inside the circle edge
      const dr = Math.hypot(x - cx, y - cy);
      if (dr <= radius - 3 && dr >= radius - 6) blend(x, y, 255, 255, 255, 60);
    }
  }
  return px;
}

function encodePNG(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  // compression/filter/interlace = 0

  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeICO(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(1, 4);      // image count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 == 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0;                      // palette
  entry[3] = 0;                      // reserved
  entry.writeUInt16LE(1, 4);         // color planes
  entry.writeUInt16LE(32, 6);        // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);       // offset (6 + 16)
  return Buffer.concat([header, entry, pngBuf]);
}

function encodeBMP24(w, h) {
  // bottom-up 24-bit BMP with a teal->cyan vertical gradient
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixels = Buffer.alloc(rowSize * h);
  const top = [0x14, 0xb8, 0xa6];
  const bot = [0x08, 0x91, 0xb2];
  for (let y = 0; y < h; y++) {
    const tg = (h - 1 - y) / (h - 1); // file is bottom-up
    const r = Math.round(top[0] + (bot[0] - top[0]) * tg);
    const g = Math.round(top[1] + (bot[1] - top[1]) * tg);
    const b = Math.round(top[2] + (bot[2] - top[2]) * tg);
    for (let x = 0; x < w; x++) {
      const off = y * rowSize + x * 3;
      pixels[off] = b; pixels[off + 1] = g; pixels[off + 2] = r; // BGR
    }
  }
  const fileHeader = Buffer.alloc(14);
  const infoHeader = Buffer.alloc(40);
  const dataSize = pixels.length;
  fileHeader.write('BM', 0, 'ascii');
  fileHeader.writeUInt32LE(14 + 40 + dataSize, 2);
  fileHeader.writeUInt32LE(14 + 40, 10);
  infoHeader.writeUInt32LE(40, 0);
  infoHeader.writeInt32LE(w, 4);
  infoHeader.writeInt32LE(h, 8);
  infoHeader.writeUInt16LE(1, 12);
  infoHeader.writeUInt16LE(24, 14);
  infoHeader.writeUInt32LE(dataSize, 20);
  return Buffer.concat([fileHeader, infoHeader, pixels]);
}

// ---- Write everything ------------------------------------------------------
const out = (rel) => {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  return p;
};

const SIZE = 256;
const mainRGBA = drawIcon(SIZE, [255, 255, 255]);
const mainPNG = encodePNG(SIZE, mainRGBA);
const unRGBA = drawIcon(SIZE, [0xef, 0x44, 0x44]); // red cross for uninstaller
const unPNG = encodePNG(SIZE, unRGBA);

writeFileSync(out('build/icon.png'), mainPNG);
writeFileSync(out('build/icon.ico'), encodeICO(mainPNG, SIZE));
writeFileSync(out('build/uninstall.ico'), encodeICO(unPNG, SIZE));
writeFileSync(out('build/installer-sidebar.bmp'), encodeBMP24(164, 314));
writeFileSync(out('electron/assets/icon.png'), mainPNG);
writeFileSync(out('electron/assets/icon.ico'), encodeICO(mainPNG, SIZE));

console.log('Icons generated: build/icon.png, build/icon.ico, build/uninstall.ico, build/installer-sidebar.bmp, electron/assets/icon.{png,ico}');
