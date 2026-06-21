import { describe, expect, it } from 'vitest';
import {
  MIN_RELIABLE_ISOLATES,
  computeSIR,
  coverageBand,
  getOrganismGroup,
  interpret,
  isReliable,
  resistanceRate,
  susceptibilityBand,
  susceptibilityShift,
  weightedCoverage,
  wilson95CI,
} from './clinical';
import {
  calculateMDR,
  calculateResistanceRegression,
  detectResistanceFlag,
  forecastSusceptibility,
} from './stats';
import { AntibiogramData } from '../types/database';

type SIRInput = Parameters<typeof computeSIR>[0];

function sirInput(overrides: Partial<SIRInput> = {}): SIRInput {
  return {
    susceptible_count: 0,
    intermediate_count: 0,
    resistant_count: 0,
    total_tested: 0,
    susceptible_percent: 0,
    ...overrides,
  };
}

function clinicalRecord(overrides: Partial<AntibiogramData> = {}): AntibiogramData {
  return {
    id: 'fixture',
    hospital_id: 'test-hospital',
    organism: 'E. coli',
    antibiotic: 'Ampicillin',
    susceptible_count: 0,
    intermediate_count: 0,
    resistant_count: 0,
    total_tested: 0,
    susceptible_percent: 0,
    year: 2026,
    period: 'annual',
    standard: 'CLSI',
    upload_date: '2026-01-01',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('clinical antibiogram calculations', () => {
  it('uses the reported resistant count instead of treating intermediate as resistant', () => {
    const input = sirInput({
      susceptible_count: 60,
      intermediate_count: 25,
      resistant_count: 15,
      total_tested: 100,
      susceptible_percent: 60,
    });

    expect(computeSIR(input)).toMatchObject({
      susceptible: 60,
      intermediate: 25,
      resistant: 15,
      total: 100,
      reliable: true,
    });
    expect(resistanceRate(input)).toBe(15);
  });

  it('falls back to stored susceptibility while keeping its percentage bounded', () => {
    expect(computeSIR(sirInput({ susceptible_percent: 120 }))).toMatchObject({
      susceptible: 100,
      intermediate: 0,
      resistant: 0,
    });
    expect(computeSIR(sirInput({ susceptible_percent: -5 }))).toMatchObject({
      susceptible: 0,
      resistant: 100,
    });
  });

  it('marks counts below the CLSI M39 reporting threshold as unreliable', () => {
    expect(isReliable(MIN_RELIABLE_ISOLATES - 1)).toBe(false);
    expect(isReliable(MIN_RELIABLE_ISOLATES)).toBe(true);
  });

  it('returns a bounded Wilson confidence interval', () => {
    expect(wilson95CI(0, 10)).toEqual({ low: 0, high: 27.8 });
    expect(wilson95CI(10, 10)).toEqual({ low: 72.2, high: 100 });
    expect(wilson95CI(0, 0)).toEqual({ low: 0, high: 0 });
  });

  it('uses inclusive display and surveillance thresholds', () => {
    expect(susceptibilityBand(80)).toBe('good');
    expect(susceptibilityBand(60)).toBe('moderate');
    expect(susceptibilityBand(59.9)).toBe('poor');
    expect(coverageBand(90)).toBe('good');
    expect(coverageBand(80)).toBe('moderate');
  });

  it('classifies changes exactly at the configured surveillance threshold', () => {
    expect(susceptibilityShift(70, 85)).toBe('improving');
    expect(susceptibilityShift(70, 55)).toBe('worsening');
    expect(susceptibilityShift(70, 84.9)).toBe('stable');
  });

  it('calculates WISCA-style coverage using organism prevalence weights', () => {
    const rows = [
      { ...sirInput({ susceptible_count: 90, resistant_count: 10, total_tested: 100 }), organism: 'E. coli', antibiotic: 'A' },
      { ...sirInput({ susceptible_count: 10, resistant_count: 10, total_tested: 20 }), organism: 'K. pneumoniae', antibiotic: 'A' },
      { ...sirInput({ susceptible_count: 50, resistant_count: 50, total_tested: 100 }), organism: 'E. coli', antibiotic: 'B' },
      { ...sirInput({ susceptible_count: 20, total_tested: 20 }), organism: 'K. pneumoniae', antibiotic: 'B' },
    ];

    expect(weightedCoverage(rows)).toEqual([
      { antibiotic: 'A', coverage: 83.3, isolates: 120, organisms: 2, reliable: true },
      { antibiotic: 'B', coverage: 58.3, isolates: 120, organisms: 2, reliable: true },
    ]);
    expect(weightedCoverage(rows, ['E. coli'])).toEqual([
      { antibiotic: 'A', coverage: 90, isolates: 100, organisms: 1, reliable: true },
      { antibiotic: 'B', coverage: 50, isolates: 100, organisms: 1, reliable: true },
    ]);
  });
});

describe('organism grouping and MIC interpretation', () => {
  it('does not misclassify Streptococcus pneumoniae as Enterobacterales', () => {
    expect(getOrganismGroup('Streptococcus pneumoniae')).toBe('Streptococcus');
    expect(getOrganismGroup('Klebsiella pneumoniae')).toBe('Enterobacterales');
    expect(getOrganismGroup('Pseudomonas aeruginosa')).toBe('Pseudomonas');
  });

  it('interprets exact and censored MIC values against the selected standard', () => {
    expect(interpret('E. coli', 'Ampicillin', '8', 'CLSI')).toBe('S');
    expect(interpret('E. coli', 'Ampicillin', '16', 'CLSI')).toBe('I');
    expect(interpret('E. coli', 'Ampicillin', '>=32', 'CLSI')).toBe('R');
    expect(interpret('E. coli', 'Ceftriaxone', '2', 'EUCAST')).toBe('R');
    expect(interpret('E. coli', 'Unknown drug', '2', 'CLSI')).toBe('N/A');
    expect(interpret('E. coli', 'Ampicillin', 'not-a-mic', 'CLSI')).toBe('N/A');
  });
});

describe('synthetic clinical surveillance fixtures', () => {
  it('flags resistance signals only for the expected organism-antibiotic pairings', () => {
    expect(detectResistanceFlag('K. pneumoniae', 'Meropenem')?.type).toBe('CRE');
    expect(detectResistanceFlag('S. aureus', 'Vancomycin')?.type).toBe('VRSA');
    expect(detectResistanceFlag('E. coli', 'Ceftriaxone')?.type).toBe('ESBL');
    expect(detectResistanceFlag('E. coli', 'Gentamicin')).toBeNull();
  });

  it('forecasts only when two or more historical years are available', () => {
    expect(calculateResistanceRegression([{ year: 2026, value: 80 }])).toBeNull();

    const regression = calculateResistanceRegression([
      { year: 2024, value: 90 },
      { year: 2025, value: 80 },
      { year: 2026, value: 70 },
    ]);
    expect(regression).not.toBeNull();
    expect(forecastSusceptibility(regression, 2027, 70)).toBe(60);
  });

  it('calculates isolate-level MDR only when at least three classes were tested', () => {
    const records = [
      clinicalRecord({ patient_id: 'A', antibiotic: 'Ampicillin', resistant_count: 1, total_tested: 1 }),
      clinicalRecord({ patient_id: 'A', antibiotic: 'Ceftriaxone', resistant_count: 1, total_tested: 1 }),
      clinicalRecord({ patient_id: 'A', antibiotic: 'Ciprofloxacin', resistant_count: 1, total_tested: 1 }),
      clinicalRecord({ patient_id: 'B', antibiotic: 'Ampicillin', susceptible_count: 1, total_tested: 1 }),
      clinicalRecord({ patient_id: 'B', antibiotic: 'Ceftriaxone', susceptible_count: 1, total_tested: 1 }),
      clinicalRecord({ patient_id: 'B', antibiotic: 'Ciprofloxacin', susceptible_count: 1, total_tested: 1 }),
      clinicalRecord({ patient_id: 'C', antibiotic: 'Ampicillin', resistant_count: 1, total_tested: 1 }),
      clinicalRecord({ patient_id: 'C', antibiotic: 'Ceftriaxone', resistant_count: 1, total_tested: 1 }),
    ];

    expect(calculateMDR(records)).toBe(50);
  });
});
