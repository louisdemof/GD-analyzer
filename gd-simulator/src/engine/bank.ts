import type { ConsumptionUnit, Distributor, Project, RateioAllocation, UCMonthlyDetail } from './types';
import { computeICMSPerKWh } from './tariff';

interface BankSimParams {
  uc: ConsumptionUnit;
  distributor: Distributor;
  generation: number[];       // contractMonths of plant generation (kWh)
  rateio: RateioAllocation;
  includeCS3Credits: boolean; // false for SEM, true for COM
  batCreditsPerMonth: number[]; // BAT bank credits flowing to this UC per month (T+1 applied)
  icmsExempt: boolean;
  competitorDiscount: number; // only affects Grupo B SEM scenario
  isSEM: boolean;
  contractMonths: number;     // typically 24, but can be 12-60
}

export interface BankSimResult {
  monthlyDetails: UCMonthlyDetail[];
  finalBank: number;
  totalCostRede: number;
  totalIcmsAdditional: number;
}

function getRateioFraction(
  rateio: RateioAllocation,
  ucId: string,
  monthIndex: number
): number {
  for (const period of rateio.periods) {
    if (monthIndex >= period.start && monthIndex <= period.end) {
      const alloc = period.allocations.find(a => a.ucId === ucId);
      return alloc ? alloc.fraction : 0;
    }
  }
  return 0;
}

/**
 * Simulate credit bank for a single UC over contractMonths.
 *
 * Matches Excel V10 Simulacao formulas exactly:
 *
 * Grupo A (rows 25-37 NHS, 43-55 AMD):
 *   Row 25: autoCompFP = MIN(ownGen, consFP)
 *   Row 26: autoCompPT = MIN(ownGenSurplus * FA, consPT)
 *   Row 30: bankDraw = MIN(bankStart, fpShortfall + ptShortfall/FA)
 *   Row 31: bankEnd = MAX(bankStart-draw,0) + bat + cs3Surplus + ownGenSurplus
 *   Row 36: cost = IF(bankEnd>0, 0, fpUncovered*T_AFP + ptUncovered*T_APT)
 *
 * FA converts FP-equivalent surplus to PT offset: 1 FP kWh = FA PT kWh.
 * Bank stores FP-equivalent kWh; drawing for PT costs ptShortfall/FA.
 *
 * Grupo B (rows 57-68 etc): single tariff, no PT, no own generation.
 */
