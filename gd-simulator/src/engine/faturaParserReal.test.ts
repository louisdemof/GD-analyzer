import { describe, it, expect, vi } from 'vitest';
// faturaParser.ts importa pdfjs-dist (precisa de DOMMatrix, ausente no Node). As funções
// *FromLines testadas aqui são PURAS (recebem PdfLine[] já extraídas) — mockamos o módulo
// só para o import não explodir. As fixtures são linhas REAIS extraídas dos PDFs Superfrio.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
import { parseEnergisaFromLines, parseEquatorialFromLines, parseNeoenergiaFromLines,
  parseCemigFromLines, parseEdpSpFromLines, parseLightFromLines, parseEnelFromLines,
  parseCopelFromLines, type ParsedFatura } from './faturaParser';
import { analyzeFaturaSet, dedupByUC } from './projectFromFaturas';
import energisaCgd from './__fixtures__/energisa_cgd_jun26.json';
import eqTomadas from './__fixtures__/equatorial_gyn_tomadas.json';
import eqArm from './__fixtures__/equatorial_gyn_arm.json';
import coelba13410 from './__fixtures__/neoenergia_coelba_13410.json';
import coelba08301 from './__fixtures__/neoenergia_coelba_08301.json';
import cemigBritadora from './__fixtures__/cemig_britadora.json';
import edpSuzano from './__fixtures__/edp_suzano.json';
import lightJacarepagua from './__fixtures__/light_jacarepagua.json';
import enelrjClubmed from './__fixtures__/enelrj_clubmed.json';
import copelCwb2 from './__fixtures__/copel_cwb2.json';
import copelCwb3 from './__fixtures__/copel_cwb3.json';

// Fixtures são {page,y,text}. O caminho principal dos parsers usa line.text; items só é
// usado no fallback gatherWideRow (não disparado em faturas válidas) → items:[] basta.
const asLines = (f: { page: number; y: number; text: string }[]) => f.map(l => ({ ...l, items: [] })) as never;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byIso = (h: any[], iso: string): any => h.find(r => r.monthIso === iso)!;
const round = (n: number | undefined) => Math.round(n ?? 0);

describe('Energisa MS — Superfrio CGD (Campo Grande, A4 Verde) — bug do merge de linhas vizinhas', () => {
  const r = parseEnergisaFromLines(asLines(energisaCgd));
  it('reconhece Grupo A e as 13 linhas do histórico', () => {
    expect(r.classificacao).toMatch(/A4/i);
    expect(r.history.length).toBe(13);
  });
  it('mês corrente (JUN/26) com consumo correto — antes vinha 0 por causa do merge', () => {
    const jun = byIso(r.history, '2026-06');
    expect(round(jun.consumoPonta)).toBe(3196);
    expect(round(jun.consumoForaPonta)).toBe(193356);
  });
  it('MAI/26 não é contaminado pela linha vizinha (era 2.666 roubado da ponta)', () => {
    const mai = byIso(r.history, '2026-05');
    expect(round(mai.consumoPonta)).toBe(2666);
    expect(round(mai.consumoForaPonta)).toBe(190982);
  });
  it('nenhum mês fica zerado', () => {
    expect(r.history.every(m => m.consumoForaPonta > 0)).toBe(true);
  });
});

describe('Equatorial GO — Superfrio GYN Tomadas (optante B) — bug do token de ano "MAI / 26"', () => {
  const r = parseEquatorialFromLines(asLines(eqTomadas));
  it('reconhece 13 meses de histórico', () => {
    expect(r.history.length).toBe(13);
  });
  it('o ano NÃO vaza como demanda (era demandaPonta=26)', () => {
    // demanda ponta real do Tomadas fica entre 3–8 kW; se o ano "26" vazasse, apareceria 25/26.
    expect(Math.max(...r.history.map(m => m.demandaPonta))).toBeLessThan(20);
  });
  it('consumo fora ponta do mês recente é plausível (~672), não o valor deslocado', () => {
    const rec = byIso(r.history, '2026-04');
    expect(round(rec.consumoForaPonta)).toBe(672);
    expect(round(rec.consumoPonta)).toBe(129);
  });
});

