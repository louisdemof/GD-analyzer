import type { Project, RateioAllocation, ConsumptionUnit } from './types';
import { DEFAULT_PERIODS, buildPeriods } from './types';
import { runSimulation } from './simulation';
import { computeDerivedTariffs } from './tariff';

export interface OptimiserProgress {
  currentStart: number;
  totalStarts: number;
  bestEconomia: number;
  message?: string;
  pct?: number;
}

export interface OptimiserResult {
  allocation: RateioAllocation;
  bestEconomia: number;
  converged: boolean;
  evaluations: number;
}

// ─── Allocation matrix ↔ RateioAllocation conversion ────────────

interface Period { start: number; end: number }

function getProjectPeriods(project: Project): Period[] {
  return buildPeriods(project.plant.contractMonths || 24);
}

function buildRateioFromMatrix(
  alloc: number[][],
  eligible: ConsumptionUnit[],
  allUCIds: string[],
  lockedUCs: string[],
  periods: Period[]
): RateioAllocation {
  return {
    periods: periods.map((p, pi) => ({
      start: p.start,
      end: p.end,
      allocations: allUCIds.map(id => {
        if (lockedUCs.includes(id)) return { ucId: id, fraction: 0 };
        const ei = eligible.findIndex(uc => uc.id === id);
        return { ucId: id, fraction: ei >= 0 ? alloc[pi][ei] : 0 };
      }),
    })),
    isOptimised: true,
    lastOptimisedAt: new Date().toISOString(),
  };
}

// ─── Evaluate helper ────────────────────────────────────────────

function createEvaluator(
  project: Project,
  eligible: ConsumptionUnit[],
  allUCIds: string[],
  lockedUCs: string[],
  periods: Period[]
) {
  let evalCount = 0;
  const cache = new Map<string, number>();

  function evaluate(alloc: number[][]): number {
    const key = alloc
      .map(row => row.map(v => Math.round(v * 1000) / 1000).join(','))
      .join('|');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    evalCount++;
    const rateio = buildRateioFromMatrix(alloc, eligible, allUCIds, lockedUCs, periods);
    const result = runSimulation({ ...project, rateio });
    const eco = result.summary.economiaLiquida;
    cache.set(key, eco);
    return eco;
  }

  return { evaluate, getCount: () => evalCount };
}

// ─── Smart initial allocations ──────────────────────────────────

