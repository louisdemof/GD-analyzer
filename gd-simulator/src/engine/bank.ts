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
  // Reservado tariffs — fall back to the regular posto tariff when distributor has no
  // irrigante/aquicultor enrollment (then RSV consumption is billed as ordinary FP/B).
  const T_ARSV = distributor.T_ARSV ?? T_AFP;
  const T_BRSV = distributor.T_BRSV ?? T_B3;
  // Demanda FP (R$/kW/mês) — applies every month of the contract to Grupo A UCs
  // with a demanda contratada. Charged equally in SEM and COM (GD doesn't compensate
  // demanda), so cancels in economia but surfaces in the absolute SEM/COM totals.
  const T_A_DEMANDA = distributor.T_A_DEMANDA ?? 0;
  const demandaFaturadaKW = uc.isGrupoA ? (uc.demandaFaturadaFP ?? 0) : 0;
  const demandaMensal = demandaFaturadaKW * T_A_DEMANDA;

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
    let creditsRSVApplied = 0;
    let bankDraw = 0;
    let costRede = 0;
    let icmsAdditional = 0;

    if (uc.isGrupoA) {
      const consFP = uc.consumptionFP[m] || 0;
      const consPT = uc.consumptionPT[m] || 0;
      const consRSV = uc.consumptionReservado?.[m] ?? 0;
      const hasRSV = consRSV > 0;

      // ═══ Excel V10 Simulacao formulas — Grupo A (NHS/AMD) ═══
      // Ref: rows 25-37 (NHS) and 43-55 (AMD) in Simulacao sheet
      //
      // Extended for horário reservado (REN 1000 Art. 186): RSV pertence ao posto
      // Fora Ponta — FP credits compensate RSV 1:1, same as regular FP. Only the
      // *billing* tariff differs. When consRSV=0, every formula below reduces
      // exactly to the original 2-posto Copasul path.

      // Row 25: Auto-compensação FP-regular = MIN(ownGen, consFP)
      const autoCompFP = Math.min(ownGen, consFP);
      creditsFPApplied = autoCompFP;

      // Auto-compensação RSV (same posto as FP, no FA, 1:1)
      const ownGenAfterFPreg = Math.max(0, ownGen - autoCompFP);
      const autoCompRSV = Math.min(ownGenAfterFPreg, consRSV);
      creditsRSVApplied = autoCompRSV;

      // Row 26: Auto-compensação PT — surplus crosses posto via FA
      const ownGenSurplusAfterFPposto = Math.max(0, ownGenAfterFPreg - autoCompRSV);
      const autoCompPT = Math.min(ownGenSurplusAfterFPposto * FA, consPT);
      creditsPTApplied = autoCompPT;

      // Row 30: Bank draw — FP-posto pool = consFP + consRSV (same posto 1:1)
      const fpPostoShortfallAfterCredits = Math.max(0, (consFP + consRSV) - ownGen - cs3Credits - batCredits);
      const ptShortfallAfterOwnGen = Math.max(0, consPT - autoCompPT);
      const ptShortfallAsFPequiv = FA > 0 ? ptShortfallAfterOwnGen / FA : 0;
      bankDraw = Math.min(bankStart, fpPostoShortfallAfterCredits + ptShortfallAsFPequiv);

      // Row 31: Bank end
      const fpPostoDeficit = Math.max(0, (consFP + consRSV) - ownGen);
      const cs3Surplus = Math.max(0, cs3Credits - fpPostoDeficit);
      const ownGenSurplus = Math.max(0, ownGen - (consFP + consRSV));
      bank = Math.max(0, bankStart - bankDraw) + batCredits + cs3Surplus + ownGenSurplus;

      // Row 36: Custo — allocate credits FP-regular first, then RSV (same posto,
      // maximizes customer savings within the FP-posto bucket), then surplus to PT via FA.
      if (bank > 0) {
        costRede = 0;
      } else {
        const totalPool = ownGen + cs3Credits + batCredits + bankStart;
        const fpUncovered = Math.max(0, consFP - totalPool);
        const remAfterFP = Math.max(0, totalPool - consFP);
        const rsvUncovered = Math.max(0, consRSV - remAfterFP);
        const remAfterRSV = Math.max(0, remAfterFP - consRSV);
        const ptCoveredBySurplus = remAfterRSV * FA;
        const ptUncovered = Math.max(0, consPT - ptCoveredBySurplus);
        costRede = fpUncovered * T_AFP + rsvUncovered * T_ARSV + ptUncovered * T_APT;
      }

      // ICMS additional on compensated credits
      if (!icmsExempt) {
        const icmsFP = computeICMSPerKWh(T_AFP, distributor.taxes.ICMS);
        const icmsPT = computeICMSPerKWh(T_APT, distributor.taxes.ICMS);
        icmsAdditional = creditsFPApplied * icmsFP + creditsPTApplied * icmsPT;
        if (hasRSV) {
          const icmsRSV = computeICMSPerKWh(T_ARSV, distributor.taxes.ICMS);
          icmsAdditional += creditsRSVApplied * icmsRSV;
        }
      }

    } else {
      // ── Grupo B: single-posto logic, optional reservado split for SEM billing ──
      const consFPregular = uc.consumptionFP[m] || 0;
      const consRSV = uc.consumptionReservado?.[m] ?? 0;
      const hasRSV = consRSV > 0;
      const consTotal = consFPregular + consRSV;

      // Credits that offset consumption: own gen + CS3. BAT → bank.
      const consumptionCredits = ownGen + cs3Credits;
      const bankDeposit = batCredits;
      const totalAvail = consumptionCredits + bankStart + bankDeposit;

      // Apply credits FP-regular first (higher tariff → more savings/credit), then RSV.
      const creditsToFP = Math.min(totalAvail, consFPregular);
      const remAfterFP = Math.max(0, totalAvail - consFPregular);
      const creditsToRSV = Math.min(remAfterFP, consRSV);
      const creditsApplied = creditsToFP + creditsToRSV;

      // creditsFPApplied / creditsRSVApplied report only the "new credits" share
      // (own gen + cs3), not bank/bat draws. Matches the Copasul reporting convention.
      creditsFPApplied = Math.min(consumptionCredits, consFPregular);
      creditsRSVApplied = Math.max(0, Math.min(consumptionCredits - consFPregular, consRSV));

      const residualFP = Math.max(0, consFPregular - creditsToFP);
      const residualRSV = Math.max(0, consRSV - creditsToRSV);

      // Plin discount only in SEM, applied on both tariffs proportionally
      const discount = (isSEM && competitorDiscount > 0) ? competitorDiscount : 0;
      const effectiveT_B = T_B3 * (1 - discount);
      const effectiveT_BRSV = T_BRSV * (1 - discount);

      costRede = residualFP * effectiveT_B + residualRSV * effectiveT_BRSV;

      // ICMS additional (preserve existing semantics: on total credits applied)
      if (!icmsExempt && creditsApplied > 0) {
        const icmsB = computeICMSPerKWh(T_B3, distributor.taxes.ICMS);
        if (hasRSV) {
          const icmsBRSV = computeICMSPerKWh(T_BRSV, distributor.taxes.ICMS);
          icmsAdditional = creditsToFP * icmsB + creditsToRSV * icmsBRSV;
        } else {
          icmsAdditional = creditsApplied * icmsB;
        }
      }

      bank = Math.max(0, totalAvail - consTotal);
    }

    // Demanda contratada — charged every month regardless of SEM/COM (not compensated by SCEE).
    costRede += demandaMensal;

    totalCostRede += costRede;
    totalIcmsAdditional += icmsAdditional;

    const hasRSVReport = (uc.consumptionReservado?.[m] ?? 0) > 0;
    monthlyDetails.push({
      ucId: uc.id,
      monthIndex: m,
      creditsReceived: totalNewCredits,
      creditsFPApplied,
      creditsPTApplied,
      ...(hasRSVReport ? { creditsRSVApplied } : {}),
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
