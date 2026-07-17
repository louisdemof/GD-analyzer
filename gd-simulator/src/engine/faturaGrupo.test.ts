import { describe, it, expect, vi } from 'vitest';
// Prova que cada parser distingue Grupo A × Grupo B corretamente, rodando deriveTariffGroup
// sobre a classificação REAL que cada parser extrai das faturas de amostra.
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }) }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
import {
  parseEnergisaFromLines, parseEquatorialFromLines, parseNeoenergiaFromLines, parseCopelFromLines,
  parseCemigFromLines, parseEdpSpFromLines, parseLightFromLines, parseEnelFromLines, parseEnelGrupoBFromLines,
} from './faturaParser';
import { deriveTariffGroup } from './projectFromFaturas';
import energisaA from './__fixtures__/energisa_cgd_jun26.json';
import energisaB from './__fixtures__/energisa_b_avenida.json';
import eqArm from './__fixtures__/equatorial_gyn_arm.json';
import eqTomadas from './__fixtures__/equatorial_gyn_tomadas.json';
import coelba from './__fixtures__/neoenergia_coelba_13410.json';
import copel from './__fixtures__/copel_cwb2.json';
import cemig from './__fixtures__/cemig_britadora.json';
import edp from './__fixtures__/edp_suzano.json';
import light from './__fixtures__/light_jacarepagua.json';
import enelRj from './__fixtures__/enelrj_clubmed.json';
import enelCeB from './__fixtures__/enelce_b_avenida.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L = (f: any) => f.map((l: any) => ({ ...l, items: [] })) as never;

// [nome, parser, fixture, esperado isGrupoA]
const CASES: [string, (l: never) => { classificacao?: string }, never, boolean][] = [
  ['Energisa MS — A4 Verde', parseEnergisaFromLines, L(energisaA), true],
  ['Energisa MS — B3 Comercial (baixa tensão)', parseEnergisaFromLines, L(energisaB), false],
  ['Equatorial GO — Armazém A4 ACL', parseEquatorialFromLines, L(eqArm), true],
  ['Equatorial GO — Tomadas B3 optante', parseEquatorialFromLines, L(eqTomadas), false],
  ['Coelba BA — A4 Livre', parseNeoenergiaFromLines, L(coelba), true],
  ['COPEL PR — A4', parseCopelFromLines, L(copel), true],
  ['CEMIG MG — A4', parseCemigFromLines, L(cemig), true],
  ['EDP SP — A4 Verde', parseEdpSpFromLines, L(edp), true],
  ['Light RJ — A4', parseLightFromLines, L(light), true],
  ['Enel RJ — A4 Horo Verde', parseEnelFromLines, L(enelRj), true],
  ['Enel CE / Coelce — B3', parseEnelGrupoBFromLines, L(enelCeB), false],
];

describe('Distinção Grupo A × Grupo B — todas as distribuidoras (faturas reais)', () => {
  for (const [nome, parser, fixture, esperadoA] of CASES) {
    it(`${nome} → ${esperadoA ? 'Grupo A' : 'Grupo B'}`, () => {
      const r = parser(fixture);
      const { isGrupoA, group } = deriveTariffGroup(r.classificacao || '');
      expect({ nome, classificacao: r.classificacao, group, isGrupoA }).toMatchObject({ isGrupoA: esperadoA });
    });
  }
});

describe('Rede de segurança — grupo inferido quando a classe não vem explícita', () => {
  it('sem classe MAS com demanda → Grupo A (não cai no default B3), baixa confiança', () => {
    const r = deriveTariffGroup('', true);
    expect(r.isGrupoA).toBe(true);
    expect(r.confident).toBe(false);
  });
  it('sem classe e sem demanda → B3, baixa confiança', () => {
    const r = deriveTariffGroup('', false);
    expect(r.isGrupoA).toBe(false);
    expect(r.confident).toBe(false);
  });
  it('classe explícita → alta confiança', () => {
    expect(deriveTariffGroup('A4 VERDE').confident).toBe(true);
    expect(deriveTariffGroup('B3 COMERCIAL').confident).toBe(true);
    expect(deriveTariffGroup('A4 VERDE').isGrupoA).toBe(true);
    expect(deriveTariffGroup('B3 COMERCIAL').isGrupoA).toBe(false);
  });
})
