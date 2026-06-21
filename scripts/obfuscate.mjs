/**
 * Post-build obfuscation script.
 *
 * Layer 1 — Renderer (browser):
 *   Obfuscates every app JS chunk inside dist/assets/ with RC4 string
 *   encryption, control-flow flattening, and self-defending code.
 *   Vendor bundles (vendor-*) are skipped — they are open-source and
 *   obfuscating a 500 KB file only hurts startup time.
 *
 * Layer 2 — Main process (Node.js):
 *   Obfuscates electron/main.cjs → electron/main.obf.cjs with a
 *   Node-safe config (no selfDefending, no deadCodeInjection).
 */

import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = (p => p.substring(0, p.lastIndexOf('/')))(
  fileURLToPath(import.meta.url).replace(/\\/g, '/')
);
const root = join(__dirname, '..');

// ── Renderer obfuscation config ───────────────────────────────────────────────
const RENDERER_CFG = {
  compact: true,
  target: 'browser',
  sourceMap: false,

  // String array: extract + RC4-encrypt all string literals
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 0.75,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.5,
  rotateStringArray: true,
  shuffleStringArray: true,

  // Split long strings into pieces
  splitStrings: true,
  splitStringsChunkLength: 12,

  // Rename local identifiers to hex names
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,           // keep global names — React/Recharts rely on them

  // Control-flow obfuscation (moderate — avoids huge size blowup)
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.35,

  // Inject dummy dead-code blocks
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,

  // Object keys obfuscation
  transformObjectKeys: true,

  // Self-defending: code detects if it's been reformatted / tampered
  selfDefending: true,

  unicodeEscapeSequence: false,
};

// ── Main-process obfuscation config ──────────────────────────────────────────
const MAIN_CFG = {
  compact: true,
  target: 'node',
  sourceMap: false,

  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 0.75,
  rotateStringArray: true,
  shuffleStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 12,

  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,

  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.35,

  transformObjectKeys: true,

  // Disabled for Node.js context — can interfere with module system
  deadCodeInjection: false,
  selfDefending: false,

  unicodeEscapeSequence: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — Renderer
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n🔒 Obfuscating renderer chunks…');
const assetsDir = join(root, 'dist', 'assets');
let rendererCount = 0;

for (const file of readdirSync(assetsDir).sort()) {
  if (extname(file) !== '.js') continue;
  if (file.startsWith('vendor-')) {
    console.log(`  ⊘ skipped (vendor)  ${file}`);
    continue;
  }

  const filePath = join(assetsDir, file);
  const src = readFileSync(filePath, 'utf8');
  const obf = JavaScriptObfuscator.obfuscate(src, RENDERER_CFG).getObfuscatedCode();
  writeFileSync(filePath, obf, 'utf8');

  const sizeBefore = (src.length / 1024).toFixed(1);
  const sizeAfter  = (obf.length / 1024).toFixed(1);
  console.log(`  ✓ ${file.padEnd(45)} ${sizeBefore} kB → ${sizeAfter} kB`);
  rendererCount++;
}

console.log(`\n  Done — ${rendererCount} renderer file(s) obfuscated.\n`);

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — Electron main process
// ─────────────────────────────────────────────────────────────────────────────
console.log('🔒 Obfuscating Electron main process…');
const mainSrc = join(root, 'electron', 'main.cjs');
const mainOut = join(root, 'electron', 'main.obf.cjs');

const mainCode = readFileSync(mainSrc, 'utf8');
const mainObf  = JavaScriptObfuscator.obfuscate(mainCode, MAIN_CFG).getObfuscatedCode();
writeFileSync(mainOut, mainObf, 'utf8');

const mBefore = (mainCode.length / 1024).toFixed(1);
const mAfter  = (mainObf.length  / 1024).toFixed(1);
console.log(`  ✓ electron/main.obf.cjs  ${mBefore} kB → ${mAfter} kB\n`);

console.log('✅ Obfuscation complete.\n');
