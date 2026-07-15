import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, pdf, Svg, Line, Polyline, Polygon } from '@react-pdf/renderer';
import type { Project, SimulationResult } from './types';
import { runSimulation, computeSimulationMonths, getAllPlants } from './simulation';
import { computeDerivedTariffs } from './tariff';
import { computeTaxBreakdown } from './taxBreakdown';

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

function StackedBarChart({ months, series, width = 515, height = 130, showValues = false, showSegmentValues = false, supportNegative = false }: {
  months: string[];
  series: StackedChartSeries[];
  width?: number;
  height?: number;
  showValues?: boolean;
  showSegmentValues?: boolean;
  supportNegative?: boolean;
}) {
  const n = months.length;
  const barWidth = Math.max(4, (width - 2 * (n - 1)) / n);
  const totals = months.map((_, i) => series.reduce((acc, s) => acc + (s.data[i] || 0), 0));
  const maxTotal = supportNegative ? Math.max(1, ...totals.map(Math.abs)) : Math.max(1, ...totals);
  const abbr = (v: number): string =>
    Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`;
  // Show only as many x-axis labels as fit without overlap (a "jan/28" label needs ~26px).
  // Without this a 60-month chart smears ~60 labels into an unreadable band.
  const labelStep = Math.max(1, Math.ceil(26 / (barWidth + 2)));
  const showTopValues = showValues && barWidth >= 10;

  const topValues = showTopValues ? months.map((_, i) =>
    React.createElement(Text, {
      key: i,
      style: {
        width: barWidth,
        marginRight: i === n - 1 ? 0 : 2,
        fontSize: barWidth >= 18 ? 6 : 5,
        textAlign: 'center',
        color: NAVY,
        fontWeight: 'bold',
      },
    }, totals[i] > 0 && i % labelStep === 0 ? abbr(totals[i]) : '')
  ) : null;

  const showSegLabels = showSegmentValues && barWidth >= 14;
  const half = supportNegative ? height / 2 : height;

  const bars = months.map((label, i) => {
    if (supportNegative) {
      const val = series[0]?.data[i] || 0;
      const color = val >= 0 ? series[0].color : '#dc2626';
      const h = Math.min(half, (Math.abs(val) / maxTotal) * half);
      const showLbl = showSegLabels && h >= 8 && val !== 0;
      const top = React.createElement(View, {
        style: { width: barWidth, height: half, flexDirection: 'column-reverse' },
      }, val > 0 && React.createElement(View, {
        style: { width: barWidth, height: h, backgroundColor: color, justifyContent: 'center', alignItems: 'center' },
      }, showLbl && React.createElement(Text, {
        style: { fontSize: barWidth >= 22 ? 6 : 5, color: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
      }, abbr(val))));
      const bottom = React.createElement(View, {
        style: { width: barWidth, height: half, flexDirection: 'column' },
      }, val < 0 && React.createElement(View, {
        style: { width: barWidth, height: h, backgroundColor: color, justifyContent: 'center', alignItems: 'center' },
      }, showLbl && React.createElement(Text, {
        style: { fontSize: barWidth >= 22 ? 6 : 5, color: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
      }, abbr(val))));
      return React.createElement(View, {
        key: i,
        style: { width: barWidth, marginRight: i === n - 1 ? 0 : 2, height, flexDirection: 'column' },
      }, top, bottom);
    }
    const segments = series.map((s) => {
      const val = s.data[i] || 0;
      return { h: (val / maxTotal) * height, color: s.color, val };
    });
    return React.createElement(View, {
      key: i,
      style: { width: barWidth, marginRight: i === n - 1 ? 0 : 2, height, flexDirection: 'column-reverse' },
    },
      ...segments.map((seg, j) => {
        const showLbl = showSegLabels && seg.h >= 8 && seg.val > 0;
        return React.createElement(View, {
          key: j,
          style: { width: barWidth, height: seg.h, backgroundColor: seg.color, justifyContent: 'center', alignItems: 'center' },
        }, showLbl && React.createElement(Text, {
          style: { fontSize: barWidth >= 22 ? 6 : 5, color: '#ffffff', fontWeight: 'bold', textAlign: 'center' },
        }, abbr(seg.val)));
      })
    );
  });

  const labels = months.map((label, i) =>
    React.createElement(Text, {
      key: i,
      style: { width: barWidth, marginRight: i === n - 1 ? 0 : 2, fontSize: 5, textAlign: 'center', color: '#64748b' },
    }, (i % labelStep === 0 || i === n - 1) ? label : '')
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
    showTopValues && topValues && React.createElement(View, { style: { flexDirection: 'row', width, marginBottom: 1 } }, ...topValues),
    React.createElement(View, {
      style: { flexDirection: 'row', alignItems: supportNegative ? 'center' : 'flex-end', width, height, marginBottom: 2, position: 'relative' },
    }, ...bars, supportNegative && React.createElement(View, {
      style: { position: 'absolute', left: 0, right: 0, top: height / 2, height: 0.5, backgroundColor: '#64748b' },
    })),
    React.createElement(View, { style: { flexDirection: 'row', width } }, ...labels),
    legend,
  );
}

function computeAggregateConsumption(project: Project): { fp: number[]; pt: number[]; rsv: number[] } {
  const cm = computeSimulationMonths(project);
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
    React.createElement(Text, { style: s.pageHeaderText }, 'Helexia Brasil — Análise Preliminar')
  );
}

function CoverPage({ project, generatedAt }: { project: Project; generatedAt: string }) {
  const plants = getAllPlants(project);
  const totalKWac = plants.reduce((acc, p) => acc + (p.capacityKWac || 0), 0);
  const subtitle = plants.length === 1 ? project.plant.name : `${plants.length} usinas — ${totalKWac.toLocaleString('pt-BR')} kWac total`;
  const plantNames = plants.length > 1 ? plants.map(p => p.name).join(' + ') : null;
  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(View, { style: s.coverCenter },
      React.createElement(Image, { src: `${import.meta.env.BASE_URL}Helexia_main_logo_screen_L.png`, style: { width: 180, marginBottom: project.clientLogo ? 16 : 30 } }),
      project.clientLogo
        ? React.createElement(Image, { src: project.clientLogo, style: { width: 150, height: 60, objectFit: 'contain', marginBottom: 24 } })
        : null,
      React.createElement(Text, { style: s.coverTitle }, project.clientName),
      React.createElement(Text, { style: s.coverSubtitle }, subtitle),
      plantNames && React.createElement(Text, { style: { ...s.coverSubtitle, fontSize: 10 } }, plantNames),
      React.createElement(Text, { style: s.coverSubtitle }, `${project.distributor.name} — ${project.distributor.state}`),
      React.createElement(Text, { style: s.coverTag }, 'Análise Preliminar — Geração Distribuída'),
      React.createElement(Text, { style: { fontSize: 9, color: '#94a3b8', marginTop: 8 } },
        `Contrato: ${project.plant.contractStartMonth} — ${project.plant.contractMonths} meses PPA (principal) · ${computeSimulationMonths(project)} meses simulados`)
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
  const cm = computeSimulationMonths(project);
  const barScale = 300 / (Math.max(sm.baselineSEM, sm.totalPPACost + (sm.baselineSEM - sm.economiaLiquida - sm.totalPPACost)) || 1);
  // Faturamento por compensação: a energia relevante (faturada) é a COMPENSADA, não a injetada.
  // Trocamos rótulo + valor para ficarem coerentes com a base de faturamento.
  const billComp = project.scenarios.ppaBillingBasis === 'compensation';
  const ucIds = Object.keys(result.ucDetailsCOM ?? {});
  const compByMonth = result.months.map((_, m) => ucIds.reduce((s, id) => s + (result.ucDetailsCOM?.[id]?.[m]?.compensatedKWh ?? 0), 0));
  const energyLabel = billComp ? 'Energia compensada' : 'Geração';
  const energyTotal = billComp ? compByMonth.reduce((a, b) => a + b, 0) : sm.totalGeneration;
  const energySub = billComp ? 'compensada no horizonte' : 'P50 injetado';

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Resumo Executivo'),
    // KPIs
    React.createElement(View, { style: s.kpiRow },
      ...[
        { label: `${energyLabel} ${durationLabel(cm)}`, value: fmtKWh(energyTotal), sub: energySub },
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
    // Cost decomposition — two stacked rows (Cenário atual vs Cenário Helexia)
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 8, marginTop: 8 } }, `Decomposição de Custos (${durationLabel(cm)})`),
    (() => {
      const pcAdd = result.months.reduce((acc, m) => acc + (m.com.pisCofinsAdditional ?? 0), 0);
      const redeVal = sm.baselineSEM - sm.economiaLiquida - sm.totalPPACost - pcAdd;
      const baselineWidth = Math.max(2, sm.baselineSEM * barScale);
      const ecoPctRaw = sm.baselineSEM > 0 ? (sm.economiaLiquida / sm.baselineSEM) * 100 : 0;
      const ecoPctStr = `${ecoPctRaw >= 0 ? '' : '-'}${Math.abs(ecoPctRaw).toFixed(1)}%`;
      const segs: { label: string; value: number; color: string; isEconomia?: boolean }[] = [
        { label: 'Rede', value: redeVal, color: NAVY },
        { label: 'PPA Helexia', value: sm.totalPPACost, color: TEAL },
      ];
      if (pcAdd > 0) segs.push({ label: 'PIS/COFINS adicional', value: pcAdd, color: '#b45309' });
      segs.push({ label: 'Economia Líquida', value: Math.max(0, sm.economiaLiquida), color: LIME, isEconomia: true });
      const extra = sm.economiaLiquida < 0 ? Math.abs(sm.economiaLiquida) : 0;
      return React.createElement(View, null,
        React.createElement(View, { style: s.waterfallRow },
          React.createElement(Text, { style: s.waterfallLabel }, 'Cenário atual (sem GD)'),
          React.createElement(View, { style: { ...s.waterfallBar, width: baselineWidth, backgroundColor: '#6692A8' } }),
          React.createElement(Text, { style: s.waterfallValue }, fmtBRL(sm.baselineSEM))
        ),
        React.createElement(View, { style: s.waterfallRow },
          React.createElement(Text, { style: s.waterfallLabel }, 'Cenário Helexia'),
          React.createElement(View, { style: { flexDirection: 'row', alignItems: 'center', height: 16, borderRadius: 3, overflow: 'hidden' } },
            ...segs.map((seg, i) =>
              React.createElement(View, {
                key: i,
                style: { width: Math.max(0, seg.value * barScale), height: 16, backgroundColor: seg.color, justifyContent: 'center', alignItems: 'center' },
              }, seg.isEconomia && seg.value * barScale >= 24 && React.createElement(Text, { style: { fontSize: 7, fontWeight: 'bold', color: '#365314' } }, ecoPctStr))
            ),
            extra > 0 && React.createElement(View, {
              style: { width: Math.max(2, extra * barScale), height: 16, backgroundColor: '#dc2626', justifyContent: 'center', alignItems: 'center' },
            }, extra * barScale >= 24 && React.createElement(Text, { style: { fontSize: 7, fontWeight: 'bold', color: '#ffffff' } }, ecoPctStr))
          ),
          React.createElement(Text, { style: s.waterfallValue }, fmtBRL(sm.baselineSEM - sm.economiaLiquida))
        ),
        React.createElement(View, { style: { flexDirection: 'row', marginTop: 4, marginLeft: '30%', alignItems: 'center' } },
          React.createElement(Text, { style: { fontSize: 11, fontWeight: 'bold', color: sm.economiaLiquida >= 0 ? '#15803d' : '#dc2626' } },
            `Economia: ${fmtBRL(sm.economiaLiquida)} (${ecoPctStr} da fatura atual)`)
        ),
        React.createElement(View, { style: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, marginLeft: '30%', gap: 12 } },
          ...segs.map((seg, i) => {
            const pct = sm.baselineSEM > 0 ? (seg.value / sm.baselineSEM) * 100 : 0;
            return React.createElement(View, { key: i, style: { flexDirection: 'row', alignItems: 'center', marginRight: 12 } },
              React.createElement(View, { style: { width: 8, height: 8, backgroundColor: seg.color, marginRight: 4, borderRadius: 1 } }),
              React.createElement(Text, { style: { fontSize: 7, color: '#475569' } }, `${seg.label}: ${fmtBRL(seg.value)} (${pct.toFixed(1)}%)`)
            );
          }),
          extra > 0 && React.createElement(View, { style: { flexDirection: 'row', alignItems: 'center' } },
            React.createElement(View, { style: { width: 8, height: 8, backgroundColor: '#dc2626', marginRight: 4, borderRadius: 1 } }),
            React.createElement(Text, { style: { fontSize: 7, color: '#dc2626' } },
              `Custo extra COM: ${fmtBRL(extra)} (${(extra / Math.max(1, sm.baselineSEM) * 100).toFixed(1)}% da fatura atual)`)
          )
        )
      );
    })(),
    // Monthly net economy chart
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 6, marginTop: 16 } }, `Economia Líquida Mensal (${durationLabel(cm)})`),
    (() => {
      const labels = result.months.map(m => m.label);
      const eco = result.months.map(m => Math.round(m.economia));
      const sum = eco.reduce((a, b) => a + b, 0);
      const avg = sum / Math.max(1, eco.length);
      const peak = Math.max(...eco);
      const low = Math.min(...eco);
      const peakLabel = labels[eco.indexOf(peak)];
      const lowLabel = labels[eco.indexOf(low)];
      return React.createElement(View, null,
        StackedBarChart({
          months: labels,
          series: [{ key: 'eco', data: eco, color: LIME, label: 'Economia (R$)' }],
          supportNegative: true,
          showSegmentValues: true,
        }),
        React.createElement(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 4 } },
          React.createElement(Text, { style: { fontSize: 8, color: '#64748b' } }, `Soma ${durationLabel(cm)}: ${fmtBRL(sum)} · Média mensal: ${fmtBRL(avg)}`),
          React.createElement(Text, { style: { fontSize: 8, color: '#64748b' } }, `Pico: ${fmtBRL(peak)} (${peakLabel}) · Mínimo: ${fmtBRL(low)} (${lowLabel})`)
        )
      );
    })(),
    // Yearly summary table — adds "Consumo" column before "Geração".
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 8, marginTop: 16 } }, `Resumo por Ano (${durationLabel(cm)})`),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['Período', 'Consumo', billComp ? 'Compensada' : 'Geração', 'SEM (R$)', 'COM (R$)', 'Economia', 'Eco. Acum.'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: i === 0 ? '12%' : '14.66%', textAlign: i === 0 ? 'left' : 'right' } }, h)
        )
      ),
      ...(() => {
        const years = Math.ceil(cm / 12);
        let acum = 0;
        const consumoForMonth = (mi: number) => {
          let sum = 0;
          for (const uc of project.ucs) {
            sum += (uc.consumptionFP[mi] ?? 0)
              + (uc.consumptionPT[mi] ?? 0)
              + (uc.consumptionReservado?.[mi] ?? 0);
          }
          return sum;
        };
        return Array.from({ length: years }, (_, y) => {
          const start = y * 12;
          const end = Math.min(start + 12, cm);
          const yearMonths = result.months.slice(start, end);
          let consumo = 0;
          for (let mi = start; mi < end; mi++) consumo += consumoForMonth(mi);
          const gen = billComp
            ? compByMonth.slice(start, end).reduce((a, b) => a + b, 0)
            : yearMonths.reduce((s, m) => s + m.generation, 0);
          const sem = yearMonths.reduce((s, m) => s + m.sem.totalCost, 0);
          const com = yearMonths.reduce((s, m) => s + m.com.totalCost, 0);
          const eco = yearMonths.reduce((s, m) => s + m.economia, 0);
          acum += eco;
          return React.createElement(View, { key: y, style: y % 2 ? s.tableRowAlt : s.tableRow },
            React.createElement(Text, { style: { ...s.tableCell, width: '12%' } }, `Ano ${y + 1}`),
            React.createElement(Text, { style: { ...s.tableCell, width: '14.66%', textAlign: 'right' } }, fmtKWh(consumo)),
            React.createElement(Text, { style: { ...s.tableCell, width: '14.66%', textAlign: 'right' } }, fmtKWh(gen)),
            React.createElement(Text, { style: { ...s.tableCell, width: '14.66%', textAlign: 'right' } }, fmtBRL(sem)),
            React.createElement(Text, { style: { ...s.tableCell, width: '14.66%', textAlign: 'right' } }, fmtBRL(com)),
            React.createElement(Text, { style: { ...s.tableCellBold, width: '14.66%', textAlign: 'right', color: eco >= 0 ? TEAL : '#dc2626' } }, fmtBRL(eco)),
            React.createElement(Text, { style: { ...s.tableCellBold, width: '14.66%', textAlign: 'right', color: acum >= 0 ? TEAL : '#dc2626' } }, fmtBRL(acum))
          );
        });
      })()
    )
  );
}

// SVG area chart mirroring the on-screen Banco de Créditos view: filled COM area +
// dashed SEM line, across the full contract horizon.
function BankAreaChart({ labels, com, sem }: { labels: string[]; com: number[]; sem: number[] }) {
  const n = com.length;
  const yAxisW = 26;
  const W = 515;
  const plotW = W - yAxisW;
  const H = 150;
  const max = Math.max(1, ...com, ...sem);
  const abbr = (v: number): string => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`;
  const xAt = (i: number) => n <= 1 ? 0 : (i / (n - 1)) * plotW;
  const yAt = (v: number) => H - (v / max) * H;
  const comLine = com.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const comArea = `0,${H} ${comLine} ${plotW.toFixed(1)},${H}`;
  const semLine = sem.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const hasSem = sem.some(v => v > 0);
  const step = Math.max(1, Math.ceil(26 / Math.max(1, plotW / n)));
  const legendItem = (color: string, dashed: boolean, label: string) =>
    React.createElement(View, { key: label, style: { flexDirection: 'row', alignItems: 'center', gap: 3, marginRight: 14 } },
      React.createElement(View, { style: { width: 10, height: 0, borderTopWidth: 2, borderTopColor: color, borderStyle: dashed ? 'dashed' : 'solid' } }),
      React.createElement(Text, { style: { fontSize: 7, color: '#475569' } }, label),
    );
  return React.createElement(View, null,
    React.createElement(View, { style: { flexDirection: 'row' } },
      React.createElement(View, { style: { width: yAxisW, height: H, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 3 } },
        React.createElement(Text, { style: { fontSize: 5, color: '#94a3b8' } }, abbr(max)),
        React.createElement(Text, { style: { fontSize: 5, color: '#94a3b8' } }, abbr(max / 2)),
        React.createElement(Text, { style: { fontSize: 5, color: '#94a3b8' } }, '0'),
      ),
      React.createElement(Svg, { width: plotW, height: H, viewBox: `0 0 ${plotW} ${H}` },
        React.createElement(Line, { x1: 0, y1: H / 2, x2: plotW, y2: H / 2, stroke: '#eef2f6', strokeWidth: 0.5 }),
        React.createElement(Line, { x1: 0, y1: H - 0.5, x2: plotW, y2: H - 0.5, stroke: '#e2e8f0', strokeWidth: 1 }),
        React.createElement(Polygon, { points: comArea, fill: 'rgb(47,146,123)', fillOpacity: 0.15 }),
        hasSem ? React.createElement(Polyline, { points: semLine, fill: 'none', stroke: '#6692A8', strokeWidth: 1, strokeDasharray: '4 3' }) : null,
        React.createElement(Polyline, { points: comLine, fill: 'none', stroke: NAVY, strokeWidth: 1.5 }),
      ),
    ),
    React.createElement(View, { style: { flexDirection: 'row', marginTop: 2, paddingLeft: yAxisW } },
      ...labels.map((lb, i) => React.createElement(Text, { key: i, style: { width: plotW / n, fontSize: 5, color: '#94a3b8', textAlign: 'center' } }, i % step === 0 ? lb : '')),
    ),
    React.createElement(View, { style: { flexDirection: 'row', justifyContent: 'center', marginTop: 4 } },
      legendItem(NAVY, false, 'Banco COM'),
      hasSem ? legendItem('#6692A8', true, 'Banco SEM') : null,
    ),
  );
}

