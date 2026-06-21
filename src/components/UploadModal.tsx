import { useState, useCallback, useMemo } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { Hospital, Period, PERIOD_OPTIONS } from '../types/database';
import { insertAntibiogramData, createUploadRecord, updateUploadRecord, ensureOrganismsInCatalog, ensureAntibioticsInCatalog, getHospitals, createHospital } from '../lib/supabase';
import { X, Upload, Check, AlertCircle, Download, Loader2, Calendar, Layers } from 'lucide-react';
import * as XLSX from 'xlsx';
import { interpret } from '../lib/clinical';
import { parseExcelOffThread } from '../lib/excelWorker';

// Parsing workbooks happens in the renderer process. Keep the maximum small
// enough to avoid an accidental or hostile spreadsheet exhausting memory.
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

interface UploadModalProps {
  hospital?: Hospital;
  onClose: () => void;
  onSuccess: () => void;
  onHospitalsCreated?: () => void;
}

interface ParsedData {
  organism: string;
  /** the original organism text from the sheet, before normalization */
  organismRaw: string;
  /** true when a genus-only input was expanded to a guessed species */
  organismAmbiguous: boolean;
  antibiotic: string;
  susceptible_count: number;
  intermediate_count: number;
  resistant_count: number;
  total_tested: number;
  susceptible_percent: number;
  specimen_type?: string;
  patient_id?: string;
  mic_distribution?: Record<string, number>;
}

/**
 * Genus-only inputs whose species cannot be safely inferred. Mapping these
 * (e.g. "enterococcus" -> "E. faecalis") changes the clinical meaning — VRE
 * therapy differs between E. faecalis and E. faecium — so we keep the guess
 * but flag it for the user to verify instead of overwriting silently.
 */
const AMBIGUOUS_ORGANISM_KEYS = new Set([
  'klebsiella', 'pseudomonas', 'acinetobacter', 'enterococcus',
  'enterobacter', 'serratia', 'proteus', 'salmonella', 'streptococcus', 'staph',
]);

/** Labels that indicate a section-divider row, not an organism — skip during parsing */
const BABIL_GROUP_LABELS = new Set([
  'gram negative', 'gram positive', 'gram-negative', 'gram-positive',
  'gram +ve', 'gram -ve', 'gram +', 'gram -',
  'anaerobes', 'fungi', 'mycobacteria',
  'organisims group', 'organisms group', 'organism group',
  'total', 'المجموع', 'سالبة الغرام', 'موجبة الغرام', 'اللاهوائيات',
  '0', '', 'organsims isolated', 'organsims group',
]);

const ORGANISM_MAPPINGS: Record<string, string> = {
  // ── E. coli ──────────────────────────────────────────────────────────────
  'e. coli': 'E. coli', 'e.coli': 'E. coli', 'e-coli': 'E. coli',
  'e coli': 'E. coli', 'ecoli': 'E. coli', 'escherichia coli': 'E. coli',
  'e. coli (esbl)': 'E. coli', 'e.coli esbl': 'E. coli',

  // ── K. pneumoniae ────────────────────────────────────────────────────────
  'klebsiella': 'K. pneumoniae', 'k. pneumoniae': 'K. pneumoniae',
  'k.pneumoniae': 'K. pneumoniae', 'k pneumoniae': 'K. pneumoniae',
  'klebsiella pneumoniae': 'K. pneumoniae', 'k. pnuemoniae': 'K. pneumoniae',
  'klebsiella pneumoniae (esbl)': 'K. pneumoniae',
  'klebsiella (spp)': 'K. pneumoniae', 'klebsiella spp': 'K. pneumoniae',

  // ── P. aeruginosa ────────────────────────────────────────────────────────
  'pseudomonas': 'P. aeruginosa', 'p. aeruginosa': 'P. aeruginosa',
  'p.aeruginosa': 'P. aeruginosa', 'pseudomonas aeruginosa': 'P. aeruginosa',
  'p. aeruginosa (spp)': 'P. aeruginosa', 'pseudomonas (spp)': 'P. aeruginosa',

  // ── A. baumannii ─────────────────────────────────────────────────────────
  'acinetobacter': 'A. baumannii', 'a. baumannii': 'A. baumannii',
  'a.baumannii': 'A. baumannii', 'acinetobacter baumannii': 'A. baumannii',
  'acinetobacter spp': 'A. baumannii', 'acinetobacter spp.': 'A. baumannii',
  'acinetobacter (spp)': 'A. baumannii', 'acinetobacter baumanii': 'A. baumannii',

  // ── S. aureus / MRSA ─────────────────────────────────────────────────────
  's. aureus': 'S. aureus', 's.aureus': 'S. aureus',
  'staphylococcus aureus': 'S. aureus', 'staph': 'S. aureus', 'staph aureus': 'S. aureus',
  'staphylococcus aureus (mssa)': 'S. aureus',
  'mrsa': 'MRSA', 'methicillin resistant s. aureus': 'MRSA',
  'methicillin-resistant s. aureus': 'MRSA', 'methicillin resistant staphylococcus aureus': 'MRSA',
  'staphylococcus aureus (mrsa)': 'MRSA',

  // ── CoNS ─────────────────────────────────────────────────────────────────
  'staphylococcus non-aureus (spp)': 'CoNS', 'staphylococcus non-aureus spp': 'CoNS',
  'staphylococcus non-aureus': 'CoNS', 'cons': 'CoNS',
  'coagulase negative staphylococci': 'CoNS', 'coagulase negative staph': 'CoNS',
  'coagulase-negative staphylococci': 'CoNS', 'staph non-aureus': 'CoNS',
  'staphylococcus epidermidis': 'CoNS', 'staphylococcus haemolyticus': 'CoNS',
  'staphylococcus saprophyticus': 'CoNS',

  // ── Enterococcus ─────────────────────────────────────────────────────────
  'enterococcus': 'E. faecalis', 'e. faecalis': 'E. faecalis', 'e.faecalis': 'E. faecalis',
  'enterococcus faecalis': 'E. faecalis', 'enterococcus spp': 'E. faecalis',
  'enterococcus (spp)': 'E. faecalis',
  'e. faecium': 'E. faecium', 'e.faecium': 'E. faecium', 'enterococcus faecium': 'E. faecium',
  'enterococcus faecium (vre)': 'E. faecium',
  'enterococcus gallinarum': 'Enterococcus spp.',
  'enterococcus gallinarum/e. casseliflavus': 'Enterococcus spp.',
  'enterococcus casseliflavus': 'Enterococcus spp.',

  // ── E. cloacae / Enterobacter ────────────────────────────────────────────
  'enterobacter': 'E. cloacae', 'e. cloacae': 'E. cloacae', 'e.cloacae': 'E. cloacae',
  'enterobacter cloacae': 'E. cloacae', 'enterobacter (spp)': 'E. cloacae',
  'enterobacter spp': 'E. cloacae', 'enterobacter aerogenes': 'E. cloacae',

  // ── S. marcescens ────────────────────────────────────────────────────────
  'serratia': 'S. marcescens', 's. marcescens': 'S. marcescens', 's.marcescens': 'S. marcescens',
  'serratia marcescens': 'S. marcescens', 'serratia (spp)': 'S. marcescens',

  // ── P. mirabilis / Proteus ───────────────────────────────────────────────
  'proteus': 'P. mirabilis', 'p. mirabilis': 'P. mirabilis', 'p.mirabilis': 'P. mirabilis',
  'proteus mirabilis': 'P. mirabilis', 'proteus mirabillis': 'P. mirabilis',
  'proteus (other spp)': 'Proteus spp.', 'proteus spp': 'Proteus spp.',
  'proteus vulgaris': 'Proteus spp.',

  // ── Citrobacter ──────────────────────────────────────────────────────────
  'citrobacter': 'Citrobacter spp.', 'citrobacter (spp)': 'Citrobacter spp.',
  'citrobacter spp': 'Citrobacter spp.', 'citrobacter spp.': 'Citrobacter spp.',
  'citrobacter freundii': 'Citrobacter spp.', 'citrobacter koseri': 'Citrobacter spp.',

  // ── Enterobacteriaceae ───────────────────────────────────────────────────
  'enterobacteriaceae (other spp)': 'Enterobacteriaceae spp.',
  'enterobacteriaceae other spp': 'Enterobacteriaceae spp.',
  'enterobacteriaceae spp': 'Enterobacteriaceae spp.',
  'other enterobacteriaceae': 'Enterobacteriaceae spp.',

  // ── Providencia / Morganella ─────────────────────────────────────────────
  'providencia spp': 'Providencia spp.', 'providencia': 'Providencia spp.',
  'providencia stuartii': 'Providencia spp.', 'providencia rettgeri': 'Providencia spp.',
  'morganella morganii': 'Morganella spp.', 'morganella': 'Morganella spp.',

  // ── Salmonella / Shigella ────────────────────────────────────────────────
  'salmonella': 'Salmonella spp.', 'salmonella spp': 'Salmonella spp.',
  'salmonella (spp)': 'Salmonella spp.', 'non-typhoidal salmonella': 'Salmonella spp.',
  'shigella': 'Shigella spp.', 'shigella (spp)': 'Shigella spp.',
  'shigella spp': 'Shigella spp.',

  // ── Yersinia ─────────────────────────────────────────────────────────────
  'yersinia': 'Yersinia spp.', 'yersinia enterocoliticae': 'Yersinia spp.',
  'yersinia enterocolitica': 'Yersinia spp.',

  // ── S. pneumoniae / Streptococcus ────────────────────────────────────────
  'streptococcus': 'S. pneumoniae', 's. pneumoniae': 'S. pneumoniae',
  's.pneumoniae': 'S. pneumoniae', 'streptococcus pneumoniae': 'S. pneumoniae',
  's. pyogenes': 'S. pyogenes', 'streptococcus pyogenes': 'S. pyogenes',
  'streptococcus pyogenes (groupna)': 'S. pyogenes',
  'streptococcus pyogenes (group a)': 'S. pyogenes',
  'group a streptococcus': 'S. pyogenes', 'gas': 'S. pyogenes',
  'streptococcus viridans': 'S. viridans', 'viridans streptococci': 'S. viridans',
  'viridans group streptococcus': 'S. viridans',
  'streptococcus spp': 'Streptococcus spp.', 'streptococcus spp.': 'Streptococcus spp.',
  'streptococcus spp (β-hemolytic group)': 'Streptococcus spp.',
  'streptococcus (β hemolytic)': 'Streptococcus spp.',
  'beta haemolytic streptococcus': 'Streptococcus spp.',
  'streptococcus agalactiae': 'Streptococcus spp.',

  // ── Burkholderia ─────────────────────────────────────────────────────────
  'burkholderia cepacia complex': 'B. cepacia', 'burkholderia cepacia': 'B. cepacia',
  'burkholderia': 'B. cepacia',

  // ── H. influenzae ────────────────────────────────────────────────────────
  'hemophilus influenzae': 'H. influenzae', 'haemophilus influenzae': 'H. influenzae',
  'h. influenzae': 'H. influenzae', 'h.influenzae': 'H. influenzae',

  // ── Neisseria ────────────────────────────────────────────────────────────
  'neisseria gonorrhoeae': 'N. gonorrhoeae', 'n. gonorrhoeae': 'N. gonorrhoeae',
  'gonorrhoeae': 'N. gonorrhoeae',
  'neisseria meningitis': 'N. meningitidis', 'neisseria meningitidis': 'N. meningitidis',
  'n. meningitidis': 'N. meningitidis',

  // ── Anaerobes / B. fragilis ──────────────────────────────────────────────
  'bacteroides fragilis': 'B. fragilis', 'b. fragilis': 'B. fragilis',
  'anaerobes': 'Anaerobes', 'anaerobic bacteria': 'Anaerobes',

  // ── Other organisms ──────────────────────────────────────────────────────
  'chlamydia trachomatis': 'C. trachomatis', 'chlamydia': 'C. trachomatis',
  'helicobacter pylori': 'H. pylori', 'h. pylori': 'H. pylori',
  'fusobacterium canifelinum': 'Fusobacterium spp.', 'fusobacterium': 'Fusobacterium spp.',
  'listeria': 'Listeria spp.', 'listeria monocytogenes': 'L. monocytogenes',
  'l. monocytogenes': 'L. monocytogenes',
  'clostridium spp': 'Clostridium spp.', 'clostridium': 'Clostridium spp.',
  'clostridioides difficile': 'C. difficile', 'clostridium difficile': 'C. difficile',
  'c. difficile': 'C. difficile',
  'bacillus': 'Bacillus spp.', 'bacillus spp': 'Bacillus spp.',
  'mycobacterium tuberculosis': 'M. tuberculosis', 'm. tuberculosis': 'M. tuberculosis',
  'candida albicans': 'Candida albicans', 'candida': 'Candida spp.',
  'candida spp': 'Candida spp.',
  'stenotrophomonas maltophilia': 'S. maltophilia', 's. maltophilia': 'S. maltophilia',
};

