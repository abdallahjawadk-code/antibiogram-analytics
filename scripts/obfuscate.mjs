/**
 * Post-build obfuscation — two-layer protection.
 *
 * Layer 1 (Renderer/browser):  RC4 string encryption, control-flow flattening,
 *   dead-code injection, self-defending, object key obfuscation.
 * Layer 2 (Electron main/Node): RC4 string encryption, identifier renaming,
 *   control-flow flattening (no selfDefending — Node.js compatibility).
 *
 * Vendor bundles (vendor-*) are skipped — open-source code, no benefit.
 */

import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = (p => p.substring(0, p.lastIndexOf('/')))(
  fileURLToPath(import.meta.url).replace(/\\/g, '/')
);
const root = join(__dirname, '..');

// ── Renderer config — strongest safe settings ─────────────────────────────────
const RENDERER_CFG = {
  compact: true,
  target: 'browser',
  sourceMap: false,

  // String array with RC4 encryption
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 0.80,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.60,
  stringArrayIndexesType: ['hexadecimal-number', 'hexadecimal-numeric-string'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  rotateStringArray: true,
  shuffleStringArray: true,

  // Split long strings into fragments
  splitStrings: true,
  splitStringsChunkLength: 10,

  // Identifier renaming
  identifierNamesGenerator: 'hexadecimal',
  identifierNamesCache: null,
  renameGlobals: false,
  renameProperties: false, // safe: avoid renaming React/Recharts props

  // Control-flow flattening
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.40,

  // Dead-code blocks
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.25,

  // Object key obfuscation
  transformObjectKeys: true,

  // Self-defending: detects reformatting/tampering, crashes if modified
  selfDefending: true,

  // Number obfuscation
  numbersToExpressions: true,
  simplify: true,

  unicodeEscapeSequence: false,
  domainLock: [],
};

// ── Main-process config — Node.js safe ────────────────────────────────────────
const MAIN_CFG = {
  compact: true,
  target: 'node',
  sourceMap: false,

  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 0.80,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 0.50,
  rotateStringArray: true,
  shuffleStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 10,

  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  renameProperties: false,

  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.40,

  transformObjectKeys: true,

  numbersToExpressions: true,
  simplify: true,

  // Disabled for Node — can break module loading
  deadCodeInjection: false,
  selfDefending: false,

  unicodeEscapeSequence: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — Renderer
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nObfuscating renderer chunks...');
const assetsDir = join(root, 'dist', 'assets');
let rendererCount = 0;

for (const file of readdirSync(assetsDir).sort()) {
  if (extname(file) !== '.js') continue;
  if (file.startsWith('vendor-')) {
    console.log(`  [skip vendor]  ${file}`);
    continue;
  }
  const filePath = join(assetsDir, file);
  const src = readFileSync(filePath, 'utf8');
  const obf = JavaScriptObfuscator.obfuscate(src, RENDERER_CFG).getObfuscatedCode();
  writeFileSync(filePath, obf, 'utf8');
  const bk = (src.length / 1024).toFixed(1);
  const ak = (obf.length / 1024).toFixed(1);
  console.log(`  [ok] ${file.padEnd(48)} ${bk} kB -> ${ak} kB`);
  rendererCount++;
}

console.log(`\n  Renderer: ${rendererCount} file(s) obfuscated.\n`);

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — Electron main process
// ─────────────────────────────────────────────────────────────────────────────
console.log('Obfuscating Electron main process...');
const mainSrc = join(root, 'electron', 'main.cjs');
const mainOut = join(root, 'electron', 'main.obf.cjs');

const mainCode = readFileSync(mainSrc, 'utf8');
const mainObf  = JavaScriptObfuscator.obfuscate(mainCode, MAIN_CFG).getObfuscatedCode();
writeFileSync(mainOut, mainObf, 'utf8');

const mB = (mainCode.length / 1024).toFixed(1);
const mA = (mainObf.length  / 1024).toFixed(1);
console.log(`  [ok] electron/main.obf.cjs  ${mB} kB -> ${mA} kB\n`);

console.log('Obfuscation complete.');