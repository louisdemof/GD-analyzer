import { describe, it, expect } from 'vitest';
import { runSimulation } from './simulation';
import { createDefaultRateio, optimiseRateio } from './optimiser';
import { computeDerivedTariffs } from './tariff';
import type { Project } from './types';

import sampleData from '../../reference/SAMPLE_DATA.json';
import copelData from '../../reference/COPEL_DEMO.json';
import copel2Data from '../../reference/COPEL_DEMO_2.json';
import copel3Data from '../../reference/COPEL_DEMO_3.json';
import copel4Data from '../../reference/COPEL_DEMO_4.json';
import beloData from '../../reference/BELO_ALIMENTOS_DEMO.json';
import sfCwbiiData from '../../reference/SUPERFRIO_CWBII_ACL_DEMO.json';
import sfPortfolioData from '../../reference/SUPERFRIO_PR_PORTFOLIO_DEMO.json';
import sfFrontloadData from '../../reference/SUPERFRIO_PR_FRONTLOAD_DEMO.json';
import sf5yData from '../../reference/SUPERFRIO_PR_5Y_DEMO.json';

// End-to-end regression: builds each real demo (same JSON the app ships) and locks
// the headline simulation outputs via snapshots, plus structural invariants. Any
// future change that shifts a commercial number will fail loudly here.

// Mirrors the store's demo-loading: spread the demo, stamp id/timestamps, build the
// default rateio. Fixed timestamp keeps everything deterministic.
function buildDemo(raw: unknown, id: string): Project {
  const demo = (raw as { project: Record<string, unknown> }).project;
  const project = {
    ...demo,
    id,
    rateio: { periods: [], isOptimised: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Project;
  project.rateio = createDefaultRateio(project);
  return project;
}

const CASES: Array<[name: string, raw: unknown, id: string]> = [
  ['Copasul (sample)', sampleData, 'copasul-cs3-demo'],
  ['COPEL demo', copelData, 'copel-demo'],
  ['COPEL demo 2', copel2Data, 'copel-demo-2'],
  ['COPEL demo 3', copel3Data, 'copel-demo-3'],
  ['COPEL demo 4 (proposta)', copel4Data, 'copel-demo-4'],
  ['Belo Alimentos', beloData, 'belo-alimentos-demo'],
  ['SUPERFRIO CWBII (ACL)', sfCwbiiData, 'superfrio-cwbii-acl'],
  ['SUPERFRIO PR portfolio', sfPortfolioData, 'superfrio-pr-portfolio'],
  ['SUPERFRIO PR frontload', sfFrontloadData, 'superfrio-pr-frontload'],
  ['SUPERFRIO PR 5 anos', sf5yData, 'superfrio-pr-5y'],
];

describe('engine regression — real demo cases', () => {
  for (const [name, raw, id] of CASES) {
    it(name, () => {
      const r = runSimulation(buildDemo(raw, id));
      const s = r.summary;

      // Snapshot the headline numbers (rounded to avoid float noise).
      expect({
        months: r.months.length,
        totalGeneration: Math.round(s.totalGeneration),
        baselineSEM: Math.round(s.baselineSEM),
        economiaLiquida: Math.round(s.economiaLiquida),
        economiaPct: +(s.economiaPct * 100).toFixed(2),
        valorTotal: Math.round(s.valorTotal),
        bancoResidualKWh: Math.round(s.bancoResidualKWh),
      }).toMatchSnapshot();

      // Structural invariants (hold regardless of the exact numbers).
      expect(r.months.length).toBeGreaterThanOrEqual(12);
      expect(s.baselineSEM).toBeGreaterThan(0);
      expect(Number.isFinite(s.economiaLiquida)).toBe(true);
      expect(s.bancoResidualKWh).toBeGreaterThanOrEqual(0);
      // COM total = SEM − economia líquida must be non-negative
      expect(s.baselineSEM - s.economiaLiquida).toBeGreaterThanOrEqual(0);
      // Per-month economia reconciles to the headline (within rounding)
      const sumMonthly = r.months.reduce((a, m) => a + m.economia, 0);
      expect(sumMonthly).toBeCloseTo(s.economiaLiquida, 0);
    });
  }
});

// The optimized rateio is what's actually presented to clients. This locks those
// numbers and proves optimization never makes the economy worse than the default split.
describe('engine regression — OPTIMIZED rateio (client-facing case)', () => {
  for (const [name, raw, id] of CASES) {
    it(name, () => {
      const base = buildDemo(raw, id);
      const defaultEco = runSimulation(base).summary.economiaLiquida;

      // Same prep the optimiser.worker does: attribution off (display-only) + derived tariffs.
      const prepped: Project = {
        ...base,
        scenarios: { ...base.scenarios, runAttribution: false },
        distributor: computeDerivedTariffs(base.distributor),
      };
      const opt = optimiseRateio(prepped);
      const r = runSimulation({ ...prepped, rateio: opt.allocation });
      const s = r.summary;

      expect({
        months: r.months.length,
        baselineSEM: Math.round(s.baselineSEM),
        economiaLiquida: Math.round(s.economiaLiquida),
        economiaPct: +(s.economiaPct * 100).toFixed(2),
        valorTotal: Math.round(s.valorTotal),
        bancoResidualKWh: Math.round(s.bancoResidualKWh),
      }).toMatchSnapshot();

      // Optimization must not be worse than the default split (default is a candidate).
      expect(s.economiaLiquida).toBeGreaterThanOrEqual(defaultEco - 1);
      // The re-simulated economia matches what the optimiser reported as best.
      expect(s.economiaLiquida).toBeCloseTo(opt.bestEconomia, 0);
    });
  }
});
