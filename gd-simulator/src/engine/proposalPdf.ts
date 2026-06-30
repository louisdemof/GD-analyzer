import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import type { Project, SimulationResult } from './types';
import { getAllPlants } from './simulation';
import { computeDerivedTariffs } from './tariff';

// Brand
const NAVY = '#004B70';
const TEAL = '#2F927B';
const LIME = '#C6DA38';
const GREY = '#64748b';
const LIGHT = '#f1f5f9';

const fmtBRL = (v: number) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const fmtMWh = (kwh: number) => (kwh / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' MWh';
const fmtPct = (v: number) => (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

export interface ProposalMeta {
  cliente?: string;        // override do nome exibido (default: nome do projeto limpo)
  local?: string;          // cidade no cabeçalho (default: Rio de Janeiro)
  segmento?: string;       // ex.: "Comercial / Industrial"
  tipoGd?: string;         // ex.: "Autoconsumo Remoto (GD1)"
  usinaCodigo?: string;    // ex.: "HCO01"
  contato?: string;        // ex.: "comercial.brasil@helexia.eu"
}

const HELEXIA_ABOUT =
  'Multinacional de energia e descarbonização, no Brasil desde 2019. Um dos 5 maiores players de Geração ' +
  'Distribuída do país: mais de 60 usinas em 15 estados no Brasil, mais de 200 MW em operação, presença em ' +
  '11 países e R$ 1,5 bi investidos desde 2021. ' +
  'A Helexia faz parte do grupo Voltalia (Euronext Paris) e, como ele, é controlada pelo grupo AMF, um dos ' +
  'maiores grupos empresariais da França — o mesmo grupo por trás de Decathlon, Leroy Merlin, Auchan e Obramax, ' +
  'em cujos telhados a Helexia já opera energia solar.';

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#1e293b' },
  band: { backgroundColor: NAVY, borderRadius: 8, padding: 14, marginBottom: 12 },
  bandTitle: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  bandSub: { color: '#cbd5e1', fontSize: 8, marginTop: 3 },
  heroRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  heroCard: { flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, padding: 9 },
  heroLabel: { fontSize: 6.5, color: GREY, marginBottom: 3, textTransform: 'uppercase' },
  heroValue: { fontSize: 14, fontWeight: 'bold', color: NAVY },
  heroSub: { fontSize: 6.5, color: '#94a3b8', marginTop: 2 },
  valueLine: { fontSize: 8.5, color: '#334155', marginBottom: 10, textAlign: 'center' },
  h2: { fontSize: 11, fontWeight: 'bold', color: NAVY, marginTop: 6, marginBottom: 6, borderBottomWidth: 1.5, borderBottomColor: TEAL, paddingBottom: 3 },
  p: { fontSize: 9, color: '#334155', lineHeight: 1.45, marginBottom: 6 },
  twoCol: { flexDirection: 'row', gap: 10 },
  col: { flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, padding: 10 },
  colTitle: { fontSize: 9, fontWeight: 'bold', color: NAVY, marginBottom: 6 },
  lineItem: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  liLabel: { fontSize: 8, color: GREY },
  liVal: { fontSize: 8, fontWeight: 'bold' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5, paddingTop: 5, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  totalLabel: { fontSize: 9, fontWeight: 'bold', color: NAVY },
  totalVal: { fontSize: 10, fontWeight: 'bold', color: NAVY },
  vtBox: { backgroundColor: LIGHT, borderRadius: 6, padding: 10, marginBottom: 10 },
  quote: { fontSize: 9, fontStyle: 'italic', color: NAVY, backgroundColor: '#ecfdf5', borderLeftWidth: 3, borderLeftColor: TEAL, padding: 8, marginVertical: 8 },
  cta: { fontSize: 12, fontWeight: 'bold', color: NAVY, marginTop: 6, marginBottom: 2 },
  about: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8 },
  aboutTitle: { fontSize: 9, fontWeight: 'bold', color: NAVY, marginBottom: 3 },
  aboutText: { fontSize: 7.5, color: '#475569', lineHeight: 1.4 },
  disclaimer: { fontSize: 6, color: '#94a3b8', marginTop: 8, lineHeight: 1.35 },
});

