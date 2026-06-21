/**
 * AntibioGram Pro — Core Calculation Engine
 *
 * All medical math lives here. Every function is pure and testable.
 * Imports computeSIR / wilson95CI from clinical.ts so there is one
 * source of truth for the fundamental formula:
 *
 *   %S = (S / N) × 100
 *   %I = (I / N) × 100
 *   %R = (R / N) × 100
 *
 * Never: %R = 100 − %S  (wrong when I > 0)
 */

import { computeSIR, wilson95CI, MIN_RELIABLE_ISOLATES, isReliable } from './clinical';

export { computeSIR, wilson95CI, isReliable, MIN_RELIABLE_ISOLATES };

// ─── Types ───────────────────────────────────────────────────────────────────

export type AMRPhenotype =
  | 'MRSA' | 'VRSA' | 'VRE'
  | 'CRE'  | 'CRAB' | 'CRPA'
  | 'ESBL' | 'MDR'  | 'XDR' | 'PDR';

export interface AMRAlert {
  phenotype: AMRPhenotype;
  organism: string;
  antibiotic: string;
  confidence: 'Possible' | 'Probable';
  reason: string;
}

export interface AntibioticResult {
  antibiotic: string;
  resistant_count: number;
  susceptible_count: number;
  intermediate_count: number;
  total_tested: number;
}

// ─── AMR Phenotype Detection ─────────────────────────────────────────────────

/**
 * Rule-based AMR phenotype detection.
 * Every alert carries its triggering rule so the UI can display it.
 * Does NOT auto-diagnose clinical infections.
 */
export function detectAMRPhenotypes(
  organism: string,
  antibiotics: AntibioticResult[],
): AMRAlert[] {
  const alerts: AMRAlert[] = [];
  const org = organism.toLowerCase();

  const firstResistant = (patterns: string[]): AntibioticResult | null => {
    for (const ab of antibiotics) {
      const name = ab.antibiotic.toLowerCase();
      if (patterns.some((p) => name.includes(p)) && ab.resistant_count > 0) return ab;
    }
    return null;
  };

  const isStaph       = org.includes('aureus') || org === 'mrsa' || org.includes('staphylococcus');
  const isEntero      = /e\.?\s*coli|klebsiella|enterobacter|serratia|proteus|salmonella|citrobacter|morganella|providencia/.test(org);
  const isPseudo      = org.includes('aeruginosa') || org.includes('pseudomonas');
  const isAcinetob    = org.includes('baumannii') || org.includes('acinetobacter');
  const isEnterococ   = org.includes('faecalis') || org.includes('faecium') || org.includes('enterococcus');

  if (isStaph) {
    const hit = firstResistant(['oxacillin', 'cefoxitin', 'methicillin']);
    if (hit) alerts.push({ phenotype: 'MRSA', organism, antibiotic: hit.antibiotic, confidence: 'Possible',
      reason: `${organism} resistant to ${hit.antibiotic} (MRSA screen)` });
    const vhit = firstResistant(['vancomycin']);
    if (vhit) alerts.push({ phenotype: 'VRSA', organism, antibiotic: vhit.antibiotic, confidence: 'Possible',
      reason: `${organism} resistant to ${vhit.antibiotic} — possible VRSA` });
  }

  if (isEnterococ) {
    const hit = firstResistant(['vancomycin', 'teicoplanin']);
    if (hit) alerts.push({ phenotype: 'VRE', organism, antibiotic: hit.antibiotic, confidence: 'Possible',
      reason: `${organism} resistant to ${hit.antibiotic} — possible VRE` });
  }

  if (isEntero) {
    const carba = firstResistant(['meropenem', 'imipenem', 'ertapenem', 'doripenem']);
    if (carba) alerts.push({ phenotype: 'CRE', organism, antibiotic: carba.antibiotic, confidence: 'Possible',
      reason: `${organism} resistant to ${carba.antibiotic} — possible CRE` });
    const esbl = firstResistant(['ceftriaxone', 'cefotaxime', 'ceftazidime', 'cefepime', 'cefixime']);
    if (esbl) alerts.push({ phenotype: 'ESBL', organism, antibiotic: esbl.antibiotic, confidence: 'Possible',
      reason: `${organism} resistant to ${esbl.antibiotic} — possible ESBL producer` });
  }

  if (isAcinetob) {
    const hit = firstResistant(['meropenem', 'imipenem', 'ertapenem', 'doripenem']);
    if (hit) alerts.push({ phenotype: 'CRAB', organism, antibiotic: hit.antibiotic, confidence: 'Possible',
      reason: `${organism} resistant to ${hit.antibiotic} — possible CRAB` });
  }

  if (isPseudo) {
    const hit = firstResistant(['meropenem', 'imipenem', 'doripenem']);
    if (hit) alerts.push({ phenotype: 'CRPA', organism, antibiotic: hit.antibiotic, confidence: 'Possible',
      reason: `${organism} resistant to ${hit.antibiotic} — possible CRPA` });
  }

  return alerts;
}

