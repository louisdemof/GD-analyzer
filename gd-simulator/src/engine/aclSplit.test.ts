import { describe, it, expect } from 'vitest';
import { simulateUCBank } from './bank';
import { computeDerivedTariffs, computeAllInTariff } from './tariff';
import type { Distributor, ConsumptionUnit, RateioAllocation, ACLBaseline } from './types';

// Verifies the SEM invoice decomposition that powers the ACL invoice split:
//   teAclCost + tusdFpCost + tusdPtCost + demandaCost === costRede
// plus the semantics of each component (TE only under ACL, ponta only Grupo A,
// demanda discounted under ACL incentivada, etc.). Drives the real engine.

// COPEL-DIS RTP 2026 tariffs
const dist: Distributor = computeDerivedTariffs({
  id: 'COPEL-DIS', name: 'COPEL-DIS', state: 'PR', resolution: 'REH 3.592/2026',
  tariffs: {
    B_TUSD: 0.45717, B_TE: 0.31085,
    A_FP_TUSD_TE: 0.44234, A_PT_TUSD_TE: 1.93894,
    A_TE_FP: 0.29575, A_TE_PT: 0.47555, A_FP_DEMANDA: 25.33,
  },
  taxes: { ICMS: 0.19, PIS: 0.0153, COFINS: 0.0703 },
} as Distributor);

const T_A_DEMANDA = (dist as unknown as { T_A_DEMANDA: number }).T_A_DEMANDA; // all-in R$/kW

const acl: ACLBaseline = {
  energyPriceSemImp: 0.30,
  tusdDiscountConsumo: 0.44, tusdDiscountConsumoPT: 0.47, tusdDiscountDemanda: 0.49,
  energyIcms: true, energyPisCofins: true,
};

// Independent ACL energy rate (R$/kWh), mirrors bank.ts aclEnergyAllIn
function teAclPerKWh(yearIdx: number): number {
  const esc = Math.pow(1 + (acl.energyEscalationPct ?? 0), yearIdx);
  return computeAllInTariff(acl.energyPriceSemImp * esc, {
    ICMS: acl.energyIcms ? dist.taxes.ICMS : 0,
    PIS: acl.energyPisCofins ? (acl.energyPisCofinsPct ?? 0.0925) : 0,
    COFINS: 0,
  } as Distributor['taxes']);
}

function mkRateio(months: number): RateioAllocation {
  return { periods: [{ start: 0, end: months - 1, allocations: [{ ucId: 'uc1', fraction: 1 }] }], isOptimised: false };
}

function mkUC(isGrupoA: boolean, months: number, ownGenPerMonth = 0): ConsumptionUnit {
  return {
    id: 'uc1', name: 'UC1',
    tariffGroup: isGrupoA ? 'A4_VERDE' : 'B3', isGrupoA,
    consumptionFP: new Array(months).fill(100_000),
    consumptionPT: new Array(months).fill(isGrupoA ? 20_000 : 0),
    demandaFaturadaFP: isGrupoA ? 500 : undefined,
    openingBank: 0,
    ...(ownGenPerMonth ? { ownGeneration: new Array(months).fill(ownGenPerMonth) } : {}),
  } as ConsumptionUnit;
}

interface RunOpts { isGrupoA: boolean; aclOn: boolean; months: number; esc?: number; ownGenPerMonth?: number; isSEM?: boolean }
function run({ isGrupoA, aclOn, months, esc = 0, ownGenPerMonth = 0, isSEM = true }: RunOpts) {
  return simulateUCBank({
    uc: mkUC(isGrupoA, months, ownGenPerMonth),
    distributor: dist,
    generation: new Array(months).fill(0),
    rateio: mkRateio(months),
    includeCS3Credits: !isSEM,
    batCreditsPerMonth: new Array(months).fill(0),
    icmsExempt: true, pisCofinsExempt: true, competitorDiscount: 0,
    aclBaseline: aclOn ? acl : null,
    isSEM, contractMonths: months, tariffEscalationDistributor: esc,
  });
}

const SCENARIOS: Array<{ name: string; opts: RunOpts }> = [
  { name: 'ACL grupo A, no compensation', opts: { isGrupoA: true, aclOn: true, months: 24 } },
  { name: 'ACL grupo A, 3yr + 5% escalation', opts: { isGrupoA: true, aclOn: true, months: 36, esc: 0.05 } },
  { name: 'ACL grupo A, partial compensation', opts: { isGrupoA: true, aclOn: true, months: 12, ownGenPerMonth: 60_000 } },
  { name: 'ACL grupo A, full compensation', opts: { isGrupoA: true, aclOn: true, months: 12, ownGenPerMonth: 5_000_000 } },
  { name: 'ACL grupo B', opts: { isGrupoA: false, aclOn: true, months: 12 } },
  { name: 'CATIVO grupo A', opts: { isGrupoA: true, aclOn: false, months: 12 } },
  { name: 'CATIVO grupo B', opts: { isGrupoA: false, aclOn: false, months: 12 } },
];