function BankPage({ project, result }: { project: Project; result: SimulationResult }) {
  const n = result.months.length;
  const bankEnd = new Array(n).fill(0);
  const bankEndSEM = new Array(n).fill(0);
  const creditsReceived = new Array(n).fill(0);
  const bankDraw = new Array(n).fill(0);
  let totalInjected = 0;
  let totalDrained = 0;
  for (const ucId in result.ucDetailsCOM) {
    const det = result.ucDetailsCOM[ucId];
    for (let i = 0; i < n && i < det.length; i++) {
      bankEnd[i] += det[i].bankEnd ?? 0;
      creditsReceived[i] += det[i].creditsReceived ?? 0;
      bankDraw[i] += det[i].bankDraw ?? 0;
      totalInjected += det[i].creditsReceived ?? 0;
      totalDrained += det[i].bankDraw ?? 0;
    }
  }
  for (const ucId in result.ucDetailsSEM) {
    const det = result.ucDetailsSEM[ucId];
    for (let i = 0; i < n && i < det.length; i++) bankEndSEM[i] += det[i].bankEnd ?? 0;
  }
  const openingBank = project.ucs.reduce((acc, u) => acc + (u.openingBank || 0), 0);
  // Credit expiration via FIFO aging: a credit added to the bank expires only if it
  // sits unused for 60 months (Lei 14.300/2022, Art. 5º). For any horizon ≤ 60 months
  // nothing can expire — this avoids falsely flagging same-month-compensated energy.
  const CREDIT_VALIDITY = 60;
  let expired = 0;
  {
    const fifo: { month: number; amount: number }[] = [];
    if (openingBank > 0) fifo.push({ month: -1, amount: openingBank });
    let prevBank = openingBank;
    for (let i = 0; i < n; i++) {
      // Expire credits older than the validity window.
      while (fifo.length && i - fifo[0].month >= CREDIT_VALIDITY) {
        expired += fifo.shift()!.amount;
      }
      // Net credits added to the bank this month (surplus after in-month compensation).
      const added = Math.max(0, bankEnd[i] - prevBank + bankDraw[i]);
      // The bank draw consumes the oldest credits first (FIFO).
      let draw = bankDraw[i];
      while (draw > 1e-6 && fifo.length) {
        const head = fifo[0];
        const take = Math.min(head.amount, draw);
        head.amount -= take; draw -= take;
        if (head.amount <= 1e-6) fifo.shift();
      }
      if (added > 0) fifo.push({ month: i, amount: added });
      prevBank = bankEnd[i];
    }
  }
  const labels = result.months.map(m => m.label);
  const peak = Math.max(...bankEnd);
  const peakIdx = bankEnd.indexOf(peak);
  const finalBank = bankEnd[n - 1] ?? 0;
  const ppaRate = project.plant.ppaRateRsBRLkWh;

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Banco de Créditos — Evolução Mensal'),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 6 } },
      'Saldo do banco de créditos (kWh, somado entre UCs) ao final de cada mês. Cresce quando a geração excede o consumo no mês; drena quando o consumo excede a geração (ou após o fim do PPA).'),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 10, fontStyle: 'italic', color: '#475569' } },
      'Validade dos créditos: 60 meses a partir do mês de injeção (Lei 14.300/2022, Art. 5º). Créditos não utilizados após esse prazo expiram. A data de 2045 referenciada na transição (Art. 27) trata de regras de compensação para instalações pré-2023, não a validade dos créditos.'),
    expired > 100 && React.createElement(View, {
      style: { padding: 6, backgroundColor: '#fef3c7', borderRadius: 4, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#f59e0b' },
    },
      React.createElement(Text, { style: { fontSize: 8, fontWeight: 'bold', color: '#92400e' } }, 'Créditos expirados detectados'),
      React.createElement(Text, { style: { fontSize: 7, color: '#78350f', marginTop: 2 } },
        `Aproximadamente ${fmtKWh(expired)} de créditos não foram utilizados dentro do prazo de 60 meses e expiraram. Considere ajustar o sizing da usina ou o rateio para reduzir esse desperdício.`)
    ),
    React.createElement(View, { style: s.kpiRow },
      React.createElement(View, { key: 'peak', style: { ...s.kpiCard, borderLeftWidth: 3, borderLeftColor: TEAL } },
        React.createElement(Text, { style: s.kpiLabel }, 'Pico do banco'),
        React.createElement(Text, { style: s.kpiValue }, fmtKWh(peak)),
        React.createElement(Text, { style: s.kpiSub }, labels[peakIdx] || '')
      ),
      React.createElement(View, { key: 'final', style: { ...s.kpiCard, borderLeftWidth: 3, borderLeftColor: NAVY } },
        React.createElement(Text, { style: s.kpiLabel }, 'Banco residual final'),
        React.createElement(Text, { style: s.kpiValue }, fmtKWh(finalBank)),
        React.createElement(Text, { style: s.kpiSub }, `${fmtBRL(finalBank * ppaRate)} @ PPA`)
      ),
      React.createElement(View, { key: 'totinj', style: { ...s.kpiCard, borderLeftWidth: 3, borderLeftColor: LIME } },
        React.createElement(Text, { style: s.kpiLabel }, 'Créditos injetados total'),
        React.createElement(Text, { style: s.kpiValue }, fmtKWh(creditsReceived.reduce((a, b) => a + b, 0))),
        React.createElement(Text, { style: s.kpiSub }, `${n}m`)
      )
    ),
    BankAreaChart({ labels, com: bankEnd, sem: bankEndSEM }),
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginTop: 14, marginBottom: 6 } }, 'Valores mensais do banco (kWh) — Ano 1'),
    (() => {
      const count = Math.min(12, n);
      return React.createElement(View, { style: s.table },
        React.createElement(View, { style: s.tableHeader },
          ...['Mês', 'Créditos injetados', 'Banco drenado', 'Saldo do banco'].map((h, i) =>
            React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: '25%', textAlign: i === 0 ? 'left' : 'right' } }, h)
          )
        ),
        ...labels.slice(0, count).map((lab, i) =>
          React.createElement(View, { key: i, style: i % 2 ? s.tableRowAlt : s.tableRow },
            React.createElement(Text, { style: { ...s.tableCell, width: '25%' } }, lab),
            React.createElement(Text, { style: { ...s.tableCell, width: '25%', textAlign: 'right' } }, fmtKWh(creditsReceived[i] || 0)),
            React.createElement(Text, { style: { ...s.tableCell, width: '25%', textAlign: 'right' } }, fmtKWh(bankDraw[i] || 0)),
            React.createElement(Text, { style: { ...s.tableCellBold, width: '25%', textAlign: 'right', color: TEAL } }, fmtKWh(bankEnd[i] || 0))
          )
        )
      );
    })(),
    (() => {
      const [y0, m0] = project.plant.contractStartMonth.split('-').map(Number);
      const dateStr = y0 && m0 ? new Date(y0, m0 - 1 + n, 0).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : `mês ${n}`;
      return React.createElement(Text, { style: { ...s.sectionTitle, marginTop: 18 } },
        `Banco de Créditos por UC — Saldo Final (${dateStr}, mês ${n} do contrato)`);
    })(),
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
    // Sensitivity table (scales main plant + additional plants p50)
    React.createElement(Text, { style: { ...s.sectionTitle, marginTop: 20 } }, 'Sensibilidade de Geração'),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['Cenário', `Geração ${durationLabel(computeSimulationMonths(project))}`, 'PPA (R$)', 'Economia (R$)', 'Redução (%)'].map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: '20%', textAlign: i === 0 ? 'left' : 'right' } }, h)
        )
      ),
      ...[
        { label: 'P90 Pessimista', mult: 0.90, color: '#dc2626' },
        { label: 'P50 Base', mult: 1.00, color: NAVY },
        { label: 'P10 Otimista', mult: 1.10, color: TEAL },
      ].map((scenario, i) => {
        const scale = (arr: number[]) => arr.map(v => Math.round(v * scenario.mult));
        const scaledProject = {
          ...project,
          plant: { ...project.plant, p50Profile: scale(project.plant.p50Profile) },
          additionalPlants: (project.additionalPlants ?? []).map(p => ({ ...p, p50Profile: scale(p.p50Profile) })),
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

function tariffGroupLabel(tg: string): string {
  const map: Record<string, string> = {
    B1: 'B1 Residencial', B2: 'B2 Rural', B3: 'B3 Comercial/Industrial',
    A4_VERDE: 'A4 Verde', A4_AZUL: 'A4 Azul',
    A3A: 'A3a', A3A_VERDE: 'A3a Verde', A3A_AZUL: 'A3a Azul',
    A3: 'A3', A3_VERDE: 'A3 Verde', A3_AZUL: 'A3 Azul',
    A2: 'A2', A2_VERDE: 'A2 Verde', A2_AZUL: 'A2 Azul',
    A1: 'A1', A1_VERDE: 'A1 Verde', A1_AZUL: 'A1 Azul',
  };
  return map[tg] ?? tg;
}

// Card-based premissas layout (clearer than a flat key/value list). 'key' = dark
// highlight, 'hl' = teal/green highlight, default = light card.
function premCard(key: string, lbl: string, val: string, note: string | null, variant?: 'key' | 'hl', width = '32%') {
  const dark = variant === 'key';
  const hl = variant === 'hl';
  return React.createElement(View, {
    key,
    style: { width, borderWidth: 0.5, borderColor: dark ? NAVY : hl ? '#a7f3d0' : '#e2e8f0', borderRadius: 5, padding: 7, backgroundColor: dark ? NAVY : hl ? '#ecfdf5' : '#f8fafc' },
  },
    React.createElement(Text, { style: { fontSize: 6.5, color: dark ? '#cbd5e1' : '#64748b', marginBottom: 2 } }, lbl),
    React.createElement(Text, { style: { fontSize: 11, fontWeight: 'bold', color: dark ? '#ffffff' : hl ? TEAL : NAVY } }, val),
    note ? React.createElement(Text, { style: { fontSize: 6.5, color: dark ? '#cbd5e1' : '#94a3b8', marginTop: 1 } }, note) : null,
  );
}
function premGroup(title: string) {
  return React.createElement(Text, { key: 'g-' + title, style: { fontSize: 8, color: TEAL, fontWeight: 'bold', marginTop: 12, marginBottom: 5 } }, title.toUpperCase());
}
function premRow(key: string, cards: React.ReactNode[]) {
  return React.createElement(View, { key, style: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 } }, ...cards);
}

function PremissasPage({ project }: { project: Project }) {
  const dist = project.distributor;
  const plants = getAllPlants(project);
  const totalKWac = plants.reduce((acc, p) => acc + (p.capacityKWac || 0), 0);
  const ppaMWh = project.plant.ppaRateRsBRLkWh * 1000;
  const isACL = project.marketType === 'ACL' && !!project.aclBaseline;
  const distEsc = project.tariffEscalationDistributor ?? 0;
  const ppaEsc = project.tariffEscalationPPA ?? 0;
  const fmtM = (v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}/MWh`;
  const groupsA = [...new Set(project.ucs.filter(u => u.isGrupoA).map(u => u.tariffGroup))];
  const groupsB = [...new Set(project.ucs.filter(u => !u.isGrupoA).map(u => u.tariffGroup))];
  const allGroups = [...groupsA, ...groupsB].map(tariffGroupLabel).join(', ');
  const nA = project.ucs.filter(u => u.isGrupoA).length;
  const nB = project.ucs.length - nA;

  const blocks: React.ReactNode[] = [];

  // ── Contrato Helexia
  blocks.push(premGroup('Contrato Helexia'));
  blocks.push(premRow('r-contrato', [
    premCard('c-ppa', 'PPA Helexia (fixo)', fmtM(ppaMWh), ppaEsc > 0 ? `reajuste ${(ppaEsc * 100).toFixed(1)}%/ano (IPCA)` : 'sem reajuste', 'key'),
    premCard('c-prazo', 'Início / Prazo', project.plant.contractStartMonth, `${project.plant.contractMonths} meses PPA · ${computeSimulationMonths(project)} simulados`),
    premCard('c-usina', plants.length > 1 ? `Usinas (${plants.length})` : 'Usina', `${totalKWac.toLocaleString('pt-BR')} kWac`, plants.map(p => p.name).join(' + ').slice(0, 60)),
  ]));

  // ── Mercado ACL (only ACL)
  if (isACL) {
    const a = project.aclBaseline!;
    const tePC = (a.energyPisCofins ?? true) ? (a.energyPisCofinsPct ?? 0.0925) : 0;
    const teICMS = (a.energyIcms ?? true) ? dist.taxes.ICMS : 0;
    const teSem = a.energyPriceSemImp * 1000;
    const teAllIn = teSem / ((1 - tePC) * (1 - teICMS));
    // TE de equilíbrio (economia = 0): PPA fixo empata com a fatura ACL. Busca binária.
    let lo = 20, hi = 800;
    for (let i = 0; i < 36; i++) {
      const mid = (lo + hi) / 2;
      const p: Project = { ...project, distributor: { ...project.distributor }, aclBaseline: { ...a, energyPriceSemImp: mid / 1000 } };
      const sm = runSimulation(p).summary;
      if ((sm.baselineSEM > 0 ? sm.economiaLiquida / sm.baselineSEM : 0) > 0) hi = mid; else lo = mid;
    }
    const beTE = (lo + hi) / 2;
    const beAllIn = beTE / ((1 - tePC) * (1 - teICMS));
    const teLocked = (a.energyEscalationPct ?? 0) === 0;
    blocks.push(premGroup('Mercado atual do cliente (ACL)'));
    blocks.push(premRow('r-acl1', [
      premCard('c-tesem', 'Energia TE — sem imp.', fmtM(teSem), teLocked ? 'travado (lock-in)' : `reajuste ${((a.energyEscalationPct ?? 0) * 100).toFixed(1)}%/ano`),
      premCard('c-teall', 'Energia TE — all-in', fmtM(teAllIn), `+PIS/COFINS ${(tePC * 100).toFixed(2)}% +ICMS ${(teICMS * 100).toFixed(0)}%`),
      premCard('c-tebe', 'TE de equilíbrio (Helexia = ACL)', fmtM(beTE), `R$ ${Math.round(beAllIn).toLocaleString('pt-BR')} all-in · economia 0%`, 'hl'),
    ]));
    blocks.push(premGroup('Descontos & regras'));
    blocks.push(premRow('r-acl2', [
      premCard('c-dcons', 'Desconto TUSD consumo', `FP ${((a.tusdDiscountConsumo ?? 0) * 100).toFixed(0)}% · PT ${((a.tusdDiscountConsumoPT ?? a.tusdDiscountConsumo ?? 0) * 100).toFixed(0)}%`, 'fonte incentivada'),
      // Demanda só existe no Grupo A — omitir o card para carteira 100% Grupo B.
      nA > 0 ? premCard('c-ddem', 'Desconto TUSD demanda', `${((a.tusdDiscountDemanda ?? 0) * 100).toFixed(2)}%`, 'perdido ao migrar p/ GD cativo') : null,
      // Fator de Ajuste é regra de cross-posto (Grupo A). Grupo B compensa 1:1 sem FA.
      nA > 0 ? premCard('c-fa', 'Fator de Ajuste (FA)', project.scenarios.applyFatorAjuste === false ? 'Desativado' : 'Aplicado', project.scenarios.applyFatorAjuste === false ? '1:1 (COPEL não aplica)' : 'REN 1000') : null,
    ].filter(Boolean)));
  }

  // ── Condições comerciais (espelha a proposta)
  blocks.push(premGroup('Condições comerciais'));
  blocks.push(premRow('r-cond', [
    premCard('c-prazo', 'Prazo do contrato', `${computeSimulationMonths(project)} meses`, null),
    premCard('c-ppa', 'PPA', `R$ ${ppaMWh.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}/MWh`, `R$ ${project.plant.ppaRateRsBRLkWh.toFixed(4)}/kWh`),
    premCard('c-reajppa', 'Reajuste do PPA', ppaEsc > 0.0005 ? `~${(ppaEsc * 100).toFixed(1)}%/ano` : 'travado no contrato', null),
    premCard('c-fat', 'Faturamento', project.scenarios.ppaBillingBasis === 'compensation' ? 'Sobre compensação' : 'Sobre injeção (take-or-pay)', null),
  ]));

  // ── Distribuidora & tributos
  blocks.push(premGroup('Distribuidora & tributos'));
  blocks.push(premRow('r-dist', [
    premCard('c-dist', 'Distribuidora', `${dist.name} (${dist.state})`, dist.resolution || ''),
    premCard('c-tax', 'ICMS / PIS+COFINS', `${(dist.taxes.ICMS * 100).toFixed(0)}% / ${((dist.taxes.PIS + dist.taxes.COFINS) * 100).toFixed(2)}%`, project.scenarios.icmsExempt ? 'isenção ICMS (compensação)' : 'sem isenção ICMS'),
    premCard('c-reaj', 'Reajuste anual', `Dist. ${(distEsc * 100).toFixed(1)}% · PPA ${(ppaEsc * 100).toFixed(1)}%`, distEsc === 0 && ppaEsc === 0 ? 'cenário base sem reajuste' : 'composto a partir do início'),
  ]));

  // ── Tarifas reguladas (referência no ACL; baseline no cativo)
  const tarCards: React.ReactNode[] = [];
  if (groupsA.length > 0) {
    tarCards.push(premCard('t-fp', 'Fora Ponta (TUSD+TE)', `R$ ${dist.tariffs.A_FP_TUSD_TE.toFixed(4)}/kWh`, null));
    tarCards.push(premCard('t-pt', 'Ponta (TUSD+TE)', `R$ ${dist.tariffs.A_PT_TUSD_TE.toFixed(4)}/kWh`, null));
    if (dist.tariffs.A_FP_DEMANDA) tarCards.push(premCard('t-dem', 'Demanda', `R$ ${dist.tariffs.A_FP_DEMANDA.toFixed(2)}/kW·mês`, null));
  }
  if (groupsB.length > 0) tarCards.push(premCard('t-b', 'Grupo B (TUSD+TE)', `R$ ${(dist.tariffs.B_TUSD + dist.tariffs.B_TE).toFixed(4)}/kWh`, null));
  if (tarCards.length > 0) {
    blocks.push(premGroup(isACL ? `Tarifas reguladas — referência (${allGroups})` : `Tarifas reguladas (${allGroups})`));
    blocks.push(premRow('r-tar', tarCards.slice(0, 3)));
    if (tarCards.length > 3) blocks.push(premRow('r-tar2', tarCards.slice(3)));
  }

  // ── Cenário comparativo (concorrente) — só quando há desconto > 0
  if (project.scenarios.competitorDiscount > 0) {
    blocks.push(premGroup('Cenário comparativo'));
    blocks.push(premRow('r-comp', [
      premCard('c-comp', `Desconto concorrente${project.scenarios.competitorName ? ` (${project.scenarios.competitorName})` : ''}`,
        `${(project.scenarios.competitorDiscount * 100).toFixed(0)}%`, 'reduz o baseline de comparação', 'hl', '49%'),
    ]));
  }

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Premissas da Simulação'),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 4 } },
      `${project.clientName} · ${project.ucs.length} UC${project.ucs.length > 1 ? 's' : ''} (${[nA ? `${nA} Grupo A` : null, nB ? `${nB} Grupo B` : null].filter(Boolean).join(', ')})${allGroups ? ` · ${allGroups}` : ''}${isACL ? ' · Mercado Livre (ACL)' : ' · Mercado Cativo'}`),
    ...blocks,
  );
}

function NotesPage({ project }: { project: Project }) {
  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Notas Regulatorias'),
    React.createElement(View, { style: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#2F927B', borderRadius: 6, padding: 8, marginBottom: 10 } },
      React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY } }, '✓ Usina GD1 — 100% de compensação garantida (direito adquirido)'),
      React.createElement(Text, { style: { ...s.noteText, marginTop: 1 } }, 'A usina compensa 100% da tarifa cheia, sem bandeiras no PPA — regime preservado até 2045 (Lei 14.300/2022). Cada crédito gerado tem validade de 60 meses (Art. 5º); a partir de 5 anos de contrato, créditos não usados no prazo expiram.'),
    ),
    React.createElement(Text, { style: s.noteTitle }, 'Lei 14.300/2022 — SCEE Autoconsumo Remoto'),
    React.createElement(Text, { style: s.noteText }, 'O Sistema de Compensacao de Energia Elétrica (SCEE) permite que a energia injetada pela usina solar gere créditos que compensam o consumo das Unidades Consumidoras (UCs) do cliente, mesmo que em enderecos diferentes, dentro da mesma area de concessao.'),
    React.createElement(Text, { style: s.noteTitle }, 'Rateio Fixo por Periodos'),
    React.createElement(Text, { style: s.noteText }, `A alocacao dos créditos entre as UCs segue o modelo de rateio fixo por periodos ao longo do contrato de ${durationLabel(computeSimulationMonths(project))}. O rateio e otimizado para maximizar a economia liquida do cliente, considerando o perfil de consumo de cada UC e suas tarifas.`),
    React.createElement(Text, { style: s.noteTitle }, 'Validade dos Créditos'),
    React.createElement(Text, { style: s.noteText }, 'Conforme a Lei 14.300/2022 (Art. 5º), os créditos de energia gerados no âmbito do SCEE tem validade de 60 meses a partir do mês de injeção, podendo ser acumulados no banco de créditos da distribuidora e utilizados em faturas futuras dentro desse prazo. Créditos não utilizados após 60 meses expiram.'),
    !project.scenarios.icmsExempt && React.createElement(View, null,
      React.createElement(Text, { style: { ...s.noteTitle, color: '#dc2626' } }, 'Risco ICMS (Art. 23-A RICMS)'),
      React.createElement(Text, { style: s.noteText }, 'ATENÇÃO: A isenção de ICMS não esta ativada para esta simulacao. Caso o estado aplique ICMS sobre a energia compensada, os custos adicionais estimados estao refletidos no campo "Risco ICMS" do resumo executivo.')
    ),
    React.createElement(View, { style: { marginTop: 30, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 } },
      React.createElement(Text, { style: { fontSize: 7, color: '#94a3b8' } }, 'Este documento e uma estimativa baseada em dados fornecidos e projeções de geração P50. Os valores reais podem variar conforme condições climaticas, alterações tarifarias e disponibilidade da usina. Helexia Brasil não garante os valores apresentados.'),
    )
  );
}

// ─── Usina page — multi-plant specs + per-plant generation chart ──
function UsinaPage({ project }: { project: Project }) {
  const horizon = computeSimulationMonths(project);
  const degradation = project.generationDegradation ?? 0.005;
  const perfFactor = project.performanceFactor ?? 1.0;
  const plants = getAllPlants(project);
  // Per-plant effective generation series (each extended to min(contractMonths, horizon), padded 0)
  const perPlant = plants.map(p => {
    const cap = Math.min(p.contractMonths || horizon, horizon);
    const raw = p.useActual && p.actualProfile ? p.actualProfile : p.p50Profile;
    const ext = pdfExtendGeneration(raw, cap, degradation).map(v => Math.round(v * perfFactor));
    while (ext.length < horizon) ext.push(0);
    return ext;
  });
  const combined = perPlant[0].map((_, i) => perPlant.reduce((acc, ser) => acc + (ser[i] ?? 0), 0));
  const labels = monthLabels(project.plant.contractStartMonth, horizon);
  const totalKWac = plants.reduce((acc, p) => acc + (p.capacityKWac || 0), 0);
  const totalCombined = combined.reduce((a, b) => a + b, 0);
  const y1count = Math.min(12, horizon);
  const year1Total = combined.slice(0, y1count).reduce((a, b) => a + b, 0);
  const year1Avg = year1Total / Math.max(1, y1count);
  const year1Peak = Math.max(...combined.slice(0, y1count));
  const year1Low = Math.min(...combined.slice(0, y1count));

  const specRows: [string, string][] = [];
  plants.forEach((p, idx) => {
    const total = perPlant[idx].reduce((a, b) => a + b, 0);
    specRows.push([idx === 0 ? 'Usina principal' : `Usina adicional ${idx}`, p.name]);
    specRows.push(['  - Potência', `${p.capacityKWac.toLocaleString('pt-BR')} kWac`]);
    specRows.push(['  - PPA', `R$ ${p.ppaRateRsBRLkWh.toFixed(4)}/kWh`]);
    specRows.push(['  - Prazo PPA', `${p.contractMonths} meses`]);
    specRows.push([`  - Geração efetiva (${p.contractMonths}m)`, fmtKWh(total)]);
  });

  const combinedRows: [string, string][] = [
    ['Número de usinas', `${plants.length}`],
    ['Capacidade AC total', `${totalKWac.toLocaleString('pt-BR')} kWac`],
    ['Distribuidora', `${project.distributor.name} — ${project.distributor.state}`],
    ['Degradação anual', fmtPct(degradation)],
    ['Fator de performance', fmtPct(perfFactor)],
    ['Geração combinada Ano 1', fmtKWh(year1Total)],
    ['Média mensal Ano 1', fmtKWh(Math.round(year1Avg))],
    ['Pico/Mínimo mensal Ano 1', `${fmtKWh(year1Peak)} / ${fmtKWh(year1Low)}`],
    [`Geração combinada total ${durationLabel(horizon)}`, fmtKWh(totalCombined)],
  ];

  const palette = ['#004B70', '#2F927B', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16'];

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: plants.length === 1 ? project.plant.name : `${plants.length} usinas (${totalKWac.toLocaleString('pt-BR')} kWac)` }),
    React.createElement(Text, { style: s.sectionTitle }, plants.length === 1 ? 'Usina Solar' : `Usinas Solares (${plants.length})`),
    React.createElement(View, { style: { marginBottom: 10 } },
      ...specRows.map(([label, value], i) =>
        React.createElement(View, { key: i, style: s.premissaRow },
          React.createElement(Text, { style: { ...s.premissaLabel, fontWeight: label.startsWith('  ') ? 'normal' : 'bold' } }, label),
          React.createElement(Text, { style: s.premissaValue }, value)
        )
      )
    ),
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginTop: 8, marginBottom: 6 } }, 'Resumo combinado'),
    React.createElement(View, { style: { marginBottom: 14 } },
      ...combinedRows.map(([label, value], i) =>
        React.createElement(View, { key: i, style: s.premissaRow },
          React.createElement(Text, { style: s.premissaLabel }, label),
          React.createElement(Text, { style: s.premissaValue }, value)
        )
      )
    ),
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 6 } },
      `Perfil de geração mensal — ${plants.length} usina${plants.length > 1 ? 's' : ''}${perfFactor < 1 ? ` × ${(perfFactor * 100).toFixed(0)}%` : ''}`
    ),
    StackedBarChart({
      months: labels,
      series: plants.map((p, idx) => ({
        key: `plant-${idx}`,
        data: perPlant[idx],
        color: palette[idx % palette.length],
        label: `${p.name.split(' ')[0]} (${p.capacityKWac} kWac)`,
      })),
      showValues: true,
      showSegmentValues: true,
    }),
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginTop: 14, marginBottom: 6 } }, 'Geração mensal por usina (kWh) — Ano 1'),
    (() => {
      const count = Math.min(12, horizon);
      const monthSlice = labels.slice(0, count);
      const headers = ['Mês', ...plants.map(p => p.name.split(' ')[0]), 'Total'];
      const colW = `${(100 / headers.length).toFixed(2)}%`;
      const rows = monthSlice.map((lab, i) => {
        const cells: (string | number)[] = [lab];
        plants.forEach((_, pi) => cells.push(perPlant[pi][i] ?? 0));
        cells.push(plants.reduce((acc, _, pi) => acc + (perPlant[pi][i] ?? 0), 0));
        return cells;
      });
      const footer: (string | number)[] = ['Total Ano 1'];
      plants.forEach((_, pi) => footer.push(perPlant[pi].slice(0, count).reduce((a, b) => a + b, 0)));
      footer.push(combined.slice(0, count).reduce((a, b) => a + b, 0));
      return React.createElement(View, { style: s.table },
        React.createElement(View, { style: s.tableHeader },
          ...headers.map((h, i) =>
            React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: colW, textAlign: i === 0 ? 'left' : 'right' } }, h)
          )
        ),
        ...rows.map((row, ri) =>
          React.createElement(View, { key: ri, style: ri % 2 ? s.tableRowAlt : s.tableRow },
            ...row.map((cell, ci) =>
              React.createElement(Text, {
                key: ci,
                style: { ...(ci === row.length - 1 ? s.tableCellBold : s.tableCell), width: colW, textAlign: ci === 0 ? 'left' : 'right', color: ci === row.length - 1 ? TEAL : undefined },
              }, ci === 0 ? String(cell) : fmtKWh(cell as number))
            )
          )
        ),
        React.createElement(View, { style: { ...s.tableRow, borderTopWidth: 1, borderTopColor: '#cbd5e1', backgroundColor: '#f8fafc' } },
          ...footer.map((cell, ci) =>
            React.createElement(Text, {
              key: ci,
              style: { ...s.tableCellBold, width: colW, textAlign: ci === 0 ? 'left' : 'right', color: NAVY },
            }, ci === 0 ? String(cell) : fmtKWh(cell as number))
          )
        )
      );
    })()
  );
}

// ─── NEW: Consumption page — client baseline ─────────────────────
function ConsumptionPage({ project }: { project: Project }) {
  const cm = computeSimulationMonths(project);
  const agg = computeAggregateConsumption(project);
  const labels = monthLabels(project.plant.contractStartMonth, cm);
  const totalFP = agg.fp.reduce((a, b) => a + b, 0);
  const totalPT = agg.pt.reduce((a, b) => a + b, 0);
  const totalRSV = agg.rsv.reduce((a, b) => a + b, 0);
  const total = totalFP + totalPT + totalRSV;
  const hasRSV = totalRSV > 0;
  const hasPT = totalPT > 0;
  // Grupo B (baixa tensão): posto único — o consumo fica todo em "FP"; rotular "Consumo".
  const allGrupoB = project.ucs.filter(u => u.id !== 'bat').every(u => !u.isGrupoA);
  const fpLabel = allGrupoB ? 'Consumo' : 'Fora Ponta';

  const series: StackedChartSeries[] = [
    { key: 'FP', data: agg.fp, color: TEAL, label: fpLabel },
  ];
  if (hasPT) series.push({ key: 'PT', data: agg.pt, color: NAVY, label: 'Ponta' });
  if (hasRSV) series.push({ key: 'RSV', data: agg.rsv, color: '#f59e0b', label: 'Reservado' });

  const postoRows: { label: string; val: number; color: string; show: boolean }[] = [
    { label: fpLabel, val: totalFP, color: TEAL, show: true },
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
    StackedBarChart({ months: labels, series, height: 150, showSegmentValues: true }),
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

  // Tax-scope context
  const ICMS = project.distributor.taxes.ICMS;
  const PC = project.distributor.taxes.PIS + project.distributor.taxes.COFINS;
  const icmsScope = project.distributor.taxes.icmsScope ?? 'TE_TUSD';
  const pisCofinsExempt = project.distributor.taxes.pisCofinsExempt ?? true;
  const effectiveIcmsExempt = icmsScope === 'NONE' ? false : project.scenarios.icmsExempt;
  const showIcmsCol = !effectiveIcmsExempt || icmsScope === 'TE_ONLY';
  const showPcCol = !pisCofinsExempt;
  const grossUp = (1 - PC) * (1 - ICMS);

  // ICMS leak "por dentro" on the compensated kWh (per kWh, given gross te/tusd rates).
  const icmsLeak = (teTusdSum: number, tusd: number): number => {
    if (effectiveIcmsExempt) {
      return icmsScope === 'TE_ONLY' ? (tusd * ICMS) / (1 + ICMS) : 0;
    }
    return (teTusdSum * ICMS) / (1 + ICMS);
  };
  const pcLeak = (teTusdSum: number): number => (pisCofinsExempt ? 0 : (teTusdSum * PC) / (1 + PC));

  // Per-posto sem-impostos te/tusd rates grossed-up to all-in (so leak base matches the bill).
  const breakdown = (kind: 'FP_A' | 'PT_A' | 'RSV_A' | 'B' | 'RSV_B'): { te: number; tusd: number } => {
    const t = project.distributor.tariffs;
    switch (kind) {
      case 'FP_A':
        return { te: t.A_TE_FP / grossUp, tusd: Math.max(0, (t.A_FP_TUSD_TE - t.A_TE_FP) / grossUp) };
      case 'PT_A':
        return { te: t.A_TE_PT / grossUp, tusd: Math.max(0, (t.A_PT_TUSD_TE - t.A_TE_PT) / grossUp) };
      case 'RSV_A': {
        const base = (t.A_RSV_TUSD_TE ?? 0) / grossUp;
        const ratio = (t.A_TE_FP + (t.A_FP_TUSD_TE - t.A_TE_FP)) > 0 ? t.A_TE_FP / t.A_FP_TUSD_TE : 0;
        return { te: base * ratio, tusd: base * (1 - ratio) };
      }
      case 'B':
        return { te: t.B_TE / grossUp, tusd: t.B_TUSD / grossUp };
      case 'RSV_B': {
        const base = (t.B_RSV_TUSD_TE ?? 0) / grossUp;
        const ratio = (t.B_TE + t.B_TUSD) > 0 ? t.B_TE / (t.B_TE + t.B_TUSD) : 0;
        return { te: base * ratio, tusd: base * (1 - ratio) };
      }
    }
  };

  interface TRow { posto: string; breakdown: 'FP_A' | 'PT_A' | 'RSV_A' | 'B' | 'RSV_B'; tariff: number; conversion: string; effectivePPA: number; show: boolean; }
  const rows: TRow[] = [
    { posto: 'Grupo A — Fora Ponta', breakdown: 'FP_A', tariff: T_AFP, conversion: '1:1 mesmo posto', effectivePPA: ppa, show: hasGrupoA },
    { posto: 'Grupo A — Ponta', breakdown: 'PT_A', tariff: T_APT, conversion: `FA = ${FA.toFixed(3)}`, effectivePPA: FA > 0 ? ppa / FA : 0, show: hasGrupoA },
    { posto: 'Grupo A — Reservado', breakdown: 'RSV_A', tariff: T_ARSV ?? 0, conversion: '1:1 (= FP)', effectivePPA: ppa, show: hasARSV },
    { posto: 'Grupo B', breakdown: 'B', tariff: T_B3, conversion: '1:1 (sem posto)', effectivePPA: ppa, show: hasGrupoB },
    { posto: 'Grupo B — Reservado', breakdown: 'RSV_B', tariff: T_BRSV ?? 0, conversion: '1:1 (= B)', effectivePPA: ppa, show: hasBRSV },
  ];

  const colW = `${(100 / (5 + (showIcmsCol ? 1 : 0) + (showPcCol ? 1 : 0))).toFixed(2)}%`;
  const headers = ['Posto', 'Tarifa atual (com trib.)', 'Conversão', 'PPA efetivo'];
  if (showIcmsCol) headers.push('ICMS adicional');
  if (showPcCol) headers.push('PIS/COFINS adicional');
  headers.push('Economia/kWh');

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'De Onde Vem a Economia'),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 8 } },
      'Por kWh compensado pelos créditos da usina, ao lado da tarifa que o cliente deixa de pagar. As colunas de leaks só aparecem quando o tipo de isenção configurado deixa o respectivo tributo incidir.'
    ),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 10, fontStyle: 'italic' } },
      `Configuração ativa: Isenção ICMS = ${effectiveIcmsExempt ? (icmsScope === 'TE_ONLY' ? 'TE apenas (TUSD tributado)' : 'TE+TUSD total') : 'Sem isenção (TE+TUSD tributados)'} · PIS/COFINS = ${pisCofinsExempt ? 'isento' : 'tributado'}`
    ),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...headers.map((h, i) =>
          React.createElement(Text, { key: i, style: { ...s.tableHeaderCell, width: colW, textAlign: i === 0 ? 'left' : i === 2 ? 'center' : 'right', fontSize: 7.5 } }, h)
        )
      ),
      ...rows.filter(r => r.show).map((r, i) => {
        const { te, tusd } = breakdown(r.breakdown);
        const teTusd = te + tusd;
        const icmsAdd = icmsLeak(teTusd, tusd);
        const pcAdd = pcLeak(teTusd);
        const eco = r.tariff - r.effectivePPA - icmsAdd - pcAdd;
        const cells: React.ReactElement[] = [
          React.createElement(Text, { key: 'posto', style: { ...s.tableCell, width: colW, fontSize: 7.5 } }, r.posto),
          React.createElement(Text, { key: 'tariff', style: { ...s.tableCell, width: colW, textAlign: 'right', fontSize: 7.5 } }, fmtRate(r.tariff)),
          React.createElement(Text, { key: 'conv', style: { ...s.tableCell, width: colW, textAlign: 'center', fontSize: 7.5 } }, r.conversion),
          React.createElement(Text, { key: 'ppa', style: { ...s.tableCell, width: colW, textAlign: 'right', fontSize: 7.5 } }, fmtRate(r.effectivePPA)),
        ];
        if (showIcmsCol) cells.push(React.createElement(Text, { key: 'icms', style: { ...s.tableCell, width: colW, textAlign: 'right', color: icmsAdd > 0 ? '#b45309' : '#94a3b8', fontSize: 7.5 } }, icmsAdd > 0 ? `-${fmtRate(icmsAdd)}` : '—'));
        if (showPcCol) cells.push(React.createElement(Text, { key: 'pc', style: { ...s.tableCell, width: colW, textAlign: 'right', color: pcAdd > 0 ? '#b45309' : '#94a3b8', fontSize: 7.5 } }, pcAdd > 0 ? `-${fmtRate(pcAdd)}` : '—'));
        cells.push(React.createElement(Text, { key: 'eco', style: { ...s.tableCellBold, width: colW, textAlign: 'right', color: eco >= 0 ? TEAL : '#dc2626', fontSize: 7.5 } }, fmtRate(eco)));
        return React.createElement(View, { key: i, style: i % 2 ? s.tableRowAlt : s.tableRow }, ...cells);
      })
    ),
    React.createElement(Text, { style: { ...s.noteTitle, marginTop: 14 } }, 'Como interpretar'),
    React.createElement(Text, { style: s.noteText },
      `• Tarifa atual = T_sem / ((1-PIS-COFINS) × (1-ICMS)) — preço all-in que o cliente paga por kWh sem GD.\n` +
      `• PPA efetivo = ${fmtRate(ppa)} (${[hasGrupoA ? 'FP' : null, (hasARSV || hasBRSV) ? 'RSV' : null, hasGrupoB ? 'B' : null].filter(Boolean).join('/')}), ${FA > 0 ? `R$ ${ppa.toFixed(4)}/${FA.toFixed(3)} = ${fmtRate(ppa / FA)} (PT — 1 kWh PT exige 1/FA = ${(1 / FA).toFixed(3)} kWh FP-equiv)` : '—'}.\n` +
      (showIcmsCol ? `• ICMS adicional = parcela de ICMS que ainda incide sobre o kWh compensado. Com escopo "TE apenas", ICMS continua sendo cobrado sobre a parcela TUSD.\n` : '') +
      (showPcCol ? `• PIS/COFINS adicional = aplica quando a isenção federal não vale para este cliente (STJ Tema 986 caso a caso).\n` : '') +
      `• Economia/kWh = Tarifa atual - PPA efetivo - ICMS adicional - PIS/COFINS adicional. Positiva = cliente lucra por kWh compensado nesse posto; negativa = PPA + leaks superam a tarifa evitada.`
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
        React.createElement(Text, { style: s.kpiSub }, 'tarifa evitada - PPA')
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
    // Grouped vertical bar chart: SEM total vs (PPA + Rede residual) stacked
    React.createElement(Text, { style: { fontSize: 10, fontWeight: 'bold', color: NAVY, marginBottom: 6, marginTop: 4 } },
      'Custo Mensal — Cenário atual vs Cenário Helexia'
    ),
    (() => {
      const labels2 = result.months.map(m => m.label);
      const sem = result.months.map(m => m.sem.totalCost);
      const ppaArr = result.months.map(m => m.ppaCost);
      const redeArr = result.months.map(m => m.com.redeCost);
      const maxV = Math.max(1, ...sem, ...result.months.map((_, t) => ppaArr[t] + redeArr[t]));
      const cnt = labels2.length;
      const groupGap = Math.max(0, cnt - 1) * 3;
      const barW = Math.max(3, (515 - (cnt * 1 + groupGap)) / (cnt * 2));
      const labelStep = Math.max(1, Math.ceil(26 / (barW * 2 + 4)));
      const abbr = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`;
      const chartH = 140;
      return React.createElement(View, null,
        React.createElement(View, { style: { flexDirection: 'row', alignItems: 'flex-end', width: 515, height: chartH, marginBottom: 2 } },
          ...labels2.map((_, t) => {
            const hSem = (sem[t] / maxV) * chartH;
            const hPpa = (ppaArr[t] / maxV) * chartH;
            const hRede = (redeArr[t] / maxV) * chartH;
            const isLast = t === cnt - 1;
            return React.createElement(View, { key: t, style: { flexDirection: 'row', marginRight: isLast ? 0 : 3, alignItems: 'flex-end' } },
              React.createElement(View, { style: { width: barW, height: hSem, backgroundColor: NAVY, marginRight: 1 } }),
              React.createElement(View, { style: { width: barW, height: hPpa + hRede, flexDirection: 'column-reverse' } },
                React.createElement(View, { style: { width: barW, height: hPpa, backgroundColor: TEAL } }),
                React.createElement(View, { style: { width: barW, height: hRede, backgroundColor: '#94a3b8' } })
              )
            );
          })
        ),
        React.createElement(View, { style: { flexDirection: 'row', width: 515, marginTop: 2 } },
          ...labels2.map((lab, t) => {
            const w = barW * 2 + 1;
            const isLast = t === cnt - 1;
            return React.createElement(Text, { key: t, style: { width: w, marginRight: isLast ? 0 : 3, fontSize: 5, textAlign: 'center', color: '#64748b' } }, t % labelStep === 0 ? lab : '');
          })
        ),
        React.createElement(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 4 } },
          React.createElement(Text, { style: { fontSize: 7, color: '#64748b' } },
            `SEM total: ${abbr(sem.reduce((a, b) => a + b, 0))} · COM total: ${abbr(ppaArr.reduce((a, b) => a + b, 0) + redeArr.reduce((a, b) => a + b, 0))}`),
          React.createElement(Text, { style: { fontSize: 7, color: TEAL, fontWeight: 'bold' } },
            `Economia acumulada final: ${fmtBRL(acum[acum.length - 1] ?? 0)}`)
        ),
        React.createElement(View, { style: { flexDirection: 'row', gap: 12, marginTop: 4, justifyContent: 'center' } },
          React.createElement(View, { style: { flexDirection: 'row', alignItems: 'center', marginRight: 12 } },
            React.createElement(View, { style: { width: 8, height: 8, backgroundColor: NAVY, marginRight: 4 } }),
            React.createElement(Text, { style: { fontSize: 7 } }, 'Cenário atual (sem GD)')
          ),
          React.createElement(View, { style: { flexDirection: 'row', alignItems: 'center', marginRight: 12 } },
            React.createElement(View, { style: { width: 8, height: 8, backgroundColor: TEAL, marginRight: 4 } }),
            React.createElement(Text, { style: { fontSize: 7 } }, 'Cenário Helexia — PPA')
          ),
          React.createElement(View, { style: { flexDirection: 'row', alignItems: 'center' } },
            React.createElement(View, { style: { width: 8, height: 8, backgroundColor: '#94a3b8', marginRight: 4 } }),
            React.createElement(Text, { style: { fontSize: 7 } }, 'Cenário Helexia — Rede residual')
          )
        )
      );
    })(),
    React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold', color: NAVY, marginBottom: 6, marginTop: 14 } },
      'Economia direta mensal (tarifa evitada - PPA) e acumulada'
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
      `Mostramos aqui a redução do custo de rede de cada UC pela compensação de créditos GD. O custo do PPA Helexia é compartilhado pela usina e não está alocado individualmente por UC — a economia líquida total (Var. rede - PPA) aparece no Resumo Executivo.`
    ),
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        ...['Unidade Consumidora', 'Grupo', 'Rede SEM', 'Rede COM', 'ICMS add.', 'Var. Rede (ganho)', '% redução'].map((h, i) =>
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
      `Var. Rede total = ${fmtBRL(totalDelta)} (valor total que a compensação entrega ao cliente, antes do PPA).\n` +
      `PPA total = ${fmtBRL(result.summary.totalPPACost)}.\n` +
      `Economia líquida = Var. Rede - PPA = ${fmtBRL(totalDelta - result.summary.totalPPACost)} ~${fmtBRL(result.summary.economiaLiquida)} (diferença devido a custos não alocados).`
    ),
  );
}

