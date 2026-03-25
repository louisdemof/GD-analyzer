import type { Project, RateioAllocation, ConsumptionUnit } from './types';
import { buildPeriods } from './types';
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

interface Period { start: number; end: number }

// ─── Marginal value computation ─────────────────────────────────

interface MarginalValues { [ucId: string]: number[] }

function computeMarginalValues(
  project: Project,
  semResult: ReturnType<typeof runSimulation>,
): MarginalValues {
  const matrix: MarginalValues = {};
  const contractMonths = project.plant.contractMonths || 24;
  const dist = computeDerivedTariffs(project.distributor);
  const T_AFP = dist.T_AFP ?? 0.5;
  const T_APT = dist.T_APT ?? 1;
  const T_B3 = dist.T_B3 ?? 1;
  const discount = project.scenarios.competitorDiscount || 0;
  const T_B3_eff = discount > 0 ? T_B3 * (1 - discount) : T_B3;

  const lockedUCs = project.batBank ? ['bat'] : [];

  for (const uc of project.ucs) {
    if (lockedUCs.includes(uc.id)) {
      matrix[uc.id] = new Array(contractMonths).fill(0);
      continue;
    }

    const values: number[] = [];
    const semDetails = semResult.ucDetailsSEM[uc.id];

    // Look ahead: find the next month where this UC has SEM cost > 0
    // to determine the future value of preserved bank kWh
    function futureMonthTariff(fromMonth: number): number {
      for (let fm = fromMonth + 1; fm < contractMonths; fm++) {
        const fsd = semDetails?.[fm];
        if (fsd && fsd.costRede > 0) {
          if (!uc.isGrupoA) return T_B3_eff;
          const fConsFP = uc.consumptionFP[fm] || 0;
          const fConsPT = (uc.consumptionPT || [])[fm] || 0;
          const fTotal = fConsFP + fConsPT;
          return fTotal > 0 ? (fConsFP / fTotal) * T_AFP + (fConsPT / fTotal) * T_APT : T_AFP;
        }
      }
      return project.plant.ppaRateRsBRLkWh; // no future cost month → PPA value
    }

    for (let m = 0; m < contractMonths; m++) {
      const sd = semDetails?.[m];

      if (!sd) {
        values.push(0);
        continue;
      }

      if (sd.costRede > 0) {
        // Direct saving: credit offsets rede cost at grid tariff
        if (!uc.isGrupoA) {
          values.push(T_B3_eff);
        } else {
          const consFP = uc.consumptionFP[m] || 0;
          const consPT = (uc.consumptionPT || [])[m] || 0;
          const total = consFP + consPT;
          values.push(total > 0 ? (consFP / total) * T_AFP + (consPT / total) * T_APT : T_AFP);
        }
      } else if (sd.bankDraw > 0) {
        // Bank conservation: credit prevents bank draw, preserving
        // bank for future months when grid tariff will be saved.
        // Value = future tariff × fraction of consumption covered by draw
        const consumption = (uc.consumptionFP[m] || 0) + ((uc.consumptionPT || [])[m] || 0);
        const bankFraction = consumption > 0 ? Math.min(sd.bankDraw / consumption, 1) : 0;
        const futureTariff = futureMonthTariff(m);
        values.push(futureTariff * bankFraction * 0.85);
      } else {
        // Own gen covers everything, no bank draw — minimal value
        values.push(project.plant.ppaRateRsBRLkWh * 0.3);
      }
    }
    matrix[uc.id] = values;
  }
  return matrix;
}

// ─── Data-driven period detection ───────────────────────────────

function buildDataDrivenPeriods(
  matrix: MarginalValues,
  contractMonths: number,
  maxPeriods: number = 10,
): Period[] {
  const ucIds = Object.keys(matrix).filter(id => id !== 'bat');
  if (ucIds.length === 0 || contractMonths <= 6) {
    return [{ start: 0, end: contractMonths - 1 }];
  }

  function getTopUCs(m: number): string[] {
    return ucIds
      .map(id => ({ id, val: matrix[id][m] || 0 }))
      .sort((a, b) => b.val - a.val)
      .slice(0, Math.min(3, ucIds.length))
      .map(x => x.id);
  }

  const periods: Period[] = [];
  let periodStart = 0;
  let currentTop = getTopUCs(0);

  for (let m = 1; m < contractMonths; m++) {
    const top = getTopUCs(m);
    const rankChanged = top[0] !== currentTop[0] || (top.length > 1 && top[1] !== currentTop[1]);
    const periodLen = m - periodStart;
    const atYearBound = m % 12 === 0;

    if ((rankChanged && periodLen >= 3) || (atYearBound && periodLen >= 3)) {
      periods.push({ start: periodStart, end: m - 1 });
      periodStart = m;
      currentTop = top;
      if (periods.length >= maxPeriods - 1) {
        periods.push({ start: periodStart, end: contractMonths - 1 });
        return periods;
      }
    }
  }

  if (periodStart < contractMonths) {
    periods.push({ start: periodStart, end: contractMonths - 1 });
  }

  // Enforce minimum period count for sufficient optimiser flexibility
  const minPeriods = contractMonths <= 12 ? 1 : contractMonths <= 24 ? 4 : Math.ceil(contractMonths / 8);
  if (periods.length < minPeriods) {
    return buildPeriods(contractMonths);
  }

  return periods;
}

