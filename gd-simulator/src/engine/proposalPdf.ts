import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import type { Project, SimulationResult } from './types';
import { getAllPlants } from './simulation';

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

  return {
    sm, n, plants, ppaTotal, rede, pcAdd, fp, pt, consTot, modalidade, ppaMWh, pontaTarifa,
    custoCom: sm.baselineSEM - sm.economiaLiquida,
    capacidade: plants.reduce((a, p) => a + (p.capacityKWac ?? 0), 0),
  };
}

function Page1(project: Project, result: SimulationResult, meta: ProposalMeta, d: ReturnType<typeof buildData>) {
  const { sm, n } = d;
  const segmento = meta.segmento ?? 'Comercial / Industrial';
  const tipoGd = meta.tipoGd ?? 'Autoconsumo Remoto (GD1)';
  const mercado = project.marketType === 'ACL' ? 'Mercado Livre (ACL)' : 'Mercado Cativo';
  const usinaNome = d.plants.length > 1 ? `${d.plants.length} usinas` : (d.plants[0]?.name ?? 'Usina Helexia');
  const usinaCod = meta.usinaCodigo ? `[${meta.usinaCodigo}] ` : '';

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
      React.createElement(Image, { src: `${import.meta.env.BASE_URL}Helexia_main_logo_screen_L.png`, style: { width: 120 } }),
      project.clientLogo
        ? React.createElement(Image, { src: project.clientLogo, style: { width: 90, height: 36, objectFit: 'contain' } })
        : React.createElement(Text, { style: { fontSize: 11, fontWeight: 'bold', color: NAVY } }, project.clientName),
    ),
    React.createElement(View, { style: s.band },
      React.createElement(Text, { style: s.bandTitle }, `Proposta de Economia em Energia · ${project.clientName}`),
      React.createElement(Text, { style: s.bandSub }, `${segmento} · Grupo A ${d.modalidade} · ${mercado} · ${project.distributor.state} (${project.distributor.name})`),
      React.createElement(Text, { style: s.bandSub }, `${tipoGd} · Usina ${usinaCod}${usinaNome} · Contrato ${n} meses`),
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
        React.createElement(Text, { style: { ...s.heroValue, color: i === 2 || i === 3 ? TEAL : NAVY } }, k.value),
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
    // Perfil de consumo
    React.createElement(Text, { style: s.h2 }, 'Perfil de consumo (média mensal)'),
    React.createElement(View, { style: { flexDirection: 'row', gap: 16, marginBottom: 6 } },
      React.createElement(Text, { style: { fontSize: 9 } }, `Fora Ponta: ${fmtMWh(d.fp)} · ${(d.consTot ? d.fp / d.consTot * 100 : 0).toFixed(1)}%`),
      React.createElement(Text, { style: { fontSize: 9 } }, `Ponta: ${fmtMWh(d.pt)} · ${(d.consTot ? d.pt / d.consTot * 100 : 0).toFixed(1)}%`),
      React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold' } }, `Total: ${fmtMWh(d.consTot)}/mês`),
    ),
    d.pontaTarifa > 0 && React.createElement(Text, { style: s.p },
      `O peso do consumo em ponta (tarifa evitada ~R$ ${Math.round(d.pontaTarifa).toLocaleString('pt-BR')}/MWh) é o que mais encarece a fatura — é onde a GD gera mais economia. Preço fixo Helexia: R$ ${Math.round(d.ppaMWh).toLocaleString('pt-BR')}/MWh.`),
    // A solução
    React.createElement(Text, { style: s.h2 }, 'A solução Helexia — Autoconsumo Remoto'),
    React.createElement(Text, { style: s.p },
      `A Helexia constrói, é proprietária e opera a usina solar ${usinaCod}${usinaNome} — o cliente não investe, não instala nada na sua planta e não cuida da manutenção. No modelo de Autoconsumo Remoto (Lei 14.300/2022), a energia gerada é injetada na rede da ${project.distributor.name} e os créditos compensam o consumo das unidades consumidoras do cliente. O cliente paga apenas pela energia gerada, a um preço fixo de R$ ${Math.round(d.ppaMWh).toLocaleString('pt-BR')}/MWh — abaixo da tarifa e sem bandeiras.`),
    React.createElement(Text, { style: s.p },
      `Estrutura contratual: Contrato de Locação da Usina + O&M — a operação e a manutenção ficam por conta da Helexia. Remuneração em modelo take-or-pay sobre a energia injetada. O rateio dos créditos entre as unidades é definido e notificado à distribuidora (NDU). Os créditos são garantidos pela Lei 14.300/2022.`),
    React.createElement(Text, { style: { ...s.p, color: GREY } },
      `Usina de referência: ${Math.round(d.capacidade).toLocaleString('pt-BR')} kWac · geração estimada de ${fmtMWh(sm.totalGeneration)} no contrato (média ${fmtMWh(sm.totalGeneration / n)}/mês).`),
  );
}