describe('Equatorial GO — Superfrio GYN Armazém (Grupo A, ACL)', () => {
  const r = parseEquatorialFromLines(asLines(eqArm));
  it('13 meses; consumo do armazém na casa das centenas de MWh', () => {
    expect(r.history.length).toBe(13);
    const mai = byIso(r.history, '2026-05');
    expect(round(mai.consumoForaPonta)).toBe(151809);
    expect(round(mai.consumoPonta)).toBe(12718);
    expect(round(mai.demandaForaPonta)).toBe(328);
  });
});

describe('Neoenergia Coelba — Superfrio/Austral SSA UC 13410 (Simões Filho, A4 Livre)', () => {
  const r = parseNeoenergiaFromLines(asLines(coelba13410));
  it('identifica a distribuidora e o grupo', () => {
    expect(r.distributorSig).toBe('COELBA');
    expect(r.classificacao).toMatch(/A4/i);
    expect(r.classificacao).toMatch(/ACL|Livre/i);
  });
  it('lê o mês corrente do Demonstrativo de Consumo', () => {
    expect(r.history.length).toBe(1);
    const m = r.history[0];
    expect(round(m.consumoPonta)).toBe(13385);
    expect(round(m.consumoForaPonta)).toBe(149893);
    expect(round(m.demandaPonta)).toBe(300);
    expect(round(m.demandaForaPonta)).toBe(614);
  });
  it('extrai o Montante de Uso Contratado (demanda contratada)', () => {
    expect(round(r.demandaContratadaFP)).toBe(1160);
  });
  it('captura o número da instalação e o mês de referência', () => {
    expect(r.ucNumero).toBe('50003328');
    expect(r.refMes).toBe('05/2026');
  });
  it('endereço é o da INSTALAÇÃO (Simões Filho), não a sede da distribuidora (Salvador)', () => {
    expect(r.ucEndereco).toMatch(/PENETRACAO/);
    expect(r.ucEndereco).not.toMatch(/EDGARD SANTOS|SALVADOR/); // bug antigo: pegava a sede da Coelba
  });
});

describe('Coelba — as 2 UCs (13410 vs 08301) são distinguidas', () => {
  const a = parseNeoenergiaFromLines(asLines(coelba13410));
  const b = parseNeoenergiaFromLines(asLines(coelba08301));
  it('números de instalação diferentes', () => {
    expect(a.ucNumero).toBe('50003328');
    expect(b.ucNumero).toBe('10561510');
    expect(a.ucNumero).not.toBe(b.ucNumero);
  });
  it('endereços de instalação diferentes (999 vs 2222)', () => {
    expect(a.ucEndereco).not.toBe(b.ucEndereco);
    expect(a.ucEndereco).toMatch(/999/);
    expect(b.ucEndereco).toMatch(/2222/);
  });
});

