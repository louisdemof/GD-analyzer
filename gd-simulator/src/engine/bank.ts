import type { ACLBaseline, ConsumptionUnit, Distributor, Project, RateioAllocation, UCMonthlyDetail } from './types';
import { computeAllInTariff, computeICMSPerKWh, computePisCofinsPerKWh, incentivadaDiscounts } from './tariff';

interface BankSimParams {
  uc: ConsumptionUnit;
  distributor: Distributor;
  generation: number[];       // contractMonths of plant generation (kWh)
  rateio: RateioAllocation;
  includeCS3Credits: boolean; // false for SEM, true for COM
  batCreditsPerMonth: number[]; // BAT bank credits flowing to this UC per month (T+1 applied)
  icmsExempt: boolean;
  pisCofinsExempt: boolean;
  competitorDiscount: number; // only affects Grupo B SEM scenario
  isSEM: boolean;
  // ACL baseline (Cliente Livre) for this UC — already resolved (UC override ?? project).
  // When present, it changes ONLY the SEM scenario: energy is priced at the ACL R$/MWh and
  // TUSD (Fio B) carries the incentivada discount; demand gets the demand discount. COM is
  // unchanged (GD no mercado cativo). null/undefined ⇒ legacy captive baseline.
  aclBaseline?: ACLBaseline | null;
  contractMonths: number;     // typically 24, but can be 12-60
  // Annual escalation rate applied to all distributor tariffs (FP, PT, RSV, demanda, B).
  // Compounds from year 0 (no scaling for first 12 months).
  tariffEscalationDistributor?: number; // default 0
  // Attribution toggles — default to true to preserve existing simulate behavior.
  // Set to false to isolate the marginal value of an asset source for the
  // value-attribution decomposition (see types.ts AttributionFlags).
  includeOpeningBank?: boolean; // default true — false zeroes uc.openingBank
  includeOwnGen?: boolean;       // default true — false zeroes uc.ownGeneration
  includeBATDistrib?: boolean;   // default true — false zeroes batCreditsPerMonth
}

export interface BankSimResult {
  monthlyDetails: UCMonthlyDetail[];
  finalBank: number;
  totalCostRede: number;
  totalIcmsAdditional: number;
  totalPisCofinsAdditional: number;
}

function getRateioFraction(
  rateio: RateioAllocation,
  ucId: string,
  monthIndex: number
): number {
  const periods = rateio.periods;
  if (periods.length === 0) return 0;
  for (const period of periods) {
    if (monthIndex >= period.start && monthIndex <= period.end) {
      const alloc = period.allocations.find(a => a.ucId === ucId);
      return alloc ? alloc.fraction : 0;
    }
  }
  // Month falls outside every defined period — this happens when the contract
  // (PPA) duration is extended after the rateio was built, leaving the tail
  // months uncovered. Fall back to the nearest period so injected credits are
  // still allocated instead of silently dropping to zero (which understates the
  // economy). Months before the first period use the first; months after the
  // last use the last.
  const sorted = [...periods].sort((a, b) => a.start - b.start);
  const fallback = monthIndex < sorted[0].start ? sorted[0] : sorted[sorted.length - 1];
  const alloc = fallback.allocations.find(a => a.ucId === ucId);
  return alloc ? alloc.fraction : 0;
}

