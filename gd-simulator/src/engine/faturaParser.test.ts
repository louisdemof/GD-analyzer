import { describe, it, expect, vi } from 'vitest';
// faturaParser.ts importa pdfjs-dist (precisa de DOMMatrix, ausente no Node). As funções testadas
// aqui são puras (não usam pdfjs), então mockamos o módulo só para o import não explodir.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
import { detectEquatorialSig, faturaHealth, type ParsedFatura, type MonthRow } from './faturaParser';
import { deriveTariffGroup, analyzeFaturaSet } from './projectFromFaturas';

// Trava os bugs de parser que corrigimos nesta sessão (não roda pdfjs; testa a lógica pura).

const row = (iso: string, fp: number): MonthRow => ({
  monthLabel: iso, monthIso: iso, consumoPonta: 0, consumoForaPonta: fp,
  consumoReservado: 0, demandaPonta: 0, demandaForaPonta: 0,
});
const fatura = (over: Partial<ParsedFatura>): ParsedFatura => ({
  ok: true, errors: [], warnings: [], history: [], ...over,
});

describe('detectEquatorialSig — estado da Equatorial (bug Pará vs preposição "para")', () => {
  it('NÃO detecta Pará quando o texto tem só a preposição "para"', () => {
    const go = 'EQUATORIAL GOIAS DISTRIBUIDORA · energia elétrica PARA não contribuinte · CATALAO GO BRASIL';
    expect(detectEquatorialSig(go).sig).toBe('EQUATORIAL GO');
  });
  it('detecta GO pelo endereço "GO BRASIL" mesmo sem a razão social', () => {
    expect(detectEquatorialSig('RUA 209 ... PEDREGAL, NOVO GAMA GO BRASIL').sig).toBe('EQUATORIAL GO');
  });
  it('detecta PA só por Belém/CELPA/"PA BRASIL" — nunca pela preposição', () => {
    expect(detectEquatorialSig('... BELÉM · CELPA · PA BRASIL ...').sig).toBe('EQUATORIAL PA');
    const bare = detectEquatorialSig('energia elétrica para o cliente');
    expect(bare.matched).toBe(false); // caiu no default → baixa confiança
  });
});

describe('deriveTariffGroup — Grupo B vs Grupo A', () => {
  it('B1/B3/RESIDENCIAL → Grupo B', () => {
    expect(deriveTariffGroup('B B1 RESIDENCIAL - NORMAL').isGrupoA).toBe(false);
    expect(deriveTariffGroup('B B3 COMERCIAL OU SERVIÇOS').isGrupoA).toBe(false);
  });
  it('A4 VERDE → Grupo A', () => {
    expect(deriveTariffGroup('A4 VERDE').isGrupoA).toBe(true);
  });
});

describe('analyzeFaturaSet — dedup de UC renumerada (REN 1095/24, março/abril)', () => {
  const ENDERECO = 'RUA 209 Q 482 L 21 SN 72890000';
  // Renumeração REAL: mesmo endereço, DOIS números distintos (antigo → novo).
  const marco = fatura({ ucNumero: '1990207-1', ucEndereco: ENDERECO, refMes: '03/2026',
    history: [row('2026-02', 6000), row('2026-03', 6200)] });
  const abril = fatura({ ucNumero: '3.619.041.012-06', ucEndereco: ENDERECO, refMes: '04/2026',
    history: [row('2026-03', 6200), row('2026-04', 6400)] });
  // Nº ausente em alguns meses (formato antigo não extraído) NÃO é renumeração.
  const semNum = fatura({ ucNumero: undefined, ucEndereco: ENDERECO, refMes: '02/2026',
    history: [row('2026-01', 5800), row('2026-02', 6000)] });

  it('duas faturas do MESMO endereço com números diferentes → 1 UC', () => {
    expect(analyzeFaturaSet([marco, abril]).ucCount).toBe(1);
  });
  it('emite aviso de renumeração quando há 2 números reais distintos', () => {
    const warns = analyzeFaturaSet([marco, abril]).warnings.join(' ');
    expect(warns).toMatch(/renumerada|1095/i);
  });
  it('NÃO emite falso alarme quando o nº só falta em algumas faturas (1 número real)', () => {
    const warns = analyzeFaturaSet([abril, semNum]).warnings.join(' ');
    expect(warns).not.toMatch(/renumerada|1095/i);
  });
});

describe('faturaHealth — detecção de anomalias', () => {
  it('avisa quando o consumo é zero em todos os meses', () => {
    const p = fatura({ classificacao: 'B3', history: [row('2026-01', 0), row('2026-02', 0)] });
    expect(faturaHealth(p).some(w => /zero/i.test(w))).toBe(true);
  });
  it('avisa outlier de escala (um mês 10× o normal)', () => {
    const h = Array.from({ length: 12 }, (_, i) => row(`2026-${i}`, 5000));
    h[3].consumoForaPonta = 60000; // 12× a mediana
    expect(faturaHealth(fatura({ classificacao: 'B3', history: h })).some(w => /acima do padrão/i.test(w))).toBe(true);
  });
  it('avisa queda estrutural de ~50% na metade recente (caso SSA)', () => {
    const h = [...Array(6).fill(0).map((_, i) => row(`2025-${i}`, 8000)), ...Array(6).fill(0).map((_, i) => row(`2026-${i}`, 4000))];
    expect(faturaHealth(fatura({ classificacao: 'B3', history: h })).some(w => /caiu/i.test(w))).toBe(true);
  });
  it('propaga o aviso do parser (baixa confiança da distribuidora)', () => {
    const p = fatura({ classificacao: 'B3', warnings: ['Estado da Equatorial não identificado com clareza — assumido PA.'], history: [row('2026-01', 5000)] });
    expect(faturaHealth(p).some(w => /Equatorial/i.test(w))).toBe(true);
  });
});
