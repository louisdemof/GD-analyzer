import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import type { Project, SimulationResult } from './types';
import { runSimulation } from './simulation';

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

function ProposalDocument({ project, result, generatedAt }: { project: Project; result: SimulationResult; generatedAt: string }) {
  return React.createElement(Document, null,
    React.createElement(CoverPage, { project, generatedAt }),
    React.createElement(SummaryPage, { project, result }),
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
