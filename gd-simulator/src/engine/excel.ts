import * as XLSX from 'xlsx';
import type { Project, SimulationResult } from './types';
import { runSimulation, computeSimulationMonths } from './simulation';
import { computeTaxBreakdown } from './taxBreakdown';

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function exportResultsExcel(project: Project, result: SimulationResult): void {
  const wb = XLSX.utils.book_new();
  const sm = result.summary;

  const cm = project.plant.contractMonths || result.months.length || 24;
  const lbl = `${cm}m`;
  // Total consumption across all UCs over the contract horizon.
  let consumoTotal = 0;
  for (const uc of project.ucs) {
    for (let m = 0; m < cm; m++) {
      consumoTotal += (uc.consumptionFP[m] ?? 0)
        + (uc.consumptionPT[m] ?? 0)
        + (uc.consumptionReservado?.[m] ?? 0);
    }
  }
  const totalPisCofins = result.months.reduce((acc, m) => acc + (m.com.pisCofinsAdditional ?? 0), 0);

  // Sheet 1: Resumo
  const resumoData = [
    ['RESUMO EXECUTIVO', '', project.clientName],
    [''],
    ['Metrica', 'Valor', 'Unidade'],
    [`Consumo Total ${lbl}`, Math.round(consumoTotal), 'kWh'],
    [`Geracao Total ${lbl}`, Math.round(sm.totalGeneration), 'kWh'],
    [`PPA Pago ${lbl}`, Math.round(sm.totalPPACost), 'R$'],
    [`Custo SEM Helexia ${lbl}`, Math.round(sm.baselineSEM), 'R$'],
    [`Economia Liquida ${lbl}`, Math.round(sm.economiaLiquida), 'R$'],
    ['Reducao da Fatura', (sm.economiaPct * 100).toFixed(1) + '%', ''],
    ['Economia Mensal Media', Math.round(sm.economiaPerMonth), 'R$/mes'],
    ['Banco Residual COM', Math.round(sm.bancoResidualKWh), 'kWh'],
    ['Banco Residual (Valor)', Math.round(sm.bancoResidualValue), 'R$ @ PPA'],
    ['Banco Net Helexia', Math.round(sm.bancoNetHelexia), 'R$'],
    ['VALOR TOTAL', Math.round(sm.valorTotal), 'R$'],
    ['Risco ICMS (se isencao perdida)', Math.round(sm.icmsRisk), 'R$'],
    ['PIS/COFINS Adicional (se nao isento)', Math.round(totalPisCofins), 'R$'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(resumoData);
  ws1['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');

  // Sheet 1b: Detalhe Impostos — per-UC breakdown of fatura composition
  // (TE/TUSD sem impostos, PIS+COFINS por componente, ICMS por componente)
  // for SEM Helexia and COM Helexia, so the actual tax impact is visible.
  {
    const tb = computeTaxBreakdown(project, result);
    const PC = tb.distributor.pisRate + tb.distributor.cofinsRate;
    const rows: (string | number)[][] = [
      ['DETALHE DE IMPOSTOS POR UC — composição da fatura'],
      [''],
      [`Distribuidora: ${tb.distributor.name} (${tb.distributor.state}) · ICMS ${(tb.distributor.icmsRate*100).toFixed(0)}% · PIS+COFINS ${(PC*100).toFixed(2)}% · Escopo ICMS: ${tb.distributor.icmsScope === 'TE_ONLY' ? 'TE apenas' : 'TE+TUSD (total)'} · PIS/COFINS isento: ${tb.distributor.pisCofinsExempt ? 'Sim' : 'Não'}`],
      [''],
    ];

    for (const u of tb.ucs) {
      const comRede = u.totalCOM - (u.ppaHelexia ?? 0);
      rows.push([`UC: ${u.ucName}  (${u.tariffGroup})`, '', '', '', '', '']);
      rows.push([
        'Componente',
        'SEM Helexia (R$)',
        'Rede COM (R$)',
        'PPA Helexia (R$)',
        'Total COM (R$)',
        'Economia (R$)',
      ]);
      for (const p of u.postos) {
        rows.push([`Posto ${p.posto} (SEM ${Math.round(p.consumoSEM)} kWh · COM ${Math.round(p.consumoCOM)} kWh · Compensado ${Math.round(p.compensadoCOM)} kWh)`, '', '', '', '', '']);
        for (const line of p.lines) {
          rows.push([
            line.label,
            Math.round(line.sem),
            Math.round(line.com),
            '',
            Math.round(line.com),
            Math.round(line.delta),
          ]);
        }
        rows.push([
          `Subtotal ${p.posto}`,
          Math.round(p.subtotalSEM),
          Math.round(p.subtotalCOM),
          '',
          Math.round(p.subtotalCOM),
          Math.round(p.subtotalSEM - p.subtotalCOM),
        ]);
        rows.push(['', '', '', '', '', '']);
      }
      if (u.demanda) {
        rows.push([`Demanda contratada (${u.demanda.kW} kW × ${u.demanda.months} meses)`, '', '', '', '', '']);
        for (const line of u.demanda.lines) {
          rows.push([line.label, Math.round(line.sem), Math.round(line.com), '', Math.round(line.com), 0]);
        }
        rows.push([`Subtotal Demanda`, Math.round(u.demanda.subtotal), Math.round(u.demanda.subtotal), '', Math.round(u.demanda.subtotal), 0]);
        rows.push(['', '', '', '', '', '']);
      }
      if (u.ppaHelexia) {
        rows.push([`PPA Helexia`, 0, 0, Math.round(u.ppaHelexia), Math.round(u.ppaHelexia), Math.round(-u.ppaHelexia)]);
      }
      rows.push([
        'TOTAL UC',
        Math.round(u.totalSEM),
        Math.round(comRede),
        Math.round(u.ppaHelexia ?? 0),
        Math.round(u.totalCOM),
        Math.round(u.totalSEM - u.totalCOM),
      ]);
      rows.push(['']);
      rows.push(['']);
    }

    // Monthly aggregate breakdown — SEM Rede vs Rede COM vs PPA vs Total
    rows.push(['']);
    rows.push(['RESUMO MENSAL — Distribuidora vs PPA Helexia (somatório de todas as UCs)']);
    rows.push(['']);
    rows.push(['Mês', 'Consumo (kWh)', 'SEM Helexia (R$)', 'Rede COM (R$)', 'PPA Helexia (R$)', 'Total COM (R$)', 'Economia (R$)']);
    let totConsumo = 0, totSem = 0, totComRede = 0, totComPPA = 0, totComTotal = 0, totEconomia = 0;
    for (const m of tb.monthly) {
      rows.push([
        m.label,
        Math.round(m.consumoKWh),
        Math.round(m.semRede),
        Math.round(m.comRede),
        Math.round(m.comPPA),
        Math.round(m.comTotal),
        Math.round(m.economia),
      ]);
      totConsumo += m.consumoKWh;
      totSem += m.semRede;
      totComRede += m.comRede;
      totComPPA += m.comPPA;
      totComTotal += m.comTotal;
      totEconomia += m.economia;
    }
    rows.push([
      'TOTAL',
      Math.round(totConsumo),
      Math.round(totSem),
      Math.round(totComRede),
      Math.round(totComPPA),
      Math.round(totComTotal),
      Math.round(totEconomia),
    ]);

    const wsDet = XLSX.utils.aoa_to_sheet(rows);
    wsDet['!cols'] = [{ wch: 50 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsDet, 'Detalhe Impostos');
  }

  // Sheet 2: Mensal — "Consumo" goes before "Geracao", PIS/COFINS next to ICMS.
  const mensalHeader = ['Mes', 'Consumo (kWh)', 'Geracao (kWh)', 'PPA (R$)', 'Custo SEM (R$)', 'Custo COM Rede (R$)', 'Custo COM Total (R$)', 'ICMS Adicional (R$)', 'PIS/COFINS Adicional (R$)', 'Economia (R$)', 'Economia Acum. (R$)'];
  const consumoForMonth = (mi: number) => {
    let sum = 0;
    for (const uc of project.ucs) {
      sum += (uc.consumptionFP[mi] ?? 0)
        + (uc.consumptionPT[mi] ?? 0)
        + (uc.consumptionReservado?.[mi] ?? 0);
    }
    return sum;
  };
  const mensalRows = result.months.map(m => [
    m.label,
    Math.round(consumoForMonth(m.monthIndex)),
    Math.round(m.generation),
    Math.round(m.ppaCost),
    Math.round(m.sem.totalCost),
    Math.round(m.com.redeCost),
    Math.round(m.com.totalCost),
    Math.round(m.com.icmsAdditional),
    Math.round(m.com.pisCofinsAdditional ?? 0),
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

  // Sheet 4b: Atribuição (only when attribution decomposition was computed)
  if (result.attribution) {
    const a = result.attribution;
    const d = a.decomposition;
    const pctOfTotal = (n: number) => (d.totalCustomerBenefit > 0
      ? (n / d.totalCustomerBenefit * 100).toFixed(1) + '%'
      : '—');

    const attribData: (string | number)[][] = [
      ['ATRIBUIÇÃO DE VALOR — Decomposição da economia por origem'],
      [''],
      ['Componente', 'Valor (R$)', '% da economia total', 'Atribuível a'],
      ['Custo SEM ativos (linha de base)', Math.round(d.bareBaseline), '100,0%', 'conta cheia da distribuidora'],
      ['(−) Banco inicial (créditos pré-existentes)', Math.round(d.initialBankEffect), pctOfTotal(d.initialBankEffect), 'cliente'],
      ['(−) Geração própria (usinas do cliente)', Math.round(d.ownPlantsEffect), pctOfTotal(d.ownPlantsEffect), 'cliente'],
      ['(−) Distribuição BAT → outras UCs', Math.round(d.batDistribEffect), pctOfTotal(d.batDistribEffect), 'cliente (rateio interno)'],
      [`(−) ${project.plant.name || 'Usina Helexia'} (PPA pago)`, Math.round(d.helexiaCS3Effect), pctOfTotal(d.helexiaCS3Effect), 'Helexia'],
      ['= Custo COM Helexia (final)', Math.round(d.bareBaseline - d.totalCustomerBenefit), '', ''],
      ['Economia total do cliente', Math.round(d.totalCustomerBenefit), (d.bareBaseline > 0 ? (d.totalCustomerBenefit / d.bareBaseline * 100).toFixed(1) + '%' : '—'), 'soma dos 4 componentes'],
      [''],
      ['RECONCILIAÇÃO POR CENÁRIO'],
      ['Cenário', 'Custo rede (R$)', 'PPA (R$)', 'Total (R$)'],
      ...a.scenarios.map(s => [
        s.label,
        Math.round(s.totalRedeCost),
        s.totalPPACost > 0 ? Math.round(s.totalPPACost) : '',
        Math.round(s.totalCost),
      ]),
      [''],
      ['DECOMPOSIÇÃO MENSAL'],
      ['Mes', 'Banco inicial (R$)', 'Geração própria (R$)', 'BAT distrib (R$)', `${project.plant.name || 'Usina Helexia'} (R$)`, 'Economia total (R$)'],
      ...a.monthly.map(m => [
        m.label,
        Math.round(m.initialBankEffect),
        Math.round(m.ownPlantsEffect),
        Math.round(m.batDistribEffect),
        Math.round(m.helexiaCS3Effect),
        Math.round(m.initialBankEffect + m.ownPlantsEffect + m.batDistribEffect + m.helexiaCS3Effect),
      ]),
    ];
    const wsAttr = XLSX.utils.aoa_to_sheet(attribData);
    wsAttr['!cols'] = [{ wch: 42 }, { wch: 18 }, { wch: 18 }, { wch: 28 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsAttr, 'Atribuição');
  }

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
    ...(() => {
      const plants = [plant, ...(project.additionalPlants ?? [])];
      const rows: (string | number)[][] = [];
      plants.forEach((pl, i) => {
        const label = i === 0 ? 'Usina principal' : `Usina adicional ${i}`;
        rows.push([label, pl.name]);
        rows.push(['  ↳ Potência AC', `${pl.capacityKWac.toLocaleString('pt-BR')} kWac`]);
        rows.push(['  ↳ PPA', `R$ ${pl.ppaRateRsBRLkWh.toFixed(4)}/kWh`]);
        rows.push(['  ↳ Prazo PPA', `${pl.contractMonths} meses`]);
      });
      const totalAC = plants.reduce((acc, pl) => acc + (pl.capacityKWac || 0), 0);
      if (plants.length > 1) rows.push(['Capacidade AC total', `${totalAC.toLocaleString('pt-BR')} kWac`]);
      rows.push(['Inicio Contrato', plant.contractStartMonth]);
      rows.push(['Horizonte de simulação', `${computeSimulationMonths(project)} meses`]);
      return rows;
    })(),
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
