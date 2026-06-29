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
 * PIS+COFINS embedded per kWh (for the case when federal exemption doesn't apply).
 * Mirrors computeICMSPerKWh's "por fora extraction" convention so the leak math
 * stays consistent with the ICMS additional formula already used elsewhere.
 */
export function computePisCofinsPerKWh(
  allInTariff: number,
  pisRate: number,
  cofinsRate: number,
): number {
  const r = pisRate + cofinsRate;
  if (r <= 0) return 0;
  return allInTariff * r / (1 + r);
}

/**
 * Energia incentivada TUSD discounts, derived per UC modalidade (Verde/Azul) from the
 * distributor's TUSD tariffs — per Lei 9.427/96 art.26 §1º + ANEEL "Cálculo do Desconto
 * Aplicado à TUSD/TUST". All values are fractions of the sem-impostos TUSD base.
 *   Verde: fora-ponta energy NOT discounted (it's the floor); ponta gets the discount on the
 *          (Ponta − FP) premium → efetivo = level × (1 − TUSD_FP/TUSD_PT); demanda = level.
 *   Azul:  energy (ponta & FP) NOT discounted; demanda (ponta & FP) = level.
 * The FP/PT ratio is invariant to the tax gross-up, so all-in TUSD tariffs are fine here.
 */
export function incentivadaDiscounts(
  level: number, isAzul: boolean, tusdFP: number, tusdPT: number,
): { consumoFP: number; consumoPT: number; demanda: number } {
  if (!level || level <= 0) return { consumoFP: 0, consumoPT: 0, demanda: 0 };
  if (isAzul) return { consumoFP: 0, consumoPT: 0, demanda: level };
  const consumoPT = tusdPT > 0 ? level * (1 - tusdFP / tusdPT) : 0;
  return { consumoFP: 0, consumoPT, demanda: level };
}

/**
 * Compute all derived tariff fields for a distributor.
 * Returns a new Distributor with FA, T_B3, T_AFP, T_APT and the TUSD-only
 * variants (T_AFP_TUSD, T_APT_TUSD, T_B3_TUSD) populated. The TUSD-only
 * tariffs are used when distributor.taxes.icmsScope === 'TE_ONLY': isenção
 * cobre só TE, então o leak de ICMS no kWh compensado é calculado sobre TUSD.
 */
export function computeDerivedTariffs(dist: Distributor): Distributor {
  const FA = computeFA(dist.tariffs.A_TE_FP, dist.tariffs.A_TE_PT);
  const T_B3 = computeAllInTariff(
    dist.tariffs.B_TUSD + dist.tariffs.B_TE,
    dist.taxes
  );
  const T_AFP = computeAllInTariff(dist.tariffs.A_FP_TUSD_TE, dist.taxes);
  const T_APT = computeAllInTariff(dist.tariffs.A_PT_TUSD_TE, dist.taxes);
  const T_ARSV = dist.tariffs.A_RSV_TUSD_TE
    ? computeAllInTariff(dist.tariffs.A_RSV_TUSD_TE, dist.taxes)
    : undefined;
  const T_BRSV = dist.tariffs.B_RSV_TUSD_TE
    ? computeAllInTariff(dist.tariffs.B_RSV_TUSD_TE, dist.taxes)
    : undefined;
  const T_A_DEMANDA = dist.tariffs.A_FP_DEMANDA
    ? computeAllInTariff(dist.tariffs.A_FP_DEMANDA, dist.taxes)
    : undefined;

  // TUSD-only sem-tributos = (TUSD+TE) − TE. ANEEL feed already gives TE separately.
  const A_FP_TUSD_only = Math.max(0, dist.tariffs.A_FP_TUSD_TE - dist.tariffs.A_TE_FP);
  const A_PT_TUSD_only = Math.max(0, dist.tariffs.A_PT_TUSD_TE - dist.tariffs.A_TE_PT);
  const T_AFP_TUSD = computeAllInTariff(A_FP_TUSD_only, dist.taxes);
  const T_APT_TUSD = computeAllInTariff(A_PT_TUSD_only, dist.taxes);
  const T_B3_TUSD = computeAllInTariff(dist.tariffs.B_TUSD, dist.taxes);

  return {
    ...dist,
    FA,
    T_B3,
    T_AFP,
    T_APT,
    T_ARSV,
    T_BRSV,
    T_A_DEMANDA,
    T_AFP_TUSD,
    T_APT_TUSD,
    T_B3_TUSD,
  };
}