/**
 * Simulate credit bank for a single UC over contractMonths.
 *
 * Matches Excel V10 Simulação formulas exactly:
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
    icmsExempt, pisCofinsExempt, competitorDiscount, isSEM,
    aclBaseline,
    contractMonths,
    tariffEscalationDistributor = 0,
    includeOpeningBank = true,
    includeOwnGen = true,
    includeBATDistrib = true,
  } = params;

  const FA = distributor.FA ?? 0;
  const T_B3_base = distributor.T_B3 ?? 0;
  const T_AFP_base = distributor.T_AFP ?? 0;
  const T_APT_base = distributor.T_APT ?? 0;
  const T_ARSV_base = distributor.T_ARSV ?? T_AFP_base;
  const T_BRSV_base = distributor.T_BRSV ?? T_B3_base;
  const T_A_DEMANDA_base = distributor.T_A_DEMANDA ?? 0;
  const T_AFP_TUSD_base = distributor.T_AFP_TUSD ?? 0;
  const T_APT_TUSD_base = distributor.T_APT_TUSD ?? 0;
  const T_B3_TUSD_base = distributor.T_B3_TUSD ?? 0;
  const icmsScope = distributor.taxes.icmsScope ?? 'TE_TUSD';
  // Effective exemption: NONE scope forces "no isenção" regardless of the scenarios toggle.
  const effectiveIcmsExempt = icmsScope === 'NONE' ? false : icmsExempt;
  const icmsRate = distributor.taxes.ICMS;
  const pisRate = distributor.taxes.PIS;
  const cofinsRate = distributor.taxes.COFINS;
  const demandaFaturadaKW = uc.isGrupoA ? (uc.demandaFaturadaFP ?? 0) : 0;

  // ACL baseline only rewrites the SEM scenario (the client's current free-market bill).
  // COM is always GD no mercado cativo, so leave it on the captive tariffs.
  const aclOn = isSEM && !!aclBaseline;
  // Energia incentivada: when a level is set, derive the TUSD discounts per UC modalidade
  // (Verde/Azul) from the distributor's tariffs (national rule), overriding the manual fields.
  const incLevel = aclBaseline?.incentivadaLevel ?? 0;
  const useIncentivada = aclOn && incLevel > 0 && uc.isGrupoA;
  const incDisc = useIncentivada
    ? incentivadaDiscounts(incLevel, /AZUL/i.test(uc.tariffGroup), T_AFP_TUSD_base, T_APT_TUSD_base)
    : null;
  const aclDiscCons = (m: number) =>
    incDisc ? incDisc.consumoFP
    : aclBaseline?.tusdDiscountSchedule?.consumo?.[m] ?? aclBaseline?.tusdDiscountConsumo ?? 0;
  const aclDiscDem = (m: number) =>
    incDisc ? incDisc.demanda
    : aclBaseline?.tusdDiscountSchedule?.demanda?.[m] ?? aclBaseline?.tusdDiscountDemanda ?? 0;
  // Gross-up da TUSD (alíquotas efetivas da distribuidora). Usado também para extrair a
  // base "sem impostos" da TUSD a partir da tarifa all-in (T_x_TUSD).
  const tusdGrossUp = 1 / ((1 - pisRate - cofinsRate) * (1 - icmsRate));
  // ACL energy all-in (R$/kWh) at year `yearIdx`. A energia do fornecedor usa PIS/COFINS
  // próprio (≈9,25%, não a alíquota da TUSD da distribuidora) + ICMS estadual.
  const aclEnergyAllIn = (yearIdx: number): number => {
    if (!aclBaseline) return 0;
    const esc = Math.pow(1 + (aclBaseline.energyEscalationPct ?? 0), yearIdx);
    const semImp = aclBaseline.energyPriceSemImp * esc;
    const tePisCofins = (aclBaseline.energyPisCofins ?? true) ? (aclBaseline.energyPisCofinsPct ?? 0.0925) : 0;
    return computeAllInTariff(semImp, {
      ICMS: (aclBaseline.energyIcms ?? true) ? distributor.taxes.ICMS : 0,
      PIS: tePisCofins,
      COFINS: 0,
    });
  };
  // Benefício incentivado: desconto incide SÓ sobre a base da TUSD (sem impostos); ICMS+PIS/COFINS
  // continuam sobre a tarifa cheia. Logo o crédito por kWh = desc × base, e a tarifa paga =
  // T_cheia_comimp − desc × (T_comimp / grossUp). Confirmado em 5 faturas (COPEL/ENEL/Equatorial/CEMIG).
  const tusdAposBeneficio = (tusdComImp: number, disc: number): number =>
    tusdComImp - disc * (tusdComImp / tusdGrossUp);

  const monthlyDetails: UCMonthlyDetail[] = [];
  let bank = includeOpeningBank ? uc.openingBank : 0;
  let totalCostRede = 0;
  let totalIcmsAdditional = 0;
  let totalPisCofinsAdditional = 0;

  for (let m = 0; m < contractMonths; m++) {
    const bankStart = bank;

    // Per-year tariff escalation: year 0 = base, year 1 = base × (1+r), etc.
    const yearIdx = Math.floor(m / 12);
    const escFactor = Math.pow(1 + tariffEscalationDistributor, yearIdx);
    const T_AFP = T_AFP_base * escFactor;
    const T_APT = T_APT_base * escFactor;
    const T_ARSV = T_ARSV_base * escFactor;
    const T_B3 = T_B3_base * escFactor;
    const T_BRSV = T_BRSV_base * escFactor;
    const T_A_DEMANDA = T_A_DEMANDA_base * escFactor;
    const T_AFP_TUSD = T_AFP_TUSD_base * escFactor;
    const T_APT_TUSD = T_APT_TUSD_base * escFactor;
    const T_B3_TUSD = T_B3_TUSD_base * escFactor;

    // ── ACL baseline (SEM only): energy = TUSD(Fio B, −disc) + energia comprada na ACL.
    // Captive tariffs (T_AFP etc.) are kept for COM and for the tax-leak formulas; only the
    // SEM *billing* tariffs below switch to the ACL build-up. RSV approximated by FP-equiv ratio.
    const dCons = aclOn ? aclDiscCons(m) : 0;
    // Ponta pode ter desconto de TUSD diferente do fora-ponta (incentivada Verde / COPEL).
    const dConsPT = aclOn ? (incDisc ? incDisc.consumoPT : (aclBaseline?.tusdDiscountConsumoPT ?? dCons)) : 0;
    const teAcl = aclOn ? aclEnergyAllIn(yearIdx) : 0;
    // TUSD com benefício (desconto na base, impostos sobre a cheia) + energia ACL (já com impostos).
    const T_AFP_eff = aclOn ? tusdAposBeneficio(T_AFP_TUSD, dCons) + teAcl : T_AFP;
    const T_APT_eff = aclOn ? tusdAposBeneficio(T_APT_TUSD, dConsPT) + teAcl : T_APT;
    const T_ARSV_eff = aclOn
      ? tusdAposBeneficio(T_AFP > 0 ? T_ARSV * (T_AFP_TUSD / T_AFP) : T_AFP_TUSD, dCons) + teAcl
      : T_ARSV;
    const T_B_eff_acl = aclOn ? tusdAposBeneficio(T_B3_TUSD, dCons) + teAcl : null;

    // Demanda: SEM-ACL aplica o desconto incentivada na base (impostos sobre a cheia);
    // COM (e SEM cativo) usa a demanda cheia → a perda do desconto aparece na economia.
    const demandaTariff = aclOn ? tusdAposBeneficio(T_A_DEMANDA, aclDiscDem(m)) : T_A_DEMANDA;
    const demandaMensal = demandaFaturadaKW * demandaTariff;

    // Credit sources — all FP-equivalent kWh
    const cs3Credits = includeCS3Credits
      ? generation[m] * getRateioFraction(rateio, uc.id, m)
      : 0;
    const batCredits = includeBATDistrib ? (batCreditsPerMonth[m] || 0) : 0;
    const ownGen = (includeOwnGen && uc.ownGeneration && uc.ownGeneration[m])
      ? uc.ownGeneration[m]
      : 0;

    // Total for reporting
    const totalNewCredits = cs3Credits + batCredits + ownGen;

    let creditsFPApplied = 0;
    let creditsPTApplied = 0;
    let creditsRSVApplied = 0;
    let bankDraw = 0;
    let costRede = 0;
    let icmsAdditional = 0;
    let pisCofinsAdditional = 0;
    let monthlyResidualFP = 0;
    let monthlyResidualPT = 0;
    let monthlyResidualRSV = 0;

    if (uc.isGrupoA) {
      const consFP = uc.consumptionFP[m] || 0;
      const consPT = uc.consumptionPT[m] || 0;
      const consRSV = uc.consumptionReservado?.[m] ?? 0;
      const hasRSV = consRSV > 0;

      // ═══ Excel V10 Simulação formulas — Grupo A (NHS/AMD) ═══
      // Ref: rows 25-37 (NHS) and 43-55 (AMD) in Simulação sheet
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
      let resFP = 0, resPT = 0, resRSV = 0;
      if (bank > 0) {
        costRede = 0;
        // Bank still positive means everything got covered (or already in bank).
      } else {
        const totalPool = ownGen + cs3Credits + batCredits + bankStart;
        const fpUncovered = Math.max(0, consFP - totalPool);
        const remAfterFP = Math.max(0, totalPool - consFP);
        const rsvUncovered = Math.max(0, consRSV - remAfterFP);
        const remAfterRSV = Math.max(0, remAfterFP - consRSV);
        const ptCoveredBySurplus = remAfterRSV * FA;
        const ptUncovered = Math.max(0, consPT - ptCoveredBySurplus);
        costRede = fpUncovered * T_AFP_eff + rsvUncovered * T_ARSV_eff + ptUncovered * T_APT_eff;
        resFP = fpUncovered;
        resRSV = rsvUncovered;
        resPT = ptUncovered;
      }
      // Compensated per posto = consumption − residual. Used by tax-leak formulas
      // below and by the Detalhe Impostos UI for compensação visualization.
      const compFP = Math.max(0, consFP - resFP);
      const compPT = Math.max(0, consPT - resPT);
      const compRSV = Math.max(0, consRSV - resRSV);

      // ICMS additional on compensated credits — scope-aware:
      //   scope=NONE or !icmsExempt    → leak = ICMS sobre tarifa completa (TUSD+TE)
      //   scope=TE_ONLY + icmsExempt   → leak = ICMS sobre TUSD apenas (TE isento)
      //   scope=TE_TUSD + icmsExempt   → leak = 0 (isenção total)
      // Leak base = compensação real (own-gen + plant + bank draws + BAT), NOT só creditsXXApplied
      // (que rastreia apenas auto-comp de own-gen). Fix do bug pré-existente onde plant não vazava.
      if (!effectiveIcmsExempt) {
        const icmsFP = computeICMSPerKWh(T_AFP, icmsRate);
        const icmsPT = computeICMSPerKWh(T_APT, icmsRate);
        icmsAdditional = compFP * icmsFP + compPT * icmsPT;
        if (hasRSV) {
          const icmsRSV = computeICMSPerKWh(T_ARSV, icmsRate);
          icmsAdditional += compRSV * icmsRSV;
        }
      } else if (icmsScope === 'TE_ONLY') {
        const icmsFP = computeICMSPerKWh(T_AFP_TUSD, icmsRate);
        const icmsPT = computeICMSPerKWh(T_APT_TUSD, icmsRate);
        icmsAdditional = compFP * icmsFP + compPT * icmsPT;
        // Reservado: sem dado TUSD/TE separado, aproximamos pela razão FP-equiv.
        if (hasRSV) {
          const ratio = T_AFP > 0 ? T_AFP_TUSD / T_AFP : 0;
          icmsAdditional += compRSV * computeICMSPerKWh(T_ARSV, icmsRate) * ratio;
        }
      }

      // PIS/COFINS additional — só vaza se cliente não tem isenção federal.
      if (!pisCofinsExempt) {
        const pcFP = computePisCofinsPerKWh(T_AFP, pisRate, cofinsRate);
        const pcPT = computePisCofinsPerKWh(T_APT, pisRate, cofinsRate);
        pisCofinsAdditional = compFP * pcFP + compPT * pcPT;
        if (hasRSV) {
          const pcRSV = computePisCofinsPerKWh(T_ARSV, pisRate, cofinsRate);
          pisCofinsAdditional += compRSV * pcRSV;
        }
      }

      // Persist residual kWh for downstream consumers (Detalhe Impostos UI).
      // Inline assignment for monthlyDetails.push() below.
      monthlyResidualFP = resFP;
      monthlyResidualPT = resPT;
      monthlyResidualRSV = resRSV;

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

      // SEM billing tariff: ACL build-up (TUSD Fio B −disc + energia ACL) takes precedence;
      // otherwise the legacy Plin competitorDiscount haircut on the captive tariff.
      const discount = (isSEM && competitorDiscount > 0) ? competitorDiscount : 0;
      const effectiveT_B = aclOn && T_B_eff_acl != null ? T_B_eff_acl : T_B3 * (1 - discount);
      const effectiveT_BRSV = aclOn && T_B_eff_acl != null
        ? tusdAposBeneficio(T_B3 > 0 ? T_BRSV * (T_B3_TUSD / T_B3) : T_B3_TUSD, aclDiscCons(m)) + aclEnergyAllIn(yearIdx)
        : T_BRSV * (1 - discount);

      costRede = residualFP * effectiveT_B + residualRSV * effectiveT_BRSV;

      // ICMS additional (scope-aware, same logic as Grupo A)
      if (creditsApplied > 0) {
        if (!effectiveIcmsExempt) {
          const icmsB = computeICMSPerKWh(T_B3, icmsRate);
          if (hasRSV) {
            const icmsBRSV = computeICMSPerKWh(T_BRSV, icmsRate);
            icmsAdditional = creditsToFP * icmsB + creditsToRSV * icmsBRSV;
          } else {
            icmsAdditional = creditsApplied * icmsB;
          }
        } else if (icmsScope === 'TE_ONLY') {
          const icmsB = computeICMSPerKWh(T_B3_TUSD, icmsRate);
          icmsAdditional = creditsApplied * icmsB;
          if (hasRSV) {
            const ratio = T_B3 > 0 ? T_B3_TUSD / T_B3 : 0;
            icmsAdditional = (creditsApplied - creditsToRSV) * icmsB
              + creditsToRSV * computeICMSPerKWh(T_BRSV, icmsRate) * ratio;
          }
        }
        if (!pisCofinsExempt) {
          const pcB = computePisCofinsPerKWh(T_B3, pisRate, cofinsRate);
          if (hasRSV) {
            const pcBRSV = computePisCofinsPerKWh(T_BRSV, pisRate, cofinsRate);
            pisCofinsAdditional = creditsToFP * pcB + creditsToRSV * pcBRSV;
          } else {
            pisCofinsAdditional = creditsApplied * pcB;
          }
        }
      }

      bank = Math.max(0, totalAvail - consTotal);
      monthlyResidualFP = residualFP;
      monthlyResidualRSV = residualRSV;
      // PT not applicable for Grupo B
    }

    // Demanda contratada — charged every month regardless of SEM/COM (not compensated by SCEE).
    costRede += demandaMensal;

    totalCostRede += costRede;
    totalIcmsAdditional += icmsAdditional;
    totalPisCofinsAdditional += pisCofinsAdditional;

    // SEM bill decomposition — itemises costRede into demanda + TUSD/TE per posto, for both
    // the captive (regulated) and ACL cases. Reconciles exactly to costRede:
    //   demandaCost + tusdFpCost + tusdPtCost + teFpCost + tePtCost === costRede.
    // Captive: TE per posto = regulated energy (T_x − T_x_TUSD). ACL: TE = energia comprada
    // na ACL (teAcl, uniform per kWh); TUSD carries the incentivada discount. Reservado is
    // folded into fora-ponta (its TUSD/TE split approximated by the FP TUSD/all-in ratio).
    const demandaCost = demandaMensal;
    let tusdFpCost = 0, tusdPtCost = 0, teFpCost = 0, tePtCost = 0;
    if (uc.isGrupoA) {
      const rRSV = T_AFP > 0 ? T_AFP_TUSD / T_AFP : 1;
      const tusdFPr = aclOn ? tusdAposBeneficio(T_AFP_TUSD, dCons) : T_AFP_TUSD;
      const tusdPTr = aclOn ? tusdAposBeneficio(T_APT_TUSD, dConsPT) : T_APT_TUSD;
      const tusdRSVr = aclOn ? tusdAposBeneficio(T_ARSV * rRSV, dCons) : T_ARSV * rRSV;
      const teFPr = aclOn ? teAcl : (T_AFP - T_AFP_TUSD);
      const tePTr = aclOn ? teAcl : (T_APT - T_APT_TUSD);
      const teRSVr = aclOn ? teAcl : (T_ARSV - T_ARSV * rRSV);
      tusdFpCost = monthlyResidualFP * tusdFPr + monthlyResidualRSV * tusdRSVr;
      tusdPtCost = monthlyResidualPT * tusdPTr;
      teFpCost = monthlyResidualFP * teFPr + monthlyResidualRSV * teRSVr;
      tePtCost = monthlyResidualPT * tePTr;
    } else {
      // Grupo B: single posto (fora-ponta). Captive may carry the legacy Plin haircut.
      const discF = (!aclOn && isSEM && competitorDiscount > 0) ? (1 - competitorDiscount) : 1;
      const rBRSV = T_B3 > 0 ? T_B3_TUSD / T_B3 : 1;
      const tusdBr = (aclOn ? tusdAposBeneficio(T_B3_TUSD, dCons) : T_B3_TUSD * discF);
      const tusdBRSVr = (aclOn ? tusdAposBeneficio(T_BRSV * rBRSV, dCons) : T_BRSV * rBRSV * discF);
      const teBr = (aclOn ? teAcl : (T_B3 - T_B3_TUSD) * discF);
      const teBRSVr = (aclOn ? teAcl : (T_BRSV - T_BRSV * rBRSV) * discF);
      tusdFpCost = monthlyResidualFP * tusdBr + monthlyResidualRSV * tusdBRSVr;
      teFpCost = monthlyResidualFP * teBr + monthlyResidualRSV * teBRSVr;
    }

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
      tusdFpCost,
      tusdPtCost,
      teFpCost,
      tePtCost,
      demandaCost,
      ownGenerationUsed: ownGen,
      icmsAdditional,
      pisCofinsAdditional,
      residualFP: monthlyResidualFP,
      residualPT: monthlyResidualPT,
      residualRSV: monthlyResidualRSV,
    });
  }

  return {
    monthlyDetails,
    finalBank: bank,
    totalCostRede,
    totalIcmsAdditional,
    totalPisCofinsAdditional,
  };
}

/**
 * BAT-the-UC monthly bill detail (grid bill, bank evolution).
 * Used to include BAT in cost summing and attribution decomposition.
 */