// ─── Drug Class Mapping ───────────────────────────────────────────────────────

const DRUG_CLASSES: Record<string, string[]> = {
  Penicillins:            ['ampicillin', 'amoxicillin', 'piperacillin', 'flucloxacillin', 'oxacillin', 'penicillin'],
  'Beta-lactam/BLI':     ['amoxicillin-clavulanate', 'ampicillin-sulbactam', 'piperacillin-tazobactam', 'ticarcillin-clavulanate'],
  'Cephalosporins 1st':  ['cefazolin', 'cephalothin', 'cefadroxil'],
  'Cephalosporins 2nd':  ['cefuroxime', 'cefoxitin', 'cefaclor'],
  'Cephalosporins 3rd':  ['ceftriaxone', 'cefotaxime', 'ceftazidime', 'cefixime', 'cefdinir', 'cefpodoxime'],
  'Cephalosporins 4th':  ['cefepime'],
  Carbapenems:            ['meropenem', 'imipenem', 'ertapenem', 'doripenem'],
  Monobactams:            ['aztreonam'],
  Fluoroquinolones:       ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'norfloxacin'],
  Aminoglycosides:        ['gentamicin', 'amikacin', 'tobramycin', 'netilmicin'],
  Macrolides:             ['azithromycin', 'clarithromycin', 'erythromycin'],
  Tetracyclines:          ['tetracycline', 'doxycycline', 'tigecycline'],
  Glycopeptides:          ['vancomycin', 'teicoplanin'],
  Oxazolidinones:         ['linezolid'],
  Sulfonamides:           ['trimethoprim-sulfamethoxazole', 'trimethoprim', 'sulfisoxazole'],
  Polymyxins:             ['colistin', 'polymyxin b'],
  Fosfomycin:             ['fosfomycin'],
  Nitrofurans:            ['nitrofurantoin'],
  Rifamycins:             ['rifampicin', 'rifampin'],
  Lincosamides:           ['clindamycin'],
  Fusidanes:              ['fusidic acid'],
};

export function getDrugClass(antibiotic: string): string | null {
  const name = antibiotic.toLowerCase().trim();
  for (const [cls, members] of Object.entries(DRUG_CLASSES)) {
    if (members.some((m) => name.includes(m) || m.includes(name))) return cls;
  }
  return null;
}

// ─── MDR / XDR / PDR ─────────────────────────────────────────────────────────

export interface MDRResult {
  classification: 'MDR' | 'XDR' | 'PDR' | 'Non-MDR' | 'Insufficient data';
  resistantClasses: string[];
  testedClasses: string[];
  resistantCount: number;
  totalClassesTested: number;
  note: string;
}

/**
 * Magiorakos et al. 2012 (CMI) consensus definitions:
 *   MDR — non-susceptible to ≥1 agent in ≥3 antibiotic categories
 *   XDR — non-susceptible in all but ≤2 categories (and ≥3 total)
 *   PDR — non-susceptible to all agents in all tested categories
 */