const ANTIBIOTIC_MAPPINGS: Record<string, string> = {
  'amp': 'Ampicillin',
  'ampicillin': 'Ampicillin',
  'amc': 'Amoxicillin-Clavulanate',
  'amoxicillin-clavulanate': 'Amoxicillin-Clavulanate',
  'augmentin': 'Amoxicillin-Clavulanate',
  'piperacillin': 'Piperacillin-Tazobactam',
  'pipc': 'Piperacillin-Tazobactam',
  'p/taz': 'Piperacillin-Tazobactam',
  'tasbactam': 'Piperacillin-Tazobactam',
  'cro': 'Ceftriaxone',
  'ceftriaxone': 'Ceftriaxone',
  'fep': 'Cefepime',
  'cefepime': 'Cefepime',
  'caz': 'Ceftazidime',
  'ceftazidime': 'Ceftazidime',
  'mero': 'Meropenem',
  'meropenem': 'Meropenem',
  'imie': 'Imipenem',
  'imipenem': 'Imipenem',
  'etp': 'Ertapenem',
  'ertapenem': 'Ertapenem',
  'cip': 'Ciprofloxacin',
  'ciprofloxacin': 'Ciprofloxacin',
  'cipro': 'Ciprofloxacin',
  'lvx': 'Levofloxacin',
  'levofloxacin': 'Levofloxacin',
  'gn': 'Gentamicin',
  'gentamicin': 'Gentamicin',
  'gm': 'Gentamicin',
  'ak': 'Amikacin',
  'amikacin': 'Amikacin',
  'nn': 'Tobramycin',
  'tobramycin': 'Tobramycin',
  'sxt': 'Trimethoprim-Sulfamethoxazole',
  'cotrimoxazole': 'Trimethoprim-Sulfamethoxazole',
  'tmp-smx': 'Trimethoprim-Sulfamethoxazole',
  'nitrofurantoin': 'Nitrofurantoin',
  'nif': 'Nitrofurantoin',
  'vancomycin': 'Vancomycin',
  'va': 'Vancomycin',
  'linezolid': 'Linezolid',
  'lzd': 'Linezolid',
  'daptomycin': 'Daptomycin',
  'tigecycline': 'Tigecycline',
  'colistin': 'Colistin',
  'co': 'Colistin',
};

// ── Extra mappings covering Babil-format spellings and typos ──────────────────
const BABIL_ANTIBIOTIC_EXTRA: Record<string, string> = {
  'flouxacillin': 'Flucloxacillin', 'floxacillin': 'Flucloxacillin', 'flucloxacillin': 'Flucloxacillin',
  'oxacilline': 'Oxacillin', 'oxacillin': 'Oxacillin',
  'amoxicillin': 'Amoxicillin', 'penicillin': 'Penicillin',
  'ampicillin-sulbactam': 'Ampicillin-Sulbactam',
  'piperacillin-tazobactam': 'Piperacillin-Tazobactam',
  'ticarcillin': 'Ticarcillin', 'ticarcillin-clavulanate': 'Ticarcillin-Clavulanate',
  'cefazoline': 'Cefazolin', 'cefazolin': 'Cefazolin',
  'cefotaxime': 'Cefotaxime', 'cefpodoxime': 'Cefpodoxime',
  'cefdinir': 'Cefdinir', 'cephalothin': 'Cephalothin',
  'cefuroxime': 'Cefuroxime', 'cefoxitine': 'Cefoxitin',
  'cefixime': 'Cefixime', 'cefaclor': 'Cefaclor',
  'imipinem': 'Imipenem', 'aztreonam': 'Aztreonam',
  'netilmicin': 'Netilmicin',
  'azithromycin': 'Azithromycin', 'clarithromycin': 'Clarithromycin', 'erythromycin': 'Erythromycin',
  'moxifloxacin': 'Moxifloxacin', 'teicoplanin': 'Teicoplanin',
  'tigecycline': 'Tigecycline', 'tetracycline': 'Tetracycline', 'doxycycline': 'Doxycycline',
  'chloramphenicol': 'Chloramphenicol',
  'trimethoprime-sulfamethoxazole': 'Trimethoprim-Sulfamethoxazole',
  'trimethoprime': 'Trimethoprim', 'sulfisoxazole': 'Sulfisoxazole',
  'rifampiin': 'Rifampicin', 'rifampicin': 'Rifampicin',
  'fosfomycin': 'Fosfomycin', 'clindamycin': 'Clindamycin', 'metronidazole': 'Metronidazole',
  'fucidic acid': 'Fusidic Acid', 'fucidic acid ': 'Fusidic Acid',
};
const ALL_AB_MAPPINGS = { ...ANTIBIOTIC_MAPPINGS, ...BABIL_ANTIBIOTIC_EXTRA };

interface QualityIssue {
  type: 'impossible_pct' | 'count_mismatch' | 'pct_normalized';
  organism: string;
  antibiotic: string;
  detail: string;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function fuzzyMatchAntibiotic(raw: string): string {
  const key = raw.toLowerCase().trim();
  if (ALL_AB_MAPPINGS[key]) return ALL_AB_MAPPINGS[key];
  let best = { name: raw.charAt(0).toUpperCase() + raw.slice(1), dist: 4 };
  for (const [k, v] of Object.entries(ALL_AB_MAPPINGS)) {
    const d = levenshtein(key, k);
    if (d < best.dist) best = { name: v, dist: d };
  }
  return best.name;
}

/**
 * Normalize an organism name string to a canonical form.
 * 1. Exact lookup in ORGANISM_MAPPINGS (with common suffix stripping)
 * 2. Fuzzy Levenshtein match for typos (max distance 3 on short keys)
 * 3. Fallback: capitalize as-is
 */
function normalizeOrganism(raw: string): { name: string; ambiguous: boolean } {
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase();

  // Skip group-divider labels
  if (BABIL_GROUP_LABELS.has(key)) return { name: '', ambiguous: false };

  // Direct lookup
  if (ORGANISM_MAPPINGS[key]) {
    return { name: ORGANISM_MAPPINGS[key], ambiguous: AMBIGUOUS_ORGANISM_KEYS.has(key.split(' ')[0]) };
  }

  // Strip trailing parenthetical noise: "(spp)", "(other spp)", "(group a)", etc.
  const stripped = key.replace(/\s*\([^)]*\)\s*/g, '').replace(/\s+spp\.?$/, '').trim();
  if (stripped !== key && ORGANISM_MAPPINGS[stripped]) {
    return { name: ORGANISM_MAPPINGS[stripped], ambiguous: false };
  }

  // Fuzzy match against all known keys (allow up to distance 3 for longer names)
  let best = { name: '', dist: 999 };
  for (const [k, v] of Object.entries(ORGANISM_MAPPINGS)) {
    if (Math.abs(k.length - key.length) > 5) continue; // quick length filter
    const d = levenshtein(key, k);
    const maxDist = Math.min(3, Math.floor(k.length / 5));
    if (d < best.dist && d <= maxDist) best = { name: v, dist: d };
  }
  if (best.name) return { name: best.name, ambiguous: false };

  // Fallback: title-case
  return { name: trimmed.charAt(0).toUpperCase() + trimmed.slice(1), ambiguous: false };
}

/**
 * Score a row as a potential table header (higher = more likely to be a header).
 * Used for smart header-row detection in any Excel layout.
 */
function scoreAsHeaderRow(row: (string | number | null)[]): number {
  const ORGANISM_KW = ['organism', 'bacteria', 'species', 'isolate', 'pathogen', 'germ',
    'micro', 'bug', 'كائن', 'جرثوم', 'ميكروب', 'عزلة', 'بكتيريا'];
  const ANTIBIOTIC_KW = ['antibiotic', 'antimicrobial', 'drug', 'agent', 'مضاد',
    'دواء', 'عقار', 'antibiogram'];
  const SIR_KW = ['susceptible', 'sensitive', 'intermediate', 'resistant', 'resistance',
    '%', 'percent', 'total', 'tested', 'count', 'n ', ' n', 'مقاوم', 'حساس', 'مجموع'];

  let score = 0;
  const cells = row.map(c => String(c ?? '').toLowerCase().trim()).filter(Boolean);

  if (cells.length === 0) return -10;
  const allNumeric = cells.every(c => !isNaN(Number(c)));
  if (allNumeric) return -5;

  for (const c of cells) {
    if (ORGANISM_KW.some(k => c.includes(k))) score += 4;
    if (ANTIBIOTIC_KW.some(k => c.includes(k))) score += 4;
    if (SIR_KW.some(k => c.includes(k))) score += 3;
    if (Object.keys(ALL_AB_MAPPINGS).some(k => c === k || c.startsWith(k))) score += 2;
    if (c.length >= 2 && c.length <= 40 && isNaN(Number(c))) score += 0.5;
  }
  return score;
}

