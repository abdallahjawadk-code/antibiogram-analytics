/**
 * Clinical logic for antibiogram interpretation.
 *
 * Centralizes the rules that were previously scattered (and inconsistent)
 * across UI components so they can be reasoned about and unit-tested in one
 * place. References: CLSI M39 (Analysis and Presentation of Cumulative
 * Antimicrobial Susceptibility Test Data).
 */
import { AntibiogramData } from '../types/database';

/**
 * CLSI M39 recommends NOT reporting a cumulative %S for any organism/antibiotic
 * combination tested on fewer than 30 isolates, because the estimate is
 * statistically unreliable. Combinations below this count should be flagged or
 * withheld rather than charted as if equivalent to a large sample.
 */
export const MIN_RELIABLE_ISOLATES = 30;

export function isReliable(totalTested: number): boolean {
  return totalTested >= MIN_RELIABLE_ISOLATES;
}

export interface SIRBreakdown {
  /** % susceptible (0–100) */
  susceptible: number;
  /** % intermediate (0–100) */
  intermediate: number;
  /** % resistant (0–100) */
  resistant: number;
  total: number;
  /** true when total >= MIN_RELIABLE_ISOLATES */
  reliable: boolean;
}

/**
 * Derive S/I/R percentages from the raw counts so they always sum to ~100 and
 * can never produce a negative "resistant" value. The stored
 * susceptible_percent is only used as a fallback when counts are unavailable.
 */
export function computeSIR(d: Pick<AntibiogramData,
  'susceptible_count' | 'intermediate_count' | 'resistant_count' | 'total_tested' | 'susceptible_percent'>): SIRBreakdown {
  const total = d.total_tested
    || (d.susceptible_count + d.intermediate_count + d.resistant_count);

  if (total > 0 && (d.susceptible_count || d.intermediate_count || d.resistant_count)) {
    const susceptible = (d.susceptible_count / total) * 100;
    const intermediate = (d.intermediate_count / total) * 100;
    const resistant = (d.resistant_count / total) * 100;
    return {
      susceptible: round1(susceptible),
      intermediate: round1(intermediate),
      resistant: round1(resistant),
      total,
      reliable: isReliable(total),
    };
  }

  // Fallback: only a stored %S is available.
  const susceptible = clampPct(d.susceptible_percent || 0);
  return {
    susceptible: round1(susceptible),
    intermediate: 0,
    resistant: round1(100 - susceptible),
    total,
    reliable: isReliable(total),
  };
}

/**
 * True resistance rate (%R), NOT 100 − %S. The latter incorrectly folds
 * intermediate isolates into "resistant" and overstates the rate.
 */
export function resistanceRate(d: Pick<AntibiogramData,
  'susceptible_count' | 'intermediate_count' | 'resistant_count' | 'total_tested' | 'susceptible_percent'>): number {
  return computeSIR(d).resistant;
}

/**
 * Antibiogram display thresholds for %S. These are presentation/surveillance
 * cut-offs (institutional), not CLSI/EUCAST clinical breakpoints — exposed as
 * a single source of truth so the chart and the legend never diverge.
 */
export const SUSCEPTIBILITY_THRESHOLDS = {
  /** %S at or above this is shown as "good" (green) */
  good: 80,
  /** %S at or above this (but below good) is "moderate" (amber) */
  moderate: 60,
} as const;

export type SusceptibilityBand = 'good' | 'moderate' | 'poor';

export function susceptibilityBand(percentS: number): SusceptibilityBand {
  if (percentS >= SUSCEPTIBILITY_THRESHOLDS.good) return 'good';
  if (percentS >= SUSCEPTIBILITY_THRESHOLDS.moderate) return 'moderate';
  return 'poor';
}

export const BAND_COLORS: Record<SusceptibilityBand, string> = {
  good: '#10b981',     // emerald
  moderate: '#f59e0b', // amber
  poor: '#ef4444',     // red
};

/**
 * Wilson score 95% confidence interval for a proportion, returned as
 * percentage bounds. Preferred over the normal approximation for the small
 * denominators common in antibiograms. `successes` = susceptible count.
 */