export interface BATMonthlyBill {
  monthIndex: number;
  costRede: number;
  icmsAdditional: number;
  pisCofinsAdditional: number;
  bankStart: number;
  bankDraw: number;
  bankEnd: number;
  surplusOut: number;       // FP-equiv kWh flowing to NHS/AMD this month
  residualFP: number;       // grid kWh (FP) BAT pays
  residualPT: number;       // grid kWh (PT) BAT pays
}

export interface BATSimResult {
  /** Credits flowing TO other UCs (NHS/AMD) per month, T+1 lagged */
  creditsByUC: Record<string, number[]>;
  /** BAT-the-UC's own grid bills, bank evolution, etc. */
  monthlyBills: BATMonthlyBill[];
  /** BAT bank at end of contract */
  finalBank: number;
  /** Sum of monthlyBills.costRede */
  totalCostRede: number;
  /** Sum of monthlyBills.icmsAdditional */
  totalIcmsAdditional: number;
  /** Sum of monthlyBills.pisCofinsAdditional */
  totalPisCofinsAdditional: number;
}

interface BATSimParams {
  project: Project;
  contractMonths: number;
  icmsExempt: boolean;
  pisCofinsExempt: boolean;
  tariffEscalationDistributor?: number;
  // Attribution flags — default to true (preserves existing behavior).
  includeOpeningBank?: boolean;
  includeOwnGen?: boolean;
  includeBATDistrib?: boolean;
}

