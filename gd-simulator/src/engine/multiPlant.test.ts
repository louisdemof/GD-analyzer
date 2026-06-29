import { describe, it, expect } from 'vitest';
import { runSimulation, computeSimulationMonths } from './simulation';
import { createDefaultRateio } from './optimiser';
import { computeDerivedTariffs } from './tariff';
import type { Project, Plant, Distributor, ConsumptionUnit } from './types';

// Proves the simulation adapts to usinas with DIFFERENT PPA lengths AND rates:
// each plant's PPA is charged only during its own active window, at its own rate,
// and generation drops as each plant's contract ends.

const dist = computeDerivedTariffs({
  id: 'D', name: 'D', state: 'PR', resolution: 'x',
  tariffs: { B_TUSD: 0.45, B_TE: 0.31, A_FP_TUSD_TE: 0.44, A_PT_TUSD_TE: 1.9, A_TE_FP: 0.29, A_TE_PT: 0.47, A_FP_DEMANDA: 25 },
  taxes: { ICMS: 0.19, PIS: 0.0153, COFINS: 0.0703 },
} as Distributor);

function plant(over: Partial<Plant>): Plant {
  return {
    id: 'p', name: 'P', capacityKWac: 100, distributor: 'D',
    p50Profile: new Array(24).fill(0), useActual: false,
    ppaRateRsBRLkWh: 0.4, contractStartMonth: '2026-06', contractMonths: 24,
    ...over,
  } as Plant;
}

const ucB: ConsumptionUnit = {
  id: 'uc', name: 'UC', tariffGroup: 'B' as ConsumptionUnit['tariffGroup'], isGrupoA: false,
  consumptionFP: new Array(24).fill(50000), consumptionPT: new Array(24).fill(0), openingBank: 0,
};

function build(plants: Plant[]): Project {
  const p: Project = {
    id: 't', clientName: 'T', distributor: dist,
    plant: plants[0], additionalPlants: plants.slice(1),
    ucs: [ucB],
    scenarios: { icmsExempt: true, competitorDiscount: 0, useActualGeneration: false },
    growthRate: 0, generationDegradation: 0, performanceFactor: 0 ? 0 : 1, tariffEscalationPPA: 0,
    rateio: { periods: [], isOptimised: false }, createdAt: '', updatedAt: '',
  } as unknown as Project;
  p.rateio = createDefaultRateio(p);
  return p;
}

describe('variable PPA lengths across usinas', () => {
  // Usina A: 24 months @ R$0,40 · 10.000 kWh/mês. Usina B: only 12 months @ R$0,50 · 5.000 kWh/mês.
  const A = plant({ id: 'A', name: 'A', p50Profile: new Array(24).fill(10000), contractMonths: 24, ppaRateRsBRLkWh: 0.40 });
  const B = plant({ id: 'B', name: 'B', p50Profile: new Array(24).fill(5000), contractMonths: 12, ppaRateRsBRLkWh: 0.50 });
  const r = runSimulation(build([A, B]));

  it('horizon is the longest PPA (24 months)', () => {
    expect(computeSimulationMonths(build([A, B]))).toBe(24);
    expect(r.months).toHaveLength(24);
  });

  it('generation drops when the shorter PPA (B) ends at month 12', () => {
    expect(r.months[0].generation).toBe(15000);   // A + B
    expect(r.months[11].generation).toBe(15000);  // B still active (months 0..11)
    expect(r.months[12].generation).toBe(10000);  // B done → only A
    expect(r.months[23].generation).toBe(10000);
  });

  it('PPA cost uses each usina own rate, only within its window', () => {
    // months 0..11: 10000×0,40 + 5000×0,50 = 6500
    expect(r.months[0].ppaCost).toBeCloseTo(6500, 6);
    expect(r.months[11].ppaCost).toBeCloseTo(6500, 6);
    // months 12..23: only A → 10000×0,40 = 4000
    expect(r.months[12].ppaCost).toBeCloseTo(4000, 6);
    expect(r.months[23].ppaCost).toBeCloseTo(4000, 6);
  });

  it('total PPA = A over 24m + B over 12m', () => {
    const totalPPA = r.months.reduce((a, m) => a + m.ppaCost, 0);
    expect(totalPPA).toBeCloseTo(10000 * 0.40 * 24 + 5000 * 0.50 * 12, 4);
  });
});
