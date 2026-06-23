// Tariff group
export type TariffGroup = 'B1' | 'B2' | 'B3' | 'A4_VERDE' | 'A4_AZUL' | 'A3A' | 'A3A_VERDE' | 'A3A_AZUL' | 'A3' | 'A3_VERDE' | 'A3_AZUL' | 'A2' | 'A2_VERDE' | 'A2_AZUL' | 'A1' | 'A1_VERDE' | 'A1_AZUL';

// A distributor with its tariff structure
export interface Distributor {
  id: string;
  name: string;           // e.g. "Energisa Mato Grosso do Sul"
  state: string;          // e.g. "MS"
  resolution: string;     // e.g. "Res. ANEEL 3.441/2025"
  tariffs: {
    // All values in R$/kWh, WITHOUT taxes
    B_TUSD: number;       // TUSD Grupo B
    B_TE: number;         // TE Grupo B
    A_FP_TUSD_TE: number; // TUSD+TE Grupo A Fora Ponta
    A_PT_TUSD_TE: number; // TUSD+TE Grupo A Ponta
    A_TE_FP: number;      // TE only FP (for FA calculation)
    A_TE_PT: number;      // TE only Ponta (for FA calculation)
    // Horário Reservado (REN 1000 Art. 186). Reservado = posto Fora Ponta com desconto
    // irrigante/aquicultor (Centro-Oeste: 80% Grupo A, 67% Grupo B). Same posto as FP for
    // SCEE compensation; only tariff differs. Optional — set only for rural irrigante UCs.
    A_RSV_TUSD_TE?: number; // TUSD+TE Grupo A no horário reservado
    B_RSV_TUSD_TE?: number; // TUSD+TE Grupo B no horário reservado
    // Demanda Grupo A Verde — charged monthly on demanda contratada (R$/kW). Not
    // compensated by SCEE: same value in SEM and COM scenarios (cancels in economia,
    // but makes the absolute SEM/COM numbers match the fatura).
    A_FP_DEMANDA?: number;  // tarifa demanda FP (R$/kW/mês, sem tributos)
  };
  taxes: {
    ICMS: number;         // e.g. 0.17
    PIS: number;          // e.g. 0.0153
    COFINS: number;       // e.g. 0.0703
    // Escopo da isenção de ICMS sobre kWh compensado (Lei 14.300/22 + convênio ICMS estadual).
    //   'TE_TUSD' (default, retrocompat): isenção cobre TE+TUSD → SCEE elimina toda a parcela de ICMS.
    //   'TE_ONLY': isenção apenas sobre TE → ICMS sobre TUSD-Fio B continua sendo cobrado na fatura
    //              da energia compensada. Comum em PR, SC, RS, SP e outros estados pós-LC 194/2022.
    //   'NONE': sem isenção — cliente paga ICMS sobre TE + TUSD do kWh compensado.
    //              Equivalente a project.scenarios.icmsExempt === false (override).
    icmsScope?: 'TE_TUSD' | 'TE_ONLY' | 'NONE';
    // Isenção de PIS/COFINS sobre kWh compensado pela GD.
    //   true (default) — STJ Tema 986 + Lei 13.169/15: federal exemption applies.
    //   false — compensated kWh ainda paga PIS+COFINS (leak adicional no cenário COM).
    // Sits on the distribuidora alongside icmsScope so both tax-isenção settings live together.
    // Per-project override is via this same field (distributor instance is project-scoped).
    pisCofinsExempt?: boolean;
  };
  // Tariff markup sensitivity (DistributorForm). When a markup is applied, all
  // sem-impostos tariffs are multiplied by (1 + tariffMarkupPct); tariffsBaseline
  // snapshots the pre-markup values so "Resetar" restores and re-apply is idempotent.
  tariffMarkupPct?: number;            // e.g. 0.10 = +10%
  tariffsBaseline?: Distributor['tariffs'];
  // Computed (derived from above)
  FA?: number;            // TE_FP / TE_PT — computed on load
  T_B3?: number;          // all-in Grupo B tariff — computed
  T_AFP?: number;         // all-in Grupo A FP — computed
  T_APT?: number;         // all-in Grupo A Ponta — computed
  T_ARSV?: number;        // all-in Grupo A no horário reservado — present only if A_RSV_TUSD_TE set
  T_BRSV?: number;        // all-in Grupo B no horário reservado — present only if B_RSV_TUSD_TE set
  T_A_DEMANDA?: number;   // all-in Grupo A demanda (R$/kW/mês) — present only if A_FP_DEMANDA set
  // TUSD-only all-in tariffs (computed). Usados quando icmsScope === 'TE_ONLY':
  // a isenção cobre só TE, e o ICMS sobre TUSD continua sendo cobrado sobre o kWh compensado.
  T_AFP_TUSD?: number;    // = computeAllInTariff(A_FP_TUSD_TE − A_TE_FP, taxes)
  T_APT_TUSD?: number;    // = computeAllInTariff(A_PT_TUSD_TE − A_TE_PT, taxes)
  T_B3_TUSD?: number;     // = computeAllInTariff(B_TUSD, taxes)
}