// ─── NEW: Taxes page — per-UC per-posto tax breakdown ────────────
function TaxesPage({ project, result }: { project: Project; result: SimulationResult }) {
  const tb = computeTaxBreakdown(project, result);
  const PC = tb.distributor.pisRate + tb.distributor.cofinsRate;
  const scopeLabel =
    tb.distributor.icmsScope === 'TE_ONLY' ? 'TE apenas (parcial)' :
    tb.distributor.icmsScope === 'NONE' ? 'Sem isenção' :
    'TE+TUSD (total)';
  const pcLabel = tb.distributor.pisCofinsExempt ? 'Sim (isento)' : 'Não (tributado)';
  const icmsLabel = tb.scenarios.icmsExempt ? 'Sim' : 'Não';

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Header, { clientName: project.clientName, plantName: project.plant.name }),
    React.createElement(Text, { style: s.sectionTitle }, 'Como a economia se forma — decomposição da fatura'),
    React.createElement(Text, { style: { ...s.noteText, marginBottom: 6 } },
      project.marketType === 'ACL'
        ? 'Cada componente é decomposto em energia (s/ imp.) + PIS/COFINS + ICMS, separando TE e TUSD. SEM Helexia = fatura ACL atual; Rede COM = residual com a distribuidora após compensação; PPA Helexia substitui a energia compensada. O Benefício incentivada reconcilia ao mercado livre real (energia ACL + descontos de TUSD/demanda).'
        : 'Cada componente é decomposto em energia (s/ imp.) + PIS/COFINS + ICMS, separando TE e TUSD. SEM Helexia = fatura da distribuidora (cativo); Rede COM = residual com a distribuidora após compensação; PPA Helexia substitui a energia compensada.'
    ),
    React.createElement(View, { style: { padding: 6, backgroundColor: '#f8fafc', borderRadius: 4, marginBottom: 10 } },
      React.createElement(Text, { style: { fontSize: 8, fontWeight: 'bold', color: NAVY, marginBottom: 2 } }, 'Configuração ativa'),
      React.createElement(Text, { style: { fontSize: 7, color: '#475569' } },
        `${tb.distributor.name} (${tb.distributor.state}) · ICMS ${(tb.distributor.icmsRate * 100).toFixed(0)}% · PIS+COFINS ${(PC * 100).toFixed(2)}%`),
      React.createElement(Text, { style: { fontSize: 7, color: '#475569' } },
        `Isenção ICMS: ${icmsLabel} · Escopo: ${scopeLabel} · Isenção PIS/COFINS: ${pcLabel}`)
    ),
    ...tb.ucs.map((uc, idx) => {
      const comRede = uc.totalCOM - (uc.ppaHelexia ?? 0);
      return React.createElement(View, {
        key: idx,
        style: { marginBottom: 14, borderWidth: 0.5, borderColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
      },
        React.createElement(View, { style: { backgroundColor: '#f1f5f9', padding: 4 } },
          React.createElement(Text, { style: { fontSize: 8, fontWeight: 'bold', color: NAVY } }, `${uc.ucName}  (${uc.tariffGroup} · ${uc.isGrupoA ? 'Grupo A' : 'Grupo B'})`)
        ),
        ...uc.postos.map((p, pi) =>
          React.createElement(View, { key: pi },
            React.createElement(View, { style: { backgroundColor: '#fafafa', paddingHorizontal: 4, paddingVertical: 2, borderTopWidth: 0.5, borderTopColor: '#e2e8f0' } },
              React.createElement(Text, { style: { fontSize: 7, color: '#475569' } },
                `Posto ${p.posto} · SEM residual: ${fmtKWh(p.consumoSEM)} · COM residual: ${fmtKWh(p.consumoCOM)} · COM compensado: ${fmtKWh(p.compensadoCOM)}`)
            ),
            React.createElement(View, { style: { flexDirection: 'row', backgroundColor: '#f8fafc', paddingHorizontal: 4, paddingVertical: 2 } },
              React.createElement(Text, { style: { width: '38%', fontSize: 7, fontWeight: 'bold' } }, 'Componente'),
              React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, 'SEM (R$)'),
              React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, 'Rede COM'),
              React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, 'Total COM'),
              React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, 'Var. (R$)')
            ),
            ...p.lines.map((line, li) =>
              React.createElement(View, { key: li, style: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 1, backgroundColor: li % 2 ? '#ffffff' : '#fcfcfc' } },
                React.createElement(Text, { style: { width: '38%', fontSize: 6.5, color: '#475569' } }, line.label),
                React.createElement(Text, { style: { width: '15.5%', fontSize: 6.5, textAlign: 'right' } }, fmtBRL(line.sem)),
                React.createElement(Text, { style: { width: '15.5%', fontSize: 6.5, textAlign: 'right' } }, fmtBRL(line.com)),
                React.createElement(Text, { style: { width: '15.5%', fontSize: 6.5, textAlign: 'right' } }, fmtBRL(line.com)),
                React.createElement(Text, { style: { width: '15.5%', fontSize: 6.5, textAlign: 'right', color: line.delta >= 0 ? TEAL : '#dc2626' } }, fmtBRL(line.delta))
              )
            ),
            React.createElement(View, { style: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 2, backgroundColor: '#f1f5f9', borderTopWidth: 0.5, borderTopColor: '#cbd5e1' } },
              React.createElement(Text, { style: { width: '38%', fontSize: 7, fontWeight: 'bold' } }, `Subtotal ${p.posto}`),
              React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(p.subtotalSEM)),
              React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(p.subtotalCOM)),
              React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(p.subtotalCOM)),
              React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right', color: p.subtotalSEM - p.subtotalCOM >= 0 ? TEAL : '#dc2626' } }, fmtBRL(p.subtotalSEM - p.subtotalCOM))
            )
          )
        ),
        uc.demanda && React.createElement(View, null,
          React.createElement(View, { style: { backgroundColor: '#fafafa', paddingHorizontal: 4, paddingVertical: 2, borderTopWidth: 0.5, borderTopColor: '#e2e8f0' } },
            React.createElement(Text, { style: { fontSize: 7, color: '#475569' } }, `Demanda contratada (${uc.demanda.kW} kW × ${uc.demanda.months} meses) — não compensada por SCEE`)
          ),
          React.createElement(View, { style: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 2, backgroundColor: '#f1f5f9', borderTopWidth: 0.5, borderTopColor: '#cbd5e1' } },
            React.createElement(Text, { style: { width: '38%', fontSize: 7, fontWeight: 'bold' } }, 'Subtotal Demanda'),
            React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(uc.demanda.subtotal)),
            React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(uc.demanda.subtotalCom)),
            React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(uc.demanda.subtotalCom)),
            React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right', color: '#94a3b8' } }, '—')
          )
        ),
        uc.beneficioIncentivada !== undefined && React.createElement(View, { style: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 2, backgroundColor: '#ecfdf5', borderTopWidth: 0.5, borderTopColor: '#cbd5e1' } },
          React.createElement(Text, { style: { width: '38%', fontSize: 6.5, fontWeight: 'bold', color: TEAL } }, 'Benefício/Subsídio incentivada (energia ACL + desc. TUSD/demanda)'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, textAlign: 'right', color: TEAL } }, `-${fmtBRL(uc.beneficioIncentivada)}`),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, textAlign: 'right', color: '#94a3b8' } }, '—'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, textAlign: 'right', color: '#94a3b8' } }, '—'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right', color: '#dc2626' } }, `-${fmtBRL(uc.beneficioIncentivada)}`)
        ),
        uc.ajusteRedeCOM !== undefined && React.createElement(View, { style: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 2, backgroundColor: '#fffbeb', borderTopWidth: 0.5, borderTopColor: '#cbd5e1' } },
          React.createElement(Text, { style: { width: '38%', fontSize: 6.5, fontWeight: 'bold', color: '#b45309' } }, 'Ajuste reajuste tarifário / FA (rede COM)'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, textAlign: 'right', color: '#94a3b8' } }, '—'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, textAlign: 'right', color: '#b45309' } }, `-${fmtBRL(uc.ajusteRedeCOM)}`),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, textAlign: 'right', color: '#b45309' } }, `-${fmtBRL(uc.ajusteRedeCOM)}`),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right', color: TEAL } }, `+${fmtBRL(uc.ajusteRedeCOM)}`)
        ),
        uc.ppaHelexia !== undefined && React.createElement(View, { style: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 2, backgroundColor: '#dbeafe', borderTopWidth: 0.5, borderTopColor: '#cbd5e1' } },
          React.createElement(Text, { style: { width: '38%', fontSize: 7, fontWeight: 'bold', color: NAVY } }, 'PPA Helexia'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, textAlign: 'right', color: '#94a3b8' } }, '—'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, textAlign: 'right', color: '#94a3b8' } }, '—'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right', color: NAVY } }, fmtBRL(uc.ppaHelexia)),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 7, fontWeight: 'bold', textAlign: 'right', color: '#dc2626' } }, `-${fmtBRL(uc.ppaHelexia)}`)
        ),
        React.createElement(View, { style: { flexDirection: 'row', paddingHorizontal: 4, paddingVertical: 3, backgroundColor: '#dcfce7', borderTopWidth: 1, borderTopColor: '#475569' } },
          React.createElement(Text, { style: { width: '38%', fontSize: 8, fontWeight: 'bold' } }, 'TOTAL UC'),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 8, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(uc.totalSEM)),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 8, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(comRede)),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 8, fontWeight: 'bold', textAlign: 'right' } }, fmtBRL(uc.totalCOM)),
          React.createElement(Text, { style: { width: '15.5%', fontSize: 8, fontWeight: 'bold', textAlign: 'right', color: uc.totalSEM - uc.totalCOM >= 0 ? TEAL : '#dc2626' } }, fmtBRL(uc.totalSEM - uc.totalCOM))
        )
      );
    }),
    React.createElement(Text, { style: { fontSize: 6, color: '#94a3b8', marginTop: 8, fontStyle: 'italic' } },
      'Tax components calculados "por dentro" (T_sem / ((1-PIS-COFINS) × (1-ICMS))). Cada linha soma à tarifa all-in × kWh que cai na fatura. Subtotais COM incluem leak sobre kWh compensado (ICMS sobre TUSD quando escopo "TE apenas"; PIS+COFINS quando não isento). Total COM = Rede COM + PPA Helexia. Economia = SEM - Total COM.'
    )
  );
}

