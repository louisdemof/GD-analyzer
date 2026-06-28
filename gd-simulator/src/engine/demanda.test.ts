import { describe, it, expect } from 'vitest';
import {
  computeDemandaBilling, computeAnnualDemandaCost, optimizeDemandaContratada,
} from './demandaOptimizer';

// Locks ANEEL REN 1000/2021 Art. 93 demanda billing + the DC optimizer.

describe('computeDemandaBilling', () => {
  it('subutilização: DM < DC → bills the contracted minimum (take-or-pay)', () => {
    expect(computeDemandaBilling(100, 80)).toEqual({ billed: 100, ultrapassagem: 0, scenario: 'subutilizacao' });
  });
  it('normal: DC ≤ DM ≤ DC×1,05 → bills the measured demand', () => {
    expect(computeDemandaBilling(100, 100)).toMatchObject({ billed: 100, scenario: 'normal' });
    expect(computeDemandaBilling(100, 105)).toMatchObject({ billed: 105, scenario: 'normal' });
  });
  it('ultrapassagem: DM > DC×1,05 → DC + 2×excesso (multa 100%)', () => {
    expect(computeDemandaBilling(100, 120)).toEqual({ billed: 140, ultrapassagem: 20, scenario: 'ultrapassagem' });
  });
  it('degenerates to billing DM when DC ≤ 0', () => {
    expect(computeDemandaBilling(0, 90)).toEqual({ billed: 90, ultrapassagem: 0, scenario: 'normal' });
  });
});

describe('computeAnnualDemandaCost', () => {
  it('sums billed × tariff and counts scenario months', () => {
    const r = computeAnnualDemandaCost(100, [80, 100, 120], 10);
    // billed: 100 (sub) + 100 (normal) + 140 (ultra) = 340
    expect(r.totalBilled).toBe(340);
    expect(r.totalCost).toBe(3400);
    expect(r.subutilizacaoMonths).toBe(1);
    expect(r.ultrapassagemMonths).toBe(1);
    expect(r.byMonth).toHaveLength(3);
  });
});

describe('optimizeDemandaContratada', () => {
  it('exploits the 5% tolerance: cheapest DC sits just below the flat demand', () => {
    // DM=100 constant. DC=96 → 96×1.05=100.8 ≥ 100, so it still bills as "normal"
    // (measured 100), not subutilização — cheaper than contracting the full 100.
    const { bestDC, bestCost } = optimizeDemandaContratada([100, 100, 100, 100], 30);
    expect(bestDC).toBe(96); // ceil(100 / 1.05) — smallest DC that avoids ultrapassagem
    expect(bestCost).toBe(100 * 30 * 4); // bills the measured 100 kW every month
  });

  it('returns a DC no worse than any naive choice (true minimum)', () => {
    const history = [60, 80, 95, 130, 110, 75];
    const tariff = 30;
    const { bestDC, bestCost } = optimizeDemandaContratada(history, tariff);
    // bestCost must beat (or equal) both "contract the max" and "contract the average"
    const maxCost = computeAnnualDemandaCost(Math.max(...history), history, tariff).totalCost;
    const avg = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
    const avgCost = computeAnnualDemandaCost(avg, history, tariff).totalCost;
    expect(bestCost).toBeLessThanOrEqual(maxCost);
    expect(bestCost).toBeLessThanOrEqual(avgCost);
    expect(bestDC).toBeGreaterThan(0);
  });

  it('degenerates safely on empty history or zero tariff', () => {
    expect(optimizeDemandaContratada([], 30)).toMatchObject({ bestDC: 0, bestCost: 0 });
    expect(optimizeDemandaContratada([100], 0)).toMatchObject({ bestDC: 0, bestCost: 0 });
  });
});
