import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import type { Project, SimulationResult } from './types';
import { runSimulation } from './simulation';
import { computeDerivedTariffs } from './tariff';

// Brand colours
const NAVY = '#004B70';
const TEAL = '#2F927B';
const LIME = '#C6DA38';
const LIGHT_GREY = '#f1f5f9';

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: 'Helvetica', color: '#1e293b' },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingBottom: 10 },
  pageHeaderText: { fontSize: 7, color: '#94a3b8' },
  // Cover
  coverCenter: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  coverTitle: { fontSize: 28, fontWeight: 'bold', color: NAVY, marginBottom: 8 },
  coverSubtitle: { fontSize: 14, color: '#64748b', marginBottom: 4 },
  coverTag: { fontSize: 11, color: TEAL, marginTop: 20 },
  coverDate: { position: 'absolute', bottom: 40, left: 40, fontSize: 8, color: '#94a3b8' },
  // Section
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: NAVY, marginBottom: 12, borderBottomWidth: 2, borderBottomColor: TEAL, paddingBottom: 4 },
  // KPI row
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  kpiCard: { flex: 1, padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  kpiLabel: { fontSize: 7, color: '#64748b', marginBottom: 2 },
  kpiValue: { fontSize: 13, fontWeight: 'bold', color: NAVY },
  kpiSub: { fontSize: 7, color: '#94a3b8', marginTop: 2 },
  // Table
  table: { marginBottom: 12 },
  tableHeader: { flexDirection: 'row', backgroundColor: NAVY, padding: 6, borderRadius: 3 },
  tableHeaderCell: { color: 'white', fontSize: 7, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', padding: 5, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  tableRowAlt: { flexDirection: 'row', padding: 5, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', backgroundColor: LIGHT_GREY },
  tableCell: { fontSize: 8 },
  tableCellBold: { fontSize: 8, fontWeight: 'bold' },
  // Premissas
  premissaRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  premissaLabel: { width: '40%', fontSize: 8, color: '#64748b' },
  premissaValue: { width: '60%', fontSize: 8, fontWeight: 'bold' },
  // Notes
  noteTitle: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 4 },
  noteText: { fontSize: 8, color: '#475569', marginBottom: 8, lineHeight: 1.4 },
  // Waterfall
  waterfallRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  waterfallLabel: { width: '30%', fontSize: 8 },
  waterfallBar: { height: 16, borderRadius: 3 },
  waterfallValue: { fontSize: 8, fontWeight: 'bold', marginLeft: 6 },
});

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
function fmtKWh(v: number): string {
  return Math.round(v).toLocaleString('pt-BR') + ' kWh';
}
function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + '%';
}
function fmtRate(v: number, decimals = 4): string {
  return 'R$ ' + v.toFixed(decimals) + '/kWh';
}

// ─── Helpers (mirror simulation.ts) ──────────────────────────────
function pdfExtendConsumption(base: number[], contractMonths: number, growthPerYear: number): number[] {
  if (!base || base.length === 0) return new Array(contractMonths).fill(0);
  const extended = [...base];
  const seasonal = base.slice(0, Math.min(base.length, 12));
  while (extended.length < contractMonths) {
    const m = extended.length;
    const calMonth = m % 12;
    const yearIdx = Math.floor(m / 12);
    const baseVal = seasonal[calMonth] ?? base[m % base.length] ?? 0;
    extended.push(Math.round(baseVal * Math.pow(1 + growthPerYear, yearIdx)));
  }
  return extended.slice(0, contractMonths);
}

function pdfExtendGeneration(base: number[], contractMonths: number, degradation: number): number[] {
  if (!base || base.length === 0) return new Array(contractMonths).fill(0);
  const extended: number[] = [];
  const seasonal = base.slice(0, Math.min(base.length, 12));
  for (let m = 0; m < contractMonths; m++) {
    const yearIdx = Math.floor(m / 12);
    const factor = Math.pow(1 - degradation, yearIdx);
    const baseVal = m < base.length ? base[m] : (seasonal[m % 12] ?? 0);
    extended.push(Math.round(baseVal * factor));
  }
  return extended;
}

function monthLabels(contractStart: string, count: number): string[] {
  const [yStr, mStr] = contractStart.split('-');
  const y0 = parseInt(yStr, 10);
  const m0 = parseInt(mStr, 10) - 1;
  const abbr = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return Array.from({ length: count }, (_, i) => {
    const m = (m0 + i) % 12;
    const y = y0 + Math.floor((m0 + i) / 12);
    return `${abbr[m]}/${String(y).slice(-2)}`;
  });
}

// ─── Stacked bar chart (pure Views, no external lib) ─────────────
interface StackedChartSeries {
  key: string;
  data: number[];
  color: string;
  label: string;
}

function StackedBarChart({ months, series, width = 515, height = 130 }: {
  months: string[];
  series: StackedChartSeries[];
  width?: number;
  height?: number;
}) {
  const n = months.length;
  const barGap = 2;
  const barWidth = Math.max(4, (width - barGap * (n - 1)) / n);
  const totals = months.map((_, i) => series.reduce((acc, s) => acc + (s.data[i] || 0), 0));
  const maxTotal = Math.max(1, ...totals);

  const bars = months.map((label, i) => {
    const segments = series.map((s) => {
      const val = s.data[i] || 0;
      return { h: (val / maxTotal) * height, color: s.color };
    });
    return React.createElement(View, {
      key: i,
      style: {
        width: barWidth,
        marginRight: i === n - 1 ? 0 : barGap,
        height,
        flexDirection: 'column-reverse',
      },
    },
      ...segments.map((seg, j) =>
        React.createElement(View, { key: j, style: { width: barWidth, height: seg.h, backgroundColor: seg.color } })
      )
    );
  });

  const labels = months.map((label, i) =>
    React.createElement(Text, {
      key: i,
      style: { width: barWidth, marginRight: i === n - 1 ? 0 : barGap, fontSize: 5, textAlign: 'center', color: '#64748b' },
    }, label)
  );

  const legend = React.createElement(View, {
    style: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 6 },
  },
    ...series.map((s, i) =>
      React.createElement(View, { key: i, style: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 12 } },
        React.createElement(View, { style: { width: 8, height: 8, backgroundColor: s.color, borderRadius: 1 } }),
        React.createElement(Text, { style: { fontSize: 7 } }, s.label)
      )
    )
  );

  return React.createElement(View, null,
    React.createElement(View, { style: { flexDirection: 'row', alignItems: 'flex-end', width, height, marginBottom: 2 } }, ...bars),
    React.createElement(View, { style: { flexDirection: 'row', width } }, ...labels),
    legend,
  );
}

