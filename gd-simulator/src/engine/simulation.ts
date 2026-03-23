import type {
  Project, SimulationResult, MonthlyResult, SimulationSummary, UCMonthlyDetail
} from './types';
import { computeDerivedTariffs } from './tariff';
import { simulateUCBank, computeBATCredits, type BankSimResult } from './bank';

/**
 * Get generation profile based on scenario toggle.
 */
function getGeneration(project: Project): number[] {
  if (project.scenarios.useActualGeneration && project.plant.actualProfile) {
    return project.plant.actualProfile;
  }
  return project.plant.p50Profile;
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
export function runSimulation(project: Project): SimulationResult {
  // Ensure derived tariffs are computed
  const distributor = computeDerivedTariffs(project.distributor);

  // Validate tariffs
  if (!distributor.T_B3 || distributor.T_B3 <= 0 || isNaN(distributor.T_B3)) {
    throw new Error(`Tarifa B3 invalida para ${distributor.name}. Verifique os dados da distribuidora.`);
  }
  if (project.ucs.some(uc => uc.isGrupoA) && (!distributor.T_AFP || distributor.T_AFP <= 0)) {
    throw new Error(`Tarifa A FP invalida para ${distributor.name}. Necessaria para UCs Grupo A.`);
  }
  if (project.ucs.length === 0) {
    throw new Error('Nenhuma UC cadastrada. Adicione pelo menos uma UC ao projeto.');
  }

  const generation = getGeneration(project);
  const ppaRate = project.plant.ppaRateRsBRLkWh;

  // Compute BAT credits distribution (same for SEM and COM)
  const batCredits = computeBATCredits(project);

  // Empty BAT credits for UCs that don't receive them
  const emptyBatCredits: number[] = new Array(24).fill(0);

  // --- SEM scenario (no CS3 credits) ---
  const semResults: Record<string, BankSimResult> = {};
  for (const uc of project.ucs) {
    if (uc.id === 'bat') continue; // skip BAT itself in SEM computation
    const ucBatCredits = batCredits[uc.id] || emptyBatCredits;
    semResults[uc.id] = simulateUCBank({
      uc,
      distributor,
      generation,
      rateio: project.rateio,
      includeCS3Credits: false,  // SEM = no CS3
      batCreditsPerMonth: ucBatCredits,
      icmsExempt: true, // SEM doesn't have ICMS additional (no CS3 credits to tax)
      competitorDiscount: project.scenarios.competitorDiscount,
      isSEM: true,
    });

  }

  // --- COM scenario (with CS3 credits) ---
  const comResults: Record<string, BankSimResult> = {};
  for (const uc of project.ucs) {
    if (uc.id === 'bat') continue; // skip BAT itself in COM computation
    const ucBatCredits = batCredits[uc.id] || emptyBatCredits;
    comResults[uc.id] = simulateUCBank({
      uc,
      distributor,
      generation,
      rateio: project.rateio,
      includeCS3Credits: true,   // COM = with CS3
      batCreditsPerMonth: ucBatCredits,
      icmsExempt: project.scenarios.icmsExempt,
      competitorDiscount: project.scenarios.competitorDiscount,
      isSEM: false,
    });
  }

  // --- Aggregate monthly results ---
  const months: MonthlyResult[] = [];
  let economiaAcum = 0;

  for (let m = 0; m < 24; m++) {
    const gen = generation[m];
    const ppaCost = gen * ppaRate;

    let semTotalCost = 0;
    let comRedeCost = 0;
    let comIcmsAdditional = 0;

    for (const uc of project.ucs) {
      // Skip BAT UC (no consumption)
      if (uc.id === 'bat') {
        continue;
      }

      const semUC = semResults[uc.id];
      const comUC = comResults[uc.id];
      if (semUC && semUC.monthlyDetails[m]) {
        semTotalCost += semUC.monthlyDetails[m].costRede;
      }
      if (comUC && comUC.monthlyDetails[m]) {
        comRedeCost += comUC.monthlyDetails[m].costRede;
        comIcmsAdditional += comUC.monthlyDetails[m].icmsAdditional;
      }
    }

    const comTotalCost = comRedeCost + ppaCost;
    const economia = semTotalCost - comTotalCost - comIcmsAdditional;
    economiaAcum += economia;

    months.push({
      monthIndex: m,
      label: formatMonthLabel(project.plant.contractStartMonth, m),
      generation: gen,
      ppaCost,
      sem: { totalCost: semTotalCost },
      com: { redeCost: comRedeCost, totalCost: comTotalCost, icmsAdditional: comIcmsAdditional },
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
    // Calculate what ICMS would be if not exempt
    for (const uc of project.ucs) {
      if (uc.id === 'bat') continue;
      const ucBatCredits = batCredits[uc.id] || emptyBatCredits;
      const riskResult = simulateUCBank({
        uc,
        distributor,
        generation,
        rateio: project.rateio,
        includeCS3Credits: true,
        batCreditsPerMonth: ucBatCredits,
        icmsExempt: false,
        competitorDiscount: project.scenarios.competitorDiscount,
        isSEM: false,
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
    economiaPerMonth: economiaLiquida / 24,
    bancoResidualKWh,
    bancoResidualValue,
    bancoNetHelexia: valorBancoAtPPA,
    valorTotal,
    icmsRisk,
  };

  // Collect per-UC monthly details for bank dynamics view
  const ucDetailsCOM: Record<string, UCMonthlyDetail[]> = {};
  const ucDetailsSEM: Record<string, UCMonthlyDetail[]> = {};
  for (const uc of project.ucs) {
    if (uc.id === 'bat') continue;
    if (comResults[uc.id]) ucDetailsCOM[uc.id] = comResults[uc.id].monthlyDetails;
    if (semResults[uc.id]) ucDetailsSEM[uc.id] = semResults[uc.id].monthlyDetails;
  }

  return {
    projectId: project.id,
    months,
    summary,
    bankPerUC,
    ucDetailsCOM,
    ucDetailsSEM,
  };
}
