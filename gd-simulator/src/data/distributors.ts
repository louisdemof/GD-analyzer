import type { Distributor } from '../engine/types';
import { computeDerivedTariffs } from '../engine/tariff';

// Bundled fallback list — used when ANEEL API is unreachable (rare).
// Tariffs are placeholders (0); the live ANEEL fetch in NewProject and
// DistributorForm overrides these. ICMS rates per state are accurate.
const ZERO_TARIFFS = { B_TUSD: 0, B_TE: 0, A_FP_TUSD_TE: 0, A_PT_TUSD_TE: 0, A_TE_FP: 0, A_TE_PT: 0 };

function mk(id: string, name: string, state: string, icms: number): Distributor {
  return {
    id, name, state,
    resolution: 'Bundled — atualize via ANEEL',
    tariffs: { ...ZERO_TARIFFS },
    taxes: { ICMS: icms, PIS: 0.0153, COFINS: 0.0703 },
  };
}

const RAW_DISTRIBUTORS: Distributor[] = [
  // Centro-Oeste
  { id: 'EMS', name: 'Energisa Mato Grosso do Sul', state: 'MS',
    resolution: 'Res. ANEEL 3.441/2025',
    tariffs: { B_TUSD: 0.59, B_TE: 0.29, A_FP_TUSD_TE: 0.399588, A_PT_TUSD_TE: 2.255909, A_TE_FP: 0.27, A_TE_PT: 0.45 },
    taxes: { ICMS: 0.17, PIS: 0.0153, COFINS: 0.0703 } },
  mk('EMT', 'Energisa Mato Grosso', 'MT', 0.17),
  mk('EQUATORIAL GO', 'Equatorial Goiás', 'GO', 0.14),
  mk('Neoenergia Brasília', 'Neoenergia Brasília', 'DF', 0.25),
  // Sudeste
  mk('CEMIG-D', 'CEMIG Distribuição', 'MG', 0.25),
  mk('DMED', 'DMED (MG)', 'MG', 0.25),
  mk('CPFL-PAULISTA', 'CPFL Paulista', 'SP', 0.18),
  mk('CPFL-PIRATINING', 'CPFL Piratininga', 'SP', 0.18),
  mk('CPFL Santa Cruz', 'CPFL Santa Cruz', 'SP', 0.18),
  mk('ELETROPAULO', 'Enel SP (ex-Eletropaulo)', 'SP', 0.18),
  mk('EDP SP', 'EDP São Paulo', 'SP', 0.18),
  mk('ELEKTRO', 'Elektro', 'SP', 0.18),
  mk('ENEL RJ', 'Enel Rio de Janeiro', 'RJ', 0.18),
  mk('LIGHT SESA', 'Light', 'RJ', 0.18),
  mk('EDP ES', 'EDP Espírito Santo', 'ES', 0.27),
  mk('ESS', 'ESS (ES)', 'ES', 0.27),
  // Sul
  mk('COPEL-DIS', 'Copel Distribuição', 'PR', 0.29),
  mk('CELESC', 'Celesc Distribuição', 'SC', 0.25),
  mk('CEEE-D', 'CEEE-D', 'RS', 0.25),
  mk('RGE', 'RGE Sul', 'RS', 0.25),
  // Nordeste
  mk('COELBA', 'Coelba (Bahia)', 'BA', 0.27),
  mk('Neoenergia PE', 'Neoenergia Pernambuco', 'PE', 0.29),
  mk('ENEL CE', 'Enel Ceará', 'CE', 0.25),
  mk('EQUATORIAL MA', 'Equatorial Maranhão', 'MA', 0.22),
  mk('EQUATORIAL PI', 'Equatorial Piauí', 'PI', 0.25),
  mk('EQUATORIAL AL', 'Equatorial Alagoas', 'AL', 0.25),
  mk('EPB', 'Energisa Paraíba', 'PB', 0.25),
  mk('COSERN', 'Cosern (RN)', 'RN', 0.25),
  mk('ESE', 'Energisa Sergipe', 'SE', 0.27),
  // Norte
  mk('EQUATORIAL PA', 'Equatorial Pará', 'PA', 0.25),
  mk('AME', 'Amazonas Energia', 'AM', 0.25),
  mk('CEA', 'CEA (Amapá)', 'AP', 0.25),
  mk('BOA VISTA', 'Boa Vista Energia (RR)', 'RR', 0.25),
  mk('EAC', 'Energisa Acre', 'AC', 0.17),
  mk('ERO', 'Energisa Rondônia', 'RO', 0.25),
  mk('ETO', 'Energisa Tocantins', 'TO', 0.25),
];

export const DISTRIBUTORS: Distributor[] = RAW_DISTRIBUTORS.map(computeDerivedTariffs);

export function getDistributorById(id: string): Distributor | undefined {
  return DISTRIBUTORS.find(d => d.id === id);
}