// A consumption unit (UC)
export interface ConsumptionUnit {
  id: string;
  name: string;
  tariffGroup: TariffGroup;
  isGrupoA: boolean;
  // Monthly consumption in kWh for the 24 contract months
  consumptionFP: number[];   // length 24, fora-ponta (regular hours, excl. reservado window)
  consumptionPT: number[];   // length 24, ponta (only for Grupo A)
  // Horário reservado (21h30–06h, REN 1000 Art. 186). Same posto as FP for SCEE
  // compensation, billed at a discounted tariff. Present only when the UC is
  // enrolled as irrigante/aquicultor.
  consumptionReservado?: number[];
  // Demanda faturada Grupo A Verde (kW) — valor médio da demanda cobrada na fatura.
  // Billed monthly at A_FP_DEMANDA, unchanged by GD (SCEE não compensa demanda).
  // Set only for Grupo A UCs; ignored for Grupo B. ANEEL bills on
  // max(medida, 0,85 × contratada) — usuário deve inserir o valor médio faturado.
  demandaFaturadaFP?: number;
  // Demanda contratada (kW) — compromisso contratual com a distribuidora.
  // Usado pelo otimizador de demanda para calcular o cenário atual e sugerir DC ótima.
  demandaContratadaFP?: number;
  // Histórico da demanda medida (kW), até 13 meses — preenchido manualmente da fatura.
  // Usado exclusivamente pela aba "Demanda" (otimização de DC); não afeta simulação.
  demandaMedidaMensal?: number[];
  // Opening credit bank (kWh) at contract start
  openingBank: number;
  // Does this UC have its own generation? (e.g. NHS, AMD in the Copasul case)
  ownGeneration?: number[];  // length 24, kWh/month if applicable
  // Override do baseline ACL para esta UC (ex.: CCV da SUPERFRIO é outro CNPJ/contrato).
  // Quando ausente, usa project.aclBaseline. Só tem efeito se o projeto for marketType 'ACL'.
  aclBaselineOverride?: ACLBaseline;
}

// A solar plant (the generator)
export interface Plant {
  id: string;
  name: string;
  capacityKWac: number;
  distributor: string;    // distributor ID
  // Monthly generation profiles (kWh)
  p50Profile: number[];           // length 24 — PVsyst P50
  actualProfile?: number[];       // length 24 — real measured data
  useActual: boolean;             // toggle: use actual vs P50
  // PPA terms
  ppaRateRsBRLkWh: number;       // e.g. 0.4425
  contractStartMonth: string;    // e.g. "2026-06"
  contractMonths: number;        // e.g. 24
  // Intermediation fee taken off the PPA before Helexia's net receipt
  // (e.g. 0.10 = 10%). Used by the "Recebimento Helexia" view. Defaults to 0.
  intermediationFeePct?: number;
}

// A client project
// Market environment of the client *today* (the SEM / "what they pay now" baseline).
//   'CATIVO' — regulated market: SEM = full captive bundled tariff (TUSD+TE). Legacy default.
//   'ACL'    — free market (Cliente Livre): SEM = energia comprada na ACL (R$/MWh) +
//              TUSD (Fio B) com desconto de fonte incentivada. See ACLBaseline + ACL_BASELINE_SPEC.md.
// In both cases the COM scenario is GD no mercado cativo (client migrates to ACR to use SCEE),
// so the COM path is unchanged — only the SEM baseline differs.
export type MarketType = 'CATIVO' | 'ACL';

