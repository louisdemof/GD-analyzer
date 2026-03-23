import type { Distributor } from '../engine/types';
import { computeDerivedTariffs } from '../engine/tariff';

const RAW_DISTRIBUTORS: Distributor[] = [
  {
    id: 'EMS',
    name: 'Energisa Mato Grosso do Sul',
    state: 'MS',
    resolution: 'Res. ANEEL 3.441/2025',
    tariffs: {
      B_TUSD: 0.59,
      B_TE: 0.29,
      A_FP_TUSD_TE: 0.399588,
      A_PT_TUSD_TE: 2.255909,
      A_TE_FP: 0.27,
      A_TE_PT: 0.45,
    },
    taxes: { ICMS: 0.17, PIS: 0.0153, COFINS: 0.0703 },
  },
  {
    id: 'EQUATORIAL_GO',
    name: 'Equatorial Goiás',
    state: 'GO',
    resolution: 'Res. ANEEL 2024 — update from ANEEL SIGA',
    tariffs: { B_TUSD: 0.0, B_TE: 0.0, A_FP_TUSD_TE: 0.0, A_PT_TUSD_TE: 0.0, A_TE_FP: 0.0, A_TE_PT: 0.0 },
    taxes: { ICMS: 0.12, PIS: 0.0153, COFINS: 0.0703 },
  },
  {
    id: 'COPEL',
    name: 'COPEL Distribuição',
    state: 'PR',
    resolution: 'Res. ANEEL 2024 — update from ANEEL SIGA',
    tariffs: { B_TUSD: 0.0, B_TE: 0.0, A_FP_TUSD_TE: 0.0, A_PT_TUSD_TE: 0.0, A_TE_FP: 0.0, A_TE_PT: 0.0 },
    taxes: { ICMS: 0.29, PIS: 0.0153, COFINS: 0.0703 },
  },
  {
    id: 'ENEL_CE',
    name: 'Enel Ceará',
    state: 'CE',
    resolution: 'Res. ANEEL 2024 — update from ANEEL SIGA',
    tariffs: { B_TUSD: 0.0, B_TE: 0.0, A_FP_TUSD_TE: 0.0, A_PT_TUSD_TE: 0.0, A_TE_FP: 0.0, A_TE_PT: 0.0 },
    taxes: { ICMS: 0.25, PIS: 0.0153, COFINS: 0.0703 },
  },
  {
    id: 'EQUATORIAL_PA',
    name: 'Equatorial Pará',
    state: 'PA',
    resolution: 'Res. ANEEL 2024 — update from ANEEL SIGA',
    tariffs: { B_TUSD: 0.0, B_TE: 0.0, A_FP_TUSD_TE: 0.0, A_PT_TUSD_TE: 0.0, A_TE_FP: 0.0, A_TE_PT: 0.0 },
    taxes: { ICMS: 0.25, PIS: 0.0153, COFINS: 0.0703 },
  },
];

export const DISTRIBUTORS: Distributor[] = RAW_DISTRIBUTORS.map(computeDerivedTariffs);

export function getDistributorById(id: string): Distributor | undefined {
  return DISTRIBUTORS.find(d => d.id === id);
}
