import * as XLSX from 'xlsx';
import type { Project, SimulationResult } from './types';
import { runSimulation } from './simulation';

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function exportResultsExcel(project: Project, result: SimulationResult): void {
  const wb = XLSX.utils.book_new();
  const sm = result.summary;

  // Sheet 1: Resumo
  const resumoData = [
    ['RESUMO EXECUTIVO', '', project.clientName],
    [''],
    ['Metrica', 'Valor', 'Unidade'],
    ['Geracao Total 24m', Math.round(sm.totalGeneration), 'kWh'],
    ['PPA Pago 24m', Math.round(sm.totalPPACost), 'R$'],
    ['Custo SEM Helexia 24m', Math.round(sm.baselineSEM), 'R$'],
    ['Economia Liquida 24m', Math.round(sm.economiaLiquida), 'R$'],
    ['Reducao da Fatura', (sm.economiaPct * 100).toFixed(1) + '%', ''],
    ['Economia Mensal Media', Math.round(sm.economiaPerMonth), 'R$/mes'],
    ['Banco Residual COM', Math.round(sm.bancoResidualKWh), 'kWh'],
    ['Banco Residual (Valor)', Math.round(sm.bancoResidualValue), 'R$ @ PPA'],
    ['Banco Net Helexia', Math.round(sm.bancoNetHelexia), 'R$'],
    ['VALOR TOTAL', Math.round(sm.valorTotal), 'R$'],
    ['Risco ICMS', Math.round(sm.icmsRisk), 'R$'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(resumoData);
  ws1['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');

  // Sheet 2: Mensal
  const mensalHeader = ['Mes', 'Geracao (kWh)', 'PPA (R$)', 'Custo SEM (R$)', 'Custo COM Rede (R$)', 'Custo COM Total (R$)', 'ICMS Adicional (R$)', 'Economia (R$)', 'Economia Acum. (R$)'];
  const mensalRows = result.months.map(m => [
    m.label,
    Math.round(m.generation),
    Math.round(m.ppaCost),
    Math.round(m.sem.totalCost),
    Math.round(m.com.redeCost),
    Math.round(m.com.totalCost),
    Math.round(m.com.icmsAdditional),
    Math.round(m.economia),
    Math.round(m.economiaAcum),
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([mensalHeader, ...mensalRows]);
  ws2['!cols'] = mensalHeader.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Mensal');

  // Sheet 3: Banco por UC
  const bancoHeader = ['UC', 'Grupo', 'Banco SEM (kWh)', 'Banco COM (kWh)', 'Delta Helexia (kWh)', 'Valor @ PPA (R$)', '% do Total'];
  const totalNet = result.bankPerUC.reduce((s, b) => s + (b.finalBankCOM - b.finalBankSEM), 0);
  const bancoRows = result.bankPerUC.map(b => {
    const net = b.finalBankCOM - b.finalBankSEM;
    return [
      b.name,
      project.ucs.find(u => u.id === b.ucId)?.tariffGroup || '',
      Math.round(b.finalBankSEM),
      Math.round(b.finalBankCOM),
      Math.round(net),
      Math.round(b.valueAtPPA),
      totalNet > 0 ? (net / totalNet * 100).toFixed(1) + '%' : '0%',
    ];
  });
  const ws3 = XLSX.utils.aoa_to_sheet([bancoHeader, ...bancoRows]);
  ws3['!cols'] = bancoHeader.map((_, i) => ({ wch: i === 0 ? 25 : 18 }));
  XLSX.utils.book_append_sheet(wb, ws3, 'Banco por UC');

  // Sheet 4: Sensibilidade
  const sensHeader = ['Cenario', 'Geracao 24m (kWh)', 'PPA (R$)', 'Economia (R$)', 'Reducao (%)', 'Banco Residual (kWh)', 'VALOR TOTAL (R$)'];
  const scenarios = [
    { label: 'P90 Pessimista', mult: 0.90 },
    { label: 'P50 Base', mult: 1.00 },
    { label: 'P10 Otimista', mult: 1.10 },
  ];
  const sensRows = scenarios.map(sc => {
    const scaled = {
      ...project,
      plant: { ...project.plant, p50Profile: project.plant.p50Profile.map(v => Math.round(v * sc.mult)) },
    };
    try {
      const r = runSimulation(scaled);
      return [
        sc.label,
        Math.round(r.summary.totalGeneration),
        Math.round(r.summary.totalPPACost),
        Math.round(r.summary.economiaLiquida),
        (r.summary.economiaPct * 100).toFixed(1) + '%',
        Math.round(r.summary.bancoResidualKWh),
        Math.round(r.summary.valorTotal),
      ];
    } catch {
      return [sc.label, 'Erro', '', '', '', '', ''];
    }
  });
  const ws4 = XLSX.utils.aoa_to_sheet([sensHeader, ...sensRows]);
  ws4['!cols'] = sensHeader.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws4, 'Sensibilidade');

  // Sheet 5: Premissas
  const dist = project.distributor;
  const plant = project.plant;
  const premissasData = [
    ['PREMISSAS', ''],
    [''],
    ['Distribuidora', `${dist.name} (${dist.state})`],
    ['Resolucao', dist.resolution],
    ['Tarifa B3 (TUSD+TE s/ tributos)', `R$ ${(dist.tariffs.B_TUSD + dist.tariffs.B_TE).toFixed(4)}/kWh`],
    ['Tarifa A FP (TUSD+TE s/ tributos)', `R$ ${dist.tariffs.A_FP_TUSD_TE.toFixed(4)}/kWh`],
    ['Tarifa A PT (TUSD+TE s/ tributos)', `R$ ${dist.tariffs.A_PT_TUSD_TE.toFixed(4)}/kWh`],
    ['ICMS', `${(dist.taxes.ICMS * 100).toFixed(0)}%`],
    ['PIS', `${(dist.taxes.PIS * 100).toFixed(2)}%`],
    ['COFINS', `${(dist.taxes.COFINS * 100).toFixed(2)}%`],
    [''],
    ['Usina', plant.name],
    ['Potencia AC', `${plant.capacityKWac} kWac`],
    ['PPA', `R$ ${plant.ppaRateRsBRLkWh.toFixed(4)}/kWh`],
    ['Inicio Contrato', plant.contractStartMonth],
    ['Prazo', `${plant.contractMonths} meses`],
    [''],
    ['Isencao ICMS', project.scenarios.icmsExempt ? 'Sim' : 'Nao'],
    ['Desconto Concorrente', project.scenarios.competitorDiscount > 0 ? `${(project.scenarios.competitorDiscount * 100).toFixed(0)}%` : 'Nao'],
    ['Numero de UCs', `${project.ucs.length}`],
    ['UCs Grupo A', `${project.ucs.filter(u => u.isGrupoA).length}`],
    ['UCs Grupo B', `${project.ucs.filter(u => !u.isGrupoA).length}`],
  ];
  const ws5 = XLSX.utils.aoa_to_sheet(premissasData);
  ws5['!cols'] = [{ wch: 30 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws5, 'Premissas');

  // Download
  const filename = `${project.clientName.toLowerCase().replace(/\s+/g, '_')}_resultados_helexia.xlsx`;
  XLSX.writeFile(wb, filename);
}