// ─── Greedy allocation from marginal values ─────────────────────

function greedyAllocation(
  period: Period,
  eligible: ConsumptionUnit[],
  marginalValues: MarginalValues,
): number[] {
  const months = Array.from(
    { length: period.end - period.start + 1 },
    (_, i) => period.start + i,
  );

  // Weight marginal value by consumption VOLUME — total R$ saved matters
  const totalRSaved = eligible.map(uc => {
    let rSaved = 0;
    for (const m of months) {
      const perKWhValue = marginalValues[uc.id]?.[m] || 0;
      const consumption = (uc.consumptionFP[m] || 0) + ((uc.consumptionPT || [])[m] || 0);
      rSaved += perKWhValue * consumption;
    }
    return rSaved;
  });

  const total = totalRSaved.reduce((a, b) => a + b, 0);
  if (total <= 0) return eligible.map(() => 1 / eligible.length);
  return totalRSaved.map(v => v / total);
}

// ─── Rateio building helpers ────────────────────────────────────

function buildRateioFromMatrix(
  alloc: number[][],
  eligible: ConsumptionUnit[],
  allUCIds: string[],
  lockedUCs: string[],
  periods: Period[],
): RateioAllocation {
  return {
    periods: periods.map((p, pi) => ({
      start: p.start,
      end: p.end,
      allocations: allUCIds.map(id => {
        if (lockedUCs.includes(id)) return { ucId: id, fraction: 0 };
        const ei = eligible.findIndex(uc => uc.id === id);
        return { ucId: id, fraction: ei >= 0 ? (alloc[pi]?.[ei] ?? 0) : 0 };
      }),
    })),
    isOptimised: true,
    lastOptimisedAt: new Date().toISOString(),
  };
}

function createZeroRateio(allUCIds: string[], periods: Period[]): RateioAllocation {
  return {
    periods: periods.map(p => ({
      start: p.start,
      end: p.end,
      allocations: allUCIds.map(id => ({ ucId: id, fraction: 0 })),
    })),
    isOptimised: false,
  };
}

// ─── Evaluator with weighted objective ──────────────────────────

function createEvaluator(
  project: Project,
  eligible: ConsumptionUnit[],
  allUCIds: string[],
  lockedUCs: string[],
  periods: Period[],
) {
  let evalCount = 0;
  const cache = new Map<string, number>();
  const ecoCache = new Map<string, number>(); // real economia for each allocation
  const contractMonths = project.plant.contractMonths || 24;

  function evaluate(alloc: number[][]): number {
    const key = alloc.map(row => row.map(v => Math.round(v * 1000) / 1000).join(',')).join('|');
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    evalCount++;

    const rateio = buildRateioFromMatrix(alloc, eligible, allUCIds, lockedUCs, periods);
    const result = runSimulation({ ...project, rateio });
    // Always store the real economia
    ecoCache.set(key, result.summary.economiaLiquida);

    // For short contracts, use raw economia
    if (contractMonths <= 24) {
      cache.set(key, result.summary.economiaLiquida);
      return result.summary.economiaLiquida;
    }

    // For long contracts: weighted + payback penalty
    let weighted = 0;
    let paybackMonth = contractMonths;
    for (let m = 0; m < result.months.length; m++) {
      const yearIdx = Math.floor(m / 12);
      const weight = yearIdx === 0 ? 1.5 : yearIdx === 1 ? 1.3 : yearIdx === 2 ? 1.1 : 1.0;
      weighted += result.months[m].economia * weight;
      if (paybackMonth === contractMonths && result.months[m].economiaAcum > 0) {
        paybackMonth = m;
      }
    }
    const paybackPenalty = Math.max(0, paybackMonth - 18) * 5000;
    const score = weighted - paybackPenalty;
    cache.set(key, score);
    return score;
  }

  function getRealEconomia(alloc: number[][]): number {
    const key = alloc.map(row => row.map(v => Math.round(v * 1000) / 1000).join(',')).join('|');
    return ecoCache.get(key) ?? 0;
  }

  return { evaluate, getCount: () => evalCount, getRealEconomia };
}

