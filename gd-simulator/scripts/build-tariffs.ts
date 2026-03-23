// Parse raw ANEEL API response into compact pre-processed tariff data
// Only includes concessionárias (not permissionárias/cooperatives)
import { readFileSync, writeFileSync } from 'fs';

const raw = JSON.parse(readFileSync('src/data/aneel-tariffs-raw.json', 'utf8'));
const records = raw.result.records;

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

function parseNumber(val: string): number {
  const n = parseFloat(val.replace('.', '').replace(',', '.'));
  return isNaN(n) ? 0 : n / 1000;
}

const agents = new Map<string, {
  resolution: string;
  B_TUSD: number; B_TE: number;
  A_FP_TUSD: number; A_FP_TE: number;
  A_PT_TUSD: number; A_PT_TE: number;
  seen: Set<string>;
}>();

for (const r of records) {
  const sig = r.SigAgente;
  if (!CONCESSIONARIAS[sig]) continue; // Skip permissionárias
  if (!agents.has(sig)) {
    agents.set(sig, {
      resolution: r.DscREH || '',
      B_TUSD: 0, B_TE: 0,
      A_FP_TUSD: 0, A_FP_TE: 0,
      A_PT_TUSD: 0, A_PT_TE: 0,
      seen: new Set(),
    });
  }
  const a = agents.get(sig)!;
  const key = `${r.DscSubGrupo}|${r.NomPostoTarifario}`;
  if (a.seen.has(key)) continue;
  a.seen.add(key);
  const tusd = parseNumber(r.VlrTUSD);
  const te = parseNumber(r.VlrTE);
  if (r.DscSubGrupo === 'B3') {
    a.B_TUSD = tusd; a.B_TE = te;
  } else if (r.DscSubGrupo === 'A4') {
    const posto = r.NomPostoTarifario.toLowerCase();
    if (posto.includes('fora')) { a.A_FP_TUSD = tusd; a.A_FP_TE = te; }
    else if (posto === 'ponta' || (posto.includes('ponta') && !posto.includes('fora'))) {
      a.A_PT_TUSD = tusd; a.A_PT_TE = te;
    }
  }
}

const result = [];
for (const [sig, a] of agents) {
  result.push({
    sigAgente: sig,
    state: CONCESSIONARIAS[sig],
    resolution: a.resolution,
    B_TUSD: +a.B_TUSD.toFixed(6),
    B_TE: +a.B_TE.toFixed(6),
    A_FP_TUSD_TE: +(a.A_FP_TUSD + a.A_FP_TE).toFixed(6),
    A_PT_TUSD_TE: +(a.A_PT_TUSD + a.A_PT_TE).toFixed(6),
    A_TE_FP: +a.A_FP_TE.toFixed(6),
    A_TE_PT: +a.A_PT_TE.toFixed(6),
  });
}
result.sort((a, b) => a.sigAgente.localeCompare(b.sigAgente));

const output = {
  fetchedAt: new Date().toISOString(),
  distributors: result,
};

writeFileSync('src/data/aneel-tariffs.json', JSON.stringify(output, null, 2));
console.log(`Wrote ${result.length} concessionárias to src/data/aneel-tariffs.json`);
