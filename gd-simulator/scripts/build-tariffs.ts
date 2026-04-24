// Parse ANEEL API tariffs into compact pre-processed JSON bundled with the app.
// Only includes concessionárias (skips permissionárias/cooperatives).
// Fetches directly from ANEEL's datastore_search_sql API — no manual raw file needed.
// Matches parseRecords() logic in src/data/aneelService.ts to keep bundled and
// runtime-fetched data structurally identical (including A_FP_DEMANDA).
import { writeFileSync } from 'fs';

const RESOURCE_ID = 'fcf2906c-7c32-4b9b-a637-054e7a5234f4';

const SQL = `SELECT "SigAgente", "DscREH", "DscSubGrupo", "DscModalidadeTarifaria", "DscUnidadeTerciaria", "NomPostoTarifario", "VlrTUSD", "VlrTE", "DatInicioVigencia" FROM "${RESOURCE_ID}" WHERE "DscBaseTarifaria"='Tarifa de Aplicação' AND "DscDetalhe"='Não se aplica' AND (("DscUnidadeTerciaria"='MWh' AND (("DscSubGrupo"='B3' AND "DscModalidadeTarifaria"='Convencional') OR ("DscSubGrupo"='A4' AND "DscModalidadeTarifaria"='Verde'))) OR ("DscUnidadeTerciaria"='kW' AND "DscSubGrupo"='A4' AND "DscModalidadeTarifaria"='Verde')) AND "DatInicioVigencia" >= '2024-01-01' ORDER BY "SigAgente", "DatInicioVigencia" DESC`;

const API_URL = 'https://dadosabertos.aneel.gov.br/api/3/action/datastore_search_sql';

// Concessionárias only — must match CONCESSIONARIAS in aneelService.ts
const CONCESSIONARIAS: Record<string, string> = {
  AME: 'AM', 'BOA VISTA': 'RR', CEA: 'AP',
  EAC: 'AC', ERO: 'RO', ETO: 'TO',
  'EQUATORIAL PA': 'PA',
  'ENEL CE': 'CE', 'EQUATORIAL MA': 'MA', 'EQUATORIAL PI': 'PI',
  'EQUATORIAL AL': 'AL', EPB: 'PB', COSERN: 'RN',
  'Neoenergia PE': 'PE', COELBA: 'BA', ESE: 'SE',
  EMT: 'MT', EMS: 'MS', EMR: 'MS',
  'EQUATORIAL GO': 'GO', 'Neoenergia Brasília': 'DF',
  'CEMIG-D': 'MG', DMED: 'MG',
  'EDP ES': 'ES', ESS: 'ES',
  'ENEL RJ': 'RJ', 'LIGHT SESA': 'RJ',
  ELETROPAULO: 'SP', 'EDP SP': 'SP', ELEKTRO: 'SP',
  'CPFL-PAULISTA': 'SP', 'CPFL-PIRATINING': 'SP', 'CPFL Santa Cruz': 'SP',
  'CPFL PAULISTA': 'SP', 'CPFL PIRATININGA': 'SP', 'CPFL SANTA CRUZ': 'SP',
  'COPEL-DIS': 'PR', COPEL: 'PR',
  CELESC: 'SC',
  'CEEE-D': 'RS', RGE: 'RS',
};

interface RawRecord {
  SigAgente: string;
  DscREH: string;
  DscSubGrupo: string;
  DscModalidadeTarifaria: string;
  DscUnidadeTerciaria: string;
  NomPostoTarifario: string;
  VlrTUSD: string;
  VlrTE: string;
  DatInicioVigencia: string;
}

function parseNumberMWh(val: string): number {
  const n = parseFloat((val || '').replace('.', '').replace(',', '.'));
  return isNaN(n) ? 0 : n / 1000; // R$/MWh → R$/kWh
}

function parseNumberKW(val: string): number {
  const n = parseFloat((val || '').replace('.', '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

async function fetchRecords(): Promise<RawRecord[]> {
  const url = `${API_URL}?sql=${encodeURIComponent(SQL)}`;
  console.log('Fetching from ANEEL API...');
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as { success: boolean; result: { records: RawRecord[] } };
  if (!json.success) throw new Error('ANEEL API returned success=false');
  const recs = json.result.records;
  console.log(`Got ${recs.length} records`);
  return recs;
}

async function main() {
  const records = await fetchRecords();

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
    if (!CONCESSIONARIAS[sig]) continue;
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
    const key = `${r.DscSubGrupo}|${r.NomPostoTarifario}|${r.DscUnidadeTerciaria}`;
    if (a.seen.has(key)) continue;
    a.seen.add(key);

    if (isDemanda) {
      // Demanda A4 Verde FP — posto is typically "Não se aplica" for Verde
      const posto = r.NomPostoTarifario.toLowerCase();
      if (r.DscSubGrupo === 'A4' && (posto.includes('fora') || posto === 'não se aplica')) {
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

  const result: Array<Record<string, unknown>> = [];
  for (const [sig, a] of agents) {
    const entry: Record<string, unknown> = {
      sigAgente: sig,
      state: CONCESSIONARIAS[sig],
      resolution: a.resolution,
      B_TUSD: +a.B_TUSD.toFixed(6),
      B_TE: +a.B_TE.toFixed(6),
      A_FP_TUSD_TE: +(a.A_FP_TUSD + a.A_FP_TE).toFixed(6),
      A_PT_TUSD_TE: +(a.A_PT_TUSD + a.A_PT_TE).toFixed(6),
      A_TE_FP: +a.A_FP_TE.toFixed(6),
      A_TE_PT: +a.A_PT_TE.toFixed(6),
    };
    if (a.A_FP_DEMANDA > 0) entry.A_FP_DEMANDA = +a.A_FP_DEMANDA.toFixed(4);
    result.push(entry);
  }
  result.sort((a, b) => (a.sigAgente as string).localeCompare(b.sigAgente as string));

  const withDemanda = result.filter(r => 'A_FP_DEMANDA' in r).length;
  const output = { fetchedAt: new Date().toISOString(), distributors: result };
  writeFileSync('src/data/aneel-tariffs.json', JSON.stringify(output, null, 2));
  console.log(`Wrote ${result.length} concessionárias (${withDemanda} with A_FP_DEMANDA) to src/data/aneel-tariffs.json`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