export function wilson95CI(successes: number, total: number): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 0 };
  const z = 1.959964; // 95%
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    low: round1(Math.max(0, center - margin) * 100),
    high: round1(Math.min(1, center + margin) * 100),
  };
}

/**
 * Flag a clinically meaningful shift in %S between two periods. Threshold is
 * percentage points; default 15pp is a common surveillance trigger.
 */
export function susceptibilityShift(
  previousPercentS: number,
  currentPercentS: number,
  thresholdPP = 15,
): 'improving' | 'worsening' | 'stable' {
  const delta = currentPercentS - previousPercentS;
  if (delta >= thresholdPP) return 'improving';
  if (delta <= -thresholdPP) return 'worsening';
  return 'stable';
}

/**
 * WISCA-style weighted empiric coverage.
 *
 * For a set of organisms (a syndrome), estimates the probability that each
 * antibiotic would cover an unknown pathogen, weighting each organism by how
 * common it is (its isolate count). This answers "which drug is most likely to
 * work empirically?" rather than the per-bug %S of a standard antibiogram.
 *
 * Computed from aggregated counts, so it is an approximation — a per-isolate
 * model (planned) yields exact prevalence weights and true combination cover.
 */
export interface CoverageRow {
  antibiotic: string;
  /** weighted % of expected pathogens covered (0–100) */
  coverage: number;
  /** total isolates contributing */
  isolates: number;
  /** number of organisms contributing */
  organisms: number;
  reliable: boolean;
}

export function weightedCoverage(
  rows: Array<Pick<AntibiogramData, 'organism' | 'antibiotic' | 'susceptible_count' | 'intermediate_count' | 'resistant_count' | 'total_tested' | 'susceptible_percent'>>,
  organisms?: string[],
): CoverageRow[] {
  const filtered = organisms && organisms.length
    ? rows.filter((r) => organisms.includes(r.organism))
    : rows;

  // Organism prevalence weight ≈ its isolate count (max tested across drugs,
  // since not every isolate is tested against every antibiotic).
  const weight: Record<string, number> = {};
  filtered.forEach((r) => {
    weight[r.organism] = Math.max(weight[r.organism] || 0, r.total_tested || 0);
  });

  const byAntibiotic: Record<string, typeof filtered> = {};
  filtered.forEach((r) => { (byAntibiotic[r.antibiotic] ||= []).push(r); });

  const out: CoverageRow[] = [];
  for (const [antibiotic, rs] of Object.entries(byAntibiotic)) {
    let weightedNum = 0;
    let weightDen = 0;
    let isolates = 0;
    const orgs = new Set<string>();
    for (const r of rs) {
      const w = weight[r.organism] || r.total_tested || 0;
      if (w <= 0) continue;
      weightedNum += w * computeSIR(r).susceptible;
      weightDen += w;
      isolates += r.total_tested || 0;
      orgs.add(r.organism);
    }
    if (weightDen > 0) {
      out.push({
        antibiotic,
        coverage: round1(weightedNum / weightDen),
        isolates,
        organisms: orgs.size,
        reliable: isolates >= MIN_RELIABLE_ISOLATES,
      });
    }
  }
  return out.sort((a, b) => b.coverage - a.coverage);
}

/**
 * Coverage display bands for WISCA-style empiric therapy.
 *
 * Intentionally stricter than susceptibilityBand (which uses 80/60%) because
 * empiric therapy means choosing a drug blindly — higher confidence is required
 * before calling a regimen "good". Clinical consensus (IDSA/ASHP) suggests ≥90%
 * empiric coverage as a reasonable target for high-risk syndromes.
 */
