import type { Project, SimulationResult, UCMonthlyDetail } from './types';

// Brazilian "por dentro" tax breakdown: given sem-impostos R$/kWh and consumption
// in kWh, return the energy / PIS+COFINS / ICMS components such that they sum to
// T_all_in × kWh (matches the gross-up T = T_sem / ((1-PC)(1-ICMS))).
export function taxBreakdown(
  kWh: number,
  T_sem_per_kWh: number,
  taxes: { ICMS: number; PIS: number; COFINS: number },
): { semImpostos: number; pisCofins: number; icms: number; total: number } {
  const PC = taxes.PIS + taxes.COFINS;
  const ICMS = taxes.ICMS;
  const semImpostos = kWh * T_sem_per_kWh;
  if (PC >= 1 || ICMS >= 1 || semImpostos === 0) {
    return { semImpostos, pisCofins: 0, icms: 0, total: semImpostos };
  }
  const pisCofins = semImpostos * PC / (1 - PC);
  const icms = (semImpostos + pisCofins) * ICMS / (1 - ICMS);
  return { semImpostos, pisCofins, icms, total: semImpostos + pisCofins + icms };
}

export interface TaxBreakdownLine {
  label: string;
  sem: number;
  com: number;
  delta: number;
}

export interface TaxBreakdownPostoBlock {
  posto: 'FP' | 'PT' | 'RSV';
  consumoSEM: number;     // residual kWh paid in SEM (after own gen/BAT credits)
  consumoCOM: number;     // residual kWh paid in COM (after plant credits + bank draws)
  compensadoCOM: number;  // kWh compensated by the project's plant in COM (potential leak base)
  lines: TaxBreakdownLine[];
  subtotalSEM: number;
  subtotalCOM: number;
}

export interface TaxBreakdownUC {
  ucId: string;
  ucName: string;
  tariffGroup: string;
  isGrupoA: boolean;
  postos: TaxBreakdownPostoBlock[];
  demanda?: {
    kW: number;
    months: number;
    lines: TaxBreakdownLine[];
    subtotal: number;
  };
  ppaHelexia?: number;
  // ACL only: crédito que reconcilia a SEM cativa (linhas acima) com a SEM real do
  // mercado livre (energia ACL + TUSD/demanda com desconto incentivada) = benefício.
  // >0 = a reconstrução cativa superestima a SEM real (crédito reduz a SEM).
  beneficioIncentivada?: number;
  // Não-ACL: reconciliação da SEM reconstruída (tarifa flat) → SEM real do bank sim
  // (reajuste anual). >0 reduz a SEM. Em projetos sem reajuste fica ausente.
  ajusteSEM?: number;
  // Reconciliação da rede COM reconstruída (tarifa flat + leaks) → rede COM real do
  // bank sim (reajuste + FA cross-posto + demanda). >0 reduz a COM (aumenta a economia).
  ajusteRedeCOM?: number;
  totalSEM: number;
  totalCOM: number;
}

export interface TaxBreakdownMonthlyRow {
  monthIndex: number;
  label: string;
  consumoKWh: number;
  semRede: number;       // distribuidora bill without Helexia
  comRede: number;       // distribuidora residual + leaks with Helexia
  comPPA: number;        // PPA paid to Helexia
  comTotal: number;      // comRede + comPPA
  economia: number;      // semRede - comTotal
}

export interface TaxBreakdownReport {
  distributor: {
    name: string;
    state: string;
    icmsRate: number;
    pisRate: number;
    cofinsRate: number;
    icmsScope: 'TE_TUSD' | 'TE_ONLY' | 'NONE';
    pisCofinsExempt: boolean;
  };
  scenarios: {
    icmsExempt: boolean;
  };
  contractMonths: number;
  /** Month label being shown — undefined when this is a full-contract aggregate. */
  monthLabel?: string;
  monthIndex?: number;
  ucs: TaxBreakdownUC[];
  monthly: TaxBreakdownMonthlyRow[]; // aggregated across all UCs (always full contract)
}

