import { AntibiogramData } from '../types/database';
import { getOrganismGroup } from './clinical';
import { getDrugClass } from './calculationEngine';

/**
 * Shared statistics & resistance-signal helpers.
 *
 * This module de-duplicates the superbug / resistance-alert detection logic
 * that was previously copy-pasted (and subtly inconsistent) across
 * Dashboard, AlertsPage and RegionalDashboard, plus the pure MDR estimator
 * and the chi-square / linear-regression helpers used by the comparison and
 * trends pages.
 *
 * IMPORTANT: aggregate antibiogram data can only flag a resistance *signal*.
 * It can never confirm an isolate-level CRE/VRSA/MRSA/ESBL/VRE diagnosis.
 */

export type ResistanceFlagType = 'CRE' | 'VRSA' | 'MRSA' | 'ESBL' | 'VRE';

export interface ResistanceFlag {
  type: ResistanceFlagType;
  /** Short human-readable label, e.g. "CRE". */
  label: string;
}

const CARBAPENEMS = ['meropenem', 'imipenem', 'ertapenem', 'doripenem'];
const ESBL_CEPHALOSPORINS = ['ceftriaxone', 'ceftazidime', 'cefepime'];

/**
 * Detects which resistance flag (if any) an organism/antibiotic combination
 * raises, using the canonical organism-group classification from clinical.ts.
 *
 * This is the most complete rule set (the Dashboard MDR-index version),
 * covering CRE, VRSA, MRSA, ESBL and VRE. It deliberately performs only the
 * organism/antibiotic classification — callers apply their own resistance
 * gating (e.g. `resistantCount > 0`, `rate > 0`) and decide which flag types
 * they care about.
 *
 * Detection precedence (preserved from the canonical Dashboard order):
 *   MRSA -> VRE -> CRE -> VRSA -> ESBL
 */
export function detectResistanceFlag(
  organism: string,
  antibiotic: string,
): ResistanceFlag | null {
  const abLower = antibiotic.toLowerCase();
  const orgLower = organism.toLowerCase();
  const orgGroup = getOrganismGroup(organism);

  const isMRSA = orgGroup === 'Staphylococcus' && orgLower.includes('aureus') &&
    (abLower.includes('oxacillin') || abLower.includes('cefoxitin'));

  const isVRE = orgGroup === 'Enterococcus' && abLower.includes('vancomycin');

  const isCRE = orgGroup === 'Enterobacterales' &&
    CARBAPENEMS.some((c) => abLower.includes(c));

  const isVRSA = orgGroup === 'Staphylococcus' && orgLower.includes('aureus') &&
    abLower.includes('vancomycin');

  const isESBL = orgGroup === 'Enterobacterales' &&
    ESBL_CEPHALOSPORINS.some((c) => abLower.includes(c));

  if (isMRSA) return { type: 'MRSA', label: 'MRSA' };
  if (isVRE) return { type: 'VRE', label: 'VRE' };
  if (isCRE) return { type: 'CRE', label: 'CRE' };
  if (isVRSA) return { type: 'VRSA', label: 'VRSA' };
  if (isESBL) return { type: 'ESBL', label: 'ESBL' };
  return null;
}

// ---------------------------------------------------------------------------
// Antibiotic-class mapping & MDR estimation.
// ---------------------------------------------------------------------------

// Coarsen the granular drug classes from calculationEngine (which splits
// cephalosporins by generation) into the broader categories used for
// population-level MDR estimation.
function coarsenDrugClass(cls: string | null): string | null {
  if (!cls) return null;
  if (cls.startsWith('Cephalosporins')) return 'Cephalosporins';
  if (cls === 'Beta-lactam/BLI') return 'Beta-lactam combinations';
  if (cls === 'Macrolides' || cls === 'Lincosamides') return 'Macrolides & Lincosamides';
  if (cls === 'Sulfonamides') return 'Folate pathway inhibitors';
  return cls;
}

export function getAntibioticClass(antibioticName: string): string | null {
  return coarsenDrugClass(getDrugClass(antibioticName));
}

/**
 * Calculates estimated MDR (Multi-Drug Resistance) rate.
 * Defined as resistance to 3 or more standard antibiotic classes.
 * Handled exactly when patient_id is available (isolate-level),
 * or estimated using the 3rd highest resistance class rate as a proxy for aggregates.
 */