export interface ACLBaseline {
  // Energia comprada no mercado livre (a TE que o cliente paga hoje), R$/kWh SEM impostos.
  energyPriceSemImp: number;        // ex.: 0.300 (= R$300/MWh)
  energyIndexation?: 'FIXO' | 'IPCA' | 'IGPM' | 'PLD';
  energyEscalationPct?: number;     // % a.a. aplicado a energyPriceSemImp no SEM (default 0)
  // Desconto de TUSD de fonte incentivada que o cliente tem HOJE (só afeta o SEM).
  tusdDiscountConsumo: number;      // ex.: 0.44 — aplicado a fora-ponta (e ponta se *PT ausente)
  // Desconto de TUSD de ponta, quando difere do fora-ponta (COPEL: FP~2%, PT~47%).
  // Ausente ⇒ usa tusdDiscountConsumo para ambos os postos.
  tusdDiscountConsumoPT?: number;
  tusdDiscountDemanda: number;      // ex.: 0.49
  // Erosão opcional do desconto ao longo do horizonte (mês → fator 0..1). Se ausente, mantém flat.
  tusdDiscountSchedule?: { consumo: number[]; demanda: number[] };
  // A energia ACL carrega PIS/COFINS + ICMS no build-up do SEM? (PR: sim)
  energyIcms?: boolean;             // default true
  energyPisCofins?: boolean;        // default true
  // PIS+COFINS embutido no preço da energia do fornecedor (não-cumulativo). Default 9,25%
  // (1,65% PIS + 7,6% COFINS). A TUSD usa a alíquota efetiva da distribuidora (≈6,5–7,7%),
  // por isso a energia tem gross-up próprio. Ref.: Energês "Entendendo a Fatura 4".
  energyPisCofinsPct?: number;      // default 0.0925
}

export interface Project {
  id: string;
  clientName: string;
  clientLogo?: string;          // PNG/JPEG do logo do cliente (data URL) — exibido no PDF
  distributor: Distributor;
  // Ambiente de contratação do cliente hoje. Default 'CATIVO' (retrocompat).
  marketType?: MarketType;
  // Parâmetros do baseline ACL — usado quando marketType === 'ACL'. Pode ser
  // sobrescrito por UC via ConsumptionUnit.aclBaselineOverride.
  aclBaseline?: ACLBaseline;
  plant: Plant;
  // Additional usinas injecting credits into the same client. Each shares the
  // contract start month but can have its own capacity, PPA rate and prazo.
  // Their generation is summed with the main plant's, each extended to its own
  // contractMonths and zero-padded to the simulation horizon.
  additionalPlants?: Plant[];
  // Optional override for the simulation horizon (months). When unset, the
  // horizon is the max contractMonths across the main plant and all additional
  // plants. See computeSimulationMonths().
  simulationMonths?: number;
  ucs: ConsumptionUnit[];
  // BAT stranded bank (if applicable — for cases like Batayporã)
  batBank?: {
    openingKWh: number;
    toNHSPct: number;    // e.g. 0.5
    toAMDPct: number;    // e.g. 0.5
    // Which UC IDs receive the BAT credits
    nhsUCId: string;
    amdUCId: string;
  };
  // Generation source
  generationSource?: 'manual' | 'helexia_plant';
  helexiaPlantCode?: string;
  degradationPct?: number;
  lossPct?: number;
  // Folder
  folderId?: string;
  // Growth & degradation for multi-year contracts
  growthRate?: number;              // annual consumption growth, e.g. 0.025 (2.5%)
  generationDegradation?: number;   // annual gen degradation, e.g. 0.005 (0.5%)
  // Haircut on P50 to reflect real-world underperformance (typical 0.90–0.95).
  // Applied to both the main plant P50 and any UC ownGeneration. Defaults to 1.0 (no haircut).
  performanceFactor?: number;
  // Annual tariff escalation rates (compound growth from contract start).
  // Distributor rate scales all rede tariffs (FP, PT, RSV, demanda); PPA rate
  // scales ppaRateRsBRLkWh. Defaults to 0 (no escalation).
  tariffEscalationDistributor?: number; // ex: 0.05 = 5%/ano
  tariffEscalationPPA?: number;         // ex: 0.04 = 4%/ano (geralmente IGPM/IPCA)
  // Scenario toggles
  scenarios: {
    icmsExempt: boolean;         // true = isenção applies (base case)
    competitorDiscount: number;  // reduces SEM baseline for Grupo B (free %, not capped)
    competitorName?: string;     // optional label for the competitor (default "Plin")
    useActualGeneration: boolean;
    // When true, simulation overrides each Grupo A UC's demandaFaturadaFP with
    // the average kW billed under the optimal DC (computed from demandaMedidaMensal).
    // Equivalent to running the demanda optimizer's recommended DC for billing.
    useOptimizedDemand?: boolean;
    // When true, run the 5-scenario value-attribution decomposition (Bare → +Bank → +OwnGen → +BATdistrib → +CS3).
    // Adds ~2.5× simulation compute. Result lands in SimulationResult.attribution.
    runAttribution?: boolean;
    // Fator de Ajuste (FA = TE_FP/TE_PT) na compensação cruzada de postos (REN 1000).
    // Default true (aplica FA: compensar 1 kWh ponta consome 1/FA créditos fora-ponta).
    // Quando false (ex.: COPEL não aplica operacionalmente), créditos fora-ponta compensam
    // ponta 1:1 → mais ponta compensada → economia maior. Força FA=1 na simulação.
    applyFatorAjuste?: boolean;
  };
  // Rateio: allocated by the optimiser or manually set
  rateio: RateioAllocation;
  createdAt: string;
  updatedAt: string;
}

