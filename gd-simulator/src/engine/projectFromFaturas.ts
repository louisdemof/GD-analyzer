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
import { aneelToDistributor, type ANEELDistributor } from '../data/aneelService';
import bundledTariffs from '../data/aneel-tariffs.json';

// Build a distributor from the bundled ANEEL snapshot by SigAgente (e.g. 'COPEL-DIS').
// Used when faturas come from a distributor whose tariffs we have in ANEEL data rather
// than derived from the bill itself.
function distributorFromBundle(sig: string): Distributor | null {
  const src = (bundledTariffs.distributors as ANEELDistributor[]).find(d => d.sigAgente === sig);
  return src ? aneelToDistributor(src) : null;
}

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
    ...(rsv.some(v => v > 0) ? { consumptionReservado: rsv24 } : {}),
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

// Dedup key for a fatura: installation ADDRESS first (stable when the UC number changes across
// bills — e.g. REN 1095/24 renumbering: the same UC's March and April bills carry DIFFERENT
// numbers), then the UC number / matrícula. Random fallback = never dedups (un-identifiable bills).
export function faturaDedupKey(p: ParsedFatura): string {
  return p.ucEndereco || p.ucNumero || (p.ucMatricula?.split('-')[0] || `unknown-${Math.random()}`);
}
const latestMonth = (q: ParsedFatura) => q.history.reduce((mx, h) => (h.monthIso > mx ? h.monthIso : mx), '');
const shortAddr = (a?: string) => (a || '').replace(/\s+\d{8}$/, '').slice(0, 40).trim();

/**
 * "Monthly-snapshot" set: most bills carry a SINGLE month (Coelba/Neoenergia — 1 PDF = 1 mês).
 * Then the stable UC identity is the código da instalação (ucNumero) and we MERGE the months
 * across bills. Otherwise each bill carries its own 12-month history (Energisa/Equatorial/COPEL)
 * → dedup by installation address (survives REN 1095/24 renumbering) and keep the most recent.
 */
function isMonthlySnapshotSet(ok: ParsedFatura[]): boolean {
  return ok.length > 0 && ok.filter(p => p.history.length <= 1).length >= ok.length * 0.6;
}
function ucKey(p: ParsedFatura, monthly: boolean): string {
  const fallback = (p.ucMatricula?.split('-')[0]) || `unknown-${Math.random()}`;
  return monthly
    ? (p.ucNumero || p.ucEndereco || fallback)   // por número (código estável) quando 1 fatura = 1 mês
    : (p.ucEndereco || p.ucNumero || fallback);  // por endereço (sobrevive à renumeração) quando há histórico
}
export function faturaGroups(parsedList: ParsedFatura[]): Map<string, ParsedFatura[]> {
  const ok = parsedList.filter(p => p.ok);
  const monthly = isMonthlySnapshotSet(ok);
  const groups = new Map<string, ParsedFatura[]>();
  for (const p of ok) {
    const k = ucKey(p, monthly);
    const g = groups.get(k) ?? [];
    g.push(p);
    groups.set(k, g);
  }
  return groups;
}
/** Merge a UC's bills into ONE fatura whose history is the union of every month seen. */
function mergeGroup(g: ParsedFatura[]): ParsedFatura {
  const base = g.reduce((a, b) => (latestMonth(b) > latestMonth(a) ? b : a)); // freshest tariffs/classif
  const byMonth = new Map<string, ParsedFatura['history'][number]>();
  const olderFirst = [...g].sort((a, b) => latestMonth(a).localeCompare(latestMonth(b)));
  for (const f of olderFirst) for (const h of f.history) {
    if (h.consumoForaPonta > 0 || h.consumoPonta > 0) byMonth.set(h.monthIso, h); // newer overwrites
  }
  return { ...base, history: [...byMonth.values()].sort((a, b) => a.monthIso.localeCompare(b.monthIso)) };
}

/**
 * Collapse N parsed faturas into one fatura per UC, MERGING month histories across bills.
 */
export function dedupByUC(parsedList: ParsedFatura[]): ParsedFatura[] {
  return [...faturaGroups(parsedList).values()].map(mergeGroup);
}

export interface FaturaSetAnalysis {
  ucCount: number;      // distinct UCs after dedup
  warnings: string[];   // consolidation + REN 1095/24 renumbering notices
}

/**
 * Preview how a set of parsed faturas collapses into UCs, and explain consolidations —
 * in particular UC renumbering (REN 1095/24): same installation address, different UC numbers
 * across bills. Used both by the New Project screen (live preview) and buildProjectFromFaturas.
 */