function AttributionPage({ project, result }: { project: Project; result: SimulationResult }) {
  const attr = result.attribution!;
  const d = attr.decomposition;
  const pct = (n: number, total: number) => (total > 0 ? (n / total * 100).toFixed(1) + '%' : '—');

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(View, { style: s.pageHeader },
      React.createElement(Text, { style: s.pageHeaderText }, project.clientName),
      React.createElement(Text, { style: s.pageHeaderText }, 'Atribuição de Valor')
    ),
    React.createElement(Text, { style: s.sectionTitle }, 'Atribuição da Economia por Origem'),
    React.createElement(Text, { style: { fontSize: 8, color: '#64748b', marginBottom: 12 } },
      'Decomposição da economia total do cliente em 4 componentes. Apenas o último (HCS03 Helexia) é remunerado via PPA. Os demais provêm de ativos pré-existentes do cliente.'
    ),

    // Decomposition table
    React.createElement(View, { style: s.table },
      React.createElement(View, { style: s.tableHeader },
        React.createElement(Text, { style: [s.tableHeaderCell, { width: '46%' }] }, 'Componente'),
        React.createElement(Text, { style: [s.tableHeaderCell, { width: '22%', textAlign: 'right' }] }, 'Valor'),
        React.createElement(Text, { style: [s.tableHeaderCell, { width: '14%', textAlign: 'right' }] }, '% Total'),
        React.createElement(Text, { style: [s.tableHeaderCell, { width: '18%' }] }, 'Atribuível a')
      ),
      React.createElement(View, { style: s.tableRow },
        React.createElement(Text, { style: [s.tableCell, { width: '46%' }] }, 'Custo SEM ativos (linha de base)'),
        React.createElement(Text, { style: [s.tableCell, { width: '22%', textAlign: 'right' }] }, fmtBRL(d.bareBaseline)),
        React.createElement(Text, { style: [s.tableCell, { width: '14%', textAlign: 'right' }] }, '100,0%'),
        React.createElement(Text, { style: [s.tableCell, { width: '18%', color: '#94a3b8' }] }, 'distribuidora')
      ),
      React.createElement(View, { style: s.tableRowAlt },
        React.createElement(Text, { style: [s.tableCell, { width: '46%' }] }, '(-) Banco inicial'),
        React.createElement(Text, { style: [s.tableCell, { width: '22%', textAlign: 'right' }] }, fmtBRL(d.initialBankEffect)),
        React.createElement(Text, { style: [s.tableCell, { width: '14%', textAlign: 'right' }] }, pct(d.initialBankEffect, d.totalCustomerBenefit)),
        React.createElement(Text, { style: [s.tableCell, { width: '18%' }] }, 'cliente')
      ),
      React.createElement(View, { style: s.tableRow },
        React.createElement(Text, { style: [s.tableCell, { width: '46%' }] }, '(-) Geração própria'),
        React.createElement(Text, { style: [s.tableCell, { width: '22%', textAlign: 'right' }] }, fmtBRL(d.ownPlantsEffect)),
        React.createElement(Text, { style: [s.tableCell, { width: '14%', textAlign: 'right' }] }, pct(d.ownPlantsEffect, d.totalCustomerBenefit)),
        React.createElement(Text, { style: [s.tableCell, { width: '18%' }] }, 'cliente')
      ),
      React.createElement(View, { style: s.tableRowAlt },
        React.createElement(Text, { style: [s.tableCell, { width: '46%' }] }, '(-) Distribuição BAT -> outras UCs'),
        React.createElement(Text, { style: [s.tableCell, { width: '22%', textAlign: 'right' }] }, fmtBRL(d.batDistribEffect)),
        React.createElement(Text, { style: [s.tableCell, { width: '14%', textAlign: 'right' }] }, pct(d.batDistribEffect, d.totalCustomerBenefit)),
        React.createElement(Text, { style: [s.tableCell, { width: '18%' }] }, 'cliente')
      ),
      React.createElement(View, { style: [s.tableRow, { backgroundColor: '#dbeafe' }] },
        React.createElement(Text, { style: [s.tableCellBold, { width: '46%', color: NAVY }] }, '(-) HCS03 Helexia (PPA pago)'),
        React.createElement(Text, { style: [s.tableCellBold, { width: '22%', textAlign: 'right', color: NAVY }] }, fmtBRL(d.helexiaCS3Effect)),
        React.createElement(Text, { style: [s.tableCellBold, { width: '14%', textAlign: 'right', color: NAVY }] }, pct(d.helexiaCS3Effect, d.totalCustomerBenefit)),
        React.createElement(Text, { style: [s.tableCellBold, { width: '18%', color: NAVY }] }, 'Helexia')
      ),
      React.createElement(View, { style: [s.tableRow, { borderTopWidth: 1, borderTopColor: NAVY, backgroundColor: LIGHT_GREY }] },
        React.createElement(Text, { style: [s.tableCellBold, { width: '46%' }] }, 'Economia total do cliente'),
        React.createElement(Text, { style: [s.tableCellBold, { width: '22%', textAlign: 'right' }] }, fmtBRL(d.totalCustomerBenefit)),
        React.createElement(Text, { style: [s.tableCellBold, { width: '14%', textAlign: 'right' }] }, pct(d.totalCustomerBenefit, d.bareBaseline)),
        React.createElement(Text, { style: [s.tableCell, { width: '18%' }] })
      )
    ),

    // Headline box
    React.createElement(View, {
      style: {
        marginTop: 14,
        padding: 12,
        borderWidth: 1.5,
        borderColor: NAVY,
        borderRadius: 6,
        backgroundColor: '#f0f9ff',
      },
    },
      React.createElement(Text, { style: { fontSize: 8, color: NAVY, fontWeight: 'bold', marginBottom: 4 } }, 'ATRIBUIÇÃO HELEXIA'),
      React.createElement(Text, { style: { fontSize: 16, fontWeight: 'bold', color: NAVY } }, fmtBRL(d.helexiaCS3Effect)),
      React.createElement(Text, { style: { fontSize: 8, color: '#475569', marginTop: 4 } },
        `de ${fmtBRL(d.totalCustomerBenefit)} de economia total (${pct(d.helexiaCS3Effect, d.totalCustomerBenefit)})`
      ),
      React.createElement(Text, { style: { fontSize: 7, color: '#64748b', marginTop: 6, fontStyle: 'italic' } },
        `Único componente que gera PPA. Os demais (${fmtBRL(d.totalCustomerBenefit - d.helexiaCS3Effect)}) já existiriam sem a Helexia.`
      )
    )
  );
}