function fmtModalidade(g: string): string {
  return g.replace(/_/g, ' ').replace(/\bVERDE\b/i, 'Verde').replace(/\bAZUL\b/i, 'Azul');
}

// Reduce an internal project name to the client name for the proposal title.
// "SUPERFRIO Paraná — 5 UCs … · PPA R$450 — Copia" → "SUPERFRIO Paraná".
// Cuts at the first scenario separator (— – ·) and strips any "(cópia)"/"copia".
function cleanName(name?: string): string {
  let sname = (name || 'Cliente').split(/\s+[—–·]\s+/)[0];
  sname = sname.replace(/\s*\(c[oó]pia[^)]*\)/ig, '').replace(/\s*c[oó]pia\s*$/i, '').trim();
  return sname || 'Cliente';
}
// "RESOLUÇÃO HOMOLOGATÓRIA Nº 3.592, DE 23 DE JUNHO DE 2026" → "REH 3.592/2026".
function shortResolution(r?: string): string {
  if (!r) return 'resolução vigente';
  if (r.length < 30) return r;
  const num = r.match(/n[ºo°]\s*([\d.]+)/i)?.[1];
  const years = r.match(/\b(\d{4})\b/g);
  const year = years ? years[years.length - 1] : undefined;
  return num && year ? `REH ${num}/${year}` : r;
}

function buildData(project: Project, result: SimulationResult) {
  const sm = result.summary;
  const n = Math.max(1, result.months.length);
  const plants = getAllPlants(project);
  const pcAdd = result.months.reduce((a, m) => a + (m.com.pisCofinsAdditional ?? 0), 0);
  const ppaTotal = sm.totalPPACost;
  const rede = sm.baselineSEM - sm.economiaLiquida - ppaTotal - pcAdd;

  // consumo perfil (média mensal)
  let fp = 0, pt = 0;
  for (const uc of project.ucs) {
    const a = (uc.consumptionFP ?? []).slice(0, 12);
    const b = (uc.consumptionPT ?? []).slice(0, 12);
    fp += a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    pt += b.length ? b.reduce((x, y) => x + y, 0) / b.length : 0;
  }
  const consTot = fp + pt;
  const modalidade = fmtModalidade(project.ucs[0]?.tariffGroup ?? '');
  const ppaMWh = (plants[0]?.ppaRateRsBRLkWh ?? 0) * 1000;
  const pontaTarifa = (project.distributor.T_APT ?? 0) * 1000;

  // Detailed SEM/COM invoice — MONTHLY AVERAGE over the whole contract (clients read their
  // monthly bill, not annual). Mirrors KPICards' decomposition so it matches "Detalhe Impostos".
  const isACL = project.marketType === 'ACL';
  const distName = project.distributor.name?.trim() || 'Distribuidora';
  const allSum = (f: (m: typeof result.months[number]) => number) => result.months.reduce((a, m) => a + (f(m) || 0), 0);
  const T_DEM = computeDerivedTariffs(project.distributor).T_A_DEMANDA ?? 0;
  const monthlyDemandaR = project.ucs.filter(u => u.isGrupoA && u.id !== 'bat')
    .reduce((s, u) => s + (u.demandaFaturadaFP ?? 0), 0) * T_DEM;
  const mavg = {
    teFp: allSum(m => m.sem.teFpCost) / n, tePt: allSum(m => m.sem.tePtCost) / n,
    tusdFp: allSum(m => m.sem.tusdFpCost) / n, tusdPt: allSum(m => m.sem.tusdPtCost) / n,
    demandaAcl: allSum(m => m.sem.demandaCost) / n,
    semTotal: sm.baselineSEM / n,
    rede: allSum(m => m.com.redeCost) / n,
    ppa: sm.totalPPACost / n,
    icmsAdd: allSum(m => m.com.icmsAdditional) / n,
    economia: sm.economiaLiquida / n,
    demCom: monthlyDemandaR,
  };
  const energiaResidual = Math.max(0, mavg.rede - mavg.demCom);
  const comTotalAvg = mavg.rede + mavg.ppa + mavg.icmsAdd;

  // 12-month series for the chart: client consumption (FP/PT) + plant generation (kWh).
  const n12 = Math.min(12, result.months.length);
  const labels: string[] = [], gen: number[] = [], cFP: number[] = [], cPT: number[] = [];
  for (let m = 0; m < n12; m++) {
    labels.push(result.months[m].label);
    gen.push(result.months[m].generation);
    let f = 0, p = 0;
    for (const uc of project.ucs) { f += uc.consumptionFP?.[m] ?? 0; p += uc.consumptionPT?.[m] ?? 0; }
    cFP.push(f); cPT.push(p);
  }
  const maxBar = Math.max(1, ...cFP.map((v, i) => v + cPT[i]), ...gen);

  return {
    sm, n, plants, ppaTotal, rede, pcAdd, fp, pt, consTot, modalidade, ppaMWh, pontaTarifa,
    custoCom: sm.baselineSEM - sm.economiaLiquida,
    capacidade: plants.reduce((a, p) => a + (p.capacityKWac ?? 0), 0),
    isACL, distName, mavg, energiaResidual, comTotalAvg,
    labels, gen, cFP, cPT, maxBar, n12,
  };
}