export function calculateMDR(data: AntibiogramData[]): number {
  if (data.length === 0) return 0;

  const hasPatientIds = data.some((r) => r.patient_id);

  if (hasPatientIds) {
    const isolatesMap = new Map<string, {
      resistantClasses: Set<string>;
      testedClasses: Set<string>;
    }>();

    data.forEach((r) => {
      if (!r.patient_id) return;
      const key = `${r.hospital_id}||${r.patient_id}||${r.organism}||${r.specimen_type || ''}||${r.year}||${r.period}`;
      let isolate = isolatesMap.get(key);
      if (!isolate) {
        isolate = { resistantClasses: new Set(), testedClasses: new Set() };
        isolatesMap.set(key, isolate);
      }

      const className = getAntibioticClass(r.antibiotic);
      if (className) {
        isolate.testedClasses.add(className);
        if (r.resistant_count > 0) {
          isolate.resistantClasses.add(className);
        }
      }
    });

    let mdrCount = 0;
    let totalIsolates = 0;
    isolatesMap.forEach((isolate) => {
      // Calculate MDR only if at least 3 classes were tested
      if (isolate.testedClasses.size >= 3) {
        totalIsolates++;
        if (isolate.resistantClasses.size >= 3) {
          mdrCount++;
        }
      }
    });

    return totalIsolates > 0 ? Math.round((mdrCount / totalIsolates) * 100 * 10) / 10 : 0;
  } else {
    // Fallback: estimate based on aggregate classes
    const classRates: Record<string, { resistant: number; total: number }> = {};
    data.forEach((r) => {
      const className = getAntibioticClass(r.antibiotic);
      if (!className) return;
      if (!classRates[className]) {
        classRates[className] = { resistant: 0, total: 0 };
      }
      // Use resistant_count when available (including 0); fall back to deriving
      // from susceptible_percent only when the count is genuinely absent.
      const rc = r.resistant_count != null
        ? r.resistant_count
        : (r.total_tested * (100 - (r.susceptible_percent ?? 0)) / 100);
      classRates[className].resistant += rc;
      classRates[className].total += r.total_tested;
    });

    const rates: number[] = [];
    Object.values(classRates).forEach((stats) => {
      if (stats.total > 0) {
        rates.push((stats.resistant / stats.total) * 100);
      }
    });

    if (rates.length < 3) return 0;
    rates.sort((a, b) => b - a);

    // Mathematically, the rate of isolates resistant to 3+ classes is bounded by the 3rd highest class rate.
    // We estimate MDR as 80% of this 3rd highest rate.
    const thirdHighest = rates[2];
    return Math.round(thirdHighest * 0.8 * 10) / 10;
  }
}

// ---------------------------------------------------------------------------
// Statistical tests (lifted from ComparisonPage / TrendsPage).
// ---------------------------------------------------------------------------

/**
 * Pearson chi-square test of independence on a 2x2 contingency table,
 * with Yates' continuity correction when any expected cell frequency < 5.
 * The p-value is derived from a normal-CDF approximation of Z = sqrt(chi2).
 */
export function chiSquareTest(a: number, b: number, c: number, d: number): { chi2: number; pValue: number } {
  const N = a + b + c + d;
  if (N === 0) return { chi2: 0, pValue: 1 };

  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const col2 = b + d;

  if (row1 === 0 || row2 === 0 || col1 === 0 || col2 === 0) {
    return { chi2: 0, pValue: 1 };
  }

  // Expected frequencies
  const eA = (row1 * col1) / N;
  const eB = (row1 * col2) / N;
  const eC = (row2 * col1) / N;
  const eD = (row2 * col2) / N;

  // Use Yates' correction if any expected frequency is < 5
  const useYates = eA < 5 || eB < 5 || eC < 5 || eD < 5;

  let numerator;
  if (useYates) {
    numerator = N * Math.pow(Math.max(0, Math.abs(a * d - b * c) - N / 2), 2);
  } else {
    numerator = N * Math.pow(a * d - b * c, 2);
  }

  const denominator = row1 * row2 * col1 * col2;
  if (denominator === 0) return { chi2: 0, pValue: 1 };

  const chi2 = numerator / denominator;

  // Calculate p-value from Z = sqrt(chi2)
  const Z = Math.sqrt(chi2);

  // Normal CDF approximation
  const d1 = 0.196854;
  const d2 = 0.115194;
  const d3 = 0.000344;
  const d4 = 0.019527;

  const phi = 1 - 0.5 * Math.pow(1 + d1 * Z + d2 * Math.pow(Z, 2) + d3 * Math.pow(Z, 3) + d4 * Math.pow(Z, 4), -4);
  const pValue = 2 * (1 - phi);

  return { chi2, pValue: Math.max(0, Math.min(1, pValue)) };
}

/**
 * Ordinary-least-squares linear regression of resistance (100 - susceptibility)
 * against year. Returns null when fewer than 2 points or the year variance is
 * zero. Used to forecast future susceptibility on the trends page.
 */
export function calculateResistanceRegression(
  points: { year: number; value: number }[],
): { slope: number; intercept: number } | null {
  if (points.length < 2) return null;

  const meanX = points.reduce((sum, point) => sum + point.year, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + (100 - point.value), 0) / points.length;
  const numerator = points.reduce((sum, point) => (
    sum + (point.year - meanX) * ((100 - point.value) - meanY)
  ), 0);
  const denominator = points.reduce((sum, point) => sum + (point.year - meanX) ** 2, 0);

  if (denominator === 0) return null;

  const slope = numerator / denominator;
  return { slope, intercept: meanY - slope * meanX };
}

/**
 * Projects susceptibility for a given year from a resistance regression,
 * clamping predicted resistance to [0, 100]. Falls back to `fallback` when
 * no regression is available.
 */
export function forecastSusceptibility(
  regression: { slope: number; intercept: number } | null,
  year: number,
  fallback: number,
): number {
  if (!regression) return fallback;

  const predictedResistance = regression.slope * year + regression.intercept;
  return 100 - Math.max(0, Math.min(100, predictedResistance));
}