export function classifyMDR(
  antibiotics: AntibioticResult[],
  minClassesRequired = 3,
): MDRResult {
  const resistantClasses = new Set<string>();
  const testedClasses    = new Set<string>();

  // In population antibiograms, require ≥5% resistance rate before flagging a
  // class as resistant — prevents a single stray isolate in a large dataset from
  // triggering MDR classification (Magiorakos 2012 applies per-isolate; 5% is a
  // practical epidemiological threshold for cumulative antibiogram data).
  for (const ab of antibiotics) {
    const cls = getDrugClass(ab.antibiotic);
    if (!cls) continue;
    testedClasses.add(cls);
    const rate = ab.resistant_count / Math.max(1, ab.total_tested);
    if (rate >= 0.05) resistantClasses.add(cls);
  }

  const total     = testedClasses.size;
  const resistant = resistantClasses.size;

  if (total < minClassesRequired) {
    return {
      classification: 'Insufficient data',
      resistantClasses: [...resistantClasses],
      testedClasses:    [...testedClasses],
      resistantCount:   resistant,
      totalClassesTested: total,
      note: `Only ${total} drug class(es) tested — need ≥${minClassesRequired} to classify`,
    };
  }

  let classification: MDRResult['classification'];
  let note: string;

  if (resistant === total) {
    classification = 'PDR';
    note = `Pan-Drug Resistant: resistant to all ${total} tested drug classes`;
  } else if (resistant >= total - 2 && resistant >= 3) {
    classification = 'XDR';
    note = `Extensively Drug Resistant: susceptible to only ${total - resistant} class(es)`;
  } else if (resistant >= 3) {
    classification = 'MDR';
    note = `Multi-Drug Resistant: resistant to ${resistant} of ${total} drug classes`;
  } else {
    classification = 'Non-MDR';
    note = `Resistant to ${resistant} class(es) — does not meet MDR threshold`;
  }

  return {
    classification,
    resistantClasses: [...resistantClasses],
    testedClasses:    [...testedClasses],
    resistantCount:   resistant,
    totalClassesTested: total,
    note,
  };
}

// ─── Wilson CI helper ─────────────────────────────────────────────────────────

export function wilsonCI(successes: number, total: number) {
  return wilson95CI(successes, total);
}

// ─── Mandatory Calculation Test Suite ────────────────────────────────────────

export interface CalcTestResult {
  name: string;
  passed: boolean;
  input: { s: number; i: number; r: number; n: number };
  expected: { pctS: number; pctI: number; pctR: number; reliable: boolean };
  actual:   { pctS: number; pctI: number; pctR: number; reliable: boolean };
  error?: string;
}

function approxEq(a: number, b: number, tol = 0.15): boolean {
  return Math.abs(a - b) <= tol;
}

/**
 * Runs the 5 mandatory test cases from the specification.
 * Returns results so callers can render a pass/fail dashboard.
 */
export function runCalculationTests(): CalcTestResult[] {
  const cases: Array<{
    name: string;
    s: number; i: number; r: number;
    expS: number; expI: number; expR: number;
    expReliable: boolean;
  }> = [
    { name: 'Test 1 — S=2 I=0 R=3 N=5 (→ 40%S 60%R)',         s: 2,  i: 0, r: 3,  expS: 40,  expI: 0,     expR: 60,   expReliable: false },
    { name: 'Test 2 — S=1 I=0 R=0 N=1 (→ 100%S low)',         s: 1,  i: 0, r: 0,  expS: 100, expI: 0,     expR: 0,    expReliable: false },
    { name: 'Test 3 — S=0 I=0 R=1 N=1 (→ 0%S 100%R low)',     s: 0,  i: 0, r: 1,  expS: 0,   expI: 0,     expR: 100,  expReliable: false },
    { name: 'Test 4 — S=15 I=0 R=0 N=15 (→ 100%S low)',       s: 15, i: 0, r: 0,  expS: 100, expI: 0,     expR: 0,    expReliable: false },
    { name: 'Test 5 — S=15 I=5 R=10 N=30 (→ 50%S 16.7%I 33.3%R)', s: 15, i: 5, r: 10, expS: 50, expI: 16.7, expR: 33.3, expReliable: true },
  ];

  return cases.map((tc) => {
    const n = tc.s + tc.i + tc.r;
    const sir = computeSIR({
      susceptible_count:  tc.s,
      intermediate_count: tc.i,
      resistant_count:    tc.r,
      total_tested:       n,
      susceptible_percent: 0,
    });

    const passed =
      approxEq(sir.susceptible,  tc.expS) &&
      approxEq(sir.intermediate, tc.expI) &&
      approxEq(sir.resistant,    tc.expR) &&
      sir.reliable === tc.expReliable;

    return {
      name: tc.name,
      passed,
      input:    { s: tc.s, i: tc.i, r: tc.r, n },
      expected: { pctS: tc.expS, pctI: tc.expI, pctR: tc.expR, reliable: tc.expReliable },
      actual:   { pctS: sir.susceptible, pctI: sir.intermediate, pctR: sir.resistant, reliable: sir.reliable },
      error: passed ? undefined
        : `%S: expected ${tc.expS} got ${sir.susceptible} | %I: expected ${tc.expI} got ${sir.intermediate} | %R: expected ${tc.expR} got ${sir.resistant}`,
    };
  });
}