// ── small invoice/chart primitives ──────────────────────────────────────────
function invRow(label: string, value: number, note?: string, bold?: boolean, color?: string) {
  return React.createElement(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1.5 } },
    React.createElement(View, { style: { flexDirection: 'row', flex: 1 } },
      React.createElement(Text, { style: { fontSize: 7.5, color: bold ? NAVY : '#475569', fontWeight: bold ? 'bold' : 'normal' } }, label),
      note ? React.createElement(Text, { style: { fontSize: 6, color: '#94a3b8', marginLeft: 3 } }, `· ${note}`) : null,
    ),
    React.createElement(Text, { style: { fontSize: 7.5, fontWeight: bold ? 'bold' : 'normal', color: color || '#334155' } }, fmtBRL(value)),
  );
}
const invSec = (t: string) => React.createElement(Text, { style: { fontSize: 6.5, color: GREY, fontWeight: 'bold', marginTop: 5, marginBottom: 1, textTransform: 'uppercase' } }, t);
const invDiv = () => React.createElement(View, { style: { borderTopWidth: 0.5, borderTopColor: '#cbd5e1', marginVertical: 2 } });

function DetailedInvoices(project: Project, d: ReturnType<typeof buildData>) {
  const { mavg, isACL, distName } = d;
  const semCol = React.createElement(View, { style: { ...s.col, flex: 1 } },
    React.createElement(Text, { style: s.colTitle }, isACL ? 'SEM Helexia — Energia ACL + Distribuidora (média/mês)' : 'SEM Helexia — Fatura Distribuidora (média/mês)'),
    ...(isACL ? [
      invSec('Energia ACL'),
      invRow('Energia ACL (TE)', mavg.teFp + mavg.tePt, 'Comercializadora'),
      invSec(distName),
      invRow('TUSD Fora Ponta', mavg.tusdFp),
      mavg.tusdPt > 0 ? invRow('TUSD Ponta', mavg.tusdPt) : null,
      invRow('Demanda contratada', mavg.demandaAcl, 'c/ desconto incentivada'),
      invDiv(),
      invRow(`Subtotal ${distName}`, mavg.tusdFp + mavg.tusdPt + mavg.demandaAcl),
      invDiv(),
      invRow('Total atual (SEM)', mavg.semTotal, undefined, true),
    ] : [
      invSec(distName),
      invRow('TUSD Fora Ponta', mavg.tusdFp),
      mavg.tusdPt > 0 ? invRow('TUSD Ponta', mavg.tusdPt) : null,
      invRow('TE Fora Ponta', mavg.teFp),
      mavg.tePt > 0 ? invRow('TE Ponta', mavg.tePt) : null,
      invRow('Demanda contratada', mavg.demandaAcl, 'Não compensada'),
      invDiv(),
      invRow(`Total Fatura ${distName}`, mavg.semTotal, undefined, true),
    ]).filter(Boolean),
    React.createElement(Text, { style: { fontSize: 5.5, color: '#94a3b8', marginTop: 4 } }, 'Obs: não inclui CIP, reativo excedente, subsídios — valores marginais ignorados na simulação.'),
  );
  const ecoPos = mavg.economia >= 0;
  const ecoColor = ecoPos ? '#15803d' : '#dc2626';
  const pct = d.sm.economiaPct; // overall reduction over the contract
  const comCol = React.createElement(View, { style: { ...s.col, flex: 1, borderColor: TEAL, backgroundColor: '#ecfdf5' } },
    React.createElement(Text, { style: s.colTitle }, 'COM Helexia — Distribuidora + Helexia (média/mês)'),
    invSec(distName),
    invRow('Energia residual', d.energiaResidual, d.energiaResidual === 0 ? 'Totalmente compensada' : undefined),
    invRow('Demanda contratada', mavg.demCom, isACL ? 'Cativo — demanda cheia (≠ SEM)' : 'Idêntica ao SEM'),
    invDiv(),
    invRow(`Subtotal ${distName}`, mavg.rede),
    invSec('Helexia'),
    invRow('PPA (geração × tarifa)', mavg.ppa),
    invDiv(),
    invRow('Total COM Helexia', d.comTotalAvg, undefined, true),
    React.createElement(View, { style: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 } },
      React.createElement(Text, { style: { fontSize: 8.5, fontWeight: 'bold', color: ecoColor } }, ecoPos ? `Economia média (${fmtPct(pct)})` : `Custo adicional vs SEM (${fmtPct(Math.abs(pct))})`),
      React.createElement(Text, { style: { fontSize: 8.5, fontWeight: 'bold', color: ecoColor } }, `${ecoPos ? '' : '−'}${fmtBRL(Math.abs(mavg.economia))}/mês`),
    ),
  );
  return React.createElement(View, { style: s.twoCol, wrap: false }, semCol, comCol);
}