function ProposalDocument({ project, result, generatedAt }: { project: Project; result: SimulationResult; generatedAt: string }) {
  const pages = [
    React.createElement(CoverPage, { project, generatedAt, key: 'cover' }),
    React.createElement(SummaryPage, { project, result, key: 'summary' }),
    // Premissas (claras, em cards) + decomposição da fatura logo no início, p/ explicar o mecanismo.
    React.createElement(PremissasPage, { project, key: 'prem' }),
    React.createElement(TaxesPage, { project, result, key: 'taxes' }),
    React.createElement(UsinaPage, { project, key: 'usina' }),
    React.createElement(ConsumptionPage, { project, key: 'cons' }),
    // "De Onde Vem a Economia" recompõe a tarifa CATIVA — não faz sentido p/ ACL; ocultada.
    ...(project.marketType === 'ACL' ? [] : [React.createElement(TariffComparisonPage, { project, key: 'tariff' })]),
    React.createElement(CumulativeEconomyPage, { project, result, key: 'cum' }),
    ...(project.ucs.filter(u => u.id !== 'bat').length > 1
      ? [React.createElement(PerUCEconomyPage, { project, result, key: 'peruc' })]
      : []),
    React.createElement(BankPage, { project, result, key: 'bank' }),
  ];
  if (result.attribution) {
    pages.push(React.createElement(AttributionPage, { project, result, key: 'attr' }));
  }
  pages.push(React.createElement(NotesPage, { project, key: 'notes' }));
  return React.createElement(Document, null, ...pages);
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
  a.download = `${clientName.toLowerCase().replace(/\s+/g, '_')}_analise_preliminar_helexia.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