function buildSmartInitialAllocations(
  project: Project,
  eligible: ConsumptionUnit[],
  allUCIds: string[],
  lockedUCs: string[],
  evaluate: (alloc: number[][]) => number,
  periods: Period[]
): { best: number[][]; bestVal: number } {
  const nUCs = eligible.length;
  const grupoB = eligible.filter(uc => !uc.isGrupoA);
  const nB = grupoB.length;
  const bShare = 1.0 / Math.max(nB, 1);
  const discount = project.scenarios.competitorDiscount || 0;

  const dist = computeDerivedTariffs(project.distributor);
  const T_B3 = dist.T_B3 ?? 1;
  const T_AFP = dist.T_AFP ?? 0.5;
  const T_APT = dist.T_APT ?? 1;
  const T_B3_eff = discount > 0 ? T_B3 * (1 - discount) : T_B3;

  const nhsIdx = eligible.findIndex(uc => uc.id === 'nhs' || uc.name.includes('Horizonte'));
  const amdIdx = eligible.findIndex(uc => uc.id === 'amd' || uc.name.includes('Amandina'));

  function uniform(fracs: (uc: ConsumptionUnit, ucIdx: number, period: number) => number): number[][] {
    return periods.map((_, p) => {
      const row = eligible.map((uc, i) => fracs(uc, i, p));
      const sum = row.reduce((a, b) => a + b, 0);
      return sum > 0 ? row.map(v => v / sum) : row.map(() => 1 / nUCs);
    });
  }

  const candidates: number[][][] = [];

  // 1. Equal across all eligible UCs
  candidates.push(uniform(() => 1));

  // 2. 100% Grupo B equally
  if (nB > 0) {
    candidates.push(uniform((uc) => uc.isGrupoA ? 0 : 1));
  }

  // 3. 70% Grupo B + 30% NHS
  if (nhsIdx >= 0) {
    candidates.push(uniform((uc, i) => {
      if (i === nhsIdx) return 0.30;
      if (uc.isGrupoA) return 0;
      return 0.70 * bShare;
    }));
  }

  // 4. Proportional to consumption × tariff
  candidates.push(uniform((uc) => {
    const avgFP = uc.consumptionFP.reduce((a, b) => a + b, 0) / 24;
    const avgPT = (uc.consumptionPT || []).reduce((a, b) => a + b, 0) / 24;
    const tariff = uc.isGrupoA
      ? T_AFP * avgFP + T_APT * avgPT
      : T_B3_eff * avgFP;
    return tariff;
  }));

  // 5. Period-aware: AMD gets 0 early, NHS high early, B gets share
  if (nhsIdx >= 0 || amdIdx >= 0) {
    candidates.push(uniform((uc, i, p) => {
      if (i === amdIdx) return p < 2 ? 0 : 0.10;
      if (i === nhsIdx) return p < 2 ? 0.50 : 0.40;
      if (uc.isGrupoA) return 0;
      return p < 2 ? 0.50 / Math.max(nB, 1) : 0.50 / Math.max(nB, 1);
    }));
  }

  // 6. 60% NHS + 40% Grupo B
  if (nhsIdx >= 0 && nB > 0) {
    candidates.push(uniform((uc, i) => {
      if (i === nhsIdx) return 0.60;
      if (uc.isGrupoA) return 0;
      return 0.40 * bShare;
    }));
  }

  // 7. Greedy — marginal value based on SEM bank state
  {
    const zeroRateio = createZeroRateio(allUCIds, lockedUCs, periods);
    const semResult = runSimulation({ ...project, rateio: zeroRateio });

    const greedy = periods.map((_, pi) => {
      const pStart = periods[pi].start;
      const pEnd = periods[pi].end;
      const periodMonths = pEnd - pStart + 1;
      const row = eligible.map(uc => {
        const semDetails = semResult.ucDetailsSEM[uc.id];
        if (!semDetails) return 0;
        const bankAtStart = semDetails[pStart]?.bankStart ?? 0;
        let periodCons = 0;
        for (let m = pStart; m <= pEnd; m++) {
          periodCons += (uc.consumptionFP[m] || 0) + (uc.consumptionPT[m] || 0);
        }
        const shortfall = Math.max(0, periodCons - bankAtStart);
        if (shortfall <= 0) return project.plant.ppaRateRsBRLkWh * periodMonths;
        const tariff = uc.isGrupoA ? T_AFP : T_B3_eff;
        return tariff * Math.min(shortfall, periodCons) / periodMonths;
      });
      const sum = row.reduce((a, b) => a + b, 0);
      return sum > 0 ? row.map(v => v / sum) : row.map(() => 1 / nUCs);
    });
    candidates.push(greedy);
  }

  // 8. 50/50 A and B, consumption-weighted
  candidates.push(uniform((uc) => {
    const avgCons = uc.consumptionFP.reduce((s, v) => s + v, 0) / 24;
    return avgCons;
  }));

  // Evaluate all candidates and pick best
  let best = candidates[0];
  let bestVal = evaluate(best);
  for (let c = 1; c < candidates.length; c++) {
    const val = evaluate(candidates[c]);
    if (val > bestVal) { bestVal = val; best = candidates[c]; }
  }
  return { best, bestVal };
}

function createZeroRateio(
  ucIds: string[],
  lockedUCs: string[],
  periods: Period[]
): RateioAllocation {
  return {
    periods: periods.map(p => ({
      start: p.start,
      end: p.end,
      allocations: ucIds.map(id => ({ ucId: id, fraction: 0 })),
    })),
    isOptimised: false,
  };
}

// ─── Coordinate descent optimiser ──────────────────────────────