function MonthlyChart(d: ReturnType<typeof buildData>) {
  const H = 70, plotW = 515;
  const gw = plotW / Math.max(1, d.n12);
  const barW = Math.max(6, gw * 0.32);
  const mwh = (v: number) => Math.round(v / 1000).toLocaleString('pt-BR'); // MWh label
  return React.createElement(View, { wrap: false, style: { marginTop: 4 } },
    React.createElement(Text, { style: s.h2 }, 'Consumo mensal (Fora Ponta + Ponta) vs Geração — 12 meses · MWh'),
    React.createElement(View, { style: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 2 } },
      ...Array.from({ length: d.n12 }, (_, m) => React.createElement(View, { key: m, style: { width: gw, flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 1.5 } },
        // consumption bar (stacked FP+PT) with value label on top
        React.createElement(View, { style: { width: barW, alignItems: 'center' } },
          React.createElement(Text, { style: { fontSize: 4.5, color: NAVY, marginBottom: 1 } }, mwh(d.cFP[m] + d.cPT[m])),
          React.createElement(View, { style: { width: barW, height: d.cPT[m] / d.maxBar * H, backgroundColor: '#6692A8' } }),
          React.createElement(View, { style: { width: barW, height: d.cFP[m] / d.maxBar * H, backgroundColor: NAVY } }),
        ),
        // generation bar with value label on top
        React.createElement(View, { style: { width: barW, alignItems: 'center' } },
          React.createElement(Text, { style: { fontSize: 4.5, color: '#658c00', marginBottom: 1 } }, mwh(d.gen[m])),
          React.createElement(View, { style: { width: barW, height: d.gen[m] / d.maxBar * H, backgroundColor: LIME } }),
        ),
      )),
    ),
    React.createElement(View, { style: { flexDirection: 'row' } },
      ...d.labels.map((lb, m) => React.createElement(Text, { key: m, style: { width: gw, fontSize: 5, color: '#94a3b8', textAlign: 'center' } }, lb)),
    ),
    React.createElement(View, { style: { flexDirection: 'row', gap: 12, marginTop: 4 } },
      ...([['Consumo Fora Ponta', NAVY], ['Consumo Ponta', '#6692A8'], ['Geração estimada', LIME]] as [string, string][]).map(([lab, c], i) =>
        React.createElement(View, { key: i, style: { flexDirection: 'row', alignItems: 'center', marginRight: 10 } },
          React.createElement(View, { style: { width: 7, height: 7, backgroundColor: c, marginRight: 3 } }),
          React.createElement(Text, { style: { fontSize: 6.5, color: '#475569' } }, lab))),
    ),
    React.createElement(Text, { style: { fontSize: 6, color: '#94a3b8', marginTop: 2 } },
      `Valores em MWh · base das faturas do cliente (consumo) e geração estimada da usina — para conferência da premissa.`),
  );
}