export function simulateUCBank(params: BankSimParams): BankSimResult {
  const {
    uc, distributor, generation, rateio,
    includeCS3Credits, batCreditsPerMonth,
    icmsExempt, competitorDiscount, isSEM,
    contractMonths
  } = params;

  const FA = distributor.FA ?? 0;
  const T_B3 = distributor.T_B3 ?? 0;
  const T_AFP = distributor.T_AFP ?? 0;
  const T_APT = distributor.T_APT ?? 0;

  const monthlyDetails: UCMonthlyDetail[] = [];
  let bank = uc.openingBank;
  let totalCostRede = 0;
  let totalIcmsAdditional = 0;

  for (let m = 0; m < contractMonths; m++) {
    const bankStart = bank;

    // Credit sources — all FP-equivalent kWh
    const cs3Credits = includeCS3Credits
      ? generation[m] * getRateioFraction(rateio, uc.id, m)
      : 0;
    const batCredits = batCreditsPerMonth[m] || 0;
    const ownGen = (uc.ownGeneration && uc.ownGeneration[m]) ? uc.ownGeneration[m] : 0;

    // Total for reporting
    const totalNewCredits = cs3Credits + batCredits + ownGen;

    let creditsFPApplied = 0;
    let creditsPTApplied = 0;
    let bankDraw = 0;
    let costRede = 0;
    let icmsAdditional = 0;

    if (uc.isGrupoA) {
      const consFP = uc.consumptionFP[m] || 0;
      const consPT = uc.consumptionPT[m] || 0;

      // ═══ Excel V10 Simulacao formulas — Grupo A (NHS/AMD) ═══
      // Ref: rows 25-37 (NHS) and 43-55 (AMD) in Simulacao sheet

      // Row 25: Auto-compensação FP = MIN(ownGen, consFP)
      const autoCompFP = Math.min(ownGen, consFP);
      creditsFPApplied = autoCompFP;

      // Row 26: Auto-compensação PT = MIN((ownGen - autoCompFP) * FA, consPT)
      // Surplus own gen after FP, converted to PT via FA
      const ownGenSurplusFP = Math.max(0, ownGen - autoCompFP);
      const autoCompPT = Math.min(ownGenSurplusFP * FA, consPT);
      creditsPTApplied = autoCompPT;

      // Row 30: Bank draw COM
      // = MIN(bankStart,
      //     MAX(consFP - ownGen - cs3 - bat, 0)
      //   + MAX(consPT - autoCompPT, 0) / FA )
      const fpShortfallAfterCredits = Math.max(0, consFP - ownGen - cs3Credits - batCredits);
      const ptShortfallAfterOwnGen = Math.max(0, consPT - autoCompPT);
      const ptShortfallAsFPequiv = FA > 0 ? ptShortfallAfterOwnGen / FA : 0;
      bankDraw = Math.min(bankStart, fpShortfallAfterCredits + ptShortfallAsFPequiv);

      // Row 31: Bank end COM
      // = MAX(bankStart - bankDraw, 0)
      //   + batCredits
      //   + MAX(cs3 - MAX(consFP - ownGen, 0), 0)
      //   + MAX(ownGen - consFP, 0)
      const fpDeficit = Math.max(0, consFP - ownGen);
      const cs3Surplus = Math.max(0, cs3Credits - fpDeficit);
      const ownGenSurplus = Math.max(0, ownGen - consFP);
      bank = Math.max(0, bankStart - bankDraw) + batCredits + cs3Surplus + ownGenSurplus;

      // Row 36: Custo COM
      // = IF(bankEnd > 0, 0,
      //     MAX(consFP - ownGen - cs3 - bat - bankStart, 0) * T_AFP
      //   + MAX(consPT - FA * MAX(ownGen + cs3 + bat + bankStart - consFP, 0), 0) * T_APT )
      if (bank > 0) {
        costRede = 0;
      } else {
        const fpUncovered = Math.max(0, consFP - ownGen - cs3Credits - batCredits - bankStart);
        const totalSurplusFP = Math.max(0, ownGen + cs3Credits + batCredits + bankStart - consFP);
        const ptCoveredBySurplus = totalSurplusFP * FA;
        const ptUncovered = Math.max(0, consPT - ptCoveredBySurplus);
        costRede = fpUncovered * T_AFP + ptUncovered * T_APT;
      }

      // ICMS additional on compensated credits
      if (!icmsExempt) {
        const icmsFP = computeICMSPerKWh(T_AFP, distributor.taxes.ICMS);
        const icmsPT = computeICMSPerKWh(T_APT, distributor.taxes.ICMS);
        icmsAdditional = creditsFPApplied * icmsFP + creditsPTApplied * icmsPT;
      }

    } else {
      // ── Grupo B: single-tariff logic ──
      const consTotal = uc.consumptionFP[m] || 0;

      // Credits that offset consumption: own gen + CS3
      // BAT credits go to bank
      const consumptionCredits = ownGen + cs3Credits;
      const bankDeposit = batCredits;

      const totalAvail = consumptionCredits + bankStart + bankDeposit;
      const creditsApplied = Math.min(totalAvail, consTotal);
      creditsFPApplied = Math.min(consumptionCredits, consTotal);

      const residual = consTotal - creditsApplied;

      // Plin discount only in SEM
      const effectiveTariff = (isSEM && competitorDiscount > 0)
        ? T_B3 * (1 - competitorDiscount)
        : T_B3;

      costRede = Math.max(0, residual) * effectiveTariff;

      // ICMS additional
      if (!icmsExempt && creditsApplied > 0) {
        const icmsB = computeICMSPerKWh(T_B3, distributor.taxes.ICMS);
        icmsAdditional = creditsApplied * icmsB;
      }

      bank = Math.max(0, totalAvail - consTotal);
    }

    totalCostRede += costRede;
    totalIcmsAdditional += icmsAdditional;

    monthlyDetails.push({
      ucId: uc.id,
      monthIndex: m,
      creditsReceived: totalNewCredits,
      creditsFPApplied,
      creditsPTApplied,
      bankStart,
      bankDraw,
      bankEnd: bank,
      costRede,
      ownGenerationUsed: ownGen,
      icmsAdditional,
    });
  }

  return {
    monthlyDetails,
    finalBank: bank,
    totalCostRede,
    totalIcmsAdditional,
  };
}

