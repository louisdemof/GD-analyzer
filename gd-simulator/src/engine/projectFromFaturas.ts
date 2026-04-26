/**
 * Build a complete Project skeleton from a batch of parsed Energisa MS faturas.
 *
 * Strategy:
 *   1. Group parsed faturas by matrícula → keep latest per UC.
 *   2. Derive distribuidora (Energisa MS for now) with tariffs back-computed
 *      from the fatura's "com tributos" prices using its detected PIS/COFINS/ICMS.
 *   3. For each UC, build ConsumptionUnit with FP/PT/RSV arrays from the
 *      12-month history (repeated × 2 to fill 24 months — engine extends
 *      with growth thereafter), demanda fields, etc.
 *   4. Plant defaults to empty (user picks Helexia plant after creation).
 */

import type { ConsumptionUnit, Distributor, Plant, Project, RateioAllocation, TariffGroup } from './types';
import type { ParsedFatura, MonthRow } from './faturaParser';
import { computeDerivedTariffs } from './tariff';

const DEFAULT_PIS = 0.0153;
const DEFAULT_COFINS = 0.0703;
const DEFAULT_ICMS = 0.17;

// Reasonable EMS bundled defaults for B class (used as fallback when faturas are A-only).
const EMS_DEFAULTS = {
  B_TUSD: 0.59208,
  B_TE: 0.28602,
  A_FP_TUSD_TE: 0.39961,
  A_PT_TUSD_TE: 2.25614,
  A_TE_FP: 0.26963,
  A_TE_PT: 0.44621,
  A_FP_DEMANDA: 34.69,
};

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Map "MTV-MOD.TARIFÁRIA VERDE / A3A RURAL" → "A3A_VERDE" etc. */
export function deriveTariffGroup(classificacao: string): { group: TariffGroup; isGrupoA: boolean } {
  const c = classificacao.toUpperCase();
  const isVerde = /\bVERDE\b/.test(c);
  const isAzul = /\bAZUL\b/.test(c);

  if (/\bB1\b|RESIDENCIAL/.test(c)) return { group: 'B1', isGrupoA: false };
  if (/\bB2\b|B.*RURAL|RURAL.*B/.test(c) && !/\bA[1-4]/.test(c)) return { group: 'B2', isGrupoA: false };
  if (/\bB3\b|COMERC|INDUSTR.*B/.test(c) && !/\bA[1-4]/.test(c)) return { group: 'B3', isGrupoA: false };

  if (/A4\b/.test(c)) return { group: isAzul ? 'A4_AZUL' : 'A4_VERDE', isGrupoA: true };
  if (/A3A\b/.test(c)) return { group: isAzul ? 'A3A_AZUL' : isVerde ? 'A3A_VERDE' : 'A3A', isGrupoA: true };
  if (/A3\b/.test(c)) return { group: isAzul ? 'A3_AZUL' : 'A3_VERDE', isGrupoA: true };
  if (/A2\b/.test(c)) return { group: isAzul ? 'A2_AZUL' : 'A2_VERDE', isGrupoA: true };
  if (/A1\b/.test(c)) return { group: isAzul ? 'A1_AZUL' : 'A1_VERDE', isGrupoA: true };
  // Default to B3 if no class hint
  return { group: 'B3', isGrupoA: false };
}

/** Convert tariff "com tributos" → "sem tributos" using detected tax rates. */
function semFromCom(com: number | undefined, taxes: { PIS: number; COFINS: number; ICMS: number }): number | undefined {
  if (!com || com === 0) return undefined;
  const factor = (1 - taxes.PIS - taxes.COFINS) * (1 - taxes.ICMS);
  return +(com * factor).toFixed(6);
}

function buildDistributorFromFatura(p: ParsedFatura): Distributor {
  const taxes = {
    ICMS: p.taxes?.ICMS ?? DEFAULT_ICMS,
    PIS: p.taxes?.PIS ?? DEFAULT_PIS,
    COFINS: p.taxes?.COFINS ?? DEFAULT_COFINS,
  };
  const cm = p.currentMonth ?? {};

  const A_FP_TUSD_TE = semFromCom(cm.tarifaFPcomTrib, taxes) ?? EMS_DEFAULTS.A_FP_TUSD_TE;
  const A_PT_TUSD_TE = semFromCom(cm.tarifaPTcomTrib, taxes) ?? EMS_DEFAULTS.A_PT_TUSD_TE;
  const A_RSV_TUSD_TE = semFromCom(cm.tarifaRSVcomTrib, taxes);
  const A_FP_DEMANDA = semFromCom(cm.tarifaDemandaComTrib, taxes) ?? EMS_DEFAULTS.A_FP_DEMANDA;

  return computeDerivedTariffs({
    id: 'EMS',
    name: 'Energisa Mato Grosso do Sul',
    state: 'MS',
    resolution: '',
    tariffs: {
      B_TUSD: EMS_DEFAULTS.B_TUSD,
      B_TE: EMS_DEFAULTS.B_TE,
      A_FP_TUSD_TE,
      A_PT_TUSD_TE,
      A_TE_FP: EMS_DEFAULTS.A_TE_FP,
      A_TE_PT: EMS_DEFAULTS.A_TE_PT,
      ...(A_RSV_TUSD_TE !== undefined ? { A_RSV_TUSD_TE } : {}),
      A_FP_DEMANDA,
    },
    taxes,
  });
}