function usinaBits(meta: ProposalMeta, d: ReturnType<typeof buildData>) {
  const multi = d.plants.length > 1;
  const cod = meta.usinaCodigo ? `[${meta.usinaCodigo}] ` : '';
  const name = d.plants[0]?.name ?? 'Usina Helexia';
  return {
    bandLabel: multi ? `${d.plants.length} usinas` : `Usina ${cod}${name}`,
    phrase: multi ? `as usinas solares da Helexia (carteira de ${d.plants.length} usinas)` : `a usina solar ${cod}${name}`,
  };
}

function ComoFunciona(project: Project) {
  const steps: [string, string][] = [
    ['1. Usina solar Helexia', 'Helexia constrói e opera (sem custo p/ o cliente)'],
    [`2. Rede ${project.distributor.name}`, 'A energia gerada é injetada na rede'],
    ['3. Suas unidades', 'Os créditos compensam o consumo das UCs'],
    ['4. Você paga o PPA', 'Preço fixo, abaixo da tarifa = economia'],
  ];
  return React.createElement(View, { wrap: false, style: { marginTop: 8 } },
    React.createElement(Text, { style: s.h2 }, 'Como funciona — Autoconsumo Remoto'),
    React.createElement(View, { style: { flexDirection: 'row', alignItems: 'stretch', gap: 4 } },
      ...steps.flatMap(([t, sub], i) => {
        const box = React.createElement(View, { key: `b${i}`, style: { flex: 1, borderWidth: 1, borderColor: TEAL, borderRadius: 5, padding: 6, backgroundColor: i === 3 ? '#ecfdf5' : 'white' } },
          React.createElement(Text, { style: { fontSize: 7.5, fontWeight: 'bold', color: NAVY, marginBottom: 2 } }, t),
          React.createElement(Text, { style: { fontSize: 6.5, color: GREY } }, sub),
        );
        return i < 3
          ? [box, React.createElement(View, { key: `a${i}`, style: { justifyContent: 'center' } }, React.createElement(Text, { style: { fontSize: 12, color: TEAL } }, '>'))]
          : [box];
      })
    ),
  );
}

function RiskBox() {
  const items = ['Sem investimento — CAPEX zero, sem obra na sua planta', 'O&M e disponibilidade da usina por conta da Helexia', 'Modelo take-or-pay protege ambos os lados', 'Energia 100% renovável e rastreável (ESG)'];
  return React.createElement(View, { wrap: false, style: { marginTop: 8, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 6, padding: 8, backgroundColor: LIGHT } },
    React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold', color: NAVY, marginBottom: 3 } }, 'Por que é seguro para o cliente'),
    React.createElement(View, { style: { flexDirection: 'row', flexWrap: 'wrap' } },
      ...items.map((it, i) => React.createElement(View, { key: i, style: { width: '50%', flexDirection: 'row', marginBottom: 2 } },
        React.createElement(Text, { style: { fontSize: 8, color: TEAL, width: 10 } }, '✓'),
        React.createElement(Text, { style: { fontSize: 7.5, color: '#334155', flex: 1 } }, it))),
    ),
  );
}

