import type {
  Project, Plant, ConsumptionUnit, SimulationResult, MonthlyResult, SimulationSummary, UCMonthlyDetail, Distributor,
  AttributionFlags, AttributionScenario, AttributionScenarioName, AttributionResult,
  AttributionMonthly,
} from './types';
import { computeDerivedTariffs } from './tariff';
import { simulateUCBank, computeBATCredits, type BankSimResult } from './bank';
import { optimizeDemandaContratada, computeDemandaBilling } from './demandaOptimizer';

/**
 * Base generation profile for a single plant (before extension).
 */
function plantBaseGeneration(plant: Plant, useActual: boolean): number[] {
  if (useActual && plant.actualProfile) return plant.actualProfile;
  return plant.p50Profile;
}

/**
 * All plants of a project: the main plant plus any additional usinas.
 */
export function getAllPlants(project: Project): Plant[] {
  return [project.plant, ...(project.additionalPlants ?? [])];
}

function ymIndex(ym?: string): number | null {
  if (!ym || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null;
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

/**
 * Commissioning offset (months) of a plant relative to the project anchor (main
 * plant's contractStartMonth). A plant that starts later is placed that many months
 * into the timeline; earlier/invalid dates clamp to 0. Lets additional usinas come
 * online mid-contract instead of all being pinned to month 0.
 */
export function plantStartOffset(anchorYM: string, plantYM?: string): number {
  const a = ymIndex(anchorYM), p = ymIndex(plantYM);
  if (a == null || p == null) return 0;
  return Math.max(0, p - a);
}

/**
 * Simulation horizon (months). An explicit simulationMonths override wins;
 * otherwise it's the max of (commissioning offset + contractMonths) across all
 * plants, so a longer — or later-starting — usina extends the horizon.
 */
export function computeSimulationMonths(project: Project): number {
  if (project.simulationMonths && project.simulationMonths > 0) return project.simulationMonths;
  const anchor = project.plant.contractStartMonth;
  return Math.max(
    ...getAllPlants(project).map(p => plantStartOffset(anchor, p.contractStartMonth) + (p.contractMonths || 24)),
  );
}

/**
 * Per-plant generation series, each extended to its own contractMonths (with
 * degradation + performance haircut) then zero-padded to `totalMonths`. A plant
 * with a shorter prazo contributes 0 once its contract ends.
 */
function buildPlantGenerationSeries(
  plants: Plant[],
  totalMonths: number,
  performanceFactor: number,
  genDegradation: number,
  useActual: boolean,
  anchorYM: string,
): number[][] {
  return plants.map(plant => {
    const offset = plantStartOffset(anchorYM, plant.contractStartMonth);
    const raw = plantBaseGeneration(plant, useActual).map(v => v * performanceFactor);
    // Active months are capped by the horizon remaining after the offset. Degradation
    // counts from the plant's own commissioning (the extended series is local), then
    // the whole series is shifted right by `offset` and zero-filled before/after.
    const active = Math.min(plant.contractMonths || totalMonths, Math.max(0, totalMonths - offset));
    const ext = extendGeneration(raw, active, genDegradation);
    const series = new Array(totalMonths).fill(0);
    for (let i = 0; i < ext.length; i++) series[offset + i] = ext[i];
    return series;
  });
}

/**
 * Extend generation profile to contractMonths with degradation.
 * Cycles the seasonal pattern (12 months) and applies annual degradation.
 */
function extendGeneration(
  base: number[],
  contractMonths: number,
  degradationPerYear: number,
): number[] {
  if (!base || base.length === 0) return new Array(contractMonths).fill(0);

  const profile: number[] = [];
  // Use first 12 months as the seasonal base pattern
  const seasonalBase = base.slice(0, Math.min(base.length, 12));

  for (let m = 0; m < contractMonths; m++) {
    const calMonth = m % 12;
    const yearIndex = Math.floor(m / 12);
    const factor = Math.pow(1 - degradationPerYear, yearIndex);
    const baseVal = m < base.length
      ? base[m]
      : (seasonalBase[calMonth] ?? 0);
    profile.push(Math.round(baseVal * factor));
  }
  return profile;
}

/**
 * Extend consumption array to contractMonths with annual growth.
 * Cycles the seasonal pattern and applies compound growth per year.
 */
function extendConsumption(
  base: number[],
  contractMonths: number,
  growthPerYear: number,
): number[] {
  if (!base || base.length === 0) return new Array(contractMonths).fill(0);
  if (base.length >= contractMonths) return base.slice(0, contractMonths);

  const extended = [...base];
  const seasonalBase = base.slice(0, Math.min(base.length, 12));

  while (extended.length < contractMonths) {
    const m = extended.length;
    const calMonth = m % 12;
    const yearIndex = Math.floor(m / 12);
    const baseVal = seasonalBase[calMonth] ?? base[m % base.length] ?? 0;
    const growth = Math.pow(1 + growthPerYear, yearIndex);
    extended.push(Math.round(baseVal * growth));
  }
  return extended;
}

/**
 * Format month label from contract start and month index.
 * e.g. "2026-06" + index 0 = "Jun/26"
 */
function formatMonthLabel(contractStart: string, monthIndex: number): string {
  const [year, month] = contractStart.split('-').map(Number);
  const date = new Date(year, month - 1 + monthIndex, 1);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[date.getMonth()]}/${String(date.getFullYear()).slice(2)}`;
}

/**
 * Run full 24-month simulation: SEM and COM scenarios.
 */
function validateProject(project: Project, d: Distributor): void {
  if (project.ucs.length === 0) {
    throw new Error('O projeto não tem Unidades Consumidoras. Adicione pelo menos uma UC antes de simular.');
  }

  const checks: [string, number | undefined][] = [
    ['T_B3', d.T_B3],
    ['T_AFP', d.T_AFP],
    ['T_APT', d.T_APT],
  ];
  for (const [name, value] of checks) {
    if (value === undefined || value === null || isNaN(value) || value <= 0) {
      throw new Error(`Tarifa inválida: ${name} = ${value} para ${d.name}. Preencha todos os campos tarifários antes de simular.`);
    }
  }

  if (d.taxes && (d.taxes.PIS || 0) + (d.taxes.COFINS || 0) >= 1) {
    throw new Error('PIS + COFINS >= 100% — valores invalidos. Insira as taxas como percentagem decimal (ex: 0.0153 para 1,53%).');
  }

  if (!project.plant.p50Profile?.length || project.plant.p50Profile.every(v => v === 0)) {
    throw new Error('Perfil de geração inválido — todos os valores são zero. Adicione os dados de geração da usina.');
  }

  if (!project.plant.ppaRateRsBRLkWh || project.plant.ppaRateRsBRLkWh <= 0) {
    throw new Error('Tarifa PPA inválida. Defina o preço do PPA em R$/kWh antes de simular.');
  }
}

export function runSimulation(project: Project): SimulationResult {
  // Ensure derived tariffs are computed
  const distributor = computeDerivedTariffs(project.distributor);

  // Fator de Ajuste: se a distribuidora não aplica FA na compensação cruzada de postos
  // (ex.: COPEL), créditos fora-ponta compensam ponta 1:1 → FA=1 (benéfico ao cliente).
  if (project.scenarios.applyFatorAjuste === false) {
    distributor.FA = 1;
  }

  // Validate project inputs
  validateProject(project, distributor);

  const ppaRate = project.plant.ppaRateRsBRLkWh;
  const contractMonths = computeSimulationMonths(project);
  const growthRate = project.growthRate ?? 0.025;
  const genDegradation = project.generationDegradation ?? 0.005;
  const performanceFactor = project.performanceFactor ?? 1.0;

  // Generation across all usinas (main + additional). Each plant is extended to
  // its own contractMonths with degradation + performance haircut, zero-padded
  // to the simulation horizon, then summed month-by-month. plantGenSeries is kept
  // so per-plant PPA rates can be applied in the monthly loop below.
  const allPlants = getAllPlants(project);
  const plantGenSeries = buildPlantGenerationSeries(
    allPlants, contractMonths, performanceFactor, genDegradation,
    !!project.scenarios.useActualGeneration, project.plant.contractStartMonth,
  );
  const generation: number[] = new Array(contractMonths).fill(0)
    .map((_, m) => plantGenSeries.reduce((sum, s) => sum + (s[m] ?? 0), 0));

  // If "useOptimizedDemand" scenario is on, replace each UC's demandaFaturadaFP
  // with the average kW billed under the optimal DC computed from its DM history.
  const useOptDemand = !!project.scenarios.useOptimizedDemand;
  const T_DEMANDA = distributor.T_A_DEMANDA ?? 0;

  const extendedProject: Project = {
    ...project,
    ucs: project.ucs.map(uc => {
      const next = {
        ...uc,
        consumptionFP: extendConsumption(uc.consumptionFP, contractMonths, growthRate),
        consumptionPT: extendConsumption(uc.consumptionPT || [], contractMonths, growthRate),
        consumptionReservado: uc.consumptionReservado
          ? extendConsumption(uc.consumptionReservado, contractMonths, growthRate)
          : undefined,
        ownGeneration: uc.ownGeneration
          ? extendGeneration(uc.ownGeneration.map(v => v * performanceFactor), contractMonths, genDegradation)
          : undefined,
      };

      if (useOptDemand && uc.isGrupoA && T_DEMANDA > 0
          && uc.demandaMedidaMensal && uc.demandaMedidaMensal.some(v => v > 0)) {
        const opt = optimizeDemandaContratada(uc.demandaMedidaMensal, T_DEMANDA);
        if (opt.bestDC > 0) {
          const monthlyBilledKW = uc.demandaMedidaMensal.map(dm =>
            computeDemandaBilling(opt.bestDC, dm).billed
          );
          const avgKW = monthlyBilledKW.reduce((a, b) => a + b, 0) / monthlyBilledKW.length;
          next.demandaFaturadaFP = avgKW;
          next.demandaContratadaFP = opt.bestDC;
        }
      }

      return next;
    }),
  };

  // Compute BAT credits distribution AND BAT-the-UC's own grid bill.
  // SEM and COM differ only in whether HCS03 reaches BAT — for Copasul that's
  // always 0 (BAT is locked from rateio), but the function correctly handles
  // either case via the rateio param.
  const tariffEsc = project.tariffEscalationDistributor ?? 0;
  const pisCofinsExempt = project.distributor.taxes.pisCofinsExempt ?? true;
  const batSimSEM = computeBATCredits({
    project: extendedProject,
    contractMonths,
    icmsExempt: true, // SEM has no compensated credits → no ICMS additional
    pisCofinsExempt: true, // same: no compensated credits in SEM
    tariffEscalationDistributor: tariffEsc,
  });
  const batSimCOM = computeBATCredits({
    project: extendedProject,
    contractMonths,
    icmsExempt: project.scenarios.icmsExempt,
    pisCofinsExempt,
    tariffEscalationDistributor: tariffEsc,
  });

  // Empty BAT credits for UCs that don't receive them
  const emptyBatCredits: number[] = new Array(contractMonths).fill(0);

  // Resolve the ACL baseline for a UC: only when the project is no mercado livre.
  // UC-level override wins over the project default; null ⇒ captive baseline (legacy).
  const resolveACL = (uc: ConsumptionUnit) =>
    project.marketType === 'ACL'
      ? (uc.aclBaselineOverride ?? project.aclBaseline ?? null)
      : null;

  // --- SEM scenario (no CS3 credits) ---
  const semResults: Record<string, BankSimResult> = {};
  for (const uc of extendedProject.ucs) {
    if (uc.id === 'bat') continue; // BAT bills tracked separately via batSimSEM
    const ucBatCredits = batSimSEM.creditsByUC[uc.id] || emptyBatCredits;
    semResults[uc.id] = simulateUCBank({
      uc,
      distributor,
      generation,
      rateio: project.rateio,
      includeCS3Credits: false,  // SEM = no CS3
      batCreditsPerMonth: ucBatCredits,
      icmsExempt: true, // SEM doesn't have ICMS additional (no CS3 credits to tax)
      pisCofinsExempt: true,
      competitorDiscount: project.scenarios.competitorDiscount,
      aclBaseline: resolveACL(uc),
      isSEM: true,
      contractMonths,
      tariffEscalationDistributor: tariffEsc,
    });

  }

  // --- COM scenario (with CS3 credits) ---
  const comResults: Record<string, BankSimResult> = {};
  for (const uc of extendedProject.ucs) {
    if (uc.id === 'bat') continue; // BAT bills tracked separately via batSimCOM
    const ucBatCredits = batSimCOM.creditsByUC[uc.id] || emptyBatCredits;
    comResults[uc.id] = simulateUCBank({
      uc,
      distributor,
      generation,
      rateio: project.rateio,
      includeCS3Credits: true,   // COM = with CS3
      batCreditsPerMonth: ucBatCredits,
      icmsExempt: project.scenarios.icmsExempt,
      pisCofinsExempt,
      competitorDiscount: project.scenarios.competitorDiscount,
      isSEM: false,
      contractMonths,
      tariffEscalationDistributor: tariffEsc,
    });
  }

  // --- Aggregate monthly results ---
  const months: MonthlyResult[] = [];
  let economiaAcum = 0;
  const ppaEscalation = project.tariffEscalationPPA ?? 0;

  for (let m = 0; m < contractMonths; m++) {
    const gen = generation[m];
    const yearIdx = Math.floor(m / 12);
    const escFactor = Math.pow(1 + ppaEscalation, yearIdx);
    // PPA cost uses each usina's own rate: Σ plantGen[m] × plant.ppaRate × escalation.
    const ppaCost = plantGenSeries.reduce(
      (sum, s, i) => sum + (s[m] ?? 0) * allPlants[i].ppaRateRsBRLkWh * escFactor, 0,
    );

    let semTotalCost = 0;
    let semTusdPtCost = 0;
    let semTeFpCost = 0;
    let semTePtCost = 0;
    let semDemandaCost = 0;
    let comRedeCost = 0;
    let comIcmsAdditional = 0;
    let comPisCofinsAdditional = 0;

    for (const uc of extendedProject.ucs) {
      // BAT-the-UC is summed below from batSimSEM/batSimCOM (its bills include
      // own consumption × tariff residual, which the standard simulateUCBank
      // path doesn't compute because BAT also distributes surplus to NHS/AMD).
      if (uc.id === 'bat') continue;

      const semUC = semResults[uc.id];
      const comUC = comResults[uc.id];
      if (semUC && semUC.monthlyDetails[m]) {
        semTotalCost += semUC.monthlyDetails[m].costRede;
        semTusdPtCost += semUC.monthlyDetails[m].tusdPtCost;
        semTeFpCost += semUC.monthlyDetails[m].teFpCost;
        semTePtCost += semUC.monthlyDetails[m].tePtCost;
        semDemandaCost += semUC.monthlyDetails[m].demandaCost;
      }
      if (comUC && comUC.monthlyDetails[m]) {
        comRedeCost += comUC.monthlyDetails[m].costRede;
        comIcmsAdditional += comUC.monthlyDetails[m].icmsAdditional;
        comPisCofinsAdditional += comUC.monthlyDetails[m].pisCofinsAdditional;
      }
    }

    // Add BAT-the-UC's own bills (was missing — silently dropped on the floor before).
    if (batSimSEM.monthlyBills[m]) {
      semTotalCost += batSimSEM.monthlyBills[m].costRede;
    }
    if (batSimCOM.monthlyBills[m]) {
      comRedeCost += batSimCOM.monthlyBills[m].costRede;
      comIcmsAdditional += batSimCOM.monthlyBills[m].icmsAdditional;
      comPisCofinsAdditional += batSimCOM.monthlyBills[m].pisCofinsAdditional;
    }

    const comTotalCost = comRedeCost + ppaCost;
    const economia = semTotalCost - comTotalCost - comIcmsAdditional - comPisCofinsAdditional;
    economiaAcum += economia;

    // Fora-ponta TUSD as the residual so the SEM decomposition always reconciles to
    // totalCost (also absorbs BAT-the-UC's captive bill, which isn't itemised here).
    const semTusdFpCost = Math.max(0, semTotalCost - semTusdPtCost - semTeFpCost - semTePtCost - semDemandaCost);

    months.push({
      monthIndex: m,
      label: formatMonthLabel(project.plant.contractStartMonth, m),
      generation: gen,
      ppaCost,
      sem: { totalCost: semTotalCost, tusdFpCost: semTusdFpCost, tusdPtCost: semTusdPtCost, teFpCost: semTeFpCost, tePtCost: semTePtCost, demandaCost: semDemandaCost },
      com: { redeCost: comRedeCost, totalCost: comTotalCost, icmsAdditional: comIcmsAdditional, pisCofinsAdditional: comPisCofinsAdditional },
      economia,
      economiaAcum,
    });
  }

  // --- Bank per UC at end of contract ---
  const bankPerUC = project.ucs
    .filter(uc => uc.id !== 'bat')
    .map(uc => {
      const comBank = comResults[uc.id]?.finalBank ?? 0;
      const semBank = semResults[uc.id]?.finalBank ?? 0;
      return {
        ucId: uc.id,
        name: uc.name,
        finalBankCOM: comBank,
        finalBankSEM: semBank,
        valueAtPPA: (comBank - semBank) * ppaRate,
      };
    });

  // Append BAT-the-UC's bank (tracked by computeBATCredits, not by simulateUCBank).
  const batUC = project.ucs.find(uc => uc.id === 'bat');
  if (batUC) {
    bankPerUC.push({
      ucId: 'bat',
      name: batUC.name,
      finalBankCOM: batSimCOM.finalBank,
      finalBankSEM: batSimSEM.finalBank,
      valueAtPPA: (batSimCOM.finalBank - batSimSEM.finalBank) * ppaRate,
    });
  }

  // --- Summary ---
  const totalGeneration = generation.reduce((a, b) => a + b, 0);
  const totalPPACost = totalGeneration * ppaRate;
  const baselineSEM = months.reduce((acc, m) => acc + m.sem.totalCost, 0);
  const economiaLiquida = months.reduce((acc, m) => acc + m.economia, 0);
  const bancoResidualKWh = bankPerUC.reduce((acc, b) => acc + b.finalBankCOM, 0);
  const bancoResidualValue = bancoResidualKWh * ppaRate;

  // Banco Net Helexia = COM banks - SEM banks (only NHS and AMD have SEM banks)
  const bancoSEM = bankPerUC.reduce((acc, b) => acc + b.finalBankSEM, 0);
  const bancoNetHelexia = bancoResidualKWh - bancoSEM;
  const valorBancoAtPPA = bancoNetHelexia * ppaRate;
  const valorTotal = economiaLiquida + valorBancoAtPPA;

  // ICMS risk: total ICMS additional if isenção were lost
  // Recalculate COM with icmsExempt=false
  let icmsRisk = 0;
  if (project.scenarios.icmsExempt) {
    // BAT-the-UC: re-run with icmsExempt=false
    const batRisk = computeBATCredits({
      project: extendedProject,
      contractMonths,
      icmsExempt: false,
      pisCofinsExempt,
      tariffEscalationDistributor: tariffEsc,
    });
    icmsRisk += batRisk.totalIcmsAdditional;
    // Other UCs
    for (const uc of extendedProject.ucs) {
      if (uc.id === 'bat') continue;
      const ucBatCredits = batRisk.creditsByUC[uc.id] || emptyBatCredits;
      const riskResult = simulateUCBank({
        uc,
        distributor,
        generation,
        rateio: project.rateio,
        includeCS3Credits: true,
        batCreditsPerMonth: ucBatCredits,
        icmsExempt: false,
        pisCofinsExempt,
        competitorDiscount: project.scenarios.competitorDiscount,
        isSEM: false,
        contractMonths,
        tariffEscalationDistributor: tariffEsc,
      });
      icmsRisk += riskResult.totalIcmsAdditional;
    }
  }

  const summary: SimulationSummary = {
    totalGeneration,
    totalPPACost,
    baselineSEM,
    economiaLiquida,
    economiaPct: baselineSEM > 0 ? economiaLiquida / baselineSEM : 0,
    economiaPerMonth: economiaLiquida / contractMonths,
    bancoResidualKWh,
    bancoResidualValue,
    bancoNetHelexia: valorBancoAtPPA,
    valorTotal,
    icmsRisk,
  };

  // Collect per-UC monthly details for bank dynamics view
  const ucDetailsCOM: Record<string, UCMonthlyDetail[]> = {};
  const ucDetailsSEM: Record<string, UCMonthlyDetail[]> = {};
  for (const uc of extendedProject.ucs) {
    if (uc.id === 'bat') continue;
    if (comResults[uc.id]) ucDetailsCOM[uc.id] = comResults[uc.id].monthlyDetails;
    if (semResults[uc.id]) ucDetailsSEM[uc.id] = semResults[uc.id].monthlyDetails;
  }

  // --- Optional value attribution (5-scenario decomposition) ---
  const attribution: AttributionResult | undefined = project.scenarios.runAttribution
    ? computeAttribution({
        project: extendedProject,
        distributor,
        generation,
        emptyBatCredits,
        contractMonths,
        ppaRate,
        ppaEscalation,
      })
    : undefined;

  return {
    projectId: project.id,
    months,
    summary,
    bankPerUC,
    ucDetailsCOM,
    ucDetailsSEM,
    ...(attribution ? { attribution } : {}),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Value attribution: 5-scenario decomposition.
//
// Runs simulations with progressively-enabled asset sources so each layer's
// marginal value can be isolated. Sequential subtraction yields the per-source
// contribution to total customer benefit.
//
//   Scenario 1 (Bare):         no opening bank, no own gen, no BAT distrib, no CS3
//   Scenario 2 (+ Bank):       opening bank ON
//   Scenario 3 (+ OwnGen):     each UC's own plant ON (NHS/AMD/BAT plants)
//   Scenario 4 (+ BATdistrib): BAT surplus → NHS/AMD ON  (= existing SEM scenario)
//   Scenario 5 (+ CS3):        Helexia HCS03 ON          (= existing COM scenario)
//
//   initialBankEffect  = cost(Bare)        − cost(+Bank)
//   ownPlantsEffect    = cost(+Bank)       − cost(+OwnGen)
//   batDistribEffect   = cost(+OwnGen)     − cost(+BATdistrib)
//   helexiaCS3Effect   = cost(+BATdistrib) − cost(+CS3)         ← Helexia's true value
//   total              = cost(Bare)        − cost(+CS3)
// ──────────────────────────────────────────────────────────────────────────

interface AttributionRunContext {
  project: Project;
  distributor: Distributor;
  generation: number[];
  emptyBatCredits: number[];
  contractMonths: number;
  ppaRate: number;
  ppaEscalation: number;
}

function runAttributionScenario(
  name: AttributionScenarioName,
  label: string,
  flags: AttributionFlags,
  ctx: AttributionRunContext,
): AttributionScenario {
  const { project, distributor, generation, emptyBatCredits,
    contractMonths, ppaRate, ppaEscalation } = ctx;

  // Run BAT simulation with this scenario's flags so the credits flowing to
  // NHS/AMD are correctly toggled, AND so BAT's own grid bills are scenario-
  // appropriate (no plant in Bare → BAT pays full retail; etc.).
  const batSim = computeBATCredits({
    project,
    contractMonths,
    icmsExempt: project.scenarios.icmsExempt,
    pisCofinsExempt: project.distributor.taxes.pisCofinsExempt ?? true,
    tariffEscalationDistributor: project.tariffEscalationDistributor ?? 0,
    includeOpeningBank: flags.includeOpeningBank,
    includeOwnGen: flags.includeOwnGen,
    includeBATDistrib: flags.includeBATDistrib,
  });

  const ucResults: Record<string, BankSimResult> = {};
  for (const uc of project.ucs) {
    if (uc.id === 'bat') continue;
    const ucBatCredits = batSim.creditsByUC[uc.id] || emptyBatCredits;
    ucResults[uc.id] = simulateUCBank({
      uc,
      distributor,
      generation,
      rateio: project.rateio,
      includeCS3Credits: flags.includeCS3,
      batCreditsPerMonth: ucBatCredits,
      icmsExempt: project.scenarios.icmsExempt,
      pisCofinsExempt: project.distributor.taxes.pisCofinsExempt ?? true,
      competitorDiscount: project.scenarios.competitorDiscount,
      aclBaseline: project.marketType === 'ACL'
        ? (uc.aclBaselineOverride ?? project.aclBaseline ?? null)
        : null,
      isSEM: !flags.includeCS3,
      contractMonths,
      tariffEscalationDistributor: project.tariffEscalationDistributor ?? 0,
      includeOpeningBank: flags.includeOpeningBank,
      includeOwnGen: flags.includeOwnGen,
      includeBATDistrib: flags.includeBATDistrib,
    });
  }

  const monthlyCost: number[] = [];
  let totalRedeCost = 0;
  let totalPPACost = 0;
  let totalIcmsAdditional = 0;

  for (let m = 0; m < contractMonths; m++) {
    let redeM = 0;
    let icmsM = 0;
    for (const uc of project.ucs) {
      if (uc.id === 'bat') continue;
      const r = ucResults[uc.id];
      if (r && r.monthlyDetails[m]) {
        redeM += r.monthlyDetails[m].costRede;
        icmsM += r.monthlyDetails[m].icmsAdditional;
      }
    }
    // BAT-the-UC contribution
    if (batSim.monthlyBills[m]) {
      redeM += batSim.monthlyBills[m].costRede;
      icmsM += batSim.monthlyBills[m].icmsAdditional;
    }
    const ppaM = flags.includeCS3
      ? generation[m] * ppaRate * Math.pow(1 + ppaEscalation, Math.floor(m / 12))
      : 0;
    monthlyCost.push(redeM + ppaM + icmsM);
    totalRedeCost += redeM;
    totalPPACost += ppaM;
    totalIcmsAdditional += icmsM;
  }

  return {
    name,
    label,
    flags,
    totalRedeCost,
    totalPPACost,
    totalIcmsAdditional,
    totalCost: totalRedeCost + totalPPACost + totalIcmsAdditional,
    monthlyCost,
  };
}

function computeAttribution(ctx: AttributionRunContext): AttributionResult {
  const scenarioDefs: Array<{ name: AttributionScenarioName; label: string; flags: AttributionFlags }> = [
    { name: 'bare',          label: 'Sem ativos (linha de base)', flags: { includeOpeningBank: false, includeOwnGen: false, includeBATDistrib: false, includeCS3: false } },
    { name: 'withBank',      label: '+ Banco inicial',            flags: { includeOpeningBank: true,  includeOwnGen: false, includeBATDistrib: false, includeCS3: false } },
    { name: 'withOwnGen',    label: '+ Geração própria',          flags: { includeOpeningBank: true,  includeOwnGen: true,  includeBATDistrib: false, includeCS3: false } },
    { name: 'withBATdistrib',label: '+ Distribuição BAT (= SEM)',  flags: { includeOpeningBank: true,  includeOwnGen: true,  includeBATDistrib: true,  includeCS3: false } },
    { name: 'withCS3',       label: '+ HCS03 Helexia (= COM)',     flags: { includeOpeningBank: true,  includeOwnGen: true,  includeBATDistrib: true,  includeCS3: true  } },
  ];

  const scenarios = scenarioDefs.map(def => runAttributionScenario(def.name, def.label, def.flags, ctx));

  const [bare, withBank, withOwnGen, withBATdistrib, withCS3] = scenarios;

  const decomposition = {
    bareBaseline:        bare.totalCost,
    initialBankEffect:   bare.totalCost           - withBank.totalCost,
    ownPlantsEffect:     withBank.totalCost       - withOwnGen.totalCost,
    batDistribEffect:    withOwnGen.totalCost     - withBATdistrib.totalCost,
    helexiaCS3Effect:    withBATdistrib.totalCost - withCS3.totalCost,
    totalCustomerBenefit: bare.totalCost          - withCS3.totalCost,
  };

  const monthly: AttributionMonthly[] = [];
  for (let m = 0; m < ctx.contractMonths; m++) {
    monthly.push({
      monthIndex: m,
      label: formatMonthLabel(ctx.project.plant.contractStartMonth, m),
      bareBaseline:      bare.monthlyCost[m],
      initialBankEffect: bare.monthlyCost[m]           - withBank.monthlyCost[m],
      ownPlantsEffect:   withBank.monthlyCost[m]       - withOwnGen.monthlyCost[m],
      batDistribEffect:  withOwnGen.monthlyCost[m]     - withBATdistrib.monthlyCost[m],
      helexiaCS3Effect:  withBATdistrib.monthlyCost[m] - withCS3.monthlyCost[m],
    });
  }

  return { scenarios, decomposition, monthly };
}
