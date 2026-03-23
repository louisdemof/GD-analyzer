import type { Distributor } from './types';

/**
 * Compute all-in tariff (com tributos) from sem-tributos value.
 * Formula: T_com = T_sem / ((1 - PIS - COFINS) * (1 - ICMS))
 */
export function computeAllInTariff(
  semTariff: number,
  taxes: Distributor['taxes']
): number {
  return semTariff / ((1 - taxes.PIS - taxes.COFINS) * (1 - taxes.ICMS));
}

/**
 * Fator de Ajuste: ratio of energy-only tariff components.
 * FA = TE_FP / TE_PT
 */
export function computeFA(te_fp: number, te_pt: number): number {
  if (te_pt === 0) return 0;
  return te_fp / te_pt;
}

/**
 * ICMS embedded per kWh (for risk scenario when isenção is lost).
 * ICMS_per_kWh = T_com * ICMS / (1 + ICMS)
 */
export function computeICMSPerKWh(allInTariff: number, icmsRate: number): number {
  return allInTariff * icmsRate / (1 + icmsRate);
}

/**
 * Compute all derived tariff fields for a distributor.
 * Returns a new Distributor with FA, T_B3, T_AFP, T_APT populated.
 */
export function computeDerivedTariffs(dist: Distributor): Distributor {
  const FA = computeFA(dist.tariffs.A_TE_FP, dist.tariffs.A_TE_PT);
  const T_B3 = computeAllInTariff(
    dist.tariffs.B_TUSD + dist.tariffs.B_TE,
    dist.taxes
  );
  const T_AFP = computeAllInTariff(dist.tariffs.A_FP_TUSD_TE, dist.taxes);
  const T_APT = computeAllInTariff(dist.tariffs.A_PT_TUSD_TE, dist.taxes);

  return {
    ...dist,
    FA,
    T_B3,
    T_AFP,
    T_APT,
  };
}