function sumField(
  details: UCMonthlyDetail[] | undefined,
  key: keyof UCMonthlyDetail,
): number {
  if (!details) return 0;
  return details.reduce((acc, m) => acc + ((m[key] as number | undefined) ?? 0), 0);
}

export function computeTaxBreakdown(
  project: Project,
  result: SimulationResult,
  monthIndex?: number,
): TaxBreakdownReport {
  const d = project.distributor;
  const taxes = d.taxes;
  const icmsScope = taxes.icmsScope ?? 'TE_TUSD';
  const pisCofinsExempt = taxes.pisCofinsExempt ?? true;
  // NONE scope forces no-isenção even if scenarios.icmsExempt = true.
  const effectiveIcmsExempt = icmsScope === 'NONE' ? false : project.scenarios.icmsExempt;
  const cm = project.plant.contractMonths;
  // When monthIndex is provided, scope all UC sums to that single month.
  const isMonthly = typeof monthIndex === 'number' && monthIndex >= 0 && monthIndex < cm;
  const monthLabel = isMonthly ? result.months[monthIndex]?.label : undefined;

  const ucs: TaxBreakdownUC[] = [];
  // Helpers to filter sums to a single month when isMonthly === true.
  const consAt = (arr: number[] | undefined): number => {
    if (!arr) return 0;
    if (isMonthly) return arr[monthIndex] ?? 0;
    return arr.reduce((a, v) => a + (v || 0), 0);
  };
  const residualAt = (details: UCMonthlyDetail[] | undefined, key: 'residualFP' | 'residualPT' | 'residualRSV'): number => {
    if (!details) return 0;
    if (isMonthly) return (details[monthIndex]?.[key] as number | undefined) ?? 0;
    return sumField(details, key);
  };
  for (const uc of project.ucs) {
    if (uc.id === 'bat') continue;
    const semDetails = result.ucDetailsSEM[uc.id];
    const comDetails = result.ucDetailsCOM[uc.id];

    const consFP = consAt(uc.consumptionFP);
    const consPT = consAt(uc.consumptionPT);
    const consRSV = consAt(uc.consumptionReservado);

    // Derive total compensação from residuals (bank.ts now stores residualFP/PT/RSV per month).
    // This includes own-gen + plant injection (project.plant.p50Profile via rateio) +
    // bank draws + BAT, unlike creditsXXApplied which only tracked own-gen auto-compensation.
    const residualSemFP = residualAt(semDetails, 'residualFP');
    const residualSemPT = residualAt(semDetails, 'residualPT');
    const residualSemRSV = residualAt(semDetails, 'residualRSV');
    const residualComFP = residualAt(comDetails, 'residualFP');
    const residualComPT = residualAt(comDetails, 'residualPT');
    const residualComRSV = residualAt(comDetails, 'residualRSV');
    const compFP = Math.max(0, consFP - residualComFP);
    const compPT = Math.max(0, consPT - residualComPT);
    const compRSV = Math.max(0, consRSV - residualComRSV);
    // Also track SEM compensation for PPA attribution (Helexia portion = COM-only compensation).
    const semCompFP = Math.max(0, consFP - residualSemFP);
    const semCompPT = Math.max(0, consPT - residualSemPT);
    const semCompRSV = Math.max(0, consRSV - residualSemRSV);

    // Per-component sem-impostos R$/kWh (TUSD = combined − TE)
    const teFP = uc.isGrupoA ? d.tariffs.A_TE_FP : d.tariffs.B_TE;
    const tusdFP = uc.isGrupoA
      ? Math.max(0, d.tariffs.A_FP_TUSD_TE - d.tariffs.A_TE_FP)
      : d.tariffs.B_TUSD;
    const tePT = uc.isGrupoA ? d.tariffs.A_TE_PT : 0;
    const tusdPT = uc.isGrupoA ? Math.max(0, d.tariffs.A_PT_TUSD_TE - d.tariffs.A_TE_PT) : 0;
    // RSV: ratio TE/TUSD inherited from FP (no separate TE field for RSV)
    const teRatioFP = (teFP + tusdFP) > 0 ? teFP / (teFP + tusdFP) : 0;
    const rsvBase = uc.isGrupoA ? (d.tariffs.A_RSV_TUSD_TE ?? 0) : (d.tariffs.B_RSV_TUSD_TE ?? 0);
    const teRSV = rsvBase * teRatioFP;
    const tusdRSV = rsvBase * (1 - teRatioFP);

    const postoConfigs: { name: 'FP' | 'PT' | 'RSV'; teRate: number; tusdRate: number; semK: number; comK: number; compK: number; show: boolean }[] = [
      { name: 'FP', teRate: teFP, tusdRate: tusdFP, semK: residualSemFP, comK: residualComFP, compK: compFP, show: true },
      { name: 'PT', teRate: tePT, tusdRate: tusdPT, semK: residualSemPT, comK: residualComPT, compK: compPT, show: uc.isGrupoA },
      { name: 'RSV', teRate: teRSV, tusdRate: tusdRSV, semK: residualSemRSV, comK: residualComRSV, compK: compRSV, show: consRSV > 0 },
    ];

    const postos: TaxBreakdownPostoBlock[] = [];
    let totalSEM = 0;
    let totalCOM = 0;

    for (const p of postoConfigs) {
      if (!p.show) continue;
      const semTE = taxBreakdown(p.semK, p.teRate, taxes);
      const semTUSD = taxBreakdown(p.semK, p.tusdRate, taxes);
      const comResTE = taxBreakdown(p.comK, p.teRate, taxes);
      const comResTUSD = taxBreakdown(p.comK, p.tusdRate, taxes);
      const compTE_leak = taxBreakdown(p.compK, p.teRate, taxes);
      const compTUSD_leak = taxBreakdown(p.compK, p.tusdRate, taxes);
      // Leak on compensated kWh (only present in COM scenario):
      // - ICMS sobre TE: leaks only if !effectiveIcmsExempt (scope=NONE OR icmsExempt=false)
      // - ICMS sobre TUSD: leaks if scope=NONE/icmsExempt=false OU se scope=TE_ONLY
      // - PIS/COFINS: leaks se pisCofinsExempt = false
      const icmsLeakTE = effectiveIcmsExempt ? 0 : compTE_leak.icms;
      const icmsLeakTUSD = (effectiveIcmsExempt && icmsScope === 'TE_ONLY') || !effectiveIcmsExempt
        ? compTUSD_leak.icms : 0;
      const pcLeakTE = pisCofinsExempt ? 0 : compTE_leak.pisCofins;
      const pcLeakTUSD = pisCofinsExempt ? 0 : compTUSD_leak.pisCofins;

      const lines: TaxBreakdownLine[] = [
        { label: `TE ${p.name} (sem impostos)`, sem: semTE.semImpostos, com: comResTE.semImpostos, delta: semTE.semImpostos - comResTE.semImpostos },
        { label: `TUSD ${p.name} (sem impostos)`, sem: semTUSD.semImpostos, com: comResTUSD.semImpostos, delta: semTUSD.semImpostos - comResTUSD.semImpostos },
        { label: `PIS+COFINS sobre TE ${p.name}`, sem: semTE.pisCofins, com: comResTE.pisCofins + pcLeakTE, delta: semTE.pisCofins - (comResTE.pisCofins + pcLeakTE) },
        { label: `PIS+COFINS sobre TUSD ${p.name}`, sem: semTUSD.pisCofins, com: comResTUSD.pisCofins + pcLeakTUSD, delta: semTUSD.pisCofins - (comResTUSD.pisCofins + pcLeakTUSD) },
        { label: `ICMS sobre TE ${p.name}`, sem: semTE.icms, com: comResTE.icms + icmsLeakTE, delta: semTE.icms - (comResTE.icms + icmsLeakTE) },
        { label: `ICMS sobre TUSD ${p.name}`, sem: semTUSD.icms, com: comResTUSD.icms + icmsLeakTUSD, delta: semTUSD.icms - (comResTUSD.icms + icmsLeakTUSD) },
      ];
      const subtotalSEM = semTE.total + semTUSD.total;
      const subtotalCOM = comResTE.total + comResTUSD.total + icmsLeakTE + icmsLeakTUSD + pcLeakTE + pcLeakTUSD;
      totalSEM += subtotalSEM;
      totalCOM += subtotalCOM;
      postos.push({
        posto: p.name,
        consumoSEM: p.semK,
        consumoCOM: p.comK,
        compensadoCOM: p.compK,
        lines,
        subtotalSEM,
        subtotalCOM,
      });
    }

    // Demanda (Grupo A) — não compensada por SCEE, igual em SEM e COM.
    // For monthly view, multiply by 1 month instead of full contract.
    let demanda: TaxBreakdownUC['demanda'];
    const demandaKW = uc.isGrupoA ? (uc.demandaFaturadaFP ?? 0) : 0;
    const demandaMonths = isMonthly ? 1 : cm;
    if (demandaKW > 0 && (d.tariffs.A_FP_DEMANDA ?? 0) > 0) {
      const T_dem_sem = d.tariffs.A_FP_DEMANDA ?? 0;
      const demSem = T_dem_sem * demandaKW * demandaMonths;
      const PC = taxes.PIS + taxes.COFINS;
      const demPC = (1 - PC) > 0 ? demSem * PC / (1 - PC) : 0;
      const demICMS = (1 - taxes.ICMS) > 0 ? (demSem + demPC) * taxes.ICMS / (1 - taxes.ICMS) : 0;
      const subtotal = demSem + demPC + demICMS;
      demanda = {
        kW: demandaKW,
        months: demandaMonths,
        lines: [
          { label: 'Demanda sem impostos', sem: demSem, com: demSem, delta: 0 },
          { label: 'PIS+COFINS sobre Demanda', sem: demPC, com: demPC, delta: 0 },
          { label: 'ICMS sobre Demanda', sem: demICMS, com: demICMS, delta: 0 },
        ],
        subtotal,
      };
      totalSEM += subtotal;
      totalCOM += subtotal;
    }

    // ── Reconcile the flat-tariff reconstruction (postos + demanda + leaks above) to the
    // REAL bank-sim costs, which include reajuste anual, FA cross-posto offset (e.g. COPEL
    // FA=1), the ACL incentivada discount, and demanda. The component lines stay as an
    // illustrative decomposition; a single reconciling line per side absorbs the gap so the
    // UC TOTAL matches the headline economia exactly.
    const reconstructedSEM = totalSEM;       // postos + demanda (regulated/captive reference)
    const reconstructedComRede = totalCOM;   // postos + demanda + leaks (no PPA yet)

    const realSEM = isMonthly
      ? (semDetails?.[monthIndex]?.costRede ?? 0)
      : sumField(semDetails, 'costRede');
    const realComRede = isMonthly
      ? ((comDetails?.[monthIndex]?.costRede ?? 0) + (comDetails?.[monthIndex]?.icmsAdditional ?? 0) + (comDetails?.[monthIndex]?.pisCofinsAdditional ?? 0))
      : (sumField(comDetails, 'costRede') + sumField(comDetails, 'icmsAdditional') + sumField(comDetails, 'pisCofinsAdditional'));

    // PPA (COM only): reconstructed via Helexia compensation; scaled to the real
    // plant-level PPA (generation × rate × escalation) after the loop.
    const ppaRate = project.plant.ppaRateRsBRLkWh;
    const helexiaCompensation = Math.max(0, (compFP + compPT + compRSV) - (semCompFP + semCompPT + semCompRSV));
    const reconstructedPPA = helexiaCompensation * ppaRate;

    // Overstatement (>0) = reconstruction higher than real → reconciling credit reduces it.
    const semOver = reconstructedSEM - realSEM;
    const comOver = reconstructedComRede - realComRede;
    const isACL = project.marketType === 'ACL';

    totalSEM = realSEM;
    totalCOM = realComRede + reconstructedPPA; // PPA scaled post-loop

    ucs.push({
      ucId: uc.id,
      ucName: uc.name,
      tariffGroup: uc.tariffGroup,
      isGrupoA: uc.isGrupoA,
      postos,
      demanda,
      ppaHelexia: reconstructedPPA > 0 ? reconstructedPPA : undefined,
      beneficioIncentivada: isACL && Math.abs(semOver) > 1 ? semOver : undefined,
      ajusteSEM: !isACL && Math.abs(semOver) > 1 ? semOver : undefined,
      ajusteRedeCOM: Math.abs(comOver) > 1 ? comOver : undefined,
      totalSEM,
      totalCOM,
    });
  }

  // Scale per-UC PPA so the sum equals the real plant-level PPA (generation × rate ×
  // escalation) — the same figure the monthly section shows — making the per-UC TOTAL
  // reconcile to the headline economia.
  const realTotalPPA = isMonthly
    ? (result.months[monthIndex]?.ppaCost ?? 0)
    : result.months.reduce((acc, m) => acc + m.ppaCost, 0);
  const reconstructedTotalPPA = ucs.reduce((acc, u) => acc + (u.ppaHelexia ?? 0), 0);
  if (reconstructedTotalPPA > 0 && realTotalPPA > 0 && Math.abs(realTotalPPA - reconstructedTotalPPA) > 1) {
    const scale = realTotalPPA / reconstructedTotalPPA;
    for (const u of ucs) {
      if (u.ppaHelexia) {
        const scaled = u.ppaHelexia * scale;
        u.totalCOM += scaled - u.ppaHelexia;
        u.ppaHelexia = scaled;
      }
    }
  }

  // Monthly aggregate across all UCs (SEM Rede, COM Rede+leaks, COM PPA, Total, Economia).
  // Mirrors what's already shown in MonthlyResult but reframed with PPA isolated so the
  // user can see distribuidora-residual vs PPA-Helexia side-by-side.
  const monthly: TaxBreakdownMonthlyRow[] = [];
  const totalConsumoPerMonth = (mi: number) => {
    let sum = 0;
    for (const uc of project.ucs) {
      sum += (uc.consumptionFP[mi] ?? 0)
        + (uc.consumptionPT[mi] ?? 0)
        + (uc.consumptionReservado?.[mi] ?? 0);
    }
    return sum;
  };
  for (const m of result.months) {
    const semRede = m.sem.totalCost;
    const comRede = m.com.redeCost + m.com.icmsAdditional + (m.com.pisCofinsAdditional ?? 0);
    const comPPA = m.ppaCost;
    const comTotal = comRede + comPPA;
    monthly.push({
      monthIndex: m.monthIndex,
      label: m.label,
      consumoKWh: totalConsumoPerMonth(m.monthIndex),
      semRede,
      comRede,
      comPPA,
      comTotal,
      economia: semRede - comTotal,
    });
  }

  return {
    distributor: {
      name: d.name,
      state: d.state,
      icmsRate: taxes.ICMS,
      pisRate: taxes.PIS,
      cofinsRate: taxes.COFINS,
      icmsScope,
      pisCofinsExempt,
    },
    scenarios: { icmsExempt: effectiveIcmsExempt },
    contractMonths: cm,
    monthLabel,
    monthIndex: isMonthly ? monthIndex : undefined,
    ucs,
    monthly,
  };
}