function computeAggregateConsumption(project: Project): { fp: number[]; pt: number[]; rsv: number[] } {
  const cm = project.plant.contractMonths || 24;
  const growth = project.growthRate ?? 0.025;
  const fp: number[] = new Array(cm).fill(0);
  const pt: number[] = new Array(cm).fill(0);
  const rsv: number[] = new Array(cm).fill(0);
  for (const uc of project.ucs) {
    const extFP = pdfExtendConsumption(uc.consumptionFP, cm, growth);
    const extPT = pdfExtendConsumption(uc.consumptionPT || [], cm, growth);
    const extRSV = uc.consumptionReservado ? pdfExtendConsumption(uc.consumptionReservado, cm, growth) : new Array(cm).fill(0);
    for (let m = 0; m < cm; m++) {
      fp[m] += extFP[m];
      pt[m] += extPT[m];
      rsv[m] += extRSV[m];
    }
  }
  return { fp, pt, rsv };
}

function Header({ clientName, plantName }: { clientName: string; plantName: string }) {
  return React.createElement(View, { style: s.pageHeader },
    React.createElement(Text, { style: s.pageHeaderText }, `${clientName} — ${plantName}`),
    React.createElement(Text, { style: s.pageHeaderText }, 'Helexia Brasil — Proposta Comercial')
  );
}

function CoverPage({ project, generatedAt }: { project: Project; generatedAt: string }) {
  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(View, { style: s.coverCenter },
      React.createElement(Image, { src: '/GD-analyzer/Helexia_main_logo_screen_L.png', style: { width: 180, marginBottom: 30 } }),
      React.createElement(Text, { style: s.coverTitle }, project.clientName),
      React.createElement(Text, { style: s.coverSubtitle }, project.plant.name),
      React.createElement(Text, { style: s.coverSubtitle }, `${project.distributor.name} — ${project.distributor.state}`),
      React.createElement(Text, { style: s.coverTag }, 'Proposta Comercial — Geracao Distribuida'),
      React.createElement(Text, { style: { fontSize: 9, color: '#94a3b8', marginTop: 8 } },
        `Contrato: ${project.plant.contractStartMonth} — ${project.plant.contractMonths} meses`)
    ),
    React.createElement(Text, { style: s.coverDate },
      `Documento gerado em ${new Date(generatedAt).toLocaleDateString('pt-BR')}`)
  );
}

function durationLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12} anos` : `${months} meses`;
}

function SummaryPage({ project, result }: { project: Project; result: SimulationResult }) {
  const sm = result.summary;
  const cm = project.plant.contractMonths || 24;
  const maxCost = Math.max(sm.baselineSEM, sm.totalPPACost + (sm.baselineSEM - sm.economiaLiquida - sm.totalPPACost));
  const barScale = 300 / (maxCost || 1);

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Resumo Executivo'),
    // KPIs
    React.createElement(View, { style: s.kpiRow },
      ...[
        { label: `Geracao ${durationLabel(cm)}`, value: fmtKWh(sm.totalGeneration), sub: 'P50 injetado' },
        { label: 'Economia Liquida', value: fmtBRL(sm.economiaLiquida), sub: fmtPct(sm.economiaPct) + ' reducao' },
        { label: 'Banco Residual', value: fmtBRL(sm.bancoResidualValue), sub: fmtKWh(sm.bancoResidualKWh) },
        { label: 'VALOR TOTAL', value: fmtBRL(sm.valorTotal), sub: 'Economia + Banco' },
      ].map((kpi, i) =>
        React.createElement(View, { key: i, style: s.kpiCard },
          React.createElement(Text, { style: s.kpiLabel }, kpi.label),
          React.createElement(Text, { style: s.kpiValue }, kpi.value),
          React.createElement(Text, { style: s.kpiSub }, kpi.sub)
        )
      )
    ),
    // Cost waterfall
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 8, marginTop: 8 } }, `Decomposicao de Custos (${durationLabel(cm)})`),
    ...[
      { label: 'SEM Helexia (baseline)', value: sm.baselineSEM, color: '#6692A8' },
      { label: 'COM Helexia — Rede', value: sm.baselineSEM - sm.economiaLiquida - sm.totalPPACost, color: NAVY },
      { label: 'COM Helexia — PPA', value: sm.totalPPACost, color: TEAL },
      { label: 'Economia Liquida', value: sm.economiaLiquida, color: LIME },
    ].map((row, i) =>
      React.createElement(View, { key: i, style: s.waterfallRow },
        React.createElement(Text, { style: s.waterfallLabel }, row.label),
        React.createElement(View, { style: { ...s.waterfallBar, width: Math.max(2, Math.abs(row.value) * barScale), backgroundColor: row.color } }),
        React.createElement(Text, { style: s.waterfallValue }, fmtBRL(row.value))
      )
    ),
    // Yearly summary table
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 8, marginTop: 16 } }, `Resumo por Ano (${durationLabel(cm)})`),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['Periodo', 'Geracao', 'SEM (R$)', 'COM (R$)', 'Economia', 'Eco. Acum.'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: i === 0 ? '14%' : '17.2%', textAlign: i === 0 ? 'left' : 'right' } }, h)
        )
      ),
      ...(() => {
        const years = Math.ceil(cm / 12);
        let acum = 0;
        return Array.from({ length: years }, (_, y) => {
          const start = y * 12;
          const end = Math.min(start + 12, cm);
          const yearMonths = result.months.slice(start, end);
          const gen = yearMonths.reduce((s, m) => s + m.generation, 0);
          const sem = yearMonths.reduce((s, m) => s + m.sem.totalCost, 0);
          const com = yearMonths.reduce((s, m) => s + m.com.totalCost, 0);
          const eco = yearMonths.reduce((s, m) => s + m.economia, 0);
          acum += eco;
          return React.createElement(View, { key: y, style: y % 2 ? s.tableRowAlt : s.tableRow },
            React.createElement(Text, { style: { ...s.tableCell, width: '14%' } }, `Ano ${y + 1}`),
            React.createElement(Text, { style: { ...s.tableCell, width: '17.2%', textAlign: 'right' } }, fmtKWh(gen)),
            React.createElement(Text, { style: { ...s.tableCell, width: '17.2%', textAlign: 'right' } }, fmtBRL(sem)),
            React.createElement(Text, { style: { ...s.tableCell, width: '17.2%', textAlign: 'right' } }, fmtBRL(com)),
            React.createElement(Text, { style: { ...s.tableCellBold, width: '17.2%', textAlign: 'right', color: eco >= 0 ? TEAL : '#dc2626' } }, fmtBRL(eco)),
            React.createElement(Text, { style: { ...s.tableCellBold, width: '17.2%', textAlign: 'right', color: acum >= 0 ? TEAL : '#dc2626' } }, fmtBRL(acum))
          );
        });
      })()
    )
  );
}

function BankPage({ project, result }: { project: Project; result: SimulationResult }) {
  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Banco de Creditos por UC'),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['UC', 'Grupo', 'Banco COM (kWh)', 'Banco SEM (kWh)', 'Delta Helexia', 'Valor @ PPA'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: i === 0 ? '25%' : '15%', textAlign: i < 2 ? 'left' : 'right' } }, h)
        )
      ),
      ...result.bankPerUC.map((b, i) =>
        React.createElement(View, { key: i, style: i % 2 ? s.tableRowAlt : s.tableRow },
          React.createElement(Text, { style: { ...s.tableCell, width: '25%' } }, b.name),
          React.createElement(Text, { style: { ...s.tableCell, width: '15%' } }, project.ucs.find(u => u.id === b.ucId)?.tariffGroup || ''),
          React.createElement(Text, { style: { ...s.tableCell, width: '15%', textAlign: 'right' } }, Math.round(b.finalBankCOM).toLocaleString('pt-BR')),
          React.createElement(Text, { style: { ...s.tableCell, width: '15%', textAlign: 'right' } }, Math.round(b.finalBankSEM).toLocaleString('pt-BR')),
          React.createElement(Text, { style: { ...s.tableCellBold, width: '15%', textAlign: 'right', color: TEAL } }, Math.round(b.finalBankCOM - b.finalBankSEM).toLocaleString('pt-BR')),
          React.createElement(Text, { style: { ...s.tableCell, width: '15%', textAlign: 'right' } }, fmtBRL(b.valueAtPPA))
        )
      )
    ),
    // Sensitivity table
    React.createElement(Text, { style: { ...s.sectionTitle, marginTop: 20 } }, 'Sensibilidade de Geracao'),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['Cenario', `Geracao ${durationLabel(project.plant.contractMonths || 24)}`, 'PPA (R$)', 'Economia (R$)', 'Reducao (%)'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: '20%', textAlign: i === 0 ? 'left' : 'right' } }, h)
        )
      ),
      ...[
        { label: 'P90 Pessimista', mult: 0.90, color: '#dc2626' },
        { label: 'P50 Base', mult: 1.00, color: NAVY },
        { label: 'P10 Otimista', mult: 1.10, color: TEAL },
      ].map((scenario, i) => {
        const scaledProject = {
          ...project,
          plant: {
            ...project.plant,
            p50Profile: project.plant.p50Profile.map(v => Math.round(v * scenario.mult)),
          },
        };
        let simResult;
        try { simResult = runSimulation(scaledProject); } catch { return null; }
        const gen = simResult.summary.totalGeneration;
        const ppa = simResult.summary.totalPPACost;
        const eco = simResult.summary.economiaLiquida;
        const pct = simResult.summary.economiaPct;
        return React.createElement(View, { key: i, style: i % 2 ? s.tableRowAlt : s.tableRow },
          React.createElement(Text, { style: { ...s.tableCellBold, width: '20%', color: scenario.color } }, scenario.label),
          React.createElement(Text, { style: { ...s.tableCell, width: '20%', textAlign: 'right' } }, fmtKWh(gen)),
          React.createElement(Text, { style: { ...s.tableCell, width: '20%', textAlign: 'right' } }, fmtBRL(ppa)),
          React.createElement(Text, { style: { ...s.tableCellBold, width: '20%', textAlign: 'right', color: eco >= 0 ? TEAL : '#dc2626' } }, fmtBRL(eco)),
          React.createElement(Text, { style: { ...s.tableCell, width: '20%', textAlign: 'right' } }, fmtPct(pct))
        );
      }).filter(Boolean)
    )
  );
}

function PremissasPage({ project }: { project: Project }) {
  const dist = project.distributor;
  const plant = project.plant;
  const premissas = [
    ['Distribuidora', `${dist.name} (${dist.state})`],
    ['Resolucao', dist.resolution],
    ['Tarifa B3 (TUSD+TE)', `R$ ${(dist.tariffs.B_TUSD + dist.tariffs.B_TE).toFixed(4)}/kWh`],
    ['Tarifa A FP (TUSD+TE)', `R$ ${dist.tariffs.A_FP_TUSD_TE.toFixed(4)}/kWh`],
    ['Tarifa A PT (TUSD+TE)', `R$ ${dist.tariffs.A_PT_TUSD_TE.toFixed(4)}/kWh`],
    ...(dist.tariffs.A_FP_DEMANDA ? [['Demanda A FP', `R$ ${dist.tariffs.A_FP_DEMANDA.toFixed(2)}/kW/mês`]] : []),
    ['ICMS', `${(dist.taxes.ICMS * 100).toFixed(0)}%`],
    ['PIS/COFINS', `${(dist.taxes.PIS * 100).toFixed(2)}% / ${(dist.taxes.COFINS * 100).toFixed(2)}%`],
    ['', ''],
    ['Usina', plant.name],
    ['Potencia AC', `${plant.capacityKWac} kWac`],
    ['PPA', `R$ ${plant.ppaRateRsBRLkWh.toFixed(4)}/kWh`],
    ['Inicio Contrato', plant.contractStartMonth],
    ['Prazo', `${plant.contractMonths} meses`],
    ['', ''],
    ['Isencao ICMS', project.scenarios.icmsExempt ? 'Sim' : 'Nao'],
    ['Desconto Concorrente (Plin)', project.scenarios.competitorDiscount > 0 ? `${(project.scenarios.competitorDiscount * 100).toFixed(0)}%` : 'Nao'],
    ['Numero de UCs', `${project.ucs.length}`],
    ['UCs Grupo A', `${project.ucs.filter(u => u.isGrupoA).length}`],
    ['UCs Grupo B', `${project.ucs.filter(u => !u.isGrupoA).length}`],
  ];

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Premissas'),
    ...premissas.map(([label, value], i) =>
      label === '' ? React.createElement(View, { key: i, style: { height: 8 } }) :
      React.createElement(View, { key: i, style: s.premissaRow },
        React.createElement(Text, { style: s.premissaLabel }, label),
        React.createElement(Text, { style: s.premissaValue }, value)
      )
    )
  );
}

function NotesPage({ project }: { project: Project }) {
  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Notas Regulatorias'),
    React.createElement(Text, { style: s.noteTitle }, 'Lei 14.300/2022 — SCEE Autoconsumo Remoto'),
    React.createElement(Text, { style: s.noteText }, 'O Sistema de Compensacao de Energia Eletrica (SCEE) permite que a energia injetada pela usina solar gere creditos que compensam o consumo das Unidades Consumidoras (UCs) do cliente, mesmo que em enderecos diferentes, dentro da mesma area de concessao.'),
    React.createElement(Text, { style: s.noteTitle }, 'Rateio Fixo por Periodos'),
    React.createElement(Text, { style: s.noteText }, `A alocacao dos creditos entre as UCs segue o modelo de rateio fixo por periodos ao longo do contrato de ${durationLabel(project.plant.contractMonths || 24)}. O rateio e otimizado para maximizar a economia liquida do cliente, considerando o perfil de consumo de cada UC e suas tarifas.`),
    React.createElement(Text, { style: s.noteTitle }, 'Validade dos Creditos'),
    React.createElement(Text, { style: s.noteText }, 'Conforme regulamentacao vigente, os creditos de energia gerados no ambito do SCEE tem validade ate 2045, podendo ser acumulados no banco de creditos da distribuidora e utilizados em faturas futuras.'),
    !project.scenarios.icmsExempt && React.createElement(View, null,
      React.createElement(Text, { style: { ...s.noteTitle, color: '#dc2626' } }, 'Risco ICMS (Art. 23-A RICMS)'),
      React.createElement(Text, { style: s.noteText }, 'ATENCAO: A isencao de ICMS nao esta ativada para esta simulacao. Caso o estado aplique ICMS sobre a energia compensada, os custos adicionais estimados estao refletidos no campo "Risco ICMS" do resumo executivo.')
    ),
    React.createElement(View, { style: { marginTop: 30, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 } },
      React.createElement(Text, { style: { fontSize: 7, color: '#94a3b8' } }, 'Este documento e uma estimativa baseada em dados fornecidos e projecoes de geracao P50. Os valores reais podem variar conforme condicoes climaticas, alteracoes tarifarias e disponibilidade da usina. Helexia Brasil nao garante os valores apresentados.'),
    )
  );
}

// ─── NEW: Usina page — plant specs + P50 chart ───────────────────
function UsinaPage({ project }: { project: Project }) {
  const plant = project.plant;
  const cm = plant.contractMonths || 24;
  const degradation = project.generationDegradation ?? 0.005;
  const perfFactor = project.performanceFactor ?? 1.0;
  const rawProfile = plant.useActual && plant.actualProfile ? plant.actualProfile : plant.p50Profile;
  const extP50 = pdfExtendGeneration(rawProfile, cm, degradation);
  const extEffective = extP50.map(v => Math.round(v * perfFactor));
  const totalP50 = extP50.reduce((a, b) => a + b, 0);
  const totalEffective = extEffective.reduce((a, b) => a + b, 0);
  const labels = monthLabels(plant.contractStartMonth, cm);

  // Year 1 breakdown
  const year1Labels = labels.slice(0, Math.min(12, cm));
  const year1P50 = extEffective.slice(0, Math.min(12, cm));
  const year1Total = year1P50.reduce((a, b) => a + b, 0);
  const year1Avg = year1Total / year1Labels.length;
  const year1Peak = Math.max(...year1P50);
  const year1Low = Math.min(...year1P50);

  const specs: [string, string][] = [
    ['Usina', plant.name],
    ['Potência AC', `${plant.capacityKWac.toLocaleString('pt-BR')} kWac`],
    ['Distribuidora', `${project.distributor.name} — ${project.distributor.state}`],
    ['Fonte de geração', plant.useActual && plant.actualProfile ? 'Dados reais medidos' : 'P50 PVsyst'],
    ['Degradação anual', fmtPct(degradation)],
    ['Fator de performance', fmtPct(perfFactor)],
    ['Geração Ano 1 (efetiva)', fmtKWh(year1Total)],
    ['Geração média mensal', fmtKWh(Math.round(year1Avg))],
    ['Pico mensal (Ano 1)', fmtKWh(year1Peak)],
    ['Mínimo mensal (Ano 1)', fmtKWh(year1Low)],
    [`Geração total ${durationLabel(cm)}`, fmtKWh(totalEffective)],
  ];

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Usina Solar'),
    React.createElement(View, { style: { marginBottom: 14 } },
      ...specs.map(([label, value], i) =>
        React.createElement(View, { key: i, style: s.premissaRow },
          React.createElement(Text, { style: s.premissaLabel }, label),
          React.createElement(Text, { style: s.premissaValue }, value)
        )
      )
    ),
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 6 } },
      `Perfil de geração mensal (${plant.useActual && plant.actualProfile ? 'medida real' : 'P50 PVsyst'}${perfFactor < 1 ? ` × ${(perfFactor * 100).toFixed(0)}%` : ''})`
    ),
    StackedBarChart({
      months: labels,
      series: [
        { key: 'gen', data: extEffective, color: TEAL, label: `Geração efetiva (kWh)` },
      ],
    }),
    perfFactor < 1.0 && React.createElement(Text, { style: { fontSize: 7, color: '#94a3b8', marginTop: 10, textAlign: 'center' } },
      `P50 bruto total: ${fmtKWh(totalP50)} — haircut ${(perfFactor * 100).toFixed(0)}% aplicado para refletir subperformance real`
    ),
    // Monthly table (Year 1)
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginTop: 18, marginBottom: 6 } },
      'Geração mensal — Ano 1'
    ),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['Mês', 'Geração (kWh)', '% do total'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: i === 0 ? '25%' : '37.5%', textAlign: i === 0 ? 'left' : 'right' } }, h)
        )
      ),
      ...year1Labels.map((lab, i) =>
        React.createElement(View, { key: i, style: i % 2 ? s.tableRowAlt : s.tableRow },
          React.createElement(Text, { style: { ...s.tableCell, width: '25%' } }, lab),
          React.createElement(Text, { style: { ...s.tableCell, width: '37.5%', textAlign: 'right' } }, fmtKWh(year1P50[i])),
          React.createElement(Text, { style: { ...s.tableCell, width: '37.5%', textAlign: 'right' } }, fmtPct(year1P50[i] / Math.max(1, year1Total)))
        )
      ),
    ),
  );
}

// ─── NEW: Consumption page — client baseline ─────────────────────
function ConsumptionPage({ project }: { project: Project }) {
  const cm = project.plant.contractMonths || 24;
  const agg = computeAggregateConsumption(project);
  const labels = monthLabels(project.plant.contractStartMonth, cm);
  const totalFP = agg.fp.reduce((a, b) => a + b, 0);
  const totalPT = agg.pt.reduce((a, b) => a + b, 0);
  const totalRSV = agg.rsv.reduce((a, b) => a + b, 0);
  const total = totalFP + totalPT + totalRSV;
  const hasRSV = totalRSV > 0;
  const hasPT = totalPT > 0;

  const series: StackedChartSeries[] = [
    { key: 'FP', data: agg.fp, color: TEAL, label: 'Fora Ponta' },
  ];
  if (hasPT) series.push({ key: 'PT', data: agg.pt, color: NAVY, label: 'Ponta' });
  if (hasRSV) series.push({ key: 'RSV', data: agg.rsv, color: '#f59e0b', label: 'Reservado' });

  const postoRows: { label: string; val: number; color: string; show: boolean }[] = [
    { label: 'Fora Ponta', val: totalFP, color: TEAL, show: true },
    { label: 'Ponta', val: totalPT, color: NAVY, show: hasPT },
    { label: 'Reservado (rural irrigante)', val: totalRSV, color: '#f59e0b', show: hasRSV },
  ];

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Consumo do Cliente (Antes do GD)'),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 14 } },
      `Este é o perfil de consumo projetado para os próximos ${durationLabel(cm)}, com base nos dados históricos informados e taxa de crescimento de ${fmtPct(project.growthRate ?? 0.025)}/ano. É sobre este volume que a economia com geração distribuída é calculada.`
    ),
    // Totals per posto
    React.createElement(View, { style: s.kpiRow },
      ...postoRows.filter(r => r.show).map((row, i) =>
        React.createElement(View, { key: i, style: { ...s.kpiCard, borderLeftWidth: 3, borderLeftColor: row.color } },
          React.createElement(Text, { style: s.kpiLabel }, row.label),
          React.createElement(Text, { style: s.kpiValue }, fmtKWh(row.val)),
          React.createElement(Text, { style: s.kpiSub }, fmtPct(row.val / Math.max(1, total)) + ' do total')
        )
      ),
      React.createElement(View, { key: 'total', style: { ...s.kpiCard, backgroundColor: LIGHT_GREY } },
        React.createElement(Text, { style: s.kpiLabel }, 'Consumo total'),
        React.createElement(Text, { style: s.kpiValue }, fmtKWh(total)),
        React.createElement(Text, { style: s.kpiSub }, `${durationLabel(cm)}`)
      ),
    ),
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 6, marginTop: 4 } },
      'Evolução mensal do consumo agregado'
    ),
    StackedBarChart({ months: labels, series }),
    // Per-UC table
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginTop: 16, marginBottom: 6 } },
      'Detalhamento por Unidade Consumidora'
    ),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['UC', 'Grupo', 'FP', ...(hasPT ? ['PT'] : []), ...(hasRSV ? ['RSV'] : []), 'Total', '% total'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: i === 0 ? '28%' : i === 1 ? '10%' : '12%', textAlign: i < 2 ? 'left' : 'right' } }, h)
        )
      ),
      ...project.ucs.map((uc, idx) => {
        const extFP = pdfExtendConsumption(uc.consumptionFP, cm, project.growthRate ?? 0.025);
        const extPT = pdfExtendConsumption(uc.consumptionPT || [], cm, project.growthRate ?? 0.025);
        const extRSV = uc.consumptionReservado ? pdfExtendConsumption(uc.consumptionReservado, cm, project.growthRate ?? 0.025) : new Array(cm).fill(0);
        const sFP = extFP.reduce((a, b) => a + b, 0);
        const sPT = extPT.reduce((a, b) => a + b, 0);
        const sRSV = extRSV.reduce((a, b) => a + b, 0);
        const sTotal = sFP + sPT + sRSV;
        const cells: React.ReactElement[] = [
          React.createElement(Text, { key: 'name', style: { ...s.tableCell, width: '28%' } }, uc.name),
          React.createElement(Text, { key: 'grp', style: { ...s.tableCell, width: '10%' } }, uc.tariffGroup),
          React.createElement(Text, { key: 'fp', style: { ...s.tableCell, width: '12%', textAlign: 'right' } }, fmtKWh(sFP)),
        ];
        if (hasPT) cells.push(React.createElement(Text, { key: 'pt', style: { ...s.tableCell, width: '12%', textAlign: 'right' } }, fmtKWh(sPT)));
        if (hasRSV) cells.push(React.createElement(Text, { key: 'rsv', style: { ...s.tableCell, width: '12%', textAlign: 'right' } }, fmtKWh(sRSV)));
        cells.push(React.createElement(Text, { key: 'tot', style: { ...s.tableCellBold, width: '12%', textAlign: 'right' } }, fmtKWh(sTotal)));
        cells.push(React.createElement(Text, { key: 'pct', style: { ...s.tableCell, width: '12%', textAlign: 'right' } }, fmtPct(sTotal / Math.max(1, total))));
        return React.createElement(View, { key: idx, style: idx % 2 ? s.tableRowAlt : s.tableRow }, ...cells);
      })
    ),
  );
}

// ─── NEW: Tariff vs PPA breakdown ────────────────────────────────
function TariffComparisonPage({ project }: { project: Project }) {
  // Always recompute derived tariffs from raw — the stored distributor may have
  // stale values (the simulation also does this on every run).
  const d = computeDerivedTariffs(project.distributor);
  const ppa = project.plant.ppaRateRsBRLkWh;
  const FA = d.FA ?? 0;
  const T_AFP = d.T_AFP ?? 0;
  const T_APT = d.T_APT ?? 0;
  const T_ARSV = d.T_ARSV;
  const T_B3 = d.T_B3 ?? 0;
  const T_BRSV = d.T_BRSV;

  const hasGrupoA = project.ucs.some(u => u.isGrupoA);
  const hasGrupoB = project.ucs.some(u => !u.isGrupoA);
  const hasARSV = hasGrupoA && T_ARSV !== undefined && project.ucs.some(u => u.isGrupoA && u.consumptionReservado && u.consumptionReservado.some(v => v > 0));
  const hasBRSV = hasGrupoB && T_BRSV !== undefined && project.ucs.some(u => !u.isGrupoA && u.consumptionReservado && u.consumptionReservado.some(v => v > 0));

  interface Row {
    posto: string;
    tariff: number;
    conversion: string;
    effectivePPA: number;
    show: boolean;
  }

  const rows: Row[] = [
    { posto: 'Grupo A — Fora Ponta', tariff: T_AFP, conversion: '1:1 (mesmo posto)', effectivePPA: ppa, show: hasGrupoA },
    { posto: 'Grupo A — Ponta', tariff: T_APT, conversion: `via FA = TE_FP/TE_PT = ${FA.toFixed(3)}`, effectivePPA: FA > 0 ? ppa / FA : 0, show: hasGrupoA },
    { posto: 'Grupo A — Reservado', tariff: T_ARSV ?? 0, conversion: '1:1 (mesmo posto que FP)', effectivePPA: ppa, show: hasARSV },
    { posto: 'Grupo B', tariff: T_B3, conversion: '1:1 (sem posto)', effectivePPA: ppa, show: hasGrupoB },
    { posto: 'Grupo B — Reservado', tariff: T_BRSV ?? 0, conversion: '1:1 (sem posto)', effectivePPA: ppa, show: hasBRSV },
  ];

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'De Onde Vem a Economia'),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 12 } },
      `Cada kWh consumido em cada posto é compensado por créditos gerados pela usina. Para postos no mesmo "bucket" (ex: Fora Ponta e Reservado), a compensação é 1:1. Para postos diferentes (FP → PT), aplica-se o Fator de Ajuste (FA = TE_FP / TE_PT) que preserva o valor em TE do crédito.`
    ),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['Posto', 'Tarifa atual (com trib.)', 'Conversão', 'PPA efetivo', 'Economia/kWh'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: i === 0 ? '24%' : i === 2 ? '28%' : '16%', textAlign: i < 1 ? 'left' : i === 2 ? 'center' : 'right' } }, h)
        )
      ),
      ...rows.filter(r => r.show).map((r, i) => {
        const eco = r.tariff - r.effectivePPA;
        return React.createElement(View, { key: i, style: i % 2 ? s.tableRowAlt : s.tableRow },
          React.createElement(Text, { style: { ...s.tableCell, width: '24%' } }, r.posto),
          React.createElement(Text, { style: { ...s.tableCell, width: '16%', textAlign: 'right' } }, fmtRate(r.tariff)),
          React.createElement(Text, { style: { ...s.tableCell, width: '28%', textAlign: 'center' } }, r.conversion),
          React.createElement(Text, { style: { ...s.tableCell, width: '16%', textAlign: 'right' } }, fmtRate(r.effectivePPA)),
          React.createElement(Text, { style: { ...s.tableCellBold, width: '16%', textAlign: 'right', color: eco >= 0 ? TEAL : '#dc2626' } }, fmtRate(eco)),
        );
      })
    ),
    React.createElement(Text, { style: { ...s.noteTitle, marginTop: 14 } }, 'Como interpretar'),
    React.createElement(Text, { style: s.noteText },
      `• Posto "Fora Ponta" e "Reservado" compartilham o mesmo bucket — créditos FP compensam 1:1 em ambos, mas a tarifa aplicada na fatura difere.\n` +
      `• Para compensar 1 kWh de Ponta, são injetados 1/FA = ${FA > 0 ? (1 / FA).toFixed(3) : 'n/a'} kWh de créditos FP. O PPA efetivo no Ponta é, portanto, R$ ${ppa.toFixed(2)} × ${FA > 0 ? (1 / FA).toFixed(3) : '—'} = ${fmtRate(FA > 0 ? ppa / FA : 0)}.\n` +
      `• A coluna "Economia/kWh" positiva indica posto onde o GD gera valor líquido. Valor negativo indica posto onde o cliente paga mais que a tarifa economizada — geralmente compensado pelos ganhos em Ponta.`
    ),
    hasARSV && React.createElement(View, { style: { marginTop: 10 } },
      React.createElement(Text, { style: { ...s.noteTitle, color: '#b45309' } }, 'Observação — Horário Reservado'),
      React.createElement(Text, { style: s.noteText },
        `A tarifa do horário reservado (subsídio irrigante, Art. 186 REN 1000) é ~80% inferior à FP para Grupo A. Isso significa que compensar RSV com créditos FP a PPA ${fmtRate(ppa)} gera perda líquida por kWh — mas pela regra de mesmo posto (Art. 659 §2º), não é possível "pular" o RSV. O optimizador considera esse trade-off ao distribuir os créditos.`
      )
    ),
  );
}

// ─── NEW: Cumulative economia trajectory ─────────────────────────
function CumulativeEconomyPage({ project, result }: { project: Project; result: SimulationResult }) {
  const cm = project.plant.contractMonths || 24;
  const economias = result.months.map(m => m.economia);
  const acum = result.months.map(m => m.economiaAcum);
  const labels = result.months.map(m => m.label);
  const maxAbs = Math.max(...economias.map(Math.abs), 1);

  // Find break-even month (first month where economiaAcum >= 0 after going negative)
  let breakEvenMonth = -1;
  for (let i = 1; i < acum.length; i++) {
    if (acum[i - 1] < 0 && acum[i] >= 0) { breakEvenMonth = i; break; }
    if (i === 0 && acum[i] >= 0) { breakEvenMonth = 0; break; }
  }
  if (breakEvenMonth === -1 && acum.every(v => v >= 0)) breakEvenMonth = 0;

  const sm = result.summary;
  const oversized = sm.economiaLiquida < 0 && sm.valorTotal > 0;

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Trajetória da Economia'),
    React.createElement(View, { style: s.kpiRow },
      React.createElement(View, { style: s.kpiCard },
        React.createElement(Text, { style: s.kpiLabel }, 'Economia direta'),
        React.createElement(Text, { style: { ...s.kpiValue, color: sm.economiaLiquida >= 0 ? TEAL : '#dc2626' } }, fmtBRL(sm.economiaLiquida)),
        React.createElement(Text, { style: s.kpiSub }, 'tarifa evitada − PPA')
      ),
      React.createElement(View, { style: s.kpiCard },
        React.createElement(Text, { style: s.kpiLabel }, 'Banco Net Helexia'),
        React.createElement(Text, { style: { ...s.kpiValue, color: sm.bancoNetHelexia >= 0 ? TEAL : '#dc2626' } }, fmtBRL(sm.bancoNetHelexia)),
        React.createElement(Text, { style: s.kpiSub }, `${fmtKWh(sm.bancoResidualKWh)} residual`)
      ),
      React.createElement(View, { style: { ...s.kpiCard, borderLeftWidth: 3, borderLeftColor: LIME } },
        React.createElement(Text, { style: s.kpiLabel }, 'VALOR TOTAL'),
        React.createElement(Text, { style: { ...s.kpiValue, color: sm.valorTotal >= 0 ? TEAL : '#dc2626' } }, fmtBRL(sm.valorTotal)),
        React.createElement(Text, { style: s.kpiSub }, 'economia + banco')
      ),
      React.createElement(View, { style: s.kpiCard },
        React.createElement(Text, { style: s.kpiLabel }, 'Break-even (eco. direta)'),
        React.createElement(Text, { style: s.kpiValue }, breakEvenMonth >= 0 ? (labels[breakEvenMonth] || '—') : 'n/a'),
        React.createElement(Text, { style: s.kpiSub }, breakEvenMonth === 0 ? 'desde o início' : breakEvenMonth > 0 ? `mês ${breakEvenMonth + 1}` : 'não atinge no período')
      ),
    ),
    oversized && React.createElement(View, {
      style: { padding: 8, backgroundColor: '#fef3c7', borderRadius: 4, borderLeftWidth: 3, borderLeftColor: '#f59e0b', marginBottom: 12 },
    },
      React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold', color: '#b45309', marginBottom: 3 } }, 'Usina oversizing o cliente'),
      React.createElement(Text, { style: { fontSize: 8, color: '#78350f', lineHeight: 1.4 } },
        `A geração mensal da usina supera o consumo mensal do cliente — o excedente vai para o banco de créditos. A economia direta mensal fica negativa (PPA paga por kWh que não substituiu tarifa imediatamente), mas o valor fica acumulado no banco (R$ ${sm.bancoNetHelexia.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}), resultando em VALOR TOTAL positivo de ${fmtBRL(sm.valorTotal)}.`
      )
    ),
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 4, marginTop: 4 } },
      'Economia direta mensal (tarifa evitada − PPA) e acumulada'
    ),
    React.createElement(Text, { style: { fontSize: 7, color: '#94a3b8', marginBottom: 6 } },
      'Valores negativos indicam mês onde o PPA superou a tarifa evitada; excedente foi acumulado no banco de créditos.'
    ),
    // Monthly bar chart (positive vs negative)
    React.createElement(View, { style: { marginBottom: 14 } },
      ...result.months.map((m, i) => {
        const pct = Math.abs(m.economia) / maxAbs;
        const barWidth = pct * 350;
        return React.createElement(View, { key: i, style: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 } },
          React.createElement(Text, { style: { width: 42, fontSize: 7, color: '#64748b' } }, m.label),
          React.createElement(View, { style: { width: barWidth, height: 8, backgroundColor: m.economia >= 0 ? TEAL : '#dc2626', borderRadius: 1 } }),
          React.createElement(Text, { style: { width: 70, fontSize: 7, marginLeft: 4, color: m.economia >= 0 ? TEAL : '#dc2626' } }, fmtBRL(m.economia)),
          React.createElement(Text, { style: { width: 80, fontSize: 7, marginLeft: 4, color: '#64748b', textAlign: 'right' } }, 'acum: ' + fmtBRL(m.economiaAcum))
        );
      })
    ),
  );
}

// ─── NEW: Per-UC economia decomposition ──────────────────────────
function PerUCEconomyPage({ project, result }: { project: Project; result: SimulationResult }) {
  const rows = project.ucs.filter(u => u.id !== 'bat').map(uc => {
    const sem = result.ucDetailsSEM[uc.id] || [];
    const com = result.ucDetailsCOM[uc.id] || [];
    const semRede = sem.reduce((acc, m) => acc + m.costRede, 0);
    const comRede = com.reduce((acc, m) => acc + m.costRede, 0);
    const icmsAdd = com.reduce((acc, m) => acc + m.icmsAdditional, 0);
    const deltaRede = semRede - comRede - icmsAdd;
    return { uc, semRede, comRede, icmsAdd, deltaRede, pctRedu: semRede > 0 ? deltaRede / semRede : 0 };
  });
  const totalSem = rows.reduce((a, r) => a + r.semRede, 0);
  const totalCom = rows.reduce((a, r) => a + r.comRede, 0);
  const totalIcms = rows.reduce((a, r) => a + r.icmsAdd, 0);
  const totalDelta = rows.reduce((a, r) => a + r.deltaRede, 0);

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Benefício por Unidade Consumidora'),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 14 } },
      `Mostramos aqui a redução do custo de rede de cada UC pela compensação de créditos GD. O custo do PPA Helexia é compartilhado pela usina e não está alocado individualmente por UC — a economia líquida total (∆ rede − PPA) aparece no Resumo Executivo.`
    ),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['Unidade Consumidora', 'Grupo', 'Rede SEM', 'Rede COM', 'ICMS add.', '∆ Rede (ganho)', '% redução'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: i === 0 ? '26%' : i === 1 ? '10%' : '12.8%', textAlign: i < 2 ? 'left' : 'right' } }, h)
        )
      ),
      ...rows.map((r, i) =>
        React.createElement(View, { key: i, style: i % 2 ? s.tableRowAlt : s.tableRow },
          React.createElement(Text, { style: { ...s.tableCell, width: '26%' } }, r.uc.name),
          React.createElement(Text, { style: { ...s.tableCell, width: '10%' } }, r.uc.tariffGroup),
          React.createElement(Text, { style: { ...s.tableCell, width: '12.8%', textAlign: 'right' } }, fmtBRL(r.semRede)),
          React.createElement(Text, { style: { ...s.tableCell, width: '12.8%', textAlign: 'right' } }, fmtBRL(r.comRede)),
          React.createElement(Text, { style: { ...s.tableCell, width: '12.8%', textAlign: 'right', color: r.icmsAdd > 0 ? '#b45309' : '#64748b' } }, fmtBRL(r.icmsAdd)),
          React.createElement(Text, { style: { ...s.tableCellBold, width: '12.8%', textAlign: 'right', color: TEAL } }, fmtBRL(r.deltaRede)),
          React.createElement(Text, { style: { ...s.tableCell, width: '12.8%', textAlign: 'right' } }, fmtPct(r.pctRedu)),
        )
      ),
      // Totals row
      React.createElement(View, { style: { ...s.tableRow, backgroundColor: LIGHT_GREY, borderTopWidth: 1, borderTopColor: NAVY } },
        React.createElement(Text, { style: { ...s.tableCellBold, width: '26%' } }, 'TOTAL'),
        React.createElement(Text, { style: { ...s.tableCell, width: '10%' } }, ''),
        React.createElement(Text, { style: { ...s.tableCellBold, width: '12.8%', textAlign: 'right' } }, fmtBRL(totalSem)),
        React.createElement(Text, { style: { ...s.tableCellBold, width: '12.8%', textAlign: 'right' } }, fmtBRL(totalCom)),
        React.createElement(Text, { style: { ...s.tableCellBold, width: '12.8%', textAlign: 'right' } }, fmtBRL(totalIcms)),
        React.createElement(Text, { style: { ...s.tableCellBold, width: '12.8%', textAlign: 'right', color: TEAL } }, fmtBRL(totalDelta)),
        React.createElement(Text, { style: { ...s.tableCellBold, width: '12.8%', textAlign: 'right' } }, fmtPct(totalSem > 0 ? totalDelta / totalSem : 0)),
      ),
    ),
    React.createElement(Text, { style: { ...s.noteText, marginTop: 16, fontStyle: 'italic' } },
      `∆ Rede total = ${fmtBRL(totalDelta)} (valor total que a compensação entrega ao cliente, antes do PPA).\n` +
      `PPA total = ${fmtBRL(result.summary.totalPPACost)}.\n` +
      `Economia líquida = ∆ Rede − PPA = ${fmtBRL(totalDelta - result.summary.totalPPACost)} ≈ ${fmtBRL(result.summary.economiaLiquida)} (diferença devido a custos não alocados).`
    ),
  );
}

function ProposalDocument({ project, result, generatedAt }: { project: Project; result: SimulationResult; generatedAt: string }) {
  return React.createElement(Document, null,
    React.createElement(CoverPage, { project, generatedAt }),
    React.createElement(SummaryPage, { project, result }),
    React.createElement(UsinaPage, { project }),
    React.createElement(ConsumptionPage, { project }),
    React.createElement(TariffComparisonPage, { project }),
    React.createElement(CumulativeEconomyPage, { project, result }),
    React.createElement(PerUCEconomyPage, { project, result }),
    React.createElement(BankPage, { project, result }),
    React.createElement(PremissasPage, { project }),
    React.createElement(NotesPage, { project })
  );
}

export async function generatePDF(project: Project, result: SimulationResult): Promise<Blob> {
  const generatedAt = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = React.createElement(ProposalDocument, { project, result, generatedAt }) as any;
  const blob = await pdf(doc).toBlob();
  return blob;
}

export function downloadPDF(blob: Blob, clientName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${clientName.toLowerCase().replace(/\s+/g, '_')}_proposta_helexia.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
