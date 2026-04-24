import type { Distributor } from '../engine/types';
import { computeDerivedTariffs } from '../engine/tariff';
import bundledTariffs from './aneel-tariffs.json';

// --- ICMS by state (state legislation, not ANEEL) ---
export const ICMS_BY_STATE: Record<string, number> = {
  AC: 0.17, AL: 0.25, AM: 0.25, AP: 0.25, BA: 0.27,
  CE: 0.25, DF: 0.25, ES: 0.27, GO: 0.14, MA: 0.22,
  MG: 0.25, MS: 0.17, MT: 0.17, PA: 0.25, PB: 0.25,
  PE: 0.29, PI: 0.25, PR: 0.29, RJ: 0.18, RN: 0.25,
  RO: 0.25, RR: 0.25, RS: 0.25, SC: 0.25, SE: 0.27,
  SP: 0.18, TO: 0.25,
};

export const DEFAULT_PIS = 0.0153;
export const DEFAULT_COFINS = 0.0703;

// Desconto irrigante/aquicultor no horário reservado (REN 1000 Art. 186).
// Percentuais pelo Submercado / Região — aplicados sobre a tarifa FP/B base.
// Centro-Oeste (MS/MT/GO/DF): 80% Grupo A, 67% Grupo B.
// Outras regiões podem ter percentuais diferentes — valores podem ser ajustados manualmente.
const RURAL_IRRIGANTE_REGIONS: Record<string, { grupoA: number; grupoB: number }> = {
  // Centro-Oeste
  MS: { grupoA: 0.80, grupoB: 0.67 },
  MT: { grupoA: 0.80, grupoB: 0.67 },
  GO: { grupoA: 0.80, grupoB: 0.67 },
  DF: { grupoA: 0.80, grupoB: 0.67 },
  // Outras regiões — percentuais típicos, confirmar com a distribuidora:
  // Sul/Sudeste: ~73% A / 60% B; Norte/Nordeste: ~70% A / 60% B
};

/**
 * Retorna os percentuais de desconto do horário reservado para um estado,
 * ou null se o estado não tiver percentuais cadastrados (usuário preenche manualmente).
 */
export function getRuralIrriganteDiscount(state: string): { grupoA: number; grupoB: number } | null {
  return RURAL_IRRIGANTE_REGIONS[state] ?? null;
}

/**
 * Calcula as tarifas do horário reservado (TUSD+TE, sem tributos) a partir
 * das tarifas base FP/B e do desconto aplicável à região.
 */
export function computeReservadoTariffs(
  A_FP_TUSD_TE: number,
  B_TUSD_plus_TE: number,
  state: string,
): { A_RSV_TUSD_TE: number; B_RSV_TUSD_TE: number } | null {
  const disc = getRuralIrriganteDiscount(state);
  if (!disc) return null;
  return {
    A_RSV_TUSD_TE: A_FP_TUSD_TE * (1 - disc.grupoA),
    B_RSV_TUSD_TE: B_TUSD_plus_TE * (1 - disc.grupoB),
  };
}

// --- Concessionárias: SigAgente → state mapping ---
// Only main concessionárias (not permissionárias/cooperatives).
// Agents not listed here are filtered out of the dropdown.
const CONCESSIONARIAS: Record<string, string> = {
  // Norte
  AME: 'AM', 'BOA VISTA': 'RR', CEA: 'AP',
  EAC: 'AC', ERO: 'RO', ETO: 'TO',
  'EQUATORIAL PA': 'PA',
  // Nordeste
  'ENEL CE': 'CE', 'EQUATORIAL MA': 'MA', 'EQUATORIAL PI': 'PI',
  'EQUATORIAL AL': 'AL', EPB: 'PB', COSERN: 'RN',
  'Neoenergia PE': 'PE', COELBA: 'BA', ESE: 'SE',
  // Centro-Oeste
  EMT: 'MT', EMS: 'MS', EMR: 'MS',
  'EQUATORIAL GO': 'GO', 'Neoenergia Brasília': 'DF',
  // Sudeste
  'CEMIG-D': 'MG', DMED: 'MG',
  'EDP ES': 'ES', ESS: 'ES',
  'ENEL RJ': 'RJ', 'LIGHT SESA': 'RJ',
  ELETROPAULO: 'SP', 'EDP SP': 'SP', ELEKTRO: 'SP',
  'CPFL-PAULISTA': 'SP', 'CPFL-PIRATINING': 'SP', 'CPFL Santa Cruz': 'SP',
  // Aliases for different SigAgente formats
  'CPFL PAULISTA': 'SP', 'CPFL PIRATININGA': 'SP', 'CPFL SANTA CRUZ': 'SP',
  // Sul
  'COPEL-DIS': 'PR', COPEL: 'PR',
  CELESC: 'SC',
  'CEEE-D': 'RS', RGE: 'RS',
};