// ─── Main optimiser ─────────────────────────────────────────────

export function optimiseRateio(
  project: Project,
  onProgress?: (p: OptimiserProgress) => void,
): OptimiserResult {
  const lockedUCs = project.batBank ? ['bat'] : [];
  const eligible = project.ucs.filter(uc => !lockedUCs.includes(uc.id));
  const allUCIds = project.ucs.map(uc => uc.id);
  const nUCs = eligible.length;
  const contractMonths = project.plant.contractMonths || 24;

  // Phase 0: run SEM simulation to get marginal values
  onProgress?.({ currentStart: 0, totalStarts: 1, bestEconomia: 0, message: 'Analisando perfil de consumo...', pct: 2 });

  const fallbackPeriods = buildPeriods(contractMonths);
  const zeroRateio = createZeroRateio(allUCIds, fallbackPeriods);
  const semResult = runSimulation({ ...project, rateio: zeroRateio });

  // Phase 1: compute marginal values and detect periods
  onProgress?.({ currentStart: 0, totalStarts: 1, bestEconomia: 0, message: 'Calculando valores marginais...', pct: 5 });

  const marginalValues = computeMarginalValues(project, semResult);
  const periods = buildDataDrivenPeriods(marginalValues, contractMonths);
  const nPeriods = periods.length;

  onProgress?.({ currentStart: 0, totalStarts: 1, bestEconomia: 0, message: `${nPeriods} periodos detectados. Gerando alocacoes...`, pct: 8 });

  const { evaluate, getCount, getRealEconomia } = createEvaluator(project, eligible, allUCIds, lockedUCs, periods);

  // Phase 2: build initial allocations
  const candidates: number[][][] = [];

  // Candidate 1: greedy from marginal values (data-driven)
  candidates.push(periods.map(p => greedyAllocation(p, eligible, marginalValues)));

  // Candidate 2: equal distribution
  candidates.push(periods.map(() => eligible.map(() => 1 / nUCs)));

  // Candidate 3: consumption × tariff proportional
  const dist = computeDerivedTariffs(project.distributor);
  const T_AFP = dist.T_AFP ?? 0.5;
  const T_B3_eff = (dist.T_B3 ?? 1) * (1 - (project.scenarios.competitorDiscount || 0));
  candidates.push(periods.map(() => {
    const vals = eligible.map(uc => {
      const avgFP = uc.consumptionFP.reduce((a, b) => a + b, 0) / Math.max(uc.consumptionFP.length, 1);
      const tariff = uc.isGrupoA ? T_AFP : T_B3_eff;
      return avgFP * tariff;
    });
    const total = vals.reduce((a, b) => a + b, 0);
    return total > 0 ? vals.map(v => v / total) : eligible.map(() => 1 / nUCs);
  }));

  // Candidate 4: Grupo B only
  const grupoB = eligible.filter(uc => !uc.isGrupoA);
  if (grupoB.length > 0) {
    candidates.push(periods.map(() =>
      eligible.map(uc => uc.isGrupoA ? 0 : 1 / grupoB.length)
    ));
  }

  // Candidate 5: SEM-cost-driven — allocate proportional to actual SEM cost per UC per period
  // This directly targets the UCs that pay the most grid cost
  candidates.push(periods.map(p => {
    const monthsInPeriod = Array.from({ length: p.end - p.start + 1 }, (_, i) => p.start + i);
    const semCosts = eligible.map(uc => {
      const semD = semResult.ucDetailsSEM[uc.id];
      if (!semD) return 0;
      return monthsInPeriod.reduce((s, m) => s + (semD[m]?.costRede ?? 0), 0);
    });
    const total = semCosts.reduce((a, b) => a + b, 0);
    return total > 0 ? semCosts.map(v => v / total) : eligible.map(() => 1 / nUCs);
  }));

  // Candidate 6: SEM-cost-driven with bank conservation boost
  // Like candidate 5 but also values bank draws (credits save future costs)
  candidates.push(periods.map(p => {
    const monthsInPeriod = Array.from({ length: p.end - p.start + 1 }, (_, i) => p.start + i);
    const values = eligible.map(uc => {
      const semD = semResult.ucDetailsSEM[uc.id];
      if (!semD) return 0;
      let val = 0;
      for (const m of monthsInPeriod) {
        const sd = semD[m];
        if (!sd) continue;
        // Direct cost value
        val += sd.costRede;
        // Bank conservation value: if bank is being drawn, credit preserves it
        if (sd.costRede === 0 && sd.bankDraw > 0) {
          const tariff = uc.isGrupoA ? (dist.T_AFP ?? 0.5) : T_B3_eff;
          val += sd.bankDraw * tariff * 0.8;
        }
      }
      return val;
    });
    const total = values.reduce((a, b) => a + b, 0);
    return total > 0 ? values.map(v => v / total) : eligible.map(() => 1 / nUCs);
  }));

  // Candidate 7: High Grupo A concentration with Grupo B floor
  const grupoA = eligible.filter(uc => uc.isGrupoA);
  if (grupoA.length > 0 && grupoB.length > 0) {
    candidates.push(periods.map((p, pi) => {
      const earlyPeriod = p.start < 12;
      return eligible.map(uc => {
        if (uc.isGrupoA) return earlyPeriod ? 0.70 / grupoA.length : 0.50 / grupoA.length;
        return earlyPeriod ? 0.30 / grupoB.length : 0.50 / grupoB.length;
      });
    }));
  }

  // Candidate 7: highest-value UC gets 60-80% per period (aggressive)
  candidates.push(periods.map(p => {
    const alloc = greedyAllocation(p, eligible, marginalValues);
    // Amplify: give the top UC even more
    const maxIdx = alloc.indexOf(Math.max(...alloc));
    return alloc.map((v, i) => {
      if (i === maxIdx) return Math.min(0.80, v * 1.5);
      return v * 0.5 / (1 - alloc[maxIdx]) * (1 - Math.min(0.80, alloc[maxIdx] * 1.5));
    });
  }));

  // Evaluate candidates
  let bestAlloc = candidates[0];
  let bestEco = evaluate(bestAlloc);
  for (let c = 1; c < candidates.length; c++) {
    const val = evaluate(candidates[c]);
    if (val > bestEco) { bestEco = val; bestAlloc = candidates[c]; }
  }

  const realEcoInitial = getRealEconomia(bestAlloc);
  onProgress?.({ currentStart: 0, totalStarts: 1, bestEconomia: realEcoInitial, message: `Melhor inicial: R$${Math.round(realEcoInitial).toLocaleString('pt-BR')}`, pct: 15 });

  // Phase 3: coordinate descent
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

      const pct = Math.min(95, 15 + (si / STEPS.length) * 80 + (passes / 20) * (80 / STEPS.length));
      const realEcoStep = getRealEconomia(bestAlloc);
      onProgress?.({ currentStart: si + 1, totalStarts: STEPS.length, bestEconomia: realEcoStep, message: `Passo ${step} — rodada ${passes} — R$${Math.round(realEcoStep).toLocaleString('pt-BR')}`, pct });
    }
  }

  const realEcoFinal = getRealEconomia(bestAlloc);
  onProgress?.({ currentStart: STEPS.length, totalStarts: STEPS.length, bestEconomia: realEcoFinal, message: `Concluido: R$${Math.round(realEcoFinal).toLocaleString('pt-BR')} (${getCount()} avaliacoes)`, pct: 100 });

  return {
    allocation: buildRateioFromMatrix(bestAlloc, eligible, allUCIds, lockedUCs, periods),
    bestEconomia: realEcoFinal,
    converged: true,
    evaluations: getCount(),
  };
}

export function optimiseRateioAsync(
  project: Project,
  onProgress?: (p: OptimiserProgress) => void,
): Promise<OptimiserResult> {
  return new Promise(resolve => {
    setTimeout(() => resolve(optimiseRateio(project, onProgress)), 0);
  });
}

// ─── Default rateio ─────────────────────────────────────────────

export function createDefaultRateio(project: Project): RateioAllocation {
  const ucIds = project.ucs.map(uc => uc.id);
  const lockedUCs = project.batBank ? ['bat'] : [];
  const activeUCs = ucIds.filter(id => !lockedUCs.includes(id));
  const fraction = activeUCs.length > 0 ? 1 / activeUCs.length : 0;
  const periods = buildPeriods(project.plant.contractMonths || 24);

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