function Page2(project: Project, result: SimulationResult, meta: ProposalMeta, d: ReturnType<typeof buildData>) {
  const { sm, n } = d;
  const contato = meta.contato ?? 'comercial.brasil@helexia.eu';
  const resolucao = project.distributor.resolution || 'resolução vigente';

  return React.createElement(Page, { size: 'A4', style: s.page },
    React.createElement(Text, { style: s.h2 }, `Antes da GD (${project.distributor.name}) → Com Helexia · fatura média mensal`),
    React.createElement(View, { style: s.twoCol },
      React.createElement(View, { style: s.col },
        React.createElement(Text, { style: s.colTitle }, `Antes — ${project.distributor.name}`),
        React.createElement(View, { style: s.lineItem },
          React.createElement(Text, { style: s.liLabel }, 'Energia + rede + demanda + impostos'),
          React.createElement(Text, { style: s.liVal }, fmtBRL(sm.baselineSEM / n))),
        React.createElement(View, { style: s.totalRow },
          React.createElement(Text, { style: s.totalLabel }, 'Total / mês'),
          React.createElement(Text, { style: s.totalVal }, fmtBRL(sm.baselineSEM / n))),
      ),
      React.createElement(View, { style: s.col },
        React.createElement(Text, { style: s.colTitle }, 'Com Helexia'),
        React.createElement(View, { style: s.lineItem },
          React.createElement(Text, { style: s.liLabel }, 'PPA Helexia'),
          React.createElement(Text, { style: s.liVal }, fmtBRL(d.ppaTotal / n))),
        React.createElement(View, { style: s.lineItem },
          React.createElement(Text, { style: s.liLabel }, 'Rede remanescente + demanda'),
          React.createElement(Text, { style: s.liVal }, fmtBRL(d.rede / n))),
        d.pcAdd > 0 && React.createElement(View, { style: s.lineItem },
          React.createElement(Text, { style: s.liLabel }, 'PIS/COFINS adicional'),
          React.createElement(Text, { style: s.liVal }, fmtBRL(d.pcAdd / n))),
        React.createElement(View, { style: s.totalRow },
          React.createElement(Text, { style: s.totalLabel }, 'Total / mês'),
          React.createElement(Text, { style: { ...s.totalVal, color: TEAL } }, fmtBRL(d.custoCom / n))),
      ),
    ),
    // Decomposição (barras)
    React.createElement(Text, { style: { ...s.h2, marginTop: 12 } }, `Composição de custo · ${n} meses`),
    (() => {
      const scale = 460 / Math.max(sm.baselineSEM, 1);
      const Bar = (label: string, segs: { v: number; c: string }[], total: number) =>
        React.createElement(View, { style: { marginBottom: 6 } },
          React.createElement(Text, { style: { fontSize: 7, color: GREY, marginBottom: 2 } }, `${label}: ${fmtBRL(total)}`),
          React.createElement(View, { style: { flexDirection: 'row', height: 14, borderRadius: 3, overflow: 'hidden' } },
            ...segs.map((g, i) => React.createElement(View, { key: i, style: { width: Math.max(0, g.v * scale), height: 14, backgroundColor: g.c } }))),
        );
      return React.createElement(View, null,
        Bar(`Sem GD (${project.distributor.name})`, [{ v: sm.baselineSEM, c: '#6692A8' }], sm.baselineSEM),
        Bar('Com Helexia', [
          { v: d.ppaTotal, c: TEAL },
          { v: Math.max(0, d.rede), c: NAVY },
          { v: Math.max(0, d.pcAdd), c: '#b45309' },
          { v: Math.max(0, sm.economiaLiquida), c: LIME },
        ], d.custoCom),
        React.createElement(View, { style: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 } },
          ...[['PPA Helexia', TEAL], ['Rede + demanda', NAVY], ['Economia', LIME]].map(([lab, c], i) =>
            React.createElement(View, { key: i, style: { flexDirection: 'row', alignItems: 'center', marginRight: 10 } },
              React.createElement(View, { style: { width: 7, height: 7, backgroundColor: c as string, marginRight: 3, borderRadius: 1 } }),
              React.createElement(Text, { style: { fontSize: 7, color: '#475569' } }, lab as string))),
        ),
      );
    })(),
    React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold', color: '#15803d', marginTop: 8 } },
      `Break-even desde o 1º mês · economia acumulada de ${fmtBRL(sm.economiaLiquida)} em ${n} meses.`),
    React.createElement(Text, { style: { fontSize: 9, fontWeight: 'bold', color: NAVY, marginTop: 6 } }, 'Banco de créditos — um ativo que continua seu'),
    React.createElement(Text, { style: { ...s.p, marginTop: 2 } },
      `A energia injetada e não consumida vira crédito no Sistema de Compensação (SCEE), válido por até 60 meses a partir da geração (Lei 14.300/2022). Os créditos abatem o consumo dos meses seguintes ou de outras unidades do cliente (autoconsumo remoto). Ao final do contrato, o saldo de ${fmtMWh(sm.bancoResidualKWh)} ≈ ${fmtBRL(sm.bancoResidualValue)} (valorizado ao PPA) ainda pertence ao cliente — ao serem utilizados, esses créditos abatem a tarifa cheia, valendo ainda mais.`),
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
    // Boilerplate
    React.createElement(View, { style: s.about },
      React.createElement(Text, { style: s.aboutTitle }, 'Helexia · grupo Voltalia · grupo AMF'),
      React.createElement(Text, { style: s.aboutText }, HELEXIA_ABOUT),
      React.createElement(Image, { src: `${import.meta.env.BASE_URL}grupo_brands.png`, style: { width: 480, alignSelf: 'center', marginTop: 10, marginBottom: 3 } }),
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
  a.download = `Proposta_Helexia_${(clientName || 'Cliente').replace(/[^a-z0-9]+/gi, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
