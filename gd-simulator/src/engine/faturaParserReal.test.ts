import { describe, it, expect, vi } from 'vitest';
// faturaParser.ts importa pdfjs-dist (precisa de DOMMatrix, ausente no Node). As funções
// *FromLines testadas aqui são PURAS (recebem PdfLine[] já extraídas) — mockamos o módulo
// só para o import não explodir. As fixtures são linhas REAIS extraídas dos PDFs Superfrio.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
import { parseEnergisaFromLines, parseEquatorialFromLines, parseNeoenergiaFromLines } from './faturaParser';
import energisaCgd from './__fixtures__/energisa_cgd_jun26.json';
import eqTomadas from './__fixtures__/equatorial_gyn_tomadas.json';
import eqArm from './__fixtures__/equatorial_gyn_arm.json';
import coelba13410 from './__fixtures__/neoenergia_coelba_13410.json';

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
});