/**
 * Simulate BAT-the-UC: tracks own consumption × plant × bank dynamics,
 * computes residual grid bill (the piece previously dropped on the floor),
 * AND distributes plant surplus to NHS/AMD with T+1 lag.
 *
 * Replaces the old computeBATCredits — which only returned the credit flow
 * and silently discarded BAT's residual consumption (~R$ 2.5M of grid bills
 * over 10y for the Copasul demo).
 */
export function computeBATCredits(params: BATSimParams): BATSimResult {
  const {
    project,
    contractMonths,
    icmsExempt,
    pisCofinsExempt,
    tariffEscalationDistributor = 0,
    includeOpeningBank = true,
    includeOwnGen = true,
    includeBATDistrib = true,
  } = params;

  const cm = contractMonths;
  const empty = (): BATSimResult => ({
    creditsByUC: {},
    monthlyBills: [],
    finalBank: 0,
    totalCostRede: 0,
    totalIcmsAdditional: 0,
    totalPisCofinsAdditional: 0,
  });

  if (!project.batBank) return empty();

  const bat = project.batBank;
  const batUC = project.ucs.find(uc => uc.id === 'bat');

  const FA = project.distributor.FA ?? 0.6;
  const T_AFP_base = project.distributor.T_AFP ?? 0;
  const T_APT_base = project.distributor.T_APT ?? 0;
  const T_AFP_TUSD_base = project.distributor.T_AFP_TUSD ?? 0;
  const T_APT_TUSD_base = project.distributor.T_APT_TUSD ?? 0;
  const icms = project.distributor.taxes.ICMS ?? 0;
  const pis = project.distributor.taxes.PIS ?? 0;
  const cofins = project.distributor.taxes.COFINS ?? 0;
  const icmsScope = project.distributor.taxes.icmsScope ?? 'TE_TUSD';
  const effectiveIcmsExempt = icmsScope === 'NONE' ? false : icmsExempt;

  const nhsCredits: number[] = new Array(cm).fill(0);
  const amdCredits: number[] = new Array(cm).fill(0);
  const monthlyBills: BATMonthlyBill[] = [];

  // Legacy fallback: BAT bank with no UC attached (just dribbles credits out).
  // Kept for backward compatibility with projects that have batBank but no
  // batUC entry. No grid-bill tracking applies (there's no UC to pay bills).
  if (!batUC) {
    let remaining = includeOpeningBank ? bat.openingKWh : 0;
    const draw = remaining / cm;
    for (let m = 0; m < cm; m++) {
      const d = Math.min(draw, remaining);
      remaining -= d;
      if (includeBATDistrib && m + 1 < cm) {
        nhsCredits[m + 1] += d * bat.toNHSPct;
        amdCredits[m + 1] += d * bat.toAMDPct;
      }
    }
    return {
      creditsByUC: {
        [bat.nhsUCId]: nhsCredits,
        [bat.amdUCId]: amdCredits,
      },
      monthlyBills: [],
      finalBank: remaining,
      totalCostRede: 0,
      totalIcmsAdditional: 0,
      totalPisCofinsAdditional: 0,
    };
  }

  let batBank = includeOpeningBank ? bat.openingKWh : 0;
  let totalCostRede = 0;
  let totalIcmsAdditional = 0;
  let totalPisCofinsAdditional = 0;

  for (let m = 0; m < cm; m++) {
    const yearIdx = Math.floor(m / 12);
    const escFactor = Math.pow(1 + tariffEscalationDistributor, yearIdx);
    const T_AFP = T_AFP_base * escFactor;
    const T_APT = T_APT_base * escFactor;
    const T_AFP_TUSD = T_AFP_TUSD_base * escFactor;
    const T_APT_TUSD = T_APT_TUSD_base * escFactor;

    const gen = (includeOwnGen && batUC.ownGeneration && batUC.ownGeneration[m])
      ? batUC.ownGeneration[m]
      : 0;
    const consFP = batUC.consumptionFP[m] || 0;
    const consPT = batUC.consumptionPT[m] || 0;
    const bankStart = batBank;

    // Step 1 — own gen autocompensa BAT FP first, then crosses posto via FA for PT
    const genAppliedFP = Math.min(gen, consFP);
    let remainingGen = gen - genAppliedFP;
    const genForPT = remainingGen * FA;
    const genAppliedPT = Math.min(genForPT, consPT);
    const genUsedAsFP = FA > 0 ? genAppliedPT / FA : 0;
    remainingGen = remainingGen - genUsedAsFP;
    const surplus = Math.max(0, remainingGen);

    // Step 2 — residual after own gen draws from BAT bank
    let residualFP = Math.max(0, consFP - genAppliedFP);
    let residualPT = Math.max(0, consPT - genAppliedPT);
    let bankDraw = 0;

    if (residualFP > 0 && batBank > 0) {
      const drawFP = Math.min(batBank, residualFP);
      bankDraw += drawFP;
      residualFP -= drawFP;
    }
    if (residualPT > 0 && batBank - bankDraw > 0) {
      const avail = batBank - bankDraw;
      const ptCovered = Math.min(avail * FA, residualPT);
      const drawPT = FA > 0 ? ptCovered / FA : 0;
      bankDraw += drawPT;
      residualPT -= ptCovered;
    }
    batBank = Math.max(0, batBank - bankDraw);

    // Step 3 — anything residual pays grid (this is what was missing before)
    const costRede = residualFP * T_AFP + residualPT * T_APT;
    let icmsAdditional = 0;
    let pisCofinsAdditional = 0;
    if (!effectiveIcmsExempt) {
      const icmsFP = computeICMSPerKWh(T_AFP, icms);
      const icmsPT = computeICMSPerKWh(T_APT, icms);
      // ICMS additional applies to credits that offset consumption (own gen autocomp counts here).
      icmsAdditional = genAppliedFP * icmsFP + genAppliedPT * icmsPT;
    } else if (icmsScope === 'TE_ONLY') {
      const icmsFP = computeICMSPerKWh(T_AFP_TUSD, icms);
      const icmsPT = computeICMSPerKWh(T_APT_TUSD, icms);
      icmsAdditional = genAppliedFP * icmsFP + genAppliedPT * icmsPT;
    }
    if (!pisCofinsExempt) {
      const pcFP = computePisCofinsPerKWh(T_AFP, pis, cofins);
      const pcPT = computePisCofinsPerKWh(T_APT, pis, cofins);
      pisCofinsAdditional = genAppliedFP * pcFP + genAppliedPT * pcPT;
    }

    // Step 4 — surplus distributes to NHS/AMD with T+1 lag (only when flag on)
    if (includeBATDistrib && surplus > 0 && m + 1 < cm) {
      nhsCredits[m + 1] += surplus * bat.toNHSPct;
      amdCredits[m + 1] += surplus * bat.toAMDPct;
    }
    // Note: when includeBATDistrib=false, surplus is wasted (NOT banked back).
    // This mirrors the F-section configuration in the Excel — BAT plant is configured
    // to send surplus out, not to grow its own bank. Toggling the flag isolates the
    // distribution effect without redirecting surplus into the bank (which would
    // distort the attribution by inflating bank value).

    totalCostRede += costRede;
    totalIcmsAdditional += icmsAdditional;
    totalPisCofinsAdditional += pisCofinsAdditional;

    monthlyBills.push({
      monthIndex: m,
      costRede,
      icmsAdditional,
      pisCofinsAdditional,
      bankStart,
      bankDraw,
      bankEnd: batBank,
      surplusOut: includeBATDistrib ? surplus : 0,
      residualFP,
      residualPT,
    });
  }

  return {
    creditsByUC: {
      [bat.nhsUCId]: nhsCredits,
      [bat.amdUCId]: amdCredits,
    },
    monthlyBills,
    finalBank: batBank,
    totalCostRede,
    totalIcmsAdditional,
    totalPisCofinsAdditional,
  };
}
