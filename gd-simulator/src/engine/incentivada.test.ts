import { describe, it, expect } from 'vitest';
import { runSimulation } from './simulation';
import { createDefaultRateio } from './optimiser';
import { computeDerivedTariffs, incentivadaDiscounts } from './tariff';
import type { Project, Distributor, ConsumptionUnit, ACLBaseline } from './types';

// Locks the energia-incentivada engine path: deriving discounts from the level must equal
// entering the equivalent manual discounts, and I50 must lower the SEM (FP still charged).

const dist = computeDerivedTariffs({
  id: 'ENEL RJ', name: 'Enel Rio', state: 'RJ', resolution: 'x',
  tariffs: {
    B_TUSD: 0.5, B_TE: 0.3,
    A_FP_TUSD_TE: 0.55, A_PT_TUSD_TE: 2.35, A_TE_FP: 0.33, A_TE_PT: 0.50, A_FP_DEMANDA: 38.75,
  },
  taxes: { ICMS: 0.20, PIS: 0.0165, COFINS: 0.076 },
} as Distributor);

const ucVerde: ConsumptionUnit = {
  id: 'uc', name: 'UC', tariffGroup: 'A4_VERDE', isGrupoA: true,
  consumptionFP: new Array(12).fill(180000), consumptionPT: new Array(12).fill(20000),
  demandaFaturadaFP: 1200, openingBank: 0,
};

function build(acl: ACLBaseline): Project {
  const p: Project = {
    id: 't', clientName: 'T', distributor: dist, marketType: 'ACL', aclBaseline: acl,
    plant: { id: 'p', name: 'P', capacityKWac: 1, distributor: 'ENEL RJ', p50Profile: new Array(12).fill(1), useActual: false, ppaRateRsBRLkWh: 0.45, contractStartMonth: '2026-06', contractMonths: 12 },
    ucs: [ucVerde],
    scenarios: { icmsExempt: true, competitorDiscount: 0, useActualGeneration: false },
    growthRate: 0, generationDegradation: 0, performanceFactor: 1, tariffEscalationPPA: 0,
    rateio: { periods: [], isOptimised: false }, createdAt: '', updatedAt: '',
  } as unknown as Project;
  p.rateio = createDefaultRateio(p);
  return p;
}

describe('energia incentivada (Verde, I50)', () => {
  const d = incentivadaDiscounts(0.5, false, dist.T_AFP_TUSD!, dist.T_APT_TUSD!);

  it('FP not discounted, PT discounted, demanda 50%', () => {
    expect(d.consumoFP).toBe(0);
    expect(d.demanda).toBe(0.5);
    expect(d.consumoPT).toBeGreaterThan(0.4);
    expect(d.consumoPT).toBeLessThan(0.5);
  });

  it('deriving from the level == entering the equivalent manual discounts', () => {
    const base: ACLBaseline = { energyPriceSemImp: 0.25, tusdDiscountConsumo: 0, tusdDiscountDemanda: 0 };
    const semDerived = runSimulation(build({ ...base, incentivadaLevel: 0.5 })).summary.baselineSEM;
    const semManual = runSimulation(build({ ...base, tusdDiscountConsumo: d.consumoFP, tusdDiscountConsumoPT: d.consumoPT, tusdDiscountDemanda: d.demanda })).summary.baselineSEM;
    expect(semDerived).toBeCloseTo(semManual, 2);
  });

  it('I50 lowers the SEM vs no incentivada (benefit is real)', () => {
    const base: ACLBaseline = { energyPriceSemImp: 0.25, tusdDiscountConsumo: 0, tusdDiscountDemanda: 0 };
    const semI50 = runSimulation(build({ ...base, incentivadaLevel: 0.5 })).summary.baselineSEM;
    const semNone = runSimulation(build(base)).summary.baselineSEM;
    expect(semI50).toBeLessThan(semNone);
  });

  it('Azul: energy not discounted, only demanda', () => {
    const az = incentivadaDiscounts(0.5, true, dist.T_AFP_TUSD!, dist.T_APT_TUSD!);
    expect(az).toEqual({ consumoFP: 0, consumoPT: 0, demanda: 0.5 });
  });
});
