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
  };
  taxes: {
    ICMS: number;         // e.g. 0.17
    PIS: number;          // e.g. 0.0153
    COFINS: number;       // e.g. 0.0703
  };
  // Computed (derived from above)
  FA?: number;            // TE_FP / TE_PT — computed on load
  T_B3?: number;          // all-in Grupo B tariff — computed
  T_AFP?: number;         // all-in Grupo A FP — computed
  T_APT?: number;         // all-in Grupo A Ponta — computed
}

// A consumption unit (UC)
export interface ConsumptionUnit {
  id: string;
  name: string;
  tariffGroup: TariffGroup;
  isGrupoA: boolean;
  // Monthly consumption in kWh for the 24 contract months
  consumptionFP: number[];   // length 24, fora-ponta
  consumptionPT: number[];   // length 24, ponta (only for Grupo A)
  // Opening credit bank (kWh) at contract start
  openingBank: number;
  // Does this UC have its own generation? (e.g. NHS, AMD in the Copasul case)
  ownGeneration?: number[];  // length 24, kWh/month if applicable
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
}

// A client project
export interface Project {
  id: string;
  clientName: string;
  distributor: Distributor;
  plant: Plant;
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
  // Scenario toggles
  scenarios: {
    icmsExempt: boolean;         // true = isenção applies (base case)
    competitorDiscount: number;  // 0.0 to 0.30 — reduces SEM baseline for Grupo B
    useActualGeneration: boolean;
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
}

export interface MonthlyResult {
  monthIndex: number;
  label: string;          // e.g. "Jun/26"
  generation: number;     // kWh injected
  ppaCost: number;        // R$ PPA paid to Helexia
  // Per scenario
  sem: { totalCost: number };
  com: { redeCost: number; totalCost: number; icmsAdditional: number };
  economia: number;       // sem.totalCost - com.totalCost - icmsAdditional
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
  bankStart: number;
  bankDraw: number;
  bankEnd: number;
  costRede: number;
  ownGenerationUsed: number;
  icmsAdditional: number;
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
  if (contractMonths <= 24) {
    return [
      { start: 0, end: 3 },
      { start: 4, end: 9 },
      { start: 10, end: 15 },
      { start: 16, end: contractMonths - 1 },
    ];
  }
  if (contractMonths <= 36) {
    return [
      { start: 0, end: 3 },
      { start: 4, end: 9 },
      { start: 10, end: 15 },
      { start: 16, end: 23 },
      { start: 24, end: contractMonths - 1 },
    ];
  }
  if (contractMonths <= 48) {
    return [
      { start: 0, end: 3 },
      { start: 4, end: 9 },
      { start: 10, end: 15 },
      { start: 16, end: 23 },
      { start: 24, end: 35 },
      { start: 36, end: contractMonths - 1 },
    ];
  }
  // 60 months
  return [
    { start: 0, end: 3 },
    { start: 4, end: 9 },
    { start: 10, end: 15 },
    { start: 16, end: 23 },
    { start: 24, end: 35 },
    { start: 36, end: 47 },
    { start: 48, end: contractMonths - 1 },
  ];
}
