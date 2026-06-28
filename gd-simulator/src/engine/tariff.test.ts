import { describe, it, expect } from 'vitest';
import {
  computeAllInTariff, computeFA, computeICMSPerKWh, computePisCofinsPerKWh, computeDerivedTariffs,
} from './tariff';
import type { Distributor } from './types';

// Locks the core tariff math: all-in (com tributos) grossing-up, FA, the per-kWh
// tax-leak extractions, and the full derived-tariff bundle. These feed every
// simulation, so a silent change here would shift commercial numbers.

const COPEL_TAXES = { ICMS: 0.19, PIS: 0.0153, COFINS: 0.0703 };
// denom = (1 - PIS - COFINS) * (1 - ICMS) = 0.9144 * 0.81 = 0.740664
const DENOM = (1 - 0.0153 - 0.0703) * (1 - 0.19);

describe('computeAllInTariff', () => {
  it('returns the sem-tributos value unchanged when there are no taxes', () => {
    expect(computeAllInTariff(0.5, { ICMS: 0, PIS: 0, COFINS: 0 })).toBe(0.5);
  });
  it('grosses up by 1/((1-PIS-COFINS)(1-ICMS))', () => {
    expect(computeAllInTariff(0.44234, COPEL_TAXES)).toBeCloseTo(0.44234 / DENOM, 6);
  });
  it('all-in is always >= the sem-tributos input when taxes are positive', () => {
    expect(computeAllInTariff(1, COPEL_TAXES)).toBeGreaterThan(1);
  });
});

describe('computeFA', () => {
  it('is TE_FP / TE_PT', () => {
    expect(computeFA(0.29575, 0.47555)).toBeCloseTo(0.29575 / 0.47555, 6);
  });
  it('guards division by zero', () => {
    expect(computeFA(0.3, 0)).toBe(0);
  });
});

describe('per-kWh tax leaks', () => {
  it('extracts ICMS "por fora": allIn * r / (1+r)', () => {
    expect(computeICMSPerKWh(1.19, 0.19)).toBeCloseTo(0.19, 6);
  });
  it('PIS/COFINS leak is zero when both rates are zero', () => {
    expect(computePisCofinsPerKWh(1.5, 0, 0)).toBe(0);
  });
  it('PIS/COFINS leak uses the combined rate', () => {
    const r = 0.0153 + 0.0703;
    expect(computePisCofinsPerKWh(2, 0.0153, 0.0703)).toBeCloseTo(2 * r / (1 + r), 6);
  });
});

describe('computeDerivedTariffs (COPEL REH 3.592/2026)', () => {
  const dist = computeDerivedTariffs({
    id: 'COPEL-DIS', name: 'COPEL-DIS', state: 'PR', resolution: 'REH 3.592/2026',
    tariffs: {
      B_TUSD: 0.45717, B_TE: 0.31085,
      A_FP_TUSD_TE: 0.44234, A_PT_TUSD_TE: 1.93894,
      A_TE_FP: 0.29575, A_TE_PT: 0.47555, A_FP_DEMANDA: 25.33,
    },
    taxes: COPEL_TAXES,
  } as Distributor);

  it('derives all-in FP/PT/B3/demanda from raw + taxes', () => {
    expect(dist.T_AFP).toBeCloseTo(0.44234 / DENOM, 5);
    expect(dist.T_APT).toBeCloseTo(1.93894 / DENOM, 5);
    expect(dist.T_B3).toBeCloseTo((0.45717 + 0.31085) / DENOM, 5);
    expect(dist.T_A_DEMANDA).toBeCloseTo(25.33 / DENOM, 4);
  });

  it('derives FA from the TE components', () => {
    expect(dist.FA).toBeCloseTo(0.29575 / 0.47555, 6);
  });

  it('TUSD-only all-in = (TUSD+TE − TE) grossed up, never negative', () => {
    const fpTusdOnly = 0.44234 - 0.29575;
    expect(dist.T_AFP_TUSD).toBeCloseTo(fpTusdOnly / DENOM, 5);
    expect(dist.T_AFP_TUSD).toBeGreaterThan(0);
    // TUSD-only must be smaller than the full TUSD+TE all-in
    expect(dist.T_AFP_TUSD!).toBeLessThan(dist.T_AFP!);
  });

  it('leaves optional reservado tariffs undefined when not provided', () => {
    expect(dist.T_ARSV).toBeUndefined();
    expect(dist.T_BRSV).toBeUndefined();
  });
});