export function optimiseRateio(
  project: Project,
  onProgress?: (p: OptimiserProgress) => void
): OptimiserResult {
  const lockedUCs = project.batBank ? ['bat'] : [];
  const eligible = project.ucs.filter(uc => !lockedUCs.includes(uc.id));
  const allUCIds = project.ucs.map(uc => uc.id);
  const nUCs = eligible.length;
  const periods = getProjectPeriods(project);
  const nPeriods = periods.length;

  const { evaluate, getCount } = createEvaluator(project, eligible, allUCIds, lockedUCs, periods);

  // Build smart initial allocation
  onProgress?.({
    currentStart: 0, totalStarts: 1,
    bestEconomia: 0,
    message: 'Gerando alocações iniciais...',
    pct: 5,
  });

  const { best: initialAlloc, bestVal: initialEco } = buildSmartInitialAllocations(
    project, eligible, allUCIds, lockedUCs, evaluate, periods
  );

  let bestAlloc = initialAlloc.map(row => [...row]);
  let bestEco = initialEco;

  onProgress?.({
    currentStart: 0, totalStarts: 1,
    bestEconomia: bestEco,
    message: `Melhor inicial: R$${Math.round(bestEco).toLocaleString('pt-BR')}. Iniciando otimização...`,
    pct: 10,
  });

  // Coordinate descent with decreasing step sizes
  const STEPS = [0.20, 0.10, 0.05, 0.02, 0.01, 0.005];

  for (let si = 0; si < STEPS.length; si++) {
    const step = STEPS[si];
    let improved = true;
    let passes = 0;

    while (improved && passes < 20) {
      improved = false;
      passes++;

      for (let p = 0; p < nPeriods; p++) {
        for (let i = 0; i < nUCs; i++) {
          for (let j = 0; j < nUCs; j++) {
            if (i === j) continue;
            if (bestAlloc[p][i] < step - 1e-9) continue;

            const trial = bestAlloc.map(row => [...row]);
            trial[p][i] = Math.round((trial[p][i] - step) * 1000) / 1000;
            trial[p][j] = Math.round((trial[p][j] + step) * 1000) / 1000;

            // Clamp to valid range
            if (trial[p][i] < -1e-9 || trial[p][j] > 1 + 1e-9) continue;
            trial[p][i] = Math.max(0, trial[p][i]);
            trial[p][j] = Math.min(1, trial[p][j]);

            const eco = evaluate(trial);
            if (eco > bestEco + 0.50) {
              bestEco = eco;
              bestAlloc = trial;
              improved = true;
            }
          }
        }
      }

      // Progress update per pass
      const pct = Math.min(95, 10 + (si / STEPS.length) * 85 + (passes / 20) * (85 / STEPS.length));
      onProgress?.({
        currentStart: si + 1,
        totalStarts: STEPS.length,
        bestEconomia: bestEco,
        message: `Passo ${step} — rodada ${passes} — R$${Math.round(bestEco).toLocaleString('pt-BR')}`,
        pct,
      });
    }
  }

  onProgress?.({
    currentStart: STEPS.length, totalStarts: STEPS.length,
    bestEconomia: bestEco,
    message: `Concluído: R$${Math.round(bestEco).toLocaleString('pt-BR')} (${getCount()} avaliações)`,
    pct: 100,
  });

  return {
    allocation: buildRateioFromMatrix(bestAlloc, eligible, allUCIds, lockedUCs, periods),
    bestEconomia: bestEco,
    converged: true,
    evaluations: getCount(),
  };
}

export function optimiseRateioAsync(
  project: Project,
  onProgress?: (p: OptimiserProgress) => void
): Promise<OptimiserResult> {
  return new Promise((resolve) => {
    // Use setTimeout to keep UI responsive
    setTimeout(() => {
      const result = optimiseRateio(project, onProgress);
      resolve(result);
    }, 0);
  });
}

// ─── Default rateio ─────────────────────────────────────────────

export function createDefaultRateio(project: Project): RateioAllocation {
  const ucIds = project.ucs.map(uc => uc.id);
  const lockedUCs = project.batBank ? ['bat'] : [];
  const activeUCs = ucIds.filter(id => !lockedUCs.includes(id));
  const fraction = activeUCs.length > 0 ? 1 / activeUCs.length : 0;
  const periods = getProjectPeriods(project);

  return {
    periods: periods.map(p => ({
      start: p.start,
      end: p.end,
      allocations: ucIds.map(id => ({
        ucId: id,
        fraction: lockedUCs.includes(id) ? 0 : fraction,
      })),
    })),
    isOptimised: false,
  };
}
