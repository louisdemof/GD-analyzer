/**
 * Otimização de demanda contratada (DC) para clientes Grupo A Verde.
 *
 * Regra de faturamento ANEEL REN 1000/2021 Art. 93:
 *   - DM < DC                  → DF = DC (take-or-pay, cliente paga o mínimo contratual)
 *   - DC ≤ DM ≤ DC × 1,05      → DF = DM (dentro da tolerância de 5%)
 *   - DM > DC × 1,05           → DF = DC + 2 × (DM − DC) (ultrapassagem, multa 100% sobre o excesso)
 *
 * A função de custo total anual é seccionalmente linear em DC e tem um mínimo
 * global que depende da distribuição dos valores de DM histórica. Busca por grade
 * de passo 1 kW é suficiente (12 × 1200 = 14k operações, instantâneo).
 */

export type DemandaScenario = 'subutilizacao' | 'normal' | 'ultrapassagem';

export interface DemandaBilling {
  billed: number;          // kW faturada no mês
  ultrapassagem: number;   // kW em ultrapassagem (0 se não houve)
  scenario: DemandaScenario;
}

export function computeDemandaBilling(dc: number, dm: number): DemandaBilling {
  if (dc <= 0) {
    // Sem DC definida — efeitos degeneram em pagar DM (+ potencial penalidade total indefinida).
    return { billed: dm, ultrapassagem: 0, scenario: 'normal' };
  }
  if (dm < dc) {
    return { billed: dc, ultrapassagem: 0, scenario: 'subutilizacao' };
  }
  if (dm <= dc * 1.05) {
    return { billed: dm, ultrapassagem: 0, scenario: 'normal' };
  }
  const excess = dm - dc;
  return { billed: dc + 2 * excess, ultrapassagem: excess, scenario: 'ultrapassagem' };
}

export interface MonthBreakdown {
  monthIndex: number;
  dm: number;
  billing: DemandaBilling;
  cost: number;
}

export interface AnnualCost {
  totalCost: number;
  totalBilled: number;
  ultrapassagemMonths: number;
  subutilizacaoMonths: number;
  byMonth: MonthBreakdown[];
}

export function computeAnnualDemandaCost(
  dc: number,
  dmHistory: number[],
  tariffPerKW: number,
): AnnualCost {
  const byMonth: MonthBreakdown[] = dmHistory.map((dm, monthIndex) => {
    const billing = computeDemandaBilling(dc, dm);
    return { monthIndex, dm, billing, cost: billing.billed * tariffPerKW };
  });
  let totalCost = 0;
  let totalBilled = 0;
  let ultrapassagemMonths = 0;
  let subutilizacaoMonths = 0;
  for (const m of byMonth) {
    totalCost += m.cost;
    totalBilled += m.billing.billed;
    if (m.billing.scenario === 'ultrapassagem') ultrapassagemMonths++;
    if (m.billing.scenario === 'subutilizacao') subutilizacaoMonths++;
  }
  return { totalCost, totalBilled, ultrapassagemMonths, subutilizacaoMonths, byMonth };
}

export interface OptimizerResult {
  bestDC: number;
  bestCost: number;
  sensitivity: Array<{ dc: number; cost: number }>;
}

/**
 * Retorna a DC que minimiza o custo anual dado um histórico de demanda medida.
 * Grid search em passo de 1 kW de 1 até max(DM) × 1,2.
 */
export function optimizeDemandaContratada(
  dmHistory: number[],
  tariffPerKW: number,
): OptimizerResult {
  if (dmHistory.length === 0 || tariffPerKW <= 0) {
    return { bestDC: 0, bestCost: 0, sensitivity: [] };
  }
  const maxDM = Math.max(...dmHistory);
  const upperBound = Math.max(Math.ceil(maxDM * 1.2), 10);
  const sensitivity: Array<{ dc: number; cost: number }> = [];
  let bestDC = 1;
  let bestCost = Infinity;
  for (let dc = 1; dc <= upperBound; dc++) {
    const { totalCost } = computeAnnualDemandaCost(dc, dmHistory, tariffPerKW);
    sensitivity.push({ dc, cost: totalCost });
    if (totalCost < bestCost) {
      bestCost = totalCost;
      bestDC = dc;
    }
  }
  return { bestDC, bestCost, sensitivity };
}