// Consolidação: Coelba = 1 fatura por mês. Subir 13 faturas/UC deve virar 1 UC com 13 meses —
// NÃO 1 UC com 1 mês, e sem falso aviso de renumeração (bug reportado com as 26 faturas SSA).
describe('Consolidação de faturas mensais (Coelba) — 26 faturas → 2 UCs × 13 meses', () => {
  const mkMonth = (uc: string, addr: string, iso: string, cP: number, cFP: number): ParsedFatura => ({
    ok: true, errors: [], warnings: [], distributorSig: 'COELBA', ucNumero: uc, ucEndereco: addr,
    classificacao: 'A4 Livre - Verde — Cliente Livre (ACL)', refMes: `${iso.slice(5)}/${iso.slice(0, 4)}`,
    demandaContratadaFP: 1160,
    history: [{ monthIso: iso, monthLabel: `${iso.slice(5)}/${iso.slice(2, 4)}`, consumoPonta: cP, consumoForaPonta: cFP, consumoReservado: 0, demandaPonta: 0, demandaForaPonta: 200 }],
  });
  const months = ['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  const list: ParsedFatura[] = [
    ...months.map((m, i) => mkMonth('50003328', 'VA DE PENETRACAO II 999 GP B 43700000', m, 10000 + i, 100000 + i * 1000)),
    ...months.map((m, i) => mkMonth('10561510', 'VA DE PENETRACAO II 2222 A 43700000', m, 1400 + i, 14000 + i * 100)),
  ];
  it('consolida em exatamente 2 UCs', () => {
    expect(analyzeFaturaSet(list).ucCount).toBe(2);
    expect(dedupByUC(list).length).toBe(2);
  });
  it('cada UC fica com os 13 meses (não 1)', () => {
    for (const uc of dedupByUC(list)) expect(uc.history.length).toBe(13);
  });
  it('mensagem fala em faturas mensais consolidadas, sem falso aviso de renumeração', () => {
    const w = analyzeFaturaSet(list).warnings.join(' ');
    expect(w).toMatch(/faturas mensais.*2 UC/i);
    expect(w).toMatch(/13 meses/);
    expect(w).not.toMatch(/renumerada|1095/i); // o bug: emitia REN 1095/24 à toa
  });
});

// UC extraction added to the multi-month parsers (validated against real sample invoices).
describe('UC extraction — CEMIG · EDP SP · Light · Enel RJ (novos)', () => {
  it('CEMIG lê o Nº da Instalação como UC', () => {
    const r = parseCemigFromLines(asLines(cemigBritadora));
    expect(r.distributorSig).toBe('CEMIG-D');
    expect(r.ucNumero).toBe('3015051685');
  });
  it('EDP SP lê o nº da instalação após o cliente', () => {
    const r = parseEdpSpFromLines(asLines(edpSuzano));
    expect(r.distributorSig).toBe('EDP SP');
    expect(r.ucNumero).toBe('0151372625');
  });
  it('Light lê a Conta Contrato como UC', () => {
    const r = parseLightFromLines(asLines(lightJacarepagua));
    expect(r.distributorSig).toMatch(/LIGHT/);
    expect(r.ucNumero).toBe('20007373938');
  });
  it('Enel RJ usa o endereço da instalação como UC (nº embaralhado nos glifos)', () => {
    const r = parseEnelFromLines(asLines(enelrjClubmed));
    expect(r.distributorSig).toBe('ENEL RJ');
    expect(r.ucEndereco).toMatch(/BR101|MANGARATIBA|23860000/);
    expect(r.ucNumero).toBeUndefined(); // vem embaralhado → cai no endereço
  });
});

// COPEL (Paraná) — Superfrio PR, 2 UCs (CWBII · CWBIII). Senha = 0206 (código no nome).
describe('COPEL — Superfrio PR, 2 UCs distinguidas (CWBII vs CWBIII)', () => {
  const a = parseCopelFromLines(asLines(copelCwb2));
  const b = parseCopelFromLines(asLines(copelCwb3));
  it('reconhece COPEL e extrai o nº da instalação de cada UC', () => {
    expect(a.distributorSig).toBe('COPEL-DIS');
    expect(a.ucNumero).toBe('0040682723');
    expect(b.ucNumero).toBe('0040682733');
    expect(a.ucNumero).not.toBe(b.ucNumero);
  });
  it('endereços de instalação diferentes (Henrique Gonzaga vs Vanderlei Moreno)', () => {
    expect(a.ucEndereco).toMatch(/HENRIQUE GONZAGA/);
    expect(b.ucEndereco).toMatch(/VANDERLEI MORENO/);
    expect(a.ucEndereco).not.toBe(b.ucEndereco);
  });
  it('cada fatura traz histórico de consumo', () => {
    expect(a.history.length).toBeGreaterThan(0);
    expect(b.history.length).toBeGreaterThan(0);
  });
});