export function coverageBand(coverage: number): SusceptibilityBand {
  if (coverage >= 90) return 'good';
  if (coverage >= 80) return 'moderate';
  return 'poor';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export interface Breakpoint {
  organismGroup: 'Enterobacterales' | 'Pseudomonas' | 'Acinetobacter' | 'Staphylococcus' | 'Enterococcus' | 'Streptococcus' | 'Other';
  antibiotic: string;
  standard: 'CLSI' | 'EUCAST';
  sLimit: number; // MIC <= sLimit is S
  rLimit: number; // MIC >= rLimit is R
}

// EUCAST rLimit convention: EUCAST defines R as "MIC > X" (strictly greater).
// For non-contiguous breakpoints (I zone exists), rLimit is set to the NEXT
// 2-fold dilution above X so that `conc >= rLimit` correctly excludes the last
// intermediate value. E.g. EUCAST "R > 8" → rLimit = 16 (MIC=8 → I, MIC=16 → R).
// For contiguous breakpoints (S ≤ X, R > X, no I), sLimit = rLimit = X works
// correctly because the sLimit check fires first for MIC = X.
export const BREAKPOINTS_DATA: Breakpoint[] = [
  // Enterobacterales (E. coli, Klebsiella, Proteus, etc.)
  { organismGroup: 'Enterobacterales', antibiotic: 'Ampicillin',            standard: 'CLSI',   sLimit: 8,    rLimit: 32 },
  { organismGroup: 'Enterobacterales', antibiotic: 'Ampicillin',            standard: 'EUCAST', sLimit: 8,    rLimit: 8  },  // R>8, contiguous
  { organismGroup: 'Enterobacterales', antibiotic: 'Amoxicillin-Clavulanate', standard: 'CLSI', sLimit: 8,   rLimit: 32 },
  { organismGroup: 'Enterobacterales', antibiotic: 'Amoxicillin-Clavulanate', standard: 'EUCAST', sLimit: 8, rLimit: 8  },  // R>8, contiguous
  { organismGroup: 'Enterobacterales', antibiotic: 'Ceftriaxone',           standard: 'CLSI',   sLimit: 1,    rLimit: 4  },
  { organismGroup: 'Enterobacterales', antibiotic: 'Ceftriaxone',           standard: 'EUCAST', sLimit: 1,    rLimit: 4  },  // R>2 → next=4
  { organismGroup: 'Enterobacterales', antibiotic: 'Cefepime',              standard: 'CLSI',   sLimit: 2,    rLimit: 16 },
  { organismGroup: 'Enterobacterales', antibiotic: 'Cefepime',              standard: 'EUCAST', sLimit: 1,    rLimit: 8  },  // R>4 → next=8
  { organismGroup: 'Enterobacterales', antibiotic: 'Ceftazidime',           standard: 'CLSI',   sLimit: 4,    rLimit: 16 },
  { organismGroup: 'Enterobacterales', antibiotic: 'Ceftazidime',           standard: 'EUCAST', sLimit: 1,    rLimit: 8  },  // R>4 → next=8
  { organismGroup: 'Enterobacterales', antibiotic: 'Meropenem',             standard: 'CLSI',   sLimit: 1,    rLimit: 4  },
  { organismGroup: 'Enterobacterales', antibiotic: 'Meropenem',             standard: 'EUCAST', sLimit: 2,    rLimit: 16 },  // R>8 → next=16
  { organismGroup: 'Enterobacterales', antibiotic: 'Imipenem',              standard: 'CLSI',   sLimit: 1,    rLimit: 4  },
  { organismGroup: 'Enterobacterales', antibiotic: 'Imipenem',              standard: 'EUCAST', sLimit: 2,    rLimit: 16 },  // R>8 → next=16
  { organismGroup: 'Enterobacterales', antibiotic: 'Gentamicin',            standard: 'CLSI',   sLimit: 4,    rLimit: 16 },
  { organismGroup: 'Enterobacterales', antibiotic: 'Gentamicin',            standard: 'EUCAST', sLimit: 2,    rLimit: 8  },  // R>4 → next=8
  { organismGroup: 'Enterobacterales', antibiotic: 'Ciprofloxacin',         standard: 'CLSI',   sLimit: 0.25, rLimit: 1  },
  { organismGroup: 'Enterobacterales', antibiotic: 'Ciprofloxacin',         standard: 'EUCAST', sLimit: 0.25, rLimit: 1  },  // R>0.5 → next=1

  // Pseudomonas aeruginosa
  { organismGroup: 'Pseudomonas', antibiotic: 'Piperacillin-Tazobactam', standard: 'CLSI',   sLimit: 16, rLimit: 128 },
  { organismGroup: 'Pseudomonas', antibiotic: 'Piperacillin-Tazobactam', standard: 'EUCAST', sLimit: 16, rLimit: 16  },  // R>16, contiguous
  { organismGroup: 'Pseudomonas', antibiotic: 'Ceftazidime',             standard: 'CLSI',   sLimit: 8,  rLimit: 32  },
  { organismGroup: 'Pseudomonas', antibiotic: 'Ceftazidime',             standard: 'EUCAST', sLimit: 8,  rLimit: 8   },  // R>8, contiguous
  { organismGroup: 'Pseudomonas', antibiotic: 'Cefepime',                standard: 'CLSI',   sLimit: 8,  rLimit: 32  },
  { organismGroup: 'Pseudomonas', antibiotic: 'Cefepime',                standard: 'EUCAST', sLimit: 8,  rLimit: 8   },  // R>8, contiguous
  { organismGroup: 'Pseudomonas', antibiotic: 'Meropenem',               standard: 'CLSI',   sLimit: 2,  rLimit: 8   },
  { organismGroup: 'Pseudomonas', antibiotic: 'Meropenem',               standard: 'EUCAST', sLimit: 2,  rLimit: 16  },  // R>8 → next=16
  { organismGroup: 'Pseudomonas', antibiotic: 'Gentamicin',              standard: 'CLSI',   sLimit: 4,  rLimit: 16  },
  { organismGroup: 'Pseudomonas', antibiotic: 'Gentamicin',              standard: 'EUCAST', sLimit: 2,  rLimit: 8   },  // R>4 → next=8

  // Staphylococcus aureus
  { organismGroup: 'Staphylococcus', antibiotic: 'Oxacillin',   standard: 'CLSI',   sLimit: 2, rLimit: 4  },
  { organismGroup: 'Staphylococcus', antibiotic: 'Vancomycin',  standard: 'CLSI',   sLimit: 2, rLimit: 16 },
  { organismGroup: 'Staphylococcus', antibiotic: 'Vancomycin',  standard: 'EUCAST', sLimit: 2, rLimit: 2  },  // R>2, contiguous
  { organismGroup: 'Staphylococcus', antibiotic: 'Linezolid',   standard: 'CLSI',   sLimit: 4, rLimit: 8  },
  { organismGroup: 'Staphylococcus', antibiotic: 'Linezolid',   standard: 'EUCAST', sLimit: 4, rLimit: 4  },  // R>4, contiguous

  // Acinetobacter baumannii (CLSI M100 2024 / EUCAST 2024)
  { organismGroup: 'Acinetobacter', antibiotic: 'Meropenem',          standard: 'CLSI',   sLimit: 2, rLimit: 8  },
  { organismGroup: 'Acinetobacter', antibiotic: 'Meropenem',          standard: 'EUCAST', sLimit: 2, rLimit: 16 },  // R>8 → next=16
  { organismGroup: 'Acinetobacter', antibiotic: 'Imipenem',           standard: 'CLSI',   sLimit: 2, rLimit: 8  },
  { organismGroup: 'Acinetobacter', antibiotic: 'Imipenem',           standard: 'EUCAST', sLimit: 2, rLimit: 16 },  // R>8 → next=16
  { organismGroup: 'Acinetobacter', antibiotic: 'Ampicillin-Sulbactam', standard: 'CLSI', sLimit: 4, rLimit: 16 },
  { organismGroup: 'Acinetobacter', antibiotic: 'Ampicillin-Sulbactam', standard: 'EUCAST', sLimit: 4, rLimit: 16 },  // R>8 → next=16
  { organismGroup: 'Acinetobacter', antibiotic: 'Gentamicin',         standard: 'CLSI',   sLimit: 4, rLimit: 16 },
  { organismGroup: 'Acinetobacter', antibiotic: 'Gentamicin',         standard: 'EUCAST', sLimit: 2, rLimit: 8  },  // R>4 → next=8
  { organismGroup: 'Acinetobacter', antibiotic: 'Ciprofloxacin',      standard: 'CLSI',   sLimit: 1, rLimit: 4  },
  { organismGroup: 'Acinetobacter', antibiotic: 'Ciprofloxacin',      standard: 'EUCAST', sLimit: 1, rLimit: 1  },  // R>1, contiguous
  { organismGroup: 'Acinetobacter', antibiotic: 'Colistin',           standard: 'EUCAST', sLimit: 2, rLimit: 2  },  // R>2, contiguous

  // Enterococcus faecalis / faecium (CLSI M100 2024 / EUCAST 2024)
  { organismGroup: 'Enterococcus', antibiotic: 'Vancomycin', standard: 'CLSI',   sLimit: 4, rLimit: 32 },
  { organismGroup: 'Enterococcus', antibiotic: 'Vancomycin', standard: 'EUCAST', sLimit: 4, rLimit: 4  },  // R>4, contiguous
  { organismGroup: 'Enterococcus', antibiotic: 'Ampicillin', standard: 'CLSI',   sLimit: 8, rLimit: 16 },
  { organismGroup: 'Enterococcus', antibiotic: 'Ampicillin', standard: 'EUCAST', sLimit: 8, rLimit: 8  },  // R>8, contiguous
  { organismGroup: 'Enterococcus', antibiotic: 'Linezolid',  standard: 'CLSI',   sLimit: 2, rLimit: 8  },
  { organismGroup: 'Enterococcus', antibiotic: 'Linezolid',  standard: 'EUCAST', sLimit: 4, rLimit: 4  },  // R>4, contiguous

  // Streptococcus pneumoniae (CLSI M100 2024 non-meningitis / EUCAST 2024)
  { organismGroup: 'Streptococcus', antibiotic: 'Penicillin',    standard: 'CLSI',   sLimit: 2,    rLimit: 8  },
  { organismGroup: 'Streptococcus', antibiotic: 'Penicillin',    standard: 'EUCAST', sLimit: 0.06, rLimit: 4  },  // R>2 → next=4
  { organismGroup: 'Streptococcus', antibiotic: 'Amoxicillin',   standard: 'CLSI',   sLimit: 2,    rLimit: 8  },
  { organismGroup: 'Streptococcus', antibiotic: 'Amoxicillin',   standard: 'EUCAST', sLimit: 0.5,  rLimit: 4  },  // R>2 → next=4
  { organismGroup: 'Streptococcus', antibiotic: 'Ceftriaxone',   standard: 'CLSI',   sLimit: 1,    rLimit: 4  },
  { organismGroup: 'Streptococcus', antibiotic: 'Ceftriaxone',   standard: 'EUCAST', sLimit: 0.5,  rLimit: 4  },  // R>2 → next=4
  { organismGroup: 'Streptococcus', antibiotic: 'Levofloxacin',  standard: 'CLSI',   sLimit: 2,    rLimit: 8  },
  { organismGroup: 'Streptococcus', antibiotic: 'Levofloxacin',  standard: 'EUCAST', sLimit: 2,    rLimit: 2  },  // R>2, contiguous
  { organismGroup: 'Streptococcus', antibiotic: 'Vancomycin',    standard: 'CLSI',   sLimit: 1,    rLimit: 4  },
  { organismGroup: 'Streptococcus', antibiotic: 'Clindamycin',   standard: 'CLSI',   sLimit: 0.25, rLimit: 1  },
  { organismGroup: 'Streptococcus', antibiotic: 'Clindamycin',   standard: 'EUCAST', sLimit: 0.25, rLimit: 1  },  // R>0.5 → next=1
];

export function getOrganismGroup(organism: string): 'Enterobacterales' | 'Pseudomonas' | 'Acinetobacter' | 'Staphylococcus' | 'Enterococcus' | 'Streptococcus' | 'Other' {
  const name = organism.toLowerCase();
  // Check the species-specific groups before broad epithet matches.  In
  // particular, "Streptococcus pneumoniae" must not be mistaken for
  // Klebsiella pneumoniae simply because both names contain "pneumoniae".
  if (name.includes('strep') || name.includes('streptococcus')) {
    return 'Streptococcus';
  }
  if (name.includes('coli') || name.includes('klebsiella') || name.includes('pneumoniae') || name.includes('proteus') || name.includes('enterobacter') || name.includes('serratia') || name.includes('salmonella') || name.includes('mirabilis')) {
    return 'Enterobacterales';
  }
  if (name.includes('pseudomonas') || name.includes('aeruginosa')) {
    return 'Pseudomonas';
  }
  if (name.includes('acinetobacter') || name.includes('baumannii')) {
    return 'Acinetobacter';
  }
  if (name.includes('staph') || name.includes('aureus') || name.includes('mrsa')) {
    return 'Staphylococcus';
  }
  if (name.includes('enterococcus') || name.includes('faecalis') || name.includes('faecium')) {
    return 'Enterococcus';
  }
  return 'Other';
}

/**
 * Interprets a numeric MIC string into an S/I/R category.
 * E.g., interpret('E. coli', 'Ampicillin', '<=2', 'CLSI') => 'S'
 */
export function interpret(
  organism: string,
  antibiotic: string,
  micValue: string,
  standard: 'CLSI' | 'EUCAST' = 'CLSI',
): 'S' | 'I' | 'R' | 'N/A' {
  const cleanMic = micValue.trim().replace(/\s+/g, '');
  if (!cleanMic) return 'N/A';

  const match = cleanMic.match(/^([<>=]+)?([0-9.]+)/);
  if (!match) return 'N/A';

  const operator = match[1] || '==';
  const rawNum = parseFloat(match[2]);
  if (isNaN(rawNum)) return 'N/A';

  // Determine effective concentration
  let conc = rawNum;
  if (operator === '<') {
    conc = rawNum / 2;
  } else if (operator === '>') {
    conc = rawNum * 2;
  }

  const group = getOrganismGroup(organism);

  // Find matching breakpoint
  const bp = BREAKPOINTS_DATA.find(
    (b) =>
      b.standard === standard &&
      b.organismGroup === group &&
      b.antibiotic.toLowerCase() === antibiotic.toLowerCase(),
  );

  if (!bp) return 'N/A';

  // Classify against BOTH breakpoints regardless of operator
  if (conc <= bp.sLimit) return 'S';
  if (conc >= bp.rLimit) return 'R';
  return 'I';
}

export interface ReinterpretedCounts {
  susceptible_count: number;
  intermediate_count: number;
  resistant_count: number;
  total_tested: number;
  susceptible_percent: number;
}

/**
 * Re-derive S/I/R counts from a raw MIC histogram under a chosen standard.
 * Returns null when no breakpoint exists for the organism/antibiotic/standard
 * (so the caller keeps the originally stored, upload-time counts). This is what
 * lets a CLSI↔EUCAST switch actually re-interpret data wherever raw MICs exist.
 */
export function reinterpretFromMic(
  organism: string,
  antibiotic: string,
  micDistribution: Record<string, number>,
  standard: 'CLSI' | 'EUCAST',
): ReinterpretedCounts | null {
  let s = 0, i = 0, r = 0;
  for (const [value, count] of Object.entries(micDistribution)) {
    const verdict = interpret(organism, antibiotic, value, standard);
    if (verdict === 'N/A') return null; // no breakpoint → cannot re-interpret
    if (verdict === 'S') s += count;
    else if (verdict === 'R') r += count;
    else i += count;
  }
  const total = s + i + r;
  if (total === 0) return null;
  return {
    susceptible_count: s,
    intermediate_count: i,
    resistant_count: r,
    total_tested: total,
    susceptible_percent: Math.round((s / total) * 1000) / 10,
  };
}
