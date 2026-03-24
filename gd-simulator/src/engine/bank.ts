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
 * Simulate credit bank for a single UC over 24 months.
 *
 * ANEEL SCEE (REN 1.000/2021) credit application for Grupo A:
 *
 * The credit bank tracks kWh. 1 kWh credit offsets 1 kWh of
 * consumption regardless of time-of-use post (FP or PT).
 * FA (TE_FP/TE_PT) affects the R$ value of the offset, not the
 * kWh exchange rate. All kWh offsets are 1:1.
 *
 * STEP 1 — Pool all credits (ownGen + CS3 + BAT), offset FP (1:1).
 * STEP 2 — Surplus credits offset PT consumption (1:1).
 * STEP 3 — Remaining surplus → credit bank (kWh).
 * STEP 4 — FP shortfall covered by bank draws (1:1).
 * STEP 5 — PT shortfall covered by bank draws (1:1).
 * STEP 6 — bank_end = max(0, bank_start − draws) + credits_to_bank.
 *          Cost = residual FP × T_AFP + residual PT × T_APT.
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

      // ── STEP 1 — Pool generation credits, offset FP first (1:1 kWh) ──
      // Under REN 1.000/2021 the credit bank tracks kWh;
      // 1 kWh credit offsets 1 kWh of consumption regardless of
      // time-of-use post. FA only affects the R$ value, not the
      // kWh exchange rate. All kWh offsets are 1:1.
      // BAT stranded-bank credits are T+1 transfers deposited to
      // the credit bank, not part of the consumption-offset pool.
      const totalCredits = ownGen + cs3Credits;
      const fpApplied = Math.min(totalCredits, consFP);
      const creditsRemaining = totalCredits - fpApplied;
      creditsFPApplied = fpApplied;

      // ── STEP 2 — Surplus credits offset PT (1:1 kWh) ──
      const ptApplied = Math.min(creditsRemaining, consPT);
      creditsPTApplied = ptApplied;

      // ── STEP 3 — Remaining credits → bank (kWh) ──
      const creditsToBank = creditsRemaining - ptApplied;

      // ── STEP 4 — FP shortfall covered by bank (1:1) ──
      const fpShortfall = Math.max(0, consFP - fpApplied);
      const bankDrawFP = Math.min(bankStart, fpShortfall);

      // ── STEP 5 — PT shortfall covered by bank (1:1) ──
      const ptShortfall = Math.max(0, consPT - ptApplied);
      const bankDrawPT = Math.min(bankStart - bankDrawFP, ptShortfall);

      // ── STEP 6 — Bank end and cost ──
      // BAT credits deposited to bank (T+1 stranded bank transfer).
      const totalBankDraw = bankDrawFP + bankDrawPT;
      bankDraw = totalBankDraw;
      bank = Math.max(0, bankStart - totalBankDraw) + creditsToBank + batCredits;

      // Billing rule: if bank_end > 0, all consumption was offset
      // (the distributor sees net credits >= consumption).
      if (bank > 0) {
        costRede = 0;
      } else {
        costRede = Math.max(0, fpShortfall - bankDrawFP) * T_AFP
                 + Math.max(0, ptShortfall - bankDrawPT) * T_APT;
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