export function analyzeFaturaSet(parsedList: ParsedFatura[]): FaturaSetAnalysis {
  const ok = parsedList.filter(p => p.ok);
  const monthly = isMonthlySnapshotSet(ok);
  const groups = faturaGroups(parsedList);
  const monthsIn = (g: ParsedFatura[]) => new Set(g.flatMap(f => f.history.map(h => h.monthIso))).size;
  const warnings: string[] = [];
  if (ok.length > groups.size) {
    if (monthly) {
      const maxM = Math.max(...[...groups.values()].map(monthsIn));
      warnings.push(`${ok.length} faturas mensais → ${groups.size} UC(s): os meses foram consolidados por unidade (até ${maxM} meses de histórico por UC).`);
    } else {
      warnings.push(`${ok.length} faturas → ${groups.size} UCs: faturas do mesmo ponto de consumo foram consolidadas (mantida a mais recente por UC).`);
    }
  }
  // REN 1095/24 renumbering só faz sentido para faturas COM histórico agrupadas por ENDEREÇO
  // e com nº de UC distinto. No modo mensal agrupamos por NÚMERO (código estável), então
  // endereços/nº distintos são só UCs diferentes — não emitir o aviso de renumeração.
  if (!monthly) {
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      // Só é renumeração se há 2+ números de UC REAIS distintos no mesmo endereço. Número
      // ausente em alguns meses (formato antigo pré-REN 1095 que o parser não extrai) NÃO
      // conta — senão dispara falso alarme quando o nº só falta em algumas faturas.
      const realNums = [...new Set(g.map(x => x.ucNumero).filter((n): n is string => !!n))];
      if (realNums.length > 1) {
        const kept = g.reduce((a, b) => (latestMonth(b) > latestMonth(a) ? b : a));
        warnings.push(`🔄 UC renumerada — REN 1095/24 (${shortAddr(kept.ucEndereco)}): o nº mudou entre as faturas (${realNums.join(' → ')}); consolidadas em 1 UC — nº atual ${kept.ucNumero || '—'}.`);
      }
    }
  }
  return { ucCount: groups.size, warnings };
}

export interface ProjectBuildResult {
  project: Project;
  warnings: string[];
}

export function buildProjectFromFaturas(parsedList: ParsedFatura[], clientName: string): ProjectBuildResult {
  const warnings: string[] = analyzeFaturaSet(parsedList).warnings;
  const dedup = dedupByUC(parsedList);
  if (dedup.length === 0) {
    throw new Error('Nenhuma fatura válida foi parseada com sucesso.');
  }

  // Pick an A-class fatura as the base for distribuidora (richer tariff data); fall back to first.
  const base = dedup.find(p => /A[1-4]/.test(p.classificacao || '')) || dedup[0];
  // If the fatura declares a known distributor (e.g. COPEL), use its ANEEL tariffs;
  // otherwise derive the distributor from the bill prices (Energisa path).
  const distributor = (base.distributorSig && distributorFromBundle(base.distributorSig))
    || buildDistributorFromFatura(base);

  const ucs: ConsumptionUnit[] = dedup.map((p, idx) => buildUCFromFatura(p, `uc-${idx}`));

  // Mercado: the bill's classification flags Livre/ACL. Pre-configure the ACL baseline with
  // incentivada I50 by default (most A4 Verde Livre clients are incentivada) — the energy
  // price (TE) comes from the supplier contract, not the distribution bill, so it stays a
  // placeholder for the user to set.
  const isACL = dedup.some(p => /Cliente Livre|\(ACL\)/i.test(p.classificacao || ''));
  // Incentivada level: use the stated discount % from the bill when present (CEMIG/Light),
  // rounded to the nearest standard level; otherwise default to I50.
  const statedPct = dedup.map(p => p.incentivadaLevelPct).find(v => v != null);
  const beneficio = dedup.map(p => p.incentivadaBeneficio).find(v => v != null);
  const level = statedPct != null
    ? [0.5, 0.8, 1.0].reduce((best, l) => Math.abs(l - statedPct!) < Math.abs(best - statedPct!) ? l : best, 0.5)
    : 0.5;

  const now = new Date().toISOString();
  const project: Project = {
    id: generateId(),
    clientName: clientName.trim() || (base.cnpj ? `Cliente ${base.cnpj}` : 'Cliente Importado'),
    distributor,
    plant: { ...defaultPlant(), distributor: distributor.id },
    ucs,
    marketType: isACL ? 'ACL' : 'CATIVO',
    aclBaseline: isACL ? {
      energyPriceSemImp: 0.300,
      energyIndexation: 'FIXO',
      tusdDiscountConsumo: 0,
      tusdDiscountConsumoPT: 0,
      tusdDiscountDemanda: 0,
      incentivadaLevel: level,
    } : undefined,
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

  if (isACL) {
    const lvlLabel = `I${Math.round(level * 100)}`;
    const src = statedPct != null
      ? `nível ${lvlLabel} detectado da fatura (desconto declarado ${(statedPct * 100).toFixed(1)}%)`
      : `nível ${lvlLabel} por padrão — confirme (I50/I80/I100)`;
    const ben = beneficio != null ? ` Benefício informado na fatura: R$ ${beneficio.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} (use para conferir).` : '';
    warnings.push(`Importado como ACL (Mercado Livre), ${src}. Informe o preço da energia (TE, R$/MWh) do contrato.${ben}`);
  }

  return { project, warnings };
}