describe('SEM invoice decomposition (ACL split)', () => {
  for (const { name, opts } of SCENARIOS) {
    describe(name, () => {
      const res = run(opts);

      it('components reconcile to costRede every month', () => {
        res.monthlyDetails.forEach((d, m) => {
          const sum = d.tusdFpCost + d.tusdPtCost + d.teFpCost + d.tePtCost + d.demandaCost;
          expect(Math.abs(sum - d.costRede), `month ${m}`).toBeLessThan(1e-4);
        });
      });

      it('every component is non-negative', () => {
        for (const d of res.monthlyDetails) {
          for (const v of [d.tusdFpCost, d.tusdPtCost, d.teFpCost, d.tePtCost, d.demandaCost]) {
            expect(v).toBeGreaterThanOrEqual(-1e-9);
          }
        }
      });

      it('TE (energy) equals billed kWh × rate — ACL: ACL price; captive: regulated TE', () => {
        res.monthlyDetails.forEach((d, m) => {
          const billed = d.residualFP + d.residualPT + d.residualRSV;
          const te = d.teFpCost + d.tePtCost;
          if (opts.aclOn) {
            // ACL energy is uniform per kWh across postos
            expect(Math.abs(te - billed * teAclPerKWh(Math.floor(m / 12))), `month ${m}`).toBeLessThan(1e-3);
          } else {
            // captive: TE is the regulated energy component, strictly positive when billing
            if (billed > 0) expect(te).toBeGreaterThan(0);
          }
        });
      });

      if (!opts.isGrupoA) {
        it('grupo B has no ponta (TUSD nor TE)', () => {
          for (const d of res.monthlyDetails) { expect(d.tusdPtCost).toBe(0); expect(d.tePtCost).toBe(0); }
        });
      }

      if (opts.isGrupoA) {
        it('demanda is discounted under ACL, full under cativo', () => {
          res.monthlyDetails.forEach((d, m) => {
            const full = 500 * T_A_DEMANDA * Math.pow(1 + (opts.esc ?? 0), Math.floor(m / 12));
            if (opts.aclOn) expect(d.demandaCost).toBeLessThan(full - 1e-6);
            else expect(Math.abs(d.demandaCost - full)).toBeLessThan(1e-3);
          });
        });
      }
    });
  }

  it('full compensation leaves only demanda', () => {
    const d = run({ isGrupoA: true, aclOn: true, months: 6, ownGenPerMonth: 9_000_000 }).monthlyDetails[0];
    expect(d.tusdFpCost).toBe(0);
    expect(d.tusdPtCost).toBe(0);
    expect(d.teFpCost).toBe(0);
    expect(d.tePtCost).toBe(0);
    expect(d.demandaCost).toBeGreaterThan(0);
  });

  it('captive Grupo A with ponta has both TE FP and TE PT > 0', () => {
    const d = run({ isGrupoA: true, aclOn: false, months: 12 }).monthlyDetails[0];
    expect(d.teFpCost).toBeGreaterThan(0);
    expect(d.tePtCost).toBeGreaterThan(0);
    expect(d.tusdFpCost).toBeGreaterThan(0);
    expect(d.tusdPtCost).toBeGreaterThan(0);
  });

  it('SEM-ACL demanda is lower than COM (cativo) full demanda', () => {
    const sem = run({ isGrupoA: true, aclOn: true, months: 12, isSEM: true });
    const com = run({ isGrupoA: true, aclOn: false, months: 12, isSEM: false });
    const semDem = sem.monthlyDetails[0].demandaCost;
    const comDem = com.monthlyDetails[0].demandaCost;
    expect(semDem).toBeLessThan(comDem);
    expect(Math.abs(comDem - 500 * T_A_DEMANDA)).toBeLessThan(1e-3);
  });
});

// Custos adicionais do ACL (encargos CCEE + gestão varejista) — adder líquido R$/MWh no SEM.
describe('Custos adicionais ACL (encargos CCEE + gestão)', () => {
  const months = 12;
  const callWith = (encRsMWh: number, gesRsMWh: number) => simulateUCBank({
    uc: mkUC(true, months), distributor: dist, generation: new Array(months).fill(0),
    rateio: mkRateio(months), includeCS3Credits: false, batCreditsPerMonth: new Array(months).fill(0),
    icmsExempt: true, pisCofinsExempt: true, competitorDiscount: 0,
    aclBaseline: { ...acl, encargosCceeRsMWh: encRsMWh, gestaoVarejistaRsMWh: gesRsMWh },
    isSEM: true, contractMonths: months, tariffEscalationDistributor: 0,
  });
  const total = (r: ReturnType<typeof simulateUCBank>) => r.monthlyDetails.reduce((s, d) => s + d.costRede, 0);

  it('20 R$/MWh (15+5) sobe o custo SEM em 0,02 R$/kWh × consumo faturado', () => {
    const semAdder = total(callWith(0, 0));
    const comAdder = total(callWith(15, 5));
    // consumo 12m = (100.000 FP + 20.000 PT) × 12 = 1.440.000 kWh; adder 0,02 R$/kWh
    expect(comAdder - semAdder).toBeCloseTo(1_440_000 * 0.02, 0);
  });
  it('sem os campos (0/0) não altera o custo', () => {
    expect(total(callWith(0, 0))).toBeGreaterThan(0);
    expect(total(callWith(15, 5)) - total(callWith(0, 0))).toBeGreaterThan(0);
  });
});