// Rateio allocation: 4 periods × N UCs
// periods: P1=months 1-4, P2=months 5-10, P3=months 11-16, P4=months 17-24
// Each period: array of fractions summing to 1.0, one per UC
export interface RateioAllocation {
  periods: {
    start: number;  // month index 0-based
    end: number;
    allocations: { ucId: string; fraction: number }[];
  }[];
  isOptimised: boolean;
  lastOptimisedAt?: string;
}

// Full simulation result
export interface SimulationResult {
  projectId: string;
  months: MonthlyResult[];
  summary: SimulationSummary;
  bankPerUC: { ucId: string; name: string; finalBankCOM: number; finalBankSEM: number; valueAtPPA: number }[];
  // Detailed per-UC monthly data for bank dynamics view
  ucDetailsCOM: Record<string, UCMonthlyDetail[]>;
  ucDetailsSEM: Record<string, UCMonthlyDetail[]>;
  // Optional value-attribution decomposition (set only when project.scenarios.runAttribution = true)
  attribution?: AttributionResult;
}

// ──────────────────────────────────────────────────────────────────────────
// Value attribution: decompose customer benefit into asset-source components.
//
// Sequential scenario subtraction:
//   Bare         = no own plants, no opening bank, no BAT distribution, no CS3
//   + Bank       = opening bank ON
//   + OwnGen     = each UC's own plant ON (NHS plant for NHS, BAT plant for BAT, ...)
//   + BATDistrib = BAT surplus distribution to NHS/AMD ON (=SEM scenario)
//   + CS3        = Helexia HCS03 plant ON (=COM scenario)
//
// Each component's incremental value = cost(scenario_n) − cost(scenario_n+1).
// This is what the customer can attribute to each asset source.
// Only the CS3 component is what the customer pays PPA for.
// ──────────────────────────────────────────────────────────────────────────
export interface AttributionFlags {
  includeOpeningBank: boolean;
  includeOwnGen: boolean;
  includeBATDistrib: boolean;
  includeCS3: boolean;
}

export type AttributionScenarioName = 'bare' | 'withBank' | 'withOwnGen' | 'withBATdistrib' | 'withCS3';

export interface AttributionScenario {
  name: AttributionScenarioName;
  label: string;          // PT-BR human-readable label for UI
  flags: AttributionFlags;
  totalRedeCost: number;  // R$ — total residual grid bill across all UCs
  totalPPACost: number;   // R$ — only non-zero for withCS3
  totalIcmsAdditional: number;
  totalCost: number;      // totalRedeCost + totalPPACost + totalIcmsAdditional
  monthlyCost: number[];  // R$ per month (totalCost decomposed monthly)
}

export interface AttributionDecomposition {
  bareBaseline: number;          // total grid cost with no assets at all
  initialBankEffect: number;     // bare → +Bank
  ownPlantsEffect: number;       // +Bank → +OwnGen
  batDistribEffect: number;      // +OwnGen → +BATdistrib
  helexiaCS3Effect: number;      // +BATdistrib → +CS3 (= SEM − COM, headline Eco)
  totalCustomerBenefit: number;  // bare − withCS3 (sum of all 4 effects above)
}