/**
 * Compute BAT credit distribution per month per target UC.
 * BAT has own generation and consumption — only surplus flows out.
 */
export function computeBATCredits(
  project: Project
): Record<string, number[]> {
  const result: Record<string, number[]> = {};

  if (!project.batBank) return result;

  const bat = project.batBank;
  const batUC = project.ucs.find(uc => uc.id === 'bat');

  const cm = project.plant.contractMonths || 24;
  const nhsCredits: number[] = new Array(cm).fill(0);
  const amdCredits: number[] = new Array(cm).fill(0);

  if (!batUC) {
    let remaining = bat.openingKWh;
    const draw = bat.openingKWh / cm;
    for (let m = 0; m < cm; m++) {
      const d = Math.min(draw, remaining);
      remaining -= d;
      if (m + 1 < cm) {
        nhsCredits[m + 1] += d * bat.toNHSPct;
        amdCredits[m + 1] += d * bat.toAMDPct;
      }
    }
    result[bat.nhsUCId] = nhsCredits;
    result[bat.amdUCId] = amdCredits;
    return result;
  }

  const FA = project.distributor.FA ?? 0.6;
  let batBank = bat.openingKWh;

  for (let m = 0; m < cm; m++) {
    const gen = (batUC.ownGeneration && batUC.ownGeneration[m]) ? batUC.ownGeneration[m] : 0;
    const consFP = batUC.consumptionFP[m] || 0;
    const consPT = batUC.consumptionPT[m] || 0;

    // Apply generation to BAT's own consumption
    // BAT surplus calculation uses FA for energy accounting
    // (determines how much surplus flows to NHS/AMD via T+1 transfer)
    const genAppliedFP = Math.min(gen, consFP);
    let remainingGen = gen - genAppliedFP;

    const genForPT = remainingGen * FA;
    const genAppliedPT = Math.min(genForPT, consPT);
    const genUsedAsFP = FA > 0 ? genAppliedPT / FA : 0;
    remainingGen = remainingGen - genUsedAsFP;

    const surplus = Math.max(0, remainingGen);

    // Residual consumption draws from BAT stranded bank
    let residualFP = consFP - genAppliedFP;
    let residualPT = consPT - genAppliedPT;
    let bankDraw = 0;

    if (residualFP > 0 && batBank > 0) {
      const drawFP = Math.min(batBank, residualFP);
      bankDraw += drawFP;
      residualFP -= drawFP;
    }
    if (residualPT > 0 && (batBank - bankDraw) > 0) {
      const avail = batBank - bankDraw;
      const drawPT = Math.min(avail, residualPT / FA);
      bankDraw += drawPT;
    }

    batBank = Math.max(0, batBank - bankDraw);

    // Surplus flows to target UCs with T+1 lag
    if (surplus > 0 && m + 1 < cm) {
      nhsCredits[m + 1] += surplus * bat.toNHSPct;
      amdCredits[m + 1] += surplus * bat.toAMDPct;
    }
  }

  result[bat.nhsUCId] = nhsCredits;
  result[bat.amdUCId] = amdCredits;
  return result;
}