function buildUCFromFatura(p: ParsedFatura, fallbackId: string): ConsumptionUnit {
  const cls = p.classificacao || '';
  const { group, isGrupoA } = deriveTariffGroup(cls);
  const isRural = /\bRURAL\b|IRRIG|AQUICULT/i.test(cls);

  // Use the LAST 12 months of history (most recent), in chronological order
  const sorted = [...p.history].sort((a, b) => a.monthIso.localeCompare(b.monthIso));
  const last12 = sorted.slice(-12);

  // Fill 24-month arrays by repeating the 12 (engine extends with growth)
  const fp = last12.map((r: MonthRow) => Math.round(r.consumoForaPonta || 0));
  const pt = last12.map((r: MonthRow) => Math.round(r.consumoPonta || 0));
  const rsv = last12.map((r: MonthRow) => Math.round(r.consumoReservado || 0));
  const dms = last12.map((r: MonthRow) => r.demandaForaPonta || 0);

  while (fp.length < 12) fp.push(0);
  while (pt.length < 12) pt.push(0);
  while (rsv.length < 12) rsv.push(0);
  while (dms.length < 12) dms.push(0);

  const fp24 = [...fp, ...fp];
  const pt24 = [...pt, ...pt];
  const rsv24 = [...rsv, ...rsv];

  const dmAvg = dms.filter(v => v > 0);
  const demandaFaturadaFP = dmAvg.length > 0
    ? Math.round(dmAvg.reduce((a, b) => a + b, 0) / dmAvg.length)
    : undefined;

  const ucNumero = p.ucNumero || fallbackId;
  return {
    id: ucNumero,
    name: `UC ${ucNumero}`,
    tariffGroup: group,
    isGrupoA,
    consumptionFP: fp24,
    consumptionPT: pt24,
    ...(isRural && rsv.some(v => v > 0) ? { consumptionReservado: rsv24 } : {}),
    openingBank: 0,
    ...(isGrupoA && p.demandaContratadaFP ? {
      demandaContratadaFP: p.demandaContratadaFP,
      demandaMedidaMensal: dms.slice(0, 12),
      ...(demandaFaturadaFP ? { demandaFaturadaFP } : {}),
    } : {}),
  };
}

function defaultPlant(): Plant {
  return {
    id: generateId(),
    name: '',
    capacityKWac: 0,
    distributor: 'EMS',
    p50Profile: new Array(24).fill(0),
    useActual: false,
    ppaRateRsBRLkWh: 0.50,
    contractStartMonth: new Date().toISOString().slice(0, 7),
    contractMonths: 24,
  };
}

function defaultRateio(): RateioAllocation {
  return {
    periods: [
      { start: 0, end: 3, allocations: [] },
      { start: 4, end: 9, allocations: [] },
      { start: 10, end: 15, allocations: [] },
      { start: 16, end: 23, allocations: [] },
    ],
    isOptimised: false,
  };
}

/**
 * Group N parsed faturas by matrícula's UC number, keeping the most recent
 * fatura per UC.
 */
function dedupByUC(parsedList: ParsedFatura[]): ParsedFatura[] {
  const byKey = new Map<string, ParsedFatura>();
  for (const p of parsedList) {
    if (!p.ok) continue;
    // Key is the UC number (digits before first hyphen in matrícula, or ucNumero)
    const key = p.ucNumero || (p.ucMatricula?.split('-')[0] || `unknown-${Math.random()}`);
    const existing = byKey.get(key);
    // Prefer the parsed fatura with the most history rows; tiebreak by refMes.
    const score = (q: ParsedFatura) => q.history.length * 1000 + (q.refMes ? 1 : 0);
    if (!existing || score(p) > score(existing)) {
      byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

export interface ProjectBuildResult {
  project: Project;
  warnings: string[];
}

export function buildProjectFromFaturas(parsedList: ParsedFatura[], clientName: string): ProjectBuildResult {
  const warnings: string[] = [];
  const dedup = dedupByUC(parsedList);
  if (dedup.length === 0) {
    throw new Error('Nenhuma fatura válida foi parseada com sucesso.');
  }
  if (dedup.length < parsedList.length) {
    warnings.push(`${parsedList.length - dedup.length} faturas duplicadas (mesma UC) — mantendo apenas a mais recente por UC.`);
  }

  // Pick an A-class fatura as the base for distribuidora (richer tariff data); fall back to first.
  const base = dedup.find(p => /A[1-4]/.test(p.classificacao || '')) || dedup[0];
  const distributor = buildDistributorFromFatura(base);

  const ucs: ConsumptionUnit[] = dedup.map((p, idx) => buildUCFromFatura(p, `uc-${idx}`));

  const now = new Date().toISOString();
  const project: Project = {
    id: generateId(),
    clientName: clientName.trim() || (base.cnpj ? `Cliente ${base.cnpj}` : 'Cliente Importado'),
    distributor,
    plant: defaultPlant(),
    ucs,
    scenarios: {
      icmsExempt: true,
      competitorDiscount: 0,
      useActualGeneration: false,
    },
    rateio: defaultRateio(),
    growthRate: 0.025,
    generationDegradation: 0.005,
    performanceFactor: 1.0,
    createdAt: now,
    updatedAt: now,
  };

  return { project, warnings };
}