// Legacy alias mapping (old names → new names in ANEEL data)
const AGENT_STATE: Record<string, string> = {
  ...CONCESSIONARIAS,
  // Additional aliases for backward compatibility with existing projects
  CPFL: 'SP', 'CPFL JAGUARI': 'SP', 'CPFL LESTE PAULISTA': 'SP',
  'CPFL MOCOCA': 'SP', 'CPFL SUL PAULISTA': 'SP',
  EBO: 'BA', EDEVP: 'SP', EEB: 'SP', ENF: 'RJ',
  EFLJC: 'SC', EFLUL: 'SC', ELETROCAR: 'RS', ELFSM: 'RS',
  HIDROPAN: 'RS', MUXENERGIA: 'RS', 'RGE SUL': 'RS',
  SULGIPE: 'SE', UHENPAL: 'RS', COCEL: 'PR',
  CELPE: 'PE', CEMAR: 'MA', CEAL: 'AL', CEPISA: 'PI', CELPA: 'PA',
};

// --- Types ---
interface ANEELRecord {
  SigAgente: string;
  DscREH: string;
  DscSubGrupo: string;
  DscModalidadeTarifaria: string;
  DscDetalhe: string;
  DscUnidadeTerciaria: string;
  NomPostoTarifario: string;
  VlrTUSD: string;
  VlrTE: string;
  DatInicioVigencia: string;
  DatFimVigencia: string | null;
}

export interface ANEELDistributor {
  sigAgente: string;
  state: string;
  resolution: string;
  B_TUSD: number;
  B_TE: number;
  A_FP_TUSD_TE: number;
  A_PT_TUSD_TE: number;
  A_TE_FP: number;
  A_TE_PT: number;
  // Demanda Grupo A Verde Fora Ponta — R$/kW/mês sem tributos (only TUSD is charged; TE not applicable for demanda)
  A_FP_DEMANDA?: number;
}

interface CacheEntry {
  distributors: ANEELDistributor[];
  fetchedAt: string;
}

const CACHE_KEY = 'aneel_tariffs_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const RESOURCE_ID = 'fcf2906c-7c32-4b9b-a637-054e7a5234f4';

// SQL query: get B3 Convencional + A4 Verde tariffs (energy MWh + demanda kW),
// "Tarifa de Aplicação", only "Não se aplica" detail (excludes SCEE/APE),
// from 2024 onwards, sorted by agent + latest date first
const SQL = `SELECT "SigAgente", "DscREH", "DscSubGrupo", "DscModalidadeTarifaria", "DscUnidadeTerciaria", "NomPostoTarifario", "VlrTUSD", "VlrTE", "DatInicioVigencia" FROM "${RESOURCE_ID}" WHERE "DscBaseTarifaria"='Tarifa de Aplicação' AND "DscDetalhe"='Não se aplica' AND (("DscUnidadeTerciaria"='MWh' AND (("DscSubGrupo"='B3' AND "DscModalidadeTarifaria"='Convencional') OR ("DscSubGrupo"='A4' AND "DscModalidadeTarifaria"='Verde'))) OR ("DscUnidadeTerciaria"='kW' AND "DscSubGrupo"='A4' AND "DscModalidadeTarifaria"='Verde')) AND "DatInicioVigencia" >= '2024-01-01' ORDER BY "SigAgente", "DatInicioVigencia" DESC`;