/**
 * Find the most likely header row index in the first N rows of a sheet.
 */
function findSmartHeaderRow(rows: (string | number | null)[][], maxScan = 15): number {
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const s = scoreAsHeaderRow(rows[i] || []);
    if (s > bestScore) { bestScore = s; bestIdx = i; }
  }
  return bestIdx;
}

/**
 * Auto-detect column semantics from a header row.
 * Returns a mapping of column roles → column indices.
 */
function autoMapFromHeaders(headers: string[]): Record<string, number> {
  const h = headers.map(s => s.toLowerCase().trim());
  const find = (keywords: string[]) => {
    for (const kw of keywords) {
      const idx = h.findIndex(c => c.includes(kw));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  return {
    organism: find(['organism', 'bacteria', 'species', 'isolat', 'pathogen', 'bug', 'germ', 'كائن', 'جرثوم', 'ميكروب', 'عزلة']),
    antibiotic: find(['antibiotic', 'antimicrobial', 'drug', 'agent', 'مضاد', 'دواء']),
    susceptible: find(['susceptible', 'sensitive', ' s ', 'حساس']),
    intermediate: find(['intermediate', ' i ', 'متوسط']),
    resistant: find([' r ', 'resistant count', 'resistant num', 'مقاوم عدد']),
    total: find(['total', 'n ', ' n', 'count', 'number', 'tested', 'مجموع', 'عدد']),
    percent: find(['%', 'percent', 'susceptib', 'نسبة']),
    specimen: find(['specimen', 'sample type', 'source', 'site', 'عينة', 'نوع']),
    patient: find(['patient', 'mrn', 'id', 'مريض', 'رقم']),
    mic: find(['mic', 'minimum inhibitory', 'التركيز']),
  };
}

export interface BabilLayout {
  isBabil: boolean;
  groupRow: number;
  headerRow: number;
  dataRow: number;
  abStartCol: number;   // column index where the first antibiotic triplet begins
  confidence: 'high' | 'medium' | 'low';
}

const BABIL_SAMPLE_KW = [
  'no of sample size', 'no. of sample', 'sample size', 'no of isolates',
  'number of samples', 'number of isolates', 'no. isolates', 'tested',
  'عدد العينات', 'عدد العزلات', 'عدد المعزولات',
];
const BABIL_PCT_KW = [
  '% of resistance', '% resistance', 'percent resistance', '% r',
  'resistance %', 'pct resistance', '% مقاومة', 'نسبة المقاومة',
];

/**
 * Detect the column index where antibiotic triplets begin.
 * Returns the first column (≥ skipCols) whose header matches a sample-size keyword,
 * followed immediately by an antibiotic name and a % keyword.
 */
function findAbStartCol(headerRow: (string | number | null)[], skipCols = 2): number {
  const cells = headerRow.map(c => String(c ?? '').toLowerCase().trim());
  // Look for the pattern: [sample_kw, antibiotic_name, pct_kw] repeating
  for (let c = skipCols; c + 2 < cells.length; c++) {
    const isSample = BABIL_SAMPLE_KW.some(k => cells[c].includes(k));
    const isPct    = BABIL_PCT_KW.some(k => cells[c + 2].includes(k));
    const hasAbName = cells[c + 1].length > 1 && isNaN(Number(cells[c + 1]));
    if (isSample && isPct && hasAbName) return c;
    // Also accept: [antibiotic_name, sample_kw, pct_kw] layout variant
    if (hasAbName && isSample && BABIL_PCT_KW.some(k => cells[c + 2].includes(k))) return c;
  }
  // Fallback: first column after skipCols that has repeating pairs of (numeric-header, %_header)
  for (let c = skipCols; c + 1 < cells.length; c++) {
    if (BABIL_SAMPLE_KW.some(k => cells[c].includes(k)) || BABIL_PCT_KW.some(k => cells[c + 1].includes(k))) return c;
  }
  return skipCols + 1; // default: col 3 in a standard Babil sheet
}

function detectBabilFormatSmart(wb: ReturnType<typeof XLSX.read>): BabilLayout {
  const FALLBACK: BabilLayout = { isBabil: false, groupRow: 3, headerRow: 4, dataRow: 5, abStartCol: 3, confidence: 'low' };
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return FALLBACK;

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (string | number | null)[][];
  if (rows.length < 3) return FALLBACK;

  // Pass 1 — scan rows 0–14 for English/Arabic header keywords in the same or adjacent rows
  for (let ri = 0; ri < Math.min(rows.length, 15); ri++) {
    const cells = (rows[ri] || []).map(c => String(c ?? '').toLowerCase().trim());
    const hasSample = BABIL_SAMPLE_KW.some(k => cells.some(c => c.includes(k)));
    const hasPct    = BABIL_PCT_KW.some(k => cells.some(c => c.includes(k)));
    if (hasSample && hasPct) {
      const abStart = findAbStartCol(rows[ri] || []);
      return { isBabil: true, groupRow: Math.max(0, ri - 1), headerRow: ri, dataRow: ri + 1, abStartCol: abStart, confidence: 'high' };
    }
    // keywords split across two adjacent rows
    if (ri > 0) {
      const prev = (rows[ri - 1] || []).map(c => String(c ?? '').toLowerCase().trim());
      const prevHasSample = BABIL_SAMPLE_KW.some(k => prev.some(c => c.includes(k)));
      const prevHasPct    = BABIL_PCT_KW.some(k => prev.some(c => c.includes(k)));
      if ((hasSample || prevHasSample) && (hasPct || prevHasPct)) {
        const hRow = hasSample ? ri : ri - 1;
        const abStart = findAbStartCol(rows[hRow] || []);
        return { isBabil: true, groupRow: Math.max(0, hRow - 1), headerRow: hRow, dataRow: hRow + 1, abStartCol: abStart, confidence: 'high' };
      }
    }
  }

  // Pass 2 — structural heuristic: look for repeating (num|str, str, num|str) triplet pattern
  for (let ri = 2; ri < Math.min(rows.length, 14); ri++) {
    const row = rows[ri] || [];
    // Find triplet start: scan from col 1 to 6
    for (let startC = 1; startC <= 5; startC++) {
      const slice = row.slice(startC);
      if (slice.length < 9) continue;
      let triplets = 0;
      for (let c = 0; c + 2 < slice.length; c += 3) {
        const isNum = (v: unknown) => v !== null && v !== '' && !isNaN(Number(v));
        const isStr = (v: unknown) => typeof v === 'string' && v.trim().length > 1;
        if ((isNum(slice[c]) || isStr(slice[c])) && isStr(slice[c + 1]) && (isNum(slice[c + 2]) || isStr(slice[c + 2]))) triplets++;
      }
      if (triplets >= 3) {
        return { isBabil: true, groupRow: Math.max(0, ri - 1), headerRow: ri, dataRow: ri + 1, abStartCol: startC, confidence: 'medium' };
      }
    }
  }

  return FALLBACK;
}

function normalizeBabilPct(raw: number, resistant: number, total: number): number {
  if (total > 0) {
    const computed = (resistant / total) * 100;
    if (!isNaN(raw)) {
      return Math.abs(raw * 100 - computed) <= Math.abs(raw - computed) ? raw * 100 : raw;
    }
    return computed;
  }
  return isNaN(raw) ? 0 : raw <= 1.0 ? raw * 100 : raw;
}

export function UploadModal({ hospital, onClose, onSuccess, onHospitalsCreated }: UploadModalProps) {
  const { t, isRTL } = useLanguage();
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [standard, setStandard] = useState<'CLSI' | 'EUCAST'>('CLSI');
  const [periodType, setPeriodType] = useState<'quarterly' | 'semiAnnual' | 'annual'>('annual');
  const [period, setPeriod] = useState<Period>('annual');
  const [parsedData, setParsedData] = useState<ParsedData[]>([]);
  const [importType, setImportType] = useState<'standard' | 'whonet' | 'babil'>('standard');
  const [dedupCount, setDedupCount] = useState(0);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'sheet-select' | 'mapping' | 'preview' | 'uploading' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [babilSheets, setBabilSheets] = useState<string[]>([]);
  const [selectedBabilSheets, setSelectedBabilSheets] = useState<Set<string>>(new Set());
  const [babilLayout, setBabilLayout] = useState<BabilLayout>({ isBabil: false, groupRow: 3, headerRow: 4, dataRow: 5, abStartCol: 3, confidence: 'low' });
  const [babilWorkbook, setBabilWorkbook] = useState<ReturnType<typeof XLSX.read> | null>(null);
  const [qualityIssues, setQualityIssues] = useState<QualityIssue[]>([]);
  const [babilHospitalData, setBabilHospitalData] = useState<Map<string, ParsedData[]>>(new Map());

  const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
  const [excelRows, setExcelRows] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, number>>({
    organism: -1,
    antibiotic: -1,
    susceptible: -1,
    intermediate: -1,
    resistant: -1,
    total: -1,
    percent: -1,
    specimen: -1,
    patient: -1,
    mic: -1,
  });

  const parseExcelFile = useCallback(async (file: File): Promise<ParsedData[]> => {
    // Get raw sheet JSON — use off-thread worker for files >250 KB
    const jsonData: (string | number | null)[][] = await (async () => {
      if (file.size > 250_000) {
        const wd = await parseExcelOffThread(file, true).catch(() => null);
        if (wd) return (wd.sheets[wd.sheetNames[0]] ?? []) as (string | number | null)[][];
      }
      return new Promise<(string | number | null)[][]>((res, rej) => {
        const reader2 = new FileReader();
        reader2.onload = (e) => {
          try {
            const wb = XLSX.read(e.target?.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            res(XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (string | number | null)[][]);
          } catch { rej(new Error(t.upload.error)); }
        };
        reader2.onerror = () => rej(new Error(t.upload.error));
        reader2.readAsArrayBuffer(file);
      });
    })();

    return new Promise((resolve, reject) => {
      const _reader = null as unknown as FileReader; void _reader; // keep closure shape
      const runSync = () => {
        try {

          // Smart header row detection: scan first 15 rows for the best candidate
          const rawRows = jsonData as (string | number | null)[][];
          const headerRow = findSmartHeaderRow(rawRows);
          const headers = (jsonData[headerRow] || []).map(h => String(h || '').trim().toLowerCase());

          if (importType === 'whonet') {
            // WHONET Raw Isolate Parser
            const organismCol = headers.findIndex(h => h.includes('organism') || h.includes('bacteria') || h.includes('species') || h === 'org' || h.includes('كائن'));
            const patientCol = headers.findIndex(h => h.includes('patient') || h.includes('mrn') || h.includes('id') || h.includes('مريض') || h.includes('رقم'));
            const specimenCol = headers.findIndex(h => h.includes('specimen') || h.includes('sample') || h === 'type' || h.includes('نموذج') || h.includes('عينة'));

            // Identify antibiotic columns
            const abCols: { colIndex: number; name: string }[] = [];
            const getAntibioticName = (header: string): string | null => {
              const clean = header.trim().toLowerCase().split('_')[0].split('-')[0];
              if (clean in ANTIBIOTIC_MAPPINGS) {
                return ANTIBIOTIC_MAPPINGS[clean];
              }
              for (const [key, val] of Object.entries(ANTIBIOTIC_MAPPINGS)) {
                if (val.toLowerCase() === clean || val.toLowerCase().replace('-', '') === clean || key === clean) {
                  return val;
                }
              }
              if (clean.length >= 2 && clean.length <= 20) {
                return clean.charAt(0).toUpperCase() + clean.slice(1);
              }
              return null;
            };

            for (let colIndex = 0; colIndex < headers.length; colIndex++) {
              const h = headers[colIndex];
              if (colIndex === organismCol || colIndex === patientCol || colIndex === specimenCol) continue;
              if (h.includes('date') || h.includes('age') || h.includes('sex') || h.includes('gender') || h.includes('ward') || h.includes('location') || h.includes('department') || h.includes('doctor') || h.includes('name')) continue;
              const abName = getAntibioticName(h);
              if (abName) {
                abCols.push({ colIndex, name: abName });
              }
            }

            interface WhonetIsolate {
              organism: string;
              organismRaw: string;
              organismAmbiguous: boolean;
              patient_id?: string;
              specimen_type?: string;
              tests: { antibiotic: string; result: 'S' | 'I' | 'R'; micValue?: string }[];
            }

            const rawIsolates: WhonetIsolate[] = [];

            for (let i = 1; i < jsonData.length; i++) {
              const row = jsonData[i];
              if (!row || row.length === 0) continue;

              const organismRaw = String(row[organismCol >= 0 ? organismCol : 0] || '').trim();
              if (!organismRaw) continue;

              const organismLower = organismRaw.toLowerCase();
              const mappedOrganism = ORGANISM_MAPPINGS[organismLower];
              const organism = mappedOrganism || organismRaw;
              const organismAmbiguous = Boolean(mappedOrganism) && AMBIGUOUS_ORGANISM_KEYS.has(organismLower);

              const patient_id = patientCol >= 0 ? String(row[patientCol] || '').trim() || undefined : undefined;
              const specimen_type = specimenCol >= 0 ? String(row[specimenCol] || '').trim() || undefined : undefined;

              const tests: { antibiotic: string; result: 'S' | 'I' | 'R'; micValue?: string }[] = [];

              abCols.forEach(({ colIndex, name }) => {
                const cellVal = String(row[colIndex] || '').trim().toUpperCase();
                if (!cellVal) return;
                let res: 'S' | 'I' | 'R' | null = null;
                let micValue: string | null = null;

                const cleanCellVal = cellVal.replace(/\s+/g, '');
                if (/^([<>]=?)?[0-9.]+$/.test(cleanCellVal)) {
                  micValue = cleanCellVal;
                }

                if (cellVal.startsWith('S')) res = 'S';
                else if (cellVal.startsWith('I')) res = 'I';
                else if (cellVal.startsWith('R')) res = 'R';
                else {
                  const interpreted = interpret(organism, name, cellVal, standard);
                  if (interpreted !== 'N/A') {
                    res = interpreted;
                  }
                }

                if (res) {
                  tests.push({ antibiotic: name, result: res, micValue: micValue || undefined });
                }
              });

              if (tests.length > 0) {
                rawIsolates.push({
                  organism,
                  organismRaw,
                  organismAmbiguous,
                  patient_id,
                  specimen_type,
                  tests,
                });
              }
            }

            // Apply CLSI M39 first-isolate deduplication: keep only the first organism isolate per patient
            const keptIsolates: WhonetIsolate[] = [];
            const seenPatients = new Set<string>();

            rawIsolates.forEach((iso) => {
              if (!iso.patient_id) {
                keptIsolates.push(iso);
              } else {
                const key = `${iso.patient_id}||${iso.organism}`;
                if (!seenPatients.has(key)) {
                  seenPatients.add(key);
                  keptIsolates.push(iso);
                }
              }
            });

            const removedCount = rawIsolates.length - keptIsolates.length;
            setDedupCount(removedCount);

            // Group and aggregate
            interface Aggregated {
              s: number;
              i: number;
              r: number;
              total: number;
              organismRaw: string;
              organismAmbiguous: boolean;
              mic_distribution: Record<string, number>;
            }

            const aggMap = new Map<string, Aggregated>();

            keptIsolates.forEach((iso) => {
              iso.tests.forEach((t) => {
                const groupKey = `${iso.organism}||${iso.specimen_type || ''}||${t.antibiotic}`;
                let agg = aggMap.get(groupKey);
                if (!agg) {
                  agg = {
                    s: 0,
                    i: 0,
                    r: 0,
                    total: 0,
                    organismRaw: iso.organismRaw,
                    organismAmbiguous: iso.organismAmbiguous,
                    mic_distribution: {},
                  };
                  aggMap.set(groupKey, agg);
                }
                if (t.result === 'S') agg.s++;
                else if (t.result === 'I') agg.i++;
                else if (t.result === 'R') agg.r++;
                agg.total++;

                if (t.micValue) {
                  agg.mic_distribution[t.micValue] = (agg.mic_distribution[t.micValue] || 0) + 1;
                }
              });
            });

            const result: ParsedData[] = [];
            aggMap.forEach((agg, key) => {
              const [organism, specimen_type, antibiotic] = key.split('||');
              const percent = agg.total > 0 ? (agg.s / agg.total) * 100 : 0;
              result.push({
                organism,
                organismRaw: agg.organismRaw,
                organismAmbiguous: agg.organismAmbiguous,
                antibiotic,
                susceptible_count: agg.s,
                intermediate_count: agg.i,
                resistant_count: agg.r,
                total_tested: agg.total,
                susceptible_percent: Math.round(percent * 100) / 100,
                specimen_type: specimen_type || undefined,
                patient_id: undefined,
                mic_distribution: Object.keys(agg.mic_distribution).length > 0 ? agg.mic_distribution : undefined,
              });
            });

            resolve(result);
          } else {
            // Standard Aggregate Parser — with smart auto-mapping
            // First try autoMapFromHeaders for a richer detection pass
            const autoMap = autoMapFromHeaders(headers);
            const organismCol  = autoMap.organism  >= 0 ? autoMap.organism  : headers.findIndex(h => h.includes('organism') || h.includes('bacteria') || h.includes('organismo') || h.includes('isolate') || h.includes('كائن') || h.includes('جرثوم'));
            const antibioticCol = autoMap.antibiotic >= 0 ? autoMap.antibiotic : headers.findIndex(h => h.includes('antibiotic') || h.includes('antimicrobial') || h.includes('antibiótico') || h.includes('drug') || h.includes('agent') || h.includes('مضاد'));
            const sCol     = autoMap.susceptible >= 0 ? autoMap.susceptible : headers.findIndex(h => h === 's' || h.includes('susceptible') || h.includes('sensitive') || h.includes('حساس'));
            const iCol     = autoMap.intermediate >= 0 ? autoMap.intermediate : headers.findIndex(h => h === 'i' || h.includes('intermediate') || h.includes('متوسط'));
            const rCol     = autoMap.resistant >= 0 ? autoMap.resistant : headers.findIndex(h => h === 'r' || h.includes('resistant count') || h.includes('resistant num') || h.includes('مقاوم عدد'));
            const totalCol  = autoMap.total >= 0 ? autoMap.total : headers.findIndex(h => h === 'n' || h === 'total' || h.includes('total') || h.includes('tested') || h.includes('count') || h.includes('مجموع') || h.includes('عدد'));
            const percentCol = autoMap.percent >= 0 ? autoMap.percent : headers.findIndex(h => h.includes('%') || h.includes('percent') || h.includes('susceptibility') || h.includes('نسبة'));
            const specimenCol = autoMap.specimen >= 0 ? autoMap.specimen : headers.findIndex(h => h.includes('specimen') || h.includes('sample') || h === 'type' || h.includes('نموذج') || h.includes('عينة'));
            const patientCol  = autoMap.patient  >= 0 ? autoMap.patient  : headers.findIndex(h => h.includes('patient') || h.includes('mrn') || h.includes('مريض') || h.includes('رقم'));
            const micCol      = autoMap.mic >= 0 ? autoMap.mic : headers.findIndex(h => h.includes('mic') || h.includes('minimum inhibitory') || h.includes('التركيز'));

            if (organismCol < 0 || antibioticCol < 0) {
              const cleanHeaders = (jsonData[headerRow] || []).map(h => String(h || '').trim());
              reject({
                needsMapping: true,
                headers: cleanHeaders,
                jsonData,
                initialMapping: {
                  organism: organismCol, antibiotic: antibioticCol,
                  susceptible: sCol, intermediate: iCol, resistant: rCol,
                  total: totalCol, percent: percentCol,
                  specimen: specimenCol, patient: patientCol, mic: micCol,
                }
              });
              return;
            }

            const result: ParsedData[] = [];

            // Data rows start right after the detected header row
            for (let i = headerRow + 1; i < jsonData.length; i++) {
              const row = jsonData[i];
              if (!row || row.length === 0) continue;

              const organismRaw = String(row[organismCol >= 0 ? organismCol : 0] || '').trim();
              const antibioticRaw = String(row[antibioticCol >= 0 ? antibioticCol : 1] || '').trim();

              if (!organismRaw || !antibioticRaw) continue;
              if (BABIL_GROUP_LABELS.has(organismRaw.toLowerCase())) continue;

              const { name: organism, ambiguous: organismAmbiguous } = normalizeOrganism(organismRaw);
              if (!organism) continue;

              const antibioticLower = antibioticRaw.toLowerCase();
              const antibiotic = fuzzyMatchAntibiotic(antibioticLower);

              const s = sCol >= 0 ? parseInt(String(row[sCol] ?? '')) || 0 : 0;
              const inter = iCol >= 0 ? parseInt(String(row[iCol] ?? '')) || 0 : 0;
              const r = rCol >= 0 ? parseInt(String(row[rCol] ?? '')) || 0 : 0;
              const total = totalCol >= 0 ? parseInt(String(row[totalCol] ?? '')) || 0 : s + inter + r;
              const percent = percentCol >= 0 ? parseFloat(String(row[percentCol] ?? '')) || 0 : (total > 0 ? (s / total) * 100 : 0);
              const specimenRaw = specimenCol >= 0 ? String(row[specimenCol] || '').trim() : '';
              const patientRaw = patientCol >= 0 ? String(row[patientCol] || '').trim() : '';

              const micRaw = micCol >= 0 ? String(row[micCol] || '').trim() : '';
              let mic_distribution: Record<string, number> | undefined = undefined;
              if (micRaw) {
                const cleanMic = micRaw.replace(/\s+/g, '');
                if (/^([<>]=?)?[0-9.]+$/.test(cleanMic)) {
                  const count = total > 0 ? total : (s + inter + r > 0 ? s + inter + r : 1);
                  mic_distribution = { [cleanMic]: count };
                }
              }

              result.push({
                organism,
                organismRaw,
                organismAmbiguous,
                antibiotic,
                susceptible_count: s,
                intermediate_count: inter,
                resistant_count: r,
                total_tested: total,
                susceptible_percent: Math.round(percent * 100) / 100,
                specimen_type: specimenRaw || undefined,
                patient_id: patientRaw || undefined,
                mic_distribution,
              });
            }

            // Standard first-isolate deduplication for aggregate files if patient_id is present
            const hasPatientIds = result.some((r) => r.patient_id);
            if (hasPatientIds) {
              const kept: ParsedData[] = [];
              const seen = new Set<string>();
              result.forEach((r) => {
                if (!r.patient_id) {
                  kept.push(r);
                  return;
                }
                const key = `${r.patient_id}||${r.organism}||${r.specimen_type || ''}||${r.antibiotic}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  kept.push(r);
                }
              });
              setDedupCount(result.length - kept.length);
              resolve(kept);
            } else {
              setDedupCount(0);
              resolve(result);
            }
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error(t.upload.error));
        }
      };
      runSync();
    });
  }, [t.upload.error, importType, standard]);

  const parseBabilSheet = useCallback(
    (workbook: ReturnType<typeof XLSX.read>, sheetNames: string[], layout?: BabilLayout): { data: ParsedData[]; dataBySheet: Map<string, ParsedData[]>; issues: QualityIssue[] } => {
      const result: ParsedData[] = [];
      const dataBySheet = new Map<string, ParsedData[]>();
      const issues: QualityIssue[] = [];

      for (const sheetName of sheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) continue;
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as (string | number | null)[][];

        // Re-detect per sheet for accuracy (each sheet may have slight layout differences)
        const sheetWb = { Sheets: { [sheetName]: worksheet }, SheetNames: [sheetName] } as ReturnType<typeof XLSX.read>;
        const sheetLayout = (layout && layout.confidence === 'high') ? layout : detectBabilFormatSmart(sheetWb);
        const gRowIdx   = sheetLayout.groupRow;
        const hRowIdx   = sheetLayout.headerRow;
        const dRowStart = sheetLayout.dataRow;
        const abStart   = sheetLayout.abStartCol ?? 3; // auto-detected or default

        const groupRow  = (jsonData[gRowIdx]  || []) as (string | number | null)[];
        const headerRow = (jsonData[hRowIdx]  || []) as (string | number | null)[];

        // Build antibiotic-group lookup from groupRow
        const colGroup: Record<number, string> = {};
        let currentGroup = '';
        for (let c = 0; c < groupRow.length; c++) {
          const g = String(groupRow[c] || '').trim();
          if (g && !BABIL_SAMPLE_KW.some(k => g.toLowerCase().includes(k))
                && !BABIL_PCT_KW.some(k => g.toLowerCase().includes(k))) {
            currentGroup = g;
          }
          colGroup[c] = currentGroup;
        }

        // Extract antibiotics starting at abStart, every 3 cols: [sampleSize, abName, %resistance]
        const antibiotics: Array<{ raw: string; name: string; group: string; sampleCol: number; countCol: number; pctCol: number }> = [];
        for (let c = abStart; c + 2 < headerRow.length; c += 3) {
          const label = String(headerRow[c + 1] || '').trim();
          const labelLow = label.toLowerCase();
          // Skip cells that are themselves keyword labels
          if (!label
            || BABIL_SAMPLE_KW.some(k => labelLow.includes(k))
            || BABIL_PCT_KW.some(k => labelLow.includes(k))
            || BABIL_GROUP_LABELS.has(labelLow)) continue;

          antibiotics.push({
            raw: label,
            name: fuzzyMatchAntibiotic(label),
            group: colGroup[c] || 'others',
            sampleCol: c,
            countCol:  c + 1,
            pctCol:    c + 2,
          });
        }

        // Determine which column holds the organism name (usually col 1, sometimes col 0)
        const hCells = headerRow.map(c => String(c ?? '').toLowerCase().trim());
        let orgCol = hCells.findIndex(c => c.includes('isolated') || c.includes('organism') || c.includes('bacteria') || c.includes('isolat'));
        if (orgCol < 0) orgCol = 1; // Babil default

        const seenOrgs = new Set<string>();

        for (let rowIdx = dRowStart; rowIdx < jsonData.length; rowIdx++) {
          const row = jsonData[rowIdx] || [];

          // Try primary org column, fall back to scanning cols 0-2
          let rawOrgName = String(row[orgCol] ?? '').trim();
          if (!rawOrgName) {
            for (let ci = 0; ci <= 2; ci++) {
              const v = String(row[ci] ?? '').trim();
              if (v && !BABIL_GROUP_LABELS.has(v.toLowerCase())) { rawOrgName = v; break; }
            }
          }
          if (!rawOrgName) continue;

          // Skip group-divider labels (e.g. "Gram negative", "Gram positive")
          if (BABIL_GROUP_LABELS.has(rawOrgName.toLowerCase())) continue;

          const { name: mappedOrg, ambiguous: isAmbiguous } = normalizeOrganism(rawOrgName);
          if (!mappedOrg) continue; // normalizeOrganism returned '' for a group label

          seenOrgs.add(mappedOrg.toLowerCase());

          for (const ab of antibiotics) {
            const sampleSize = Number(row[ab.sampleCol]) || 0;
            if (!sampleSize) continue;

            const resistantCount = Math.max(0, Math.round(Number(row[ab.countCol]) || 0));
            const pctRaw = Number(row[ab.pctCol]);

            const pctResistance = normalizeBabilPct(pctRaw, resistantCount, sampleSize);
            const susceptiblePct = Math.max(0, Math.min(100, 100 - pctResistance));
            const susceptibleCount = Math.max(0, sampleSize - resistantCount);

            if (pctResistance > 100 || pctResistance < 0) {
              issues.push({ type: 'impossible_pct', organism: mappedOrg, antibiotic: ab.name, detail: `${pctResistance.toFixed(1)}%` });
            }
            if (resistantCount > sampleSize) {
              issues.push({ type: 'count_mismatch', organism: mappedOrg, antibiotic: ab.name, detail: `R=${resistantCount} > total=${sampleSize}` });
            }
            if (!isNaN(pctRaw) && pctRaw > 0 && pctRaw <= 1.0) {
              issues.push({ type: 'pct_normalized', organism: mappedOrg, antibiotic: ab.name, detail: `${pctRaw} → ${(pctRaw * 100).toFixed(1)}%` });
            }

            const entry: ParsedData = {
              organism: mappedOrg,
              organismRaw: rawOrgName,
              organismAmbiguous: isAmbiguous,
              antibiotic: ab.name,
              susceptible_count: susceptibleCount,
              intermediate_count: 0,
              resistant_count: resistantCount,
              total_tested: sampleSize,
              susceptible_percent: Math.round(susceptiblePct * 100) / 100,
            };
            result.push(entry);
            const sheetBucket = dataBySheet.get(sheetName) || [];
            sheetBucket.push(entry);
            dataBySheet.set(sheetName, sheetBucket);
          }
        }
      }
      return { data: result, dataBySheet, issues };
    },
    []
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleFile = useCallback((selectedFile: File) => {
    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      setError(t.upload.supportedFormats);
      return;
    }
    if (selectedFile.size > MAX_UPLOAD_SIZE_BYTES) {
      setError(`${t.upload.error} ${isRTL ? '(الحد الأقصى لحجم الملف: 10 ميغابايت)' : '(maximum file size: 10 MB)'}`);
      return;
    }

    setFile(selectedFile);
    setError(null);

    // Read file once; auto-detect Babil format or use selected import type
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arrayBuf = e.target?.result;
        const wb = XLSX.read(arrayBuf, { type: 'array' });
        const smartLayout = detectBabilFormatSmart(wb);
        const isBabil = importType === 'babil' || smartLayout.isBabil;

        if (isBabil) {
          if (importType !== 'babil') setImportType('babil');
          setBabilLayout(smartLayout);
          setBabilWorkbook(wb);
          setBabilSheets(wb.SheetNames);
          const first = wb.SheetNames[0] || '';
          setSelectedBabilSheets(new Set([first]));
          setStatus('sheet-select');
          return;
        }

        // Standard / WHONET: fall through to existing parser (reads file again internally)
        setStatus('parsing');
        parseExcelFile(selectedFile)
          .then((data) => {
            const hasPatientIds = data.some((r) => r.patient_id);
            let deduped = data;
            let removed = 0;
            if (hasPatientIds) {
              const seen = new Set<string>();
              deduped = data.filter((r) => {
                if (!r.patient_id) return true;
                const key = `${r.patient_id}||${r.organism}||${r.specimen_type || ''}||${r.antibiotic}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              removed = data.length - deduped.length;
            }
            setDedupCount(removed);
            setParsedData(deduped);
            setStatus('preview');
          })
          .catch((err) => {
            if (err && err.needsMapping) {
              setExcelHeaders(err.headers);
              setExcelRows(err.jsonData);
              setColumnMapping(err.initialMapping);
              setStatus('mapping');
            } else {
              setError(err.message || t.upload.error);
              setStatus('error');
            }
          });
      } catch {
        setError(t.upload.error);
        setStatus('error');
      }
    };
    reader.onerror = () => { setError(t.upload.error); setStatus('error'); };
    reader.readAsArrayBuffer(selectedFile);
  }, [t.upload.supportedFormats, t.upload.error, parseExcelFile, isRTL, importType]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const processMappedData = useCallback((mapping: Record<string, number>, rows: string[][]) => {
    try {
      const organismCol = mapping.organism;
      const antibioticCol = mapping.antibiotic;
      const sCol = mapping.susceptible;
      const iCol = mapping.intermediate;
      const rCol = mapping.resistant;
      const totalCol = mapping.total;
      const percentCol = mapping.percent;
      const specimenCol = mapping.specimen;
      const patientCol = mapping.patient;
      const micCol = mapping.mic;

      const result: ParsedData[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const organismRaw = String(row[organismCol >= 0 ? organismCol : 0] || '').trim();
        const antibioticRaw = String(row[antibioticCol >= 0 ? antibioticCol : 1] || '').trim();

        if (!organismRaw || !antibioticRaw) continue;

        const organismLower = organismRaw.toLowerCase();
        const mappedOrganism = ORGANISM_MAPPINGS[organismLower];
        const organism = mappedOrganism || organismRaw;
        const organismAmbiguous = Boolean(mappedOrganism) && AMBIGUOUS_ORGANISM_KEYS.has(organismLower);

        const antibioticLower = antibioticRaw.toLowerCase();
        const antibiotic = ANTIBIOTIC_MAPPINGS[antibioticLower] || antibioticRaw;

        const s = sCol >= 0 ? parseInt(row[sCol]) || 0 : 0;
        const inter = iCol >= 0 ? parseInt(row[iCol]) || 0 : 0;
        const r = rCol >= 0 ? parseInt(row[rCol]) || 0 : 0;
        const total = totalCol >= 0 ? parseInt(row[totalCol]) || 0 : s + inter + r;
        const percent = percentCol >= 0 ? parseFloat(row[percentCol]) || 0 : (total > 0 ? (s / total) * 100 : 0);
        const specimenRaw = specimenCol >= 0 ? String(row[specimenCol] || '').trim() : '';
        const patientRaw = patientCol >= 0 ? String(row[patientCol] || '').trim() : '';

        const micRaw = micCol >= 0 ? String(row[micCol] || '').trim() : '';
        let mic_distribution: Record<string, number> | undefined = undefined;
        if (micRaw) {
          const cleanMic = micRaw.replace(/\s+/g, '');
          if (/^([<>]=?)?[0-9.]+$/.test(cleanMic)) {
            const count = total > 0 ? total : (s + inter + r > 0 ? s + inter + r : 1);
            mic_distribution = { [cleanMic]: count };
          }
        }

        result.push({
          organism,
          organismRaw,
          organismAmbiguous,
          antibiotic,
          susceptible_count: s,
          intermediate_count: inter,
          resistant_count: r,
          total_tested: total,
          susceptible_percent: Math.round(percent * 100) / 100,
          specimen_type: specimenRaw || undefined,
          patient_id: patientRaw || undefined,
          mic_distribution,
        });
      }

      // Deduplicate if patient_id is present
      const hasPatientIds = result.some((r) => r.patient_id);
      let deduped = result;
      let removed = 0;
      if (hasPatientIds) {
        const seen = new Set<string>();
        deduped = result.filter((r) => {
          if (!r.patient_id) return true;
          const key = `${r.patient_id}||${r.organism}||${r.specimen_type || ''}||${r.antibiotic}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        removed = result.length - deduped.length;
      }
      setDedupCount(removed);
      setParsedData(deduped);
      setStatus('preview');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.upload.error);
      setStatus('error');
    }
  }, [t.upload.error]);

  const handleBabilSheetConfirm = useCallback(() => {
    if (!babilWorkbook || selectedBabilSheets.size === 0) return;
    try {
      const { data, dataBySheet, issues } = parseBabilSheet(babilWorkbook, Array.from(selectedBabilSheets), babilLayout);
      setDedupCount(0);
      setParsedData(data);
      setBabilHospitalData(dataBySheet);
      setQualityIssues(issues);
      setStatus('preview');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.upload.error);
      setStatus('error');
    }
  }, [babilWorkbook, selectedBabilSheets, babilLayout, parseBabilSheet, t.upload.error]);

  const detectedSuperbugs = useMemo(() => {
    const warnings: { type: 'CRE' | 'VRSA'; organism: string; antibiotic: string; resistantCount: number }[] = [];

    const isEnterobacteralesName = (name: string): boolean => {
      const lower = name.toLowerCase();
      return (
        lower.includes('coli') ||
        lower.includes('escherichia') ||
        lower.includes('klebsiella') ||
        lower.includes('enterobacter') ||
        lower.includes('serratia') ||
        lower.includes('proteus') ||
        lower.includes('salmonella') ||
        lower.includes('citrobacter') ||
        lower.includes('providencia') ||
        lower.includes('morganella')
      );
    };

    const isCarbapenem = (ab: string): boolean => {
      const lower = ab.toLowerCase();
      return (
        lower.includes('meropenem') ||
        lower.includes('imipenem') ||
        lower.includes('ertapenem') ||
        lower.includes('doripenem')
      );
    };

    const isStaphAureus = (name: string): boolean => {
      const lower = name.toLowerCase();
      return (
        lower.includes('aureus') ||
        lower.includes('staphylococcus aureus') ||
        lower === 'staph' ||
        lower === 'mrsa'
      );
    };

    const isVancomycin = (ab: string): boolean => {
      return ab.toLowerCase().includes('vancomycin');
    };

    parsedData.forEach((row) => {
      if (row.resistant_count > 0) {
        if (isEnterobacteralesName(row.organism) && isCarbapenem(row.antibiotic)) {
          warnings.push({
            type: 'CRE',
            organism: row.organism,
            antibiotic: row.antibiotic,
            resistantCount: row.resistant_count,
          });
        } else if (isStaphAureus(row.organism) && isVancomycin(row.antibiotic)) {
          warnings.push({
            type: 'VRSA',
            organism: row.organism,
            antibiotic: row.antibiotic,
            resistantCount: row.resistant_count,
          });
        }
      }
    });

    return warnings;
  }, [parsedData]);

  async function handleSubmit() {
    if (parsedData.length === 0) return;
    setStatus('uploading');

    try {
      // ── Multi-hospital Babil path ──────────────────────────────────────────
      // When multiple sheets are selected, each sheet is a separate hospital.
      // Find or auto-create each hospital by sheet name, then upload its data.
      if (importType === 'babil' && babilHospitalData.size > 1) {
        const existingHospitals = await getHospitals();

        for (const [sheetName, sheetData] of babilHospitalData) {
          if (sheetData.length === 0) continue;

          let h = existingHospitals.find(
            (x) => x.name.trim().toLowerCase() === sheetName.trim().toLowerCase(),
          );
          if (!h) {
            const code = sheetName
              .replace(/[^a-zA-Z0-9]/g, '_')
              .toUpperCase()
              .slice(0, 16) + '_' + Date.now().toString(36).toUpperCase();
            h = await createHospital({
              name: sheetName,
              code,
              hospital_type: 'government',
              city: 'Babil',
              country: 'Iraq',
              is_active: true,
            });
            existingHospitals.push(h);
          }

          const uploadRecord = await createUploadRecord({
            hospital_id: h.id,
            filename: file?.name || 'Unknown',
            year, standard, status: 'processing',
            records_count: sheetData.length,
          });

          await insertAntibiogramData(sheetData.map((d) => ({
            hospital_id: h!.id,
            organism: d.organism,
            antibiotic: d.antibiotic,
            susceptible_count: d.susceptible_count,
            intermediate_count: d.intermediate_count,
            resistant_count: d.resistant_count,
            total_tested: d.total_tested,
            susceptible_percent: d.susceptible_percent,
            year, period, standard,
            specimen_type: d.specimen_type || '',
            patient_id: null,
            mic_distribution: d.mic_distribution || null,
          })));

          await Promise.all([
            ensureOrganismsInCatalog(sheetData.map((d) => d.organism)),
            ensureAntibioticsInCatalog(sheetData.map((d) => d.antibiotic)),
          ]).catch(() => {});

          await updateUploadRecord(uploadRecord.id, { status: 'success' });
        }

        setStatus('success');
        setTimeout(() => {
          onHospitalsCreated?.();
          onSuccess();
          onClose();
        }, 2000);
        return;
      }

      // ── Single-hospital path (standard / WHONET / single-sheet Babil) ─────
      if (!hospital) {
        setError(isRTL
          ? 'يُرجى اختيار عدة أوراق من ملف بابل لاستخدام وضع الرفع المتعدد'
          : 'Select multiple Babil sheets to use multi-hospital import, or upload to a specific hospital.');
        setStatus('error');
        return;
      }

      const uploadRecord = await createUploadRecord({
        hospital_id: hospital.id,
        filename: file?.name || 'Unknown',
        year, standard, status: 'processing',
        records_count: parsedData.length,
      });

      await insertAntibiogramData(parsedData.map((d) => ({
        hospital_id: hospital.id,
        organism: d.organism,
        antibiotic: d.antibiotic,
        susceptible_count: d.susceptible_count,
        intermediate_count: d.intermediate_count,
        resistant_count: d.resistant_count,
        total_tested: d.total_tested,
        susceptible_percent: d.susceptible_percent,
        year, period, standard,
        specimen_type: d.specimen_type || '',
        patient_id: null,
        mic_distribution: d.mic_distribution || null,
      })));

      await Promise.all([
        ensureOrganismsInCatalog(parsedData.map((d) => d.organism)),
        ensureAntibioticsInCatalog(parsedData.map((d) => d.antibiotic)),
      ]).catch(() => {});

      await updateUploadRecord(uploadRecord.id, { status: 'success' });

      setStatus('success');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch {
      setError(t.upload.error);
      setStatus('error');
    }
  }

  function downloadTemplate() {
    const template = [
      ['Organism', 'Antibiotic', 'S', 'I', 'R', 'Total', '% Susceptible', 'Specimen Type', 'Patient ID'],
      ['E. coli', 'Ampicillin', 45, 10, 15, 70, 64.3, 'Urine', 'P001'],
      ['E. coli', 'Ceftriaxone', 50, 5, 15, 70, 71.4, 'Urine', 'P001'],
      ['K. pneumoniae', 'Meropenem', 30, 2, 3, 35, 85.7, 'Blood', 'P002'],
      ['P. aeruginosa', 'Piperacillin-Tazobactam', 25, 5, 10, 40, 62.5, 'Sputum', 'P003'],
    ];

    const ws = XLSX.utils.aoa_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Antibiogram Data');
    XLSX.writeFile(wb, 'antibiogram_template.xlsx');
  }

  const handlePeriodTypeChange = (type: 'quarterly' | 'semiAnnual' | 'annual') => {
    setPeriodType(type);
    if (type === 'quarterly') {
      setPeriod('Q1');
    } else if (type === 'semiAnnual') {
      setPeriod('H1');
    } else {
      setPeriod('annual');
    }
  };

  const periodOptions = PERIOD_OPTIONS.filter(opt => {
    if (periodType === 'quarterly') return ['Q1', 'Q2', 'Q3', 'Q4'].includes(opt.value);
    if (periodType === 'semiAnnual') return ['H1', 'H2'].includes(opt.value);
    return false;
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">{t.upload.title}</h2>
            <p className="text-sm text-slate-500">
              {hospital ? hospital.name : (isRTL ? 'رفع ملف متعدد المستشفيات — سيتم الكشف تلقائياً' : 'Multi-Hospital Upload — auto-detected')}
            </p>
          </div>
          <button onClick={onClose} aria-label={isRTL ? 'إغلاق' : 'Close'} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Year and Standard Selection */}
          {(status === 'idle' || status === 'error') && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="upload-year" className="block text-sm font-medium text-slate-700 mb-2">
                    <Calendar className="w-4 h-4 inline-block mr-1" />
                    {t.upload.year}
                  </label>
                  <input
                    id="upload-year"
                    type="number"
                    value={year}
                    onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())}
                    className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                    min="2000"
                    max="2100"
                  />
                </div>
                <div>
                  <label htmlFor="upload-standard" className="block text-sm font-medium text-slate-700 mb-2">
                    {t.upload.standard}
                  </label>
                  <select
                    id="upload-standard"
                    value={standard}
                    onChange={(e) => setStandard(e.target.value as 'CLSI' | 'EUCAST')}
                    className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                  >
                    <option value="CLSI">{t.settings.clsi}</option>
                    <option value="EUCAST">{t.settings.eucast}</option>
                  </select>
                </div>
              </div>

              {/* Period Type Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">
                  <Layers className="w-4 h-4 inline-block mr-1" />
                  {t.upload.period}
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => handlePeriodTypeChange('quarterly')}
                    className={`p-4 rounded-2xl border-2 transition-all ${
                      periodType === 'quarterly'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-center">
                      <p className={`font-semibold ${periodType === 'quarterly' ? 'text-teal-700' : 'text-slate-700'}`}>
                        {t.upload.quarterly}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{isRTL ? 'الربع 1-4' : 'Q1-Q4'}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePeriodTypeChange('semiAnnual')}
                    className={`p-4 rounded-2xl border-2 transition-all ${
                      periodType === 'semiAnnual'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-center">
                      <p className={`font-semibold ${periodType === 'semiAnnual' ? 'text-teal-700' : 'text-slate-700'}`}>
                        {t.upload.semiAnnual}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{isRTL ? 'النصف 1-2' : 'H1-H2'}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePeriodTypeChange('annual')}
                    className={`p-4 rounded-2xl border-2 transition-all ${
                      periodType === 'annual'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-center">
                      <p className={`font-semibold ${periodType === 'annual' ? 'text-teal-700' : 'text-slate-700'}`}>
                        {t.upload.annual}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">{isRTL ? 'السنة كاملة' : 'Full Year'}</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Period Selection */}
              {periodType !== 'annual' && (
                <div>
                  <label htmlFor="upload-period" className="block text-sm font-medium text-slate-700 mb-2">
                    {t.upload.selectPeriod}
                  </label>
                  <select
                    id="upload-period"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value as Period)}
                    className="w-full px-4 py-3 bg-slate-50 rounded-2xl border border-slate-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                  >
                    {periodOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t.antibiogram[opt.labelKey as keyof typeof t.antibiogram]}
                      </option>
                    ))}
                  </select>
                  <p className="text-sm text-slate-500 mt-2 ml-1">
                    {period === 'Q1' && `${t.antibiogram.q1} | ${isRTL ? 'يناير - مارس' : 'January - March'}`}
                    {period === 'Q2' && `${t.antibiogram.q2} | ${isRTL ? 'أبريل - يونيو' : 'April - June'}`}
                    {period === 'Q3' && `${t.antibiogram.q3} | ${isRTL ? 'يوليو - سبتمبر' : 'July - September'}`}
                    {period === 'Q4' && `${t.antibiogram.q4} | ${isRTL ? 'أكتوبر - ديسمبر' : 'October - December'}`}
                    {period === 'H1' && `${t.antibiogram.h1} | ${isRTL ? 'يناير - يونيو' : 'January - June'}`}
                    {period === 'H2' && `${t.antibiogram.h2} | ${isRTL ? 'يوليو - ديسمبر' : 'July - December'}`}
                  </p>
                </div>
              )}
            </>
          )}

          {/* Upload Area */}
          {(status === 'idle' || status === 'error') && (
            <>
              <div
                className={`relative border-2 border-dashed rounded-3xl p-12 text-center transition-all ${
                  dragActive
                    ? 'border-teal-500 bg-teal-50'
                    : 'border-slate-200 hover:border-teal-400 hover:bg-slate-50'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => e.target.files && handleFile(e.target.files[0])}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className={`w-16 h-16 mx-auto mb-4 rounded-2xl ${dragActive ? 'bg-teal-500' : 'bg-slate-200'} flex items-center justify-center transition-colors`}>
                  <Upload className={`w-8 h-8 ${dragActive ? 'text-white' : 'text-slate-400'}`} />
                </div>
                <p className="text-lg font-medium text-slate-700 mb-2">{t.upload.dragDrop}</p>
                <p className="text-sm text-slate-500 mb-4">{t.upload.or}</p>
                <button className="px-4 py-2 bg-teal-500 text-white rounded-xl font-medium hover:bg-teal-600 transition-colors">
                  {t.upload.browse}
                </button>
                <p className="text-xs text-slate-400 mt-4">{t.upload.supportedFormats}</p>
              </div>

              {error && (
                <div className="flex items-center gap-3 p-4 bg-rose-50 text-rose-700 rounded-2xl">
                  <AlertCircle className="w-5 h-5" />
                  <p className="text-sm">{error}</p>
                </div>
              )}

              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 p-4 border border-slate-200 rounded-2xl text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Download className="w-5 h-5" />
                {t.upload.template}
              </button>
            </>
          )}

          {/* Babil Sheet Selector */}
          {status === 'sheet-select' && (
            <div className="space-y-5">
              <div className="flex items-start gap-3 p-4 bg-teal-50 text-teal-800 rounded-2xl border border-teal-200">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-teal-600" />
                <div>
                  <p className="font-semibold text-sm">
                    {isRTL ? `تم كشف تنسيق بابل — ${babilSheets.length} ورقة` : `Babil format detected — ${babilSheets.length} sheet(s)`}
                  </p>
                  <p className="text-xs text-teal-700 mt-1">
                    {isRTL
                      ? 'اختر ورقة واحدة أو أكثر للاستيراد. يمكنك دمج بيانات عدة أوراق في نفس الجلسة.'
                      : 'Select one or more sheets to import. Multiple sheets will be merged into one batch.'}
                  </p>
                </div>
              </div>

              {/* Select-all toggle */}
              <div className="flex items-center justify-between px-1">
                <span className="text-sm font-medium text-slate-700">
                  {isRTL ? 'الأوراق المتاحة' : 'Available sheets'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedBabilSheets.size === babilSheets.length) {
                      setSelectedBabilSheets(new Set());
                    } else {
                      setSelectedBabilSheets(new Set(babilSheets));
                    }
                  }}
                  className="text-xs text-teal-600 hover:text-teal-800 font-medium"
                >
                  {selectedBabilSheets.size === babilSheets.length
                    ? (isRTL ? 'إلغاء الكل' : 'Deselect all')
                    : (isRTL ? 'تحديد الكل' : 'Select all')}
                </button>
              </div>

              {/* Sheet checklist */}
              <div className="space-y-2 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 p-3">
                {babilSheets.map((s) => {
                  const checked = selectedBabilSheets.has(s);
                  return (
                    <label
                      key={s}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                        checked ? 'bg-teal-50 border border-teal-200' : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = new Set(selectedBabilSheets);
                          if (checked) next.delete(s); else next.add(s);
                          setSelectedBabilSheets(next);
                        }}
                        className="w-4 h-4 accent-teal-500"
                      />
                      <span className={`text-sm font-medium ${checked ? 'text-teal-800' : 'text-slate-700'}`}>{s}</span>
                    </label>
                  );
                })}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setStatus('idle');
                    setBabilSheets([]);
                    setSelectedBabilSheets(new Set());
                    setBabilWorkbook(null);
                    setFile(null);
                  }}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleBabilSheetConfirm}
                  disabled={selectedBabilSheets.size === 0}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg shadow-teal-500/30 hover:shadow-xl transition-all disabled:opacity-50"
                >
                  {isRTL
                    ? `قراءة ${selectedBabilSheets.size > 1 ? `${selectedBabilSheets.size} أوراق` : 'الورقة'}`
                    : `Read ${selectedBabilSheets.size > 1 ? `${selectedBabilSheets.size} sheets` : 'sheet'}`}
                </button>
              </div>
            </div>
          )}

          {/* Parsing */}
          {status === 'parsing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-12 h-12 text-teal-500 animate-spin mb-4" />
              <p className="text-lg font-medium text-slate-700">{t.upload.processing}</p>
            </div>
          )}

          {/* Interactive Column Mapper */}
          {status === 'mapping' && (
            <div className="space-y-6">
              <div className="flex items-start gap-3 p-4 bg-amber-50 text-amber-800 rounded-2xl border border-amber-200">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                <div>
                  <p className="font-semibold text-sm">
                    {isRTL ? 'تحديد الأعمدة يدويًا' : 'Column Mapping Required'}
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    {isRTL
                      ? 'لم نتمكن من مطابقة جميع الأعمدة الهامة (الكائن، المضاد الحيوي، S، I، R) تلقائيًا. يرجى تحديد العمود المقابل لكل حقل.'
                      : 'We could not automatically match all critical columns (Organism, Antibiotic, S, I, R). Please select the corresponding column for each field.'}
                  </p>
                </div>
              </div>

              {/* Raw Data Preview */}
              {excelRows.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-700">
                    {isRTL ? 'معاينة ملف البيانات الخام' : 'Raw File Preview (First 3 rows)'}
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 text-xs">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          {excelHeaders.map((h, idx) => (
                            <th key={idx} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">
                              {h || `Column ${idx + 1}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {excelRows.slice(1, 4).map((row, rIdx) => (
                          <tr key={rIdx}>
                            {excelHeaders.map((_, cIdx) => (
                              <td key={cIdx} className="px-3 py-2 text-slate-600 whitespace-nowrap">
                                {row[cIdx] !== undefined ? String(row[cIdx]) : ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Dropdowns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Critical Columns Section */}
                <div className="space-y-4 border border-teal-100 bg-teal-50/30 p-4 rounded-2xl">
                  <h4 className="text-sm font-bold text-teal-800 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                    {isRTL ? 'الأعمدة المطلوبة (الحرجة)' : 'Required Columns'}
                  </h4>
                  <div className="space-y-3">
                    {[
                      { key: 'organism', label: isRTL ? 'الكائن (Organism)' : 'Organism' },
                      { key: 'antibiotic', label: isRTL ? 'المضاد الحيوي (Antibiotic)' : 'Antibiotic' },
                      { key: 'susceptible', label: isRTL ? 'حساس (S)' : 'Susceptible (S)' },
                      { key: 'intermediate', label: isRTL ? 'متوسط (I)' : 'Intermediate (I)' },
                      { key: 'resistant', label: isRTL ? 'مقاوم (R)' : 'Resistant (R)' },
                    ].map((field) => (
                      <div key={field.key} className="flex flex-col gap-1">
                        <label htmlFor={`map-${field.key}`} className="text-xs font-semibold text-slate-600 flex items-center gap-0.5">
                          {field.label}
                          <span className="text-rose-500">*</span>
                        </label>
                        <select
                          id={`map-${field.key}`}
                          value={columnMapping[field.key]}
                          onChange={(e) => setColumnMapping(prev => ({ ...prev, [field.key]: parseInt(e.target.value) }))}
                          className="px-3 py-2 bg-white rounded-xl border border-slate-200 outline-none text-sm focus:border-teal-500"
                        >
                          <option value="-1">-- {isRTL ? 'اختر العمود' : 'Select Column'} --</option>
                          {excelHeaders.map((h, idx) => (
                            <option key={idx} value={idx}>
                              {h ? `${h} (Col ${idx + 1})` : `Col ${idx + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Optional Columns Section */}
                <div className="space-y-4 border border-slate-100 bg-slate-50/50 p-4 rounded-2xl">
                  <h4 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    {isRTL ? 'الأعمدة الاختيارية' : 'Optional Columns'}
                  </h4>
                  <div className="space-y-3">
                    {[
                      { key: 'total', label: isRTL ? 'إجمالي المفحوص (Total)' : 'Total Tested' },
                      { key: 'percent', label: isRTL ? 'نسبة الحساسية (%)' : '% Susceptible' },
                      { key: 'specimen', label: isRTL ? 'نوع العينة (Specimen)' : 'Specimen Type' },
                      { key: 'patient', label: isRTL ? 'رقم المريض (Patient ID)' : 'Patient ID' },
                      { key: 'mic', label: isRTL ? 'تركيز MIC' : 'MIC Value' },
                    ].map((field) => (
                      <div key={field.key} className="flex flex-col gap-1">
                        <label htmlFor={`map-${field.key}`} className="text-xs font-semibold text-slate-600">{field.label}</label>
                        <select
                          id={`map-${field.key}`}
                          value={columnMapping[field.key]}
                          onChange={(e) => setColumnMapping(prev => ({ ...prev, [field.key]: parseInt(e.target.value) }))}
                          className="px-3 py-2 bg-white rounded-xl border border-slate-200 outline-none text-sm focus:border-teal-500"
                        >
                          <option value="-1">-- {isRTL ? 'غير متوفر / تلقائي' : 'Not Provided / Auto'} --</option>
                          {excelHeaders.map((h, idx) => (
                            <option key={idx} value={idx}>
                              {h ? `${h} (Col ${idx + 1})` : `Col ${idx + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setStatus('idle'); setExcelHeaders([]); setExcelRows([]); setFile(null); }}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={() => processMappedData(columnMapping, excelRows)}
                  disabled={
                    columnMapping.organism < 0 ||
                    columnMapping.antibiotic < 0 ||
                    columnMapping.susceptible < 0 ||
                    columnMapping.intermediate < 0 ||
                    columnMapping.resistant < 0
                  }
                  className={`flex-1 px-4 py-3 text-white rounded-2xl font-medium shadow-lg transition-all ${
                    columnMapping.organism >= 0 &&
                    columnMapping.antibiotic >= 0 &&
                    columnMapping.susceptible >= 0 &&
                    columnMapping.intermediate >= 0 &&
                    columnMapping.resistant >= 0
                      ? 'bg-gradient-to-r from-teal-500 to-cyan-600 shadow-teal-500/30 hover:shadow-xl'
                      : 'bg-slate-300 shadow-none cursor-not-allowed'
                  }`}
                >
                  {isRTL ? 'تأكيد المعاينة' : 'Confirm & Preview'}
                </button>
              </div>
            </div>
          )}

          {/* Preview */}
          {status === 'preview' && (
            <>
              <div className="flex items-center gap-3 p-4 bg-emerald-50 text-emerald-700 rounded-2xl">
                <Check className="w-5 h-5" />
                <p className="text-sm">{t.upload.success} ({parsedData.length} {t.hospitals.files})</p>
              </div>

              {/* Multi-hospital breakdown (Babil multi-sheet) */}
              {babilHospitalData.size > 1 && (
                <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-teal-800">
                    {isRTL
                      ? `سيتم الرفع إلى ${babilHospitalData.size} مستشفيات (إنشاء تلقائي إذا لم تكن موجودة)`
                      : `Will upload to ${babilHospitalData.size} hospitals (auto-created if not found)`}
                  </p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {[...babilHospitalData.entries()].map(([sheet, rows]) => (
                      <div key={sheet} className="flex items-center justify-between text-xs text-teal-700">
                        <span className="font-medium">{sheet}</span>
                        <span>{rows.length} {isRTL ? 'سجل' : 'records'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Superbug Warning Box */}
              {detectedSuperbugs.length > 0 && (
                <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600 animate-pulse" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold">
                      {isRTL 
                        ? '⚠️ تحذير بكتيريا مقاومة متعددة (Superbugs)!' 
                        : '⚠️ Critical Resistance Warning: Superbug(s) detected!'}
                    </p>
                    <ul className="list-disc list-inside text-xs space-y-1 mt-1 text-rose-700">
                      {detectedSuperbugs.map((sb, idx) => (
                        <li key={idx}>
                          {isRTL ? (
                            <span>
                              تم العثور على بكتيريا <strong>{sb.organism}</strong> مقاومة لـ <strong>{sb.antibiotic}</strong> ({sb.resistantCount} {sb.type === 'CRE' ? 'CRE' : 'VRSA'})
                            </span>
                          ) : (
                            <span>
                              Detected <strong>{sb.type}</strong>: <em>{sb.organism}</em> resistant to <strong>{sb.antibiotic}</strong> ({sb.resistantCount} resistant isolate(s))
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {parsedData.some((r) => r.organismAmbiguous) && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 text-amber-700 rounded-2xl">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm">
                    {isRTL
                      ? 'بعض الكائنات أُدخلت باسم الجنس فقط واستُنتج النوع تلقائياً (المعلَّمة بعلامة ⚠). راجِعها قبل الحفظ — خاصة Enterococcus و Streptococcus.'
                      : 'Some organisms were entered by genus only and the species was auto-inferred (marked ⚠). Verify them before saving — especially Enterococcus and Streptococcus.'}
                  </p>
                </div>
              )}

              {dedupCount > 0 && (
                <div className="flex items-start gap-3 p-4 bg-sky-50 text-sky-700 rounded-2xl">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm">
                    {isRTL
                      ? `تم حذف ${dedupCount} سجل مكرر (CLSI M39 — العزلة الأولى لكل مريض فقط).`
                      : `${dedupCount} duplicate record(s) removed (CLSI M39 — first isolate per patient only).`}
                  </p>
                </div>
              )}

              {/* Data quality report */}
              {qualityIssues.length > 0 && (
                <details className="rounded-2xl border border-amber-200 bg-amber-50 overflow-hidden">
                  <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer text-sm font-semibold text-amber-800 select-none">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    {isRTL
                      ? `تقرير جودة البيانات — ${qualityIssues.length} ملاحظة`
                      : `Data quality report — ${qualityIssues.length} notice(s)`}
                  </summary>
                  <div className="border-t border-amber-200 max-h-44 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-100/60">
                        <tr>
                          <th className="px-3 py-2 text-right font-medium text-amber-700">{isRTL ? 'النوع' : 'Type'}</th>
                          <th className="px-3 py-2 text-right font-medium text-amber-700">{isRTL ? 'الكائن' : 'Organism'}</th>
                          <th className="px-3 py-2 text-right font-medium text-amber-700">{isRTL ? 'المضاد' : 'Antibiotic'}</th>
                          <th className="px-3 py-2 text-right font-medium text-amber-700">{isRTL ? 'التفاصيل' : 'Detail'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100">
                        {qualityIssues.slice(0, 30).map((q, i) => (
                          <tr key={i} className="hover:bg-amber-50">
                            <td className="px-3 py-1.5 text-amber-700 font-mono">
                              {q.type === 'impossible_pct' ? '⚠ %' : q.type === 'count_mismatch' ? '⚠ R>N' : '↕ norm'}
                            </td>
                            <td className="px-3 py-1.5 text-slate-700">{q.organism}</td>
                            <td className="px-3 py-1.5 text-slate-700">{q.antibiotic}</td>
                            <td className="px-3 py-1.5 text-slate-500 font-mono">{q.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {qualityIssues.length > 30 && (
                      <p className="px-4 py-2 text-xs text-amber-700">
                        {isRTL ? `+ ${qualityIssues.length - 30} ملاحظة أخرى` : `+ ${qualityIssues.length - 30} more notices`}
                      </p>
                    )}
                  </div>
                </details>
              )}

              <div>
                <h3 className="text-lg font-medium text-slate-800 mb-4">{t.upload.preview}</h3>
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">{t.antibiogram.selectOrganism}</th>
                        <th className="px-4 py-3 text-left font-medium text-slate-600">{t.antibiogram.antibiotic}</th>
                        <th className="px-4 py-3 text-center font-medium text-slate-600">S</th>
                        <th className="px-4 py-3 text-center font-medium text-slate-600">I</th>
                        <th className="px-4 py-3 text-center font-medium text-slate-600">R</th>
                        <th className="px-4 py-3 text-center font-medium text-slate-600">{t.antibiogram.total}</th>
                        <th className="px-4 py-3 text-center font-medium text-slate-600">{t.antibiogram.percent}</th>
                        <th className="px-4 py-3 text-center font-medium text-slate-600">{isRTL ? 'النموذج' : 'Specimen'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedData.slice(0, 10).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-slate-800">
                            <span className="inline-flex items-center gap-1">
                              {row.organism}
                              {row.organismAmbiguous && (
                                <AlertCircle
                                  className="w-4 h-4 text-amber-500"
                                  aria-label={`Inferred from "${row.organismRaw}" — verify species`}
                                />
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-800">{row.antibiotic}</td>
                          <td className="px-4 py-3 text-center text-emerald-600 font-medium">{row.susceptible_count}</td>
                          <td className="px-4 py-3 text-center text-amber-600 font-medium">{row.intermediate_count}</td>
                          <td className="px-4 py-3 text-center text-rose-600 font-medium">{row.resistant_count}</td>
                          <td className="px-4 py-3 text-center text-slate-600">{row.total_tested}</td>
                          <td className="px-4 py-3 text-center font-medium">{row.susceptible_percent}%</td>
                          <td className="px-4 py-3 text-center text-slate-500 text-xs">{row.specimen_type || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsedData.length > 10 && (
                  <p className="text-sm text-slate-500 mt-2">{isRTL ? `+ ${parsedData.length - 10} صف إضافي` : `+ ${parsedData.length - 10} more rows`}</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setStatus('idle'); setParsedData([]); setFile(null); }}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-2xl font-medium hover:bg-slate-200 transition-colors"
                >
                  {t.common.cancel}
                </button>
                <button
                  onClick={handleSubmit}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-teal-500 to-cyan-600 text-white rounded-2xl font-medium shadow-lg shadow-teal-500/30 hover:shadow-xl transition-all"
                >
                  {t.upload.submit}
                </button>
              </div>
            </>
          )}

          {/* Uploading */}
          {status === 'uploading' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-12 h-12 text-teal-500 animate-spin mb-4" />
              <p className="text-lg font-medium text-slate-700">{t.upload.uploading}</p>
            </div>
          )}

          {/* Success */}
          {status === 'success' && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-4">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="text-lg font-medium text-slate-700">{t.upload.success}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