function Page1(project: Project, _result: SimulationResult, meta: ProposalMeta, d: ReturnType<typeof buildData>) {
  const { sm, n } = d;
  const cliente = meta.cliente ?? cleanName(project.clientName);
  const segmento = meta.segmento ?? 'Comercial / Industrial';
  const tipoGd = meta.tipoGd ?? 'Autoconsumo Remoto (GD1)';
  const mercado = project.marketType === 'ACL' ? 'Mercado Livre (ACL)' : 'Mercado Cativo';
  const local = meta.local ?? 'Rio de Janeiro';
  const dataStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  const u = usinaBits(meta, d);
  const coverage = d.consTot > 0 ? (sm.totalGeneration / (d.consTot * n)) * 100 : 0;
  const ecoPos = sm.economiaLiquida >= 0;

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
      React.createElement(Image, { src: `${import.meta.env.BASE_URL}Helexia_main_logo_screen_L.png`, style: { width: 120 } }),
      project.clientLogo
        ? React.createElement(Image, { src: project.clientLogo, style: { width: 90, height: 36, objectFit: 'contain' } })
        : React.createElement(Text, { style: { fontSize: 11, fontWeight: 'bold', color: NAVY } }, cliente),
    ),
    React.createElement(Text, { style: { fontSize: 7, color: GREY, textAlign: 'right', marginBottom: 6 } }, `${local}, ${dataStr} · proposta válida por 15 dias`),
    React.createElement(View, { style: s.band },
      React.createElement(Text, { style: s.bandTitle }, `Proposta de Economia em Energia · ${cliente}`),
      React.createElement(Text, { style: s.bandSub }, `${segmento} · Grupo A ${d.modalidade} · ${mercado} · ${project.distributor.state} (${project.distributor.name})`),
      React.createElement(Text, { style: s.bandSub }, `${tipoGd} · ${u.bandLabel} · Contrato ${n} meses`),
    ),
    // Hero band
    React.createElement(View, { style: s.heroRow },
      ...[
        { label: `Custo atual (${n}M)`, value: fmtBRL(sm.baselineSEM), sub: 'Energia + transmissão + impostos' },
        { label: `Custo com Helexia (${n}M)`, value: fmtBRL(d.custoCom), sub: `Preço fixo R$ ${Math.round(d.ppaMWh).toLocaleString('pt-BR')}/MWh` },
        { label: `Economia projetada (${n}M)`, value: fmtBRL(sm.economiaLiquida), sub: 'vs. custo atual c/ impostos' },
        { label: 'Desconto médio', value: fmtPct(sm.economiaPct), sub: `R$ ${Math.round(sm.economiaLiquida / n).toLocaleString('pt-BR')}/mês` },
      ].map((k, i) => React.createElement(View, { key: i, style: s.heroCard },
        React.createElement(Text, { style: s.heroLabel }, k.label),
        React.createElement(Text, { style: { ...s.heroValue, color: (i === 2 || i === 3) ? (ecoPos ? TEAL : '#dc2626') : NAVY } }, k.value),
        React.createElement(Text, { style: s.heroSub }, k.sub),
      ))
    ),
    React.createElement(Text, { style: s.valueLine },
      `Preço fixo Helexia (PPA): R$ ${Math.round(d.ppaMWh).toLocaleString('pt-BR')}/MWh — custo previsível, sem bandeiras, sem investimento e sem obra. Energia 100% renovável.`),
    // Valor total (economia + banco)
    React.createElement(View, { style: s.vtBox },
      React.createElement(View, { style: s.lineItem },
        React.createElement(Text, { style: s.liLabel }, `Economia no contrato (${n} meses)`),
        React.createElement(Text, { style: s.liVal }, fmtBRL(sm.economiaLiquida))),
      React.createElement(View, { style: s.lineItem },
        React.createElement(Text, { style: s.liLabel }, `+ Banco de créditos residual (${fmtMWh(sm.bancoResidualKWh)} @ PPA)`),
        React.createElement(Text, { style: { ...s.liVal, color: TEAL } }, fmtBRL(sm.bancoResidualValue))),
      React.createElement(View, { style: s.totalRow },
        React.createElement(Text, { style: s.totalLabel }, '= Valor total para o cliente'),
        React.createElement(Text, { style: s.totalVal }, fmtBRL(sm.valorTotal))),
    ),
    // Perfil de consumo + chart
    React.createElement(Text, { style: s.h2 }, 'Perfil de consumo (média mensal)'),
    React.createElement(View, { style: { flexDirection: 'row', gap: 16, marginBottom: 2 } },
      React.createElement(Text, { style: { fontSize: 9 } }, `Fora Ponta: ${fmtMWh(d.fp)} · ${(d.consTot ? d.fp / d.consTot * 100 : 0).toFixed(1)}%`),
      React.createElement(Text, { style: { fontSize: 9 } }, `Ponta: ${fmtMWh(d.pt)} · ${(d.consTot ? d.pt / d.consTot * 100 : 0).toFixed(1)}%`),
      React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold' } }, `Total: ${fmtMWh(d.consTot)}/mês`),
    ),
    d.pontaTarifa > 0 && React.createElement(Text, { style: { ...s.p, marginBottom: 2 } },
      `O consumo em ponta (tarifa evitada ~R$ ${Math.round(d.pontaTarifa).toLocaleString('pt-BR')}/MWh) é o que mais encarece a fatura — é onde a GD gera mais economia.`),
    MonthlyChart(d),
    ComoFunciona(project),
    // A solução (textual, condensed — the diagram above covers the flow visually)
    React.createElement(Text, { style: { ...s.h2, marginTop: 8 } }, 'A solução Helexia — Autoconsumo Remoto'),
    React.createElement(Text, { style: s.p },
      `A Helexia constrói, é proprietária e opera ${u.phrase} (Contrato de Locação da Usina + O&M) — o cliente não investe, não instala nada e não cuida da manutenção. A energia gerada é injetada na rede da ${project.distributor.name} e os créditos compensam o consumo das unidades; o cliente paga apenas a energia gerada, a um preço fixo de R$ ${Math.round(d.ppaMWh).toLocaleString('pt-BR')}/MWh (take-or-pay). O rateio é notificado à distribuidora (NDU); créditos garantidos pela Lei 14.300/2022.`),
    React.createElement(Text, { style: { ...s.p, color: GREY } },
      `Usina de referência: ${Math.round(d.capacidade).toLocaleString('pt-BR')} kWac · geração estimada de ${fmtMWh(sm.totalGeneration)} no contrato (média ${fmtMWh(sm.totalGeneration / n)}/mês), cobrindo ~${coverage.toFixed(0)}% do consumo.`),
  );
}