// --- Cache ---
function getCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - new Date(entry.fetchedAt).getTime() > CACHE_TTL_MS) return null;
    return entry;
  } catch { return null; }
}

function setCache(entry: CacheEntry): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch { /* full */ }
}

export function getCacheFetchedAt(): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as CacheEntry).fetchedAt;
  } catch { return null; }
}

export function clearCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

// --- Fetch ---
function parseNumberMWh(val: string): number {
  // ANEEL returns "592,08" format (R$/MWh, comma decimal)
  const n = parseFloat(val.replace('.', '').replace(',', '.'));
  return isNaN(n) ? 0 : n / 1000; // Convert R$/MWh → R$/kWh
}
function parseNumberKW(val: string): number {
  // Demanda tariff comes in R$/kW already — no scaling
  const n = parseFloat(val.replace('.', '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

async function fetchSQL(baseUrl: string): Promise<ANEELRecord[]> {
  const url = `${baseUrl}?sql=${encodeURIComponent(SQL)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.success || !json.result?.records) throw new Error('Invalid response');
  return json.result.records;
}

function parseRecords(records: ANEELRecord[]): ANEELDistributor[] {
  // Group by SigAgente — records are sorted by agent + date desc,
  // so first occurrence per agent+subgroup+posto is the latest
  const agents = new Map<string, {
    resolution: string;
    B_TUSD: number; B_TE: number;
    A_FP_TUSD: number; A_FP_TE: number;
    A_PT_TUSD: number; A_PT_TE: number;
    A_FP_DEMANDA: number;
    seen: Set<string>;
  }>();

  for (const r of records) {
    const sig = r.SigAgente;
    if (!agents.has(sig)) {
      agents.set(sig, {
        resolution: r.DscREH || '',
        B_TUSD: 0, B_TE: 0,
        A_FP_TUSD: 0, A_FP_TE: 0,
        A_PT_TUSD: 0, A_PT_TE: 0,
        A_FP_DEMANDA: 0,
        seen: new Set(),
      });
    }
    const a = agents.get(sig)!;

    const isDemanda = r.DscUnidadeTerciaria === 'kW';
    // Dedup key: subgroup + posto + unit — take only first (latest date) per combo
    const key = `${r.DscSubGrupo}|${r.NomPostoTarifario}|${r.DscUnidadeTerciaria}`;
    if (a.seen.has(key)) continue;
    a.seen.add(key);

    if (isDemanda) {
      // Demanda: only interested in A4 Verde Fora Ponta. Verde has a single FP demanda.
      const posto = r.NomPostoTarifario.toLowerCase();
      if (r.DscSubGrupo === 'A4' && (posto.includes('fora') || posto === 'não se aplica')) {
        // TUSD holds the demanda value for Verde (TE typically zero for demanda)
        a.A_FP_DEMANDA = parseNumberKW(r.VlrTUSD) + parseNumberKW(r.VlrTE);
      }
      continue;
    }

    const tusd = parseNumberMWh(r.VlrTUSD);
    const te = parseNumberMWh(r.VlrTE);

    if (r.DscSubGrupo === 'B3') {
      a.B_TUSD = tusd;
      a.B_TE = te;
    } else if (r.DscSubGrupo === 'A4') {
      const posto = r.NomPostoTarifario.toLowerCase();
      if (posto.includes('fora')) {
        a.A_FP_TUSD = tusd;
        a.A_FP_TE = te;
      } else if (posto === 'ponta' || (posto.includes('ponta') && !posto.includes('fora'))) {
        a.A_PT_TUSD = tusd;
        a.A_PT_TE = te;
      }
    }
  }

  const result: ANEELDistributor[] = [];
  for (const [sig, a] of agents) {
    // Only include concessionárias (skip permissionárias/cooperatives)
    if (!CONCESSIONARIAS[sig]) continue;
    result.push({
      sigAgente: sig,
      state: CONCESSIONARIAS[sig],
      resolution: a.resolution,
      B_TUSD: a.B_TUSD,
      B_TE: a.B_TE,
      A_FP_TUSD_TE: a.A_FP_TUSD + a.A_FP_TE,
      A_PT_TUSD_TE: a.A_PT_TUSD + a.A_PT_TE,
      A_TE_FP: a.A_FP_TE,
      A_TE_PT: a.A_PT_TE,
      A_FP_DEMANDA: a.A_FP_DEMANDA > 0 ? a.A_FP_DEMANDA : undefined,
    });
  }

  result.sort((a, b) => a.sigAgente.localeCompare(b.sigAgente));
  return result;
}

export async function fetchANEELTariffs(forceRefresh = false): Promise<{
  distributors: ANEELDistributor[];
  fromCache: boolean;
  fetchedAt: string;
  error?: string;
}> {
  if (!forceRefresh) {
    const cached = getCache();
    if (cached) {
      return { distributors: cached.distributors, fromCache: true, fetchedAt: cached.fetchedAt };
    }
  }

  // Try: 1) Vite dev proxy (SQL endpoint), 2) direct, 3) CORS proxy
  const urls = [
    '/api/aneel/datastore_search_sql',
    'https://dadosabertos.aneel.gov.br/api/3/action/datastore_search_sql',
    'https://corsproxy.io/?' + encodeURIComponent('https://dadosabertos.aneel.gov.br/api/3/action/datastore_search_sql'),
  ];

  let records: ANEELRecord[] | null = null;
  for (const url of urls) {
    try {
      records = await fetchSQL(url);
      break;
    } catch { /* try next */ }
  }

  if (records && records.length > 0) {
    const distributors = parseRecords(records);
    const fetchedAt = new Date().toISOString();
    setCache({ distributors, fetchedAt });
    return { distributors, fromCache: false, fetchedAt };
  }

  // Expired cache fallback
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const entry: CacheEntry = JSON.parse(raw);
      return {
        distributors: entry.distributors,
        fromCache: true,
        fetchedAt: entry.fetchedAt,
        error: 'ANEEL API indisponível — usando dados em cache',
      };
    }
  } catch { /* empty */ }

  // Bundled fallback — pre-fetched tariff snapshot included in the build
  return loadBundledTariffs();
}

function loadBundledTariffs(): {
  distributors: ANEELDistributor[];
  fromCache: boolean;
  fetchedAt: string;
  error?: string;
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bundled = bundledTariffs as { fetchedAt: string; distributors: ANEELDistributor[] };
    if (bundled.distributors.length > 0) {
      return {
        distributors: bundled.distributors,
        fromCache: true,
        fetchedAt: bundled.fetchedAt,
        error: `Usando tarifas pré-carregadas (${new Date(bundled.fetchedAt).toLocaleDateString('pt-BR')})`,
      };
    }
  } catch { /* empty */ }

  return {
    distributors: [],
    fromCache: false,
    fetchedAt: '',
    error: 'ANEEL API indisponível — usando distribuidoras pré-cadastradas',
  };
}

// --- Convert to Distributor type ---
export function aneelToDistributor(aneel: ANEELDistributor): Distributor {
  const icms = ICMS_BY_STATE[aneel.state] ?? 0.25;
  return computeDerivedTariffs({
    id: aneel.sigAgente,
    name: aneel.sigAgente, // Will be displayed alongside state
    state: aneel.state,
    resolution: aneel.resolution,
    tariffs: {
      B_TUSD: aneel.B_TUSD,
      B_TE: aneel.B_TE,
      A_FP_TUSD_TE: aneel.A_FP_TUSD_TE,
      A_PT_TUSD_TE: aneel.A_PT_TUSD_TE,
      A_TE_FP: aneel.A_TE_FP,
      A_TE_PT: aneel.A_TE_PT,
      ...(aneel.A_FP_DEMANDA !== undefined ? { A_FP_DEMANDA: aneel.A_FP_DEMANDA } : {}),
    },
    taxes: { ICMS: icms, PIS: DEFAULT_PIS, COFINS: DEFAULT_COFINS },
  });
}