export interface AttributionMonthly {
  monthIndex: number;
  label: string;
  bareBaseline: number;
  initialBankEffect: number;
  ownPlantsEffect: number;
  batDistribEffect: number;
  helexiaCS3Effect: number;
}

export interface AttributionResult {
  scenarios: AttributionScenario[];
  decomposition: AttributionDecomposition;
  monthly: AttributionMonthly[];
}

export interface MonthlyResult {
  monthIndex: number;
  label: string;          // e.g. "Jun/26"
  generation: number;     // kWh injected
  ppaCost: number;        // R$ PPA paid to Helexia
  // Per scenario
  sem: { totalCost: number };
  com: { redeCost: number; totalCost: number; icmsAdditional: number; pisCofinsAdditional: number };
  economia: number;       // sem.totalCost - com.totalCost - icmsAdditional - pisCofinsAdditional
  economiaAcum: number;   // running total
}

export interface SimulationSummary {
  totalGeneration: number;     // kWh
  totalPPACost: number;        // R$
  baselineSEM: number;         // R$ total SEM Helexia
  economiaLiquida: number;     // R$
  economiaPct: number;         // %
  economiaPerMonth: number;    // R$/month average
  bancoResidualKWh: number;    // total all UCs COM
  bancoResidualValue: number;  // @ PPA rate
  bancoNetHelexia: number;     // COM minus SEM residual (true Helexia contribution)
  valorTotal: number;          // economiaLiquida + bancoNetHelexia
  icmsRisk: number;            // additional cost if isenção lost
}

// Per-UC monthly detail for bank tracking
export interface UCMonthlyDetail {
  ucId: string;
  monthIndex: number;
  creditsReceived: number;
  creditsFPApplied: number;
  creditsPTApplied: number;
  creditsRSVApplied?: number;  // only populated when UC has consumptionReservado
  bankStart: number;
  bankDraw: number;
  bankEnd: number;
  costRede: number;
  ownGenerationUsed: number;
  icmsAdditional: number;
  pisCofinsAdditional: number;
  // Residual kWh per posto that paid grid tariff this month (consumption − total compensation,
  // where total = own-gen + CS3 + BAT credits + bank draws). residualFP includes the FP-regular
  // portion only when consRSV > 0; otherwise FP-posto residual is reported under residualFP.
  residualFP: number;
  residualPT: number;
  residualRSV: number;
}

// Default rateio periods for 24 months
export const DEFAULT_PERIODS = [
  { start: 0, end: 3 },   // P1: months 1-4
  { start: 4, end: 9 },   // P2: months 5-10
  { start: 10, end: 15 },  // P3: months 11-16
  { start: 16, end: 23 },  // P4: months 17-24
];

// Build periods dynamically for any contract length
export function buildPeriods(contractMonths: number): { start: number; end: number }[] {
  if (contractMonths <= 12) {
    return [{ start: 0, end: contractMonths - 1 }];
  }
  const lastIdx = contractMonths - 1;
  const raw =
    contractMonths <= 24
      ? [
          { start: 0, end: 3 },
          { start: 4, end: 9 },
          { start: 10, end: 15 },
          { start: 16, end: lastIdx },
        ]
      : contractMonths <= 36
      ? [
          { start: 0, end: 3 },
          { start: 4, end: 9 },
          { start: 10, end: 15 },
          { start: 16, end: 23 },
          { start: 24, end: lastIdx },
        ]
      : contractMonths <= 48
      ? [
          { start: 0, end: 3 },
          { start: 4, end: 9 },
          { start: 10, end: 15 },
          { start: 16, end: 23 },
          { start: 24, end: 35 },
          { start: 36, end: lastIdx },
        ]
      : [
          { start: 0, end: 3 },
          { start: 4, end: 9 },
          { start: 10, end: 15 },
          { start: 16, end: 23 },
          { start: 24, end: 35 },
          { start: 36, end: 47 },
          { start: 48, end: lastIdx },
        ];
  return raw
    .filter(p => p.start <= lastIdx)
    .map(p => ({ start: p.start, end: Math.min(p.end, lastIdx) }));
}