function Page2(project: Project, _result: SimulationResult, meta: ProposalMeta, d: ReturnType<typeof buildData>) {
  const { sm, n } = d;
  const ecoPos = sm.economiaLiquida >= 0;
  const bancoShare = sm.valorTotal > 0 ? sm.bancoResidualValue / sm.valorTotal : 0;
  const bancoMaterial = bancoShare >= 0.05;
  const contato = meta.contato ?? 'comercial.brasil@helexia.eu';
  const resolucao = shortResolution(project.distributor.resolution);

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Text, { style: s.h2 }, 'Comparativo detalhado — SEM vs COM Helexia'),
    DetailedInvoices(project, d),
    ecoPos
      ? React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold', color: '#15803d', marginTop: 6 } },
          `Economia acumulada de ${fmtBRL(sm.economiaLiquida)} em ${n} meses (média do contrato).`)
      : React.createElement(Text, { style: { fontSize: 8, color: '#dc2626', marginTop: 6 } },
          `Neste cenário o custo COM supera o SEM em ${fmtBRL(Math.abs(sm.economiaLiquida))} — revise PPA, tarifa-base ou rateio.`),
    RiskBox(),
    // Banco — emphasis scales with materiality
    bancoMaterial
      ? React.createElement(View, { wrap: false },
          React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold', color: NAVY, marginTop: 8 } }, 'Banco de créditos — um ativo que continua seu'),
          React.createElement(Text, { style: { ...s.p, marginTop: 2 } },
            `A energia injetada e não consumida vira crédito no Sistema de Compensação (SCEE), válido por até 60 meses a partir da geração (Lei 14.300/2022). Os créditos abatem o consumo dos meses seguintes ou de outras unidades do cliente. Ao final do contrato, o saldo de ${fmtMWh(sm.bancoResidualKWh)}, equivalente a ${fmtBRL(sm.bancoResidualValue)} ao PPA, ainda pertence ao cliente — ao serem utilizados, abatem a tarifa cheia, valendo ainda mais.`))
      : React.createElement(Text, { style: { ...s.p, marginTop: 8 } },
          `Banco de créditos residual ao fim do contrato: ${fmtMWh(sm.bancoResidualKWh)} (${fmtBRL(sm.bancoResidualValue)} ao PPA), válidos por até 60 meses (Lei 14.300/2022) — crédito que continua do cliente.`),
    React.createElement(Text, { style: s.quote },
      '"Com o modelo da Helexia, o cliente paga menos pela energia fora e dentro da ponta, trava um custo fixo e previsível, e ainda torna sua operação mais sustentável."'),
    React.createElement(Text, { style: s.cta }, 'Próximos passos'),
    ...[
      'Validação das premissas de consumo e rateio — concluída neste estudo.',
      'Aprovação comercial interna pela diretoria do cliente.',
      'Revisão jurídica do Contrato de Locação da Usina + O&M.',
      'Assinatura do Contrato de Locação + O&M.',
      'Troca de titularidade da usina para o CNPJ do cliente (requisito do autoconsumo remoto) e Notificação à distribuidora (NDU) para habilitação do rateio.',
      `Habilitação pela ${project.distributor.name} — processamento do NDU (~30 dias úteis).`,
      'Início do contrato — primeiro crédito GD alocado às unidades e início da economia mensal.',
    ].map((st, i) => React.createElement(View, { key: i, style: { flexDirection: 'row', marginBottom: 1.5 } },
      React.createElement(Text, { style: { fontSize: 8, fontWeight: 'bold', color: TEAL, width: 13 } }, `${i + 1}.`),
      React.createElement(Text, { style: { fontSize: 8, color: '#334155', flex: 1 } }, st),
    )),
    React.createElement(Text, { style: { fontSize: 9, color: NAVY, fontWeight: 'bold', marginTop: 4 } },
      `Fale com a Helexia para avançar: ${contato}`),
    React.createElement(View, { style: s.about },
      React.createElement(Text, { style: s.aboutTitle }, 'Helexia · grupo Voltalia · grupo AMF'),
      React.createElement(Text, { style: s.aboutText }, HELEXIA_ABOUT),
      React.createElement(Image, { src: `${import.meta.env.BASE_URL}grupo_brands.png`, style: { width: 480, alignSelf: 'center', marginTop: 8, marginBottom: 3 } }),
      React.createElement(Text, { style: { fontSize: 6, color: '#94a3b8', textAlign: 'center' } }, 'Marcas do grupo AMF presentes no Brasil'),
    ),
    React.createElement(Text, { style: s.disclaimer },
      `Estudo preparado a partir das faturas e do perfil de consumo informados pelo cliente. As projeções consideram a geração solar estimada da usina (cenário médio esperado) e a tarifa vigente da ${project.distributor.name} (${resolucao}). Os valores são estimativos e não constituem proposta vinculante — as condições definitivas serão formalizadas em contrato. Resultados reais podem variar conforme o clima, reajustes tarifários e a disponibilidade da usina.`),
  );
}

export async function generateProposalPDF(project: Project, result: SimulationResult, meta: ProposalMeta = {}): Promise<Blob> {
  const d = buildData(project, result);
  const doc = React.createElement(Document, null,
    Page1(project, result, meta, d),
    Page2(project, result, meta, d),
  );
  return pdf(doc).toBlob();
}

export function downloadProposalPDF(blob: Blob, clientName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Proposta_Helexia_${cleanName(clientName).replace(/[^a-z0-9]+/gi, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
