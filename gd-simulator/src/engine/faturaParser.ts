/**
 * Parser for Energisa MS fatura PDFs (DANF3E layout).
 *
 * Extracts UC matrícula, classificação, demanda contratada FP, and the
 * 13-month consumption + demanda medida history from the "Consumo dos
 * Últimos 13 Meses" table.
 *
 * Browser-only (uses pdfjs-dist with a Vite-bundled worker).
 */

import * as pdfjsLib from 'pdfjs-dist';
// Vite bundles the worker as a URL when imported with `?url`
// eslint-disable-next-line import/no-unresolved
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set up worker once at module load
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export interface MonthRow {
  monthLabel: string;       // e.g. "MAR/26"
  monthIso: string;         // e.g. "2026-03"
  consumoPonta: number;     // kWh
  consumoForaPonta: number; // kWh
  consumoReservado: number; // kWh (0 if not irrigante)
  demandaPonta: number;     // kW
  demandaForaPonta: number; // kW
}

export interface ParsedFatura {
  ok: boolean;
  errors: string[];
  warnings: string[];
  needsPassword?: boolean;     // PDF is encrypted and the supplied password was wrong/missing
  notThisDistributor?: boolean; // content didn't match this parser → caller can try another
  distributorSig?: string;     // detected distributor (e.g. 'COPEL-DIS', 'EMS') for project build
  // Energia incentivada signals (ACL): the source discount % when the bill states it
  // (CEMIG/Light print "desconto de X%"), and the monetary benefit for reconciliation.
  incentivadaLevelPct?: number; // 0–1, e.g. 0.4987 → maps to I50
  incentivadaBeneficio?: number; // R$ (líquido) — "Benefício Tarifário" for cross-checking
  // Identification
  ucMatricula?: string;        // raw e.g. "0001935906-2026-03-3"
  ucNumero?: string;           // canonical e.g. "1935906-6"
  ucEndereco?: string;         // installation address (normalized) — stable dedup key when the UC
                               // number changes across bills (e.g. REN 1095/24 renumbering)
  classificacao?: string;      // e.g. "MTV-MOD.TARIFÁRIA VERDE / A3A RURAL / PROD.RURAL COM INSC.ESTADUAL"
  cnpj?: string;
  refMes?: string;             // e.g. "Março / 2026"
  // Contracted demand
  demandaContratadaFP?: number;  // kW
  demandaContratadaPonta?: number;
  // Current-month line items (from "Itens da Fatura")
  currentMonth?: {
    consumoPonta?: number;
    consumoForaPonta?: number;
    consumoReservado?: number;
    demandaMedidaFP?: number;
    tarifaFPcomTrib?: number;
    tarifaPTcomTrib?: number;
    tarifaRSVcomTrib?: number;
    tarifaDemandaComTrib?: number;
  };
  // Tax rates extracted from tributos table
  taxes?: {
    PIS?: number;
    COFINS?: number;
    ICMS?: number;
  };
  // 13-month history
  history: MonthRow[];
}

const MONTH_PT_TO_NUM: Record<string, string> = {
  JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06',
  JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12',
};

// Convert "1.234,56" → 1234.56
function parseBrNumber(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  text: string;
}

interface PdfLine {
  page: number;
  y: number;
  items: PdfTextItem[];
  text: string; // joined "x | y | z"
}

async function extractLines(file: File, password?: string): Promise<PdfLine[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), password }).promise;
  const allItems: PdfTextItem[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const item of tc.items as Array<{ str: string; transform: number[] }>) {
      if (!item.str || !item.str.trim()) continue;
      allItems.push({ page: p, x: item.transform[4], y: item.transform[5], text: item.str.trim() });
    }
  }

  // Group items into lines by (page, Y±3px)
  const Y_TOL = 4;
  const lines: PdfLine[] = [];
  for (const it of allItems) {
    const existing = lines.find(l => l.page === it.page && Math.abs(l.y - it.y) <= Y_TOL);
    if (existing) {
      existing.items.push(it);
      // Update y to running mean
      existing.y = (existing.y + it.y) / 2;
    } else {
      lines.push({ page: it.page, y: it.y, items: [it], text: '' });
    }
  }
  // Sort items within each line by X, build joined text
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map(i => i.text).join(' | ');
  }
  // Sort lines by page asc, then Y desc (PDF coords: high Y = top of page)
  lines.sort((a, b) => a.page - b.page || b.y - a.y);
  return lines;
}

function findFirstMatch(lines: PdfLine[], pattern: RegExp): RegExpMatchArray | null {
  for (const line of lines) {
    const m = line.text.match(pattern);
    if (m) return m;
  }
  return null;
}

function findLineContaining(lines: PdfLine[], needle: string): PdfLine | null {
  for (const line of lines) {
    if (line.text.includes(needle)) return line;
  }
  return null;
}

/**
 * Extract a row's full content by Y proximity to a seed line, merging items
 * from nearby Y bands (Energisa wraps long rows ±2px).
 */
function gatherWideRow(lines: PdfLine[], page: number, y: number, yTol = 8): string {
  const items: PdfTextItem[] = [];
  for (const line of lines) {
    if (line.page !== page) continue;
    if (Math.abs(line.y - y) > yTol) continue;
    items.push(...line.items);
  }
  items.sort((a, b) => a.x - b.x);
  return items.map(i => i.text).join(' | ');
}

export async function parseEnergisaFatura(file: File): Promise<ParsedFatura> {
  let lines: PdfLine[];
  try {
    lines = await extractLines(file);
  } catch (e) {
    return { ok: false, errors: ['Não foi possível ler o PDF: ' + (e instanceof Error ? e.message : 'erro desconhecido')], warnings: [], history: [] };
  }
  return parseEnergisaFromLines(lines);
}

/** Pure parse of Energisa MS DANF3E lines — testable without pdfjs. */
export function parseEnergisaFromLines(lines: PdfLine[]): ParsedFatura {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };

  // Sanity check — confirm it's an Energisa fatura
  const isEnergisa = lines.some(l => l.text.includes('ENERGISA') || l.text.includes('DANF3E'));
  if (!isEnergisa) {
    result.warnings.push('Layout não identificado como Energisa — extração pode estar imprecisa.');
  }

  // ── Matrícula ──
  const matMatch = findFirstMatch(lines, /MATR[IÍ]CULA:\s*\|?\s*(\d{4,}[-\d]*)/i);
  if (matMatch) {
    result.ucMatricula = matMatch[1].trim();
    // Energisa format is XXXXXXX-YYYY-MM-V — first segment is UC number
    const numMatch = result.ucMatricula.match(/^0*(\d+)/);
    if (numMatch) {
      const num = numMatch[1];
      // Try to find the canonical "1935906-6" format on the doc
      const canon = findFirstMatch(lines, new RegExp(`(${num}-\\d)`));
      result.ucNumero = canon ? canon[1] : num;
    }
  }

  // ── Classificação ──
  const classLine = findLineContaining(lines, 'Classificação:');
  if (classLine) {
    // The classificação may span 2 lines; take the line + the one immediately below
    const text = classLine.text.replace(/.*Classificação:\s*/i, '').trim();
    // Sometimes continued on next y-band
    const nextLine = lines.find(l => l.page === classLine.page && l.y < classLine.y && classLine.y - l.y < 12);
    const continuation = nextLine ? nextLine.text.split('|')[0].trim() : '';
    result.classificacao = continuation && /RURAL|INDUSTRIAL|COMERCIAL|RESIDENCIAL|PROD\./i.test(continuation)
      ? `${text} ${continuation}`.trim()
      : text;
  }

  // ── CNPJ pagador ──
  const cnpjMatch = findFirstMatch(lines, /CNPJ\/CPF:\s*\|?\s*([\dX./X-]+)/);
  if (cnpjMatch) result.cnpj = cnpjMatch[1].trim();

  // ── Ref Mês ──
  const refMatch = findFirstMatch(lines, /(Janeiro|Fevereiro|Mar[çc]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s*\/\s*(\d{4})/i);
  if (refMatch) result.refMes = `${refMatch[1]} / ${refMatch[2]}`;

  // ── Demanda contratada ──
  // Pattern: "Demanda fora ponta - kW | <number>"
  const dcFPLine = findLineContaining(lines, 'Demanda fora ponta');
  if (dcFPLine) {
    const m = dcFPLine.text.match(/Demanda fora ponta[^|]*\|\s*([0-9.,]+)/i);
    if (m) result.demandaContratadaFP = parseBrNumber(m[1]);
  }
  const dcPTLine = findLineContaining(lines, 'Demanda ponta');
  if (dcPTLine && !dcPTLine.text.includes('fora')) {
    const m = dcPTLine.text.match(/Demanda ponta[^|]*\|\s*([0-9.,]+)/i);
    if (m) result.demandaContratadaPonta = parseBrNumber(m[1]);
  }

  // ── Tax rates from tributos table ──
  // Pattern lines like "PIS | 19.846,20 | 0,5709 | 113,29"
  const taxes: ParsedFatura['taxes'] = {};
  for (const line of lines) {
    const pisMatch = line.text.match(/^PIS\s*\|\s*[\d.,]+\s*\|\s*([\d,]+)\s*\|/);
    if (pisMatch) taxes.PIS = parseBrNumber(pisMatch[1]) / 100;
    const cofMatch = line.text.match(/^COFINS\s*\|\s*[\d.,]+\s*\|\s*([\d,]+)\s*\|/);
    if (cofMatch) taxes.COFINS = parseBrNumber(cofMatch[1]) / 100;
    const icmsMatch = line.text.match(/^ICMS\s*\|\s*[\d.,]+\s*\|\s*([\d,]+)\s*\|/);
    if (icmsMatch) taxes.ICMS = parseBrNumber(icmsMatch[1]) / 100;
  }
  if (Object.keys(taxes).length > 0) result.taxes = taxes;

  // ── Itens da Fatura — current month ──
  const cm: NonNullable<ParsedFatura['currentMonth']> = {};
  for (const line of lines) {
    // Pattern: "Consumo em kWh - Ponta | KWH | 2.733,74 | 2,808110 | 7.676,66 | ..."
    const cpMatch = line.text.match(/Consumo em kWh\s*-\s*Ponta[^|]*\|\s*KWH\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)/i);
    if (cpMatch) {
      cm.consumoPonta = parseBrNumber(cpMatch[1]);
      cm.tarifaPTcomTrib = parseBrNumber(cpMatch[2]);
    }
    const cfpMatch = line.text.match(/Consumo em kWh\s*-\s*Fora Ponta[^|]*\|\s*KWH\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)/i);
    if (cfpMatch) {
      cm.consumoForaPonta = parseBrNumber(cfpMatch[1]);
      cm.tarifaFPcomTrib = parseBrNumber(cfpMatch[2]);
    }
    const crsvMatch = line.text.match(/Consumo em kWh Reservado[^|]*\|\s*KWH\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)/i);
    if (crsvMatch) {
      cm.consumoReservado = parseBrNumber(crsvMatch[1]);
      cm.tarifaRSVcomTrib = parseBrNumber(crsvMatch[2]);
    }
    const dmFPMatch = line.text.match(/Demanda de Pot[êe]ncia Medida\s*-\s*Fora Ponta[^|]*\|\s*KW\s*\|\s*([\d.,]+)\s*\|\s*([\d.,]+)/i);
    if (dmFPMatch) {
      cm.demandaMedidaFP = parseBrNumber(dmFPMatch[1]);
      cm.tarifaDemandaComTrib = parseBrNumber(dmFPMatch[2]);
    }
  }
  if (Object.keys(cm).length > 0) result.currentMonth = cm;

  // ── Detect posto profile from classificação ──
  // Rural irrigante/aquicultor → has RSV (Reservado) column in the history table
  // Industrial / commercial → no RSV; numbers misclassified as RSV are usually
  // ERE excedente or saldo acumulado of GDI credits — discard them.
  // Grupo B Convencional → single posto (no Ponta), only 1 consumo column.
  const cls = (result.classificacao || '').toUpperCase();
  const isRural = /\bRURAL\b|IRRIG|AQUICULT/.test(cls);
  const isGrupoB = /\bB[123]\b|RESIDENCIAL|COM\.|COMERCIAL/.test(cls)
    && !/\bA[1-4]/.test(cls); // hedge against false positives
  const expectedConsumos = isGrupoB ? 1 : (isRural ? 3 : 2);
  const expectedDemandas = isGrupoB ? 0 : 2; // Verde has FP demand only; Azul has both (we treat as 2 max)
  // Sanity caps to filter outliers (energia injetada GDI, saldo acumulado, etc.)
  const maxReasonableConsumo = 1_000_000; // 1 GWh/mês — absurd ceiling
  const maxReasonableDemanda = 5_000; // 5 MW

  // ── 13-month history ──
  // For each month label found anywhere in the document, score the row by how
  // many usable numbers it yields, and keep only the BEST candidate per month.
  // This handles faturas where the same month appears in multiple sections
  // (e.g. "Nº DIAS" column on page 1 + actual consumo table on page 2).
  const monthRe = /\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{2})\b/g;

  interface Candidate {
    consumos: number[];
    demandas: number[];
    score: number; // higher is better
  }
  const bestPerMonth = new Map<string, { label: string; iso: string; cand: Candidate }>();

  for (const line of lines) {
    const matches = [...line.text.matchAll(monthRe)];
    if (matches.length === 0) continue;
    for (const mm of matches) {
      const monthLabel = `${mm[1]}/${mm[2]}`;

      // Each Energisa history row is already a complete single line (extractLines Y_TOL=4
      // merges ±2px wraps). Parse the line itself — gatherWideRow(yTol=6) merged NEIGHBOUR
      // rows (Superfrio MS bills space them ~6px apart) and corrupted the values (JUN/26
      // ended up 0, MAI/26 stole ponta). Only widen when the line yields no consumo (a
      // genuine wrap). Validated across 13 Energisa MS bills (Superfrio Campo Grande).
      let wide = line.text;
      if (!(wide.split(monthLabel)[1] || '').match(/[\d.]+,\d{2}/g)?.some(s => parseBrNumber(s) >= 1000)) {
        wide = gatherWideRow(lines, line.page, line.y, 3);
      }
      const afterLabel = wide.split(monthLabel)[1] || '';
      const beforeNextMonth = afterLabel.split(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/\d{2}\b/)[0] || '';
      const numStrs = beforeNextMonth.match(/[\d.,]+/g) || [];
      const nums = numStrs.map(parseBrNumber).filter(n => !isNaN(n));

      const consumos: number[] = [];
      const demandas: number[] = [];
      let lastWasConsumo = false;
      for (const n of nums) {
        if (n >= 1000 && n <= maxReasonableConsumo && consumos.length < expectedConsumos) {
          consumos.push(n);
          lastWasConsumo = true;
        } else if (n >= 1 && n <= maxReasonableDemanda && lastWasConsumo && demandas.length < expectedDemandas) {
          demandas.push(n);
          lastWasConsumo = false;
        } else {
          lastWasConsumo = false;
        }
      }

      // Score: weighted toward consumos (×10), then demandas (×1).
      // Rows with no consumos (like Nº DIAS columns) score 0.
      const score = consumos.length * 10 + demandas.length;

      const existing = bestPerMonth.get(monthLabel);
      if (!existing || score > existing.cand.score) {
        const yearShort = parseInt(mm[2], 10);
        const yearFull = yearShort < 50 ? 2000 + yearShort : 1900 + yearShort;
        const monthIso = `${yearFull}-${MONTH_PT_TO_NUM[mm[1]]}`;
        bestPerMonth.set(monthLabel, {
          label: monthLabel,
          iso: monthIso,
          cand: { consumos, demandas, score },
        });
      }
    }
  }

  for (const { label, iso, cand } of bestPerMonth.values()) {
    const row: MonthRow = {
      monthLabel: label,
      monthIso: iso,
      consumoPonta: isGrupoB ? 0 : (cand.consumos[0] ?? 0),
      consumoForaPonta: isGrupoB ? (cand.consumos[0] ?? 0) : (cand.consumos[1] ?? 0),
      consumoReservado: isRural && !isGrupoB ? (cand.consumos[2] ?? 0) : 0,
      demandaPonta: isGrupoB ? 0 : (cand.demandas[0] ?? 0),
      demandaForaPonta: isGrupoB ? 0 : (cand.demandas[1] ?? 0),
    };
    result.history.push(row);
  }

  // Sort history by ISO month ascending (oldest first)
  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));

  if (result.history.length === 0) {
    result.warnings.push('Nenhuma linha do histórico de 13 meses foi reconhecida — verifique o layout do PDF.');
  }

  result.ok = result.errors.length === 0;
  return result;
}

// ─── COPEL (DANF3E-PR / Cliente Livre) parser ──────────────────────────────
// COPEL bills are password-protected (the password is often the 4-digit code in
// the filename, e.g. "CWBII_0206" → "0206") and carry a full 12-month history on
// the LAST page ("Histórico de Consumo e Pagamentos"). One PDF → 12 months.
// History row columns (bare numbers, after the dates/valor are filtered out):
//   [0] Consumo Ponta · [1] Consumo Fora Ponta · [2] Demanda Ponta ·
//   [3] Demanda Fora Ponta · [4] Dem.Cont Ponta · [5] Dem.Cont Fora Ponta · …
export async function parseCopelFatura(file: File, password?: string): Promise<ParsedFatura> {
  let lines: PdfLine[];
  try {
    lines = await extractLines(file, password);
  } catch (e) {
    const msg = (e as { name?: string; message?: string });
    if (/password/i.test(msg?.name || '') || /password/i.test(msg?.message || '')) {
      return { ok: false, errors: ['PDF protegido por senha.'], warnings: [], history: [], needsPassword: true };
    }
    return { ok: false, errors: ['Falha ao ler o PDF.'], warnings: [], history: [] };
  }
  return parseCopelFromLines(lines);
}

/** Pure parse of COPEL (Paraná) lines — testable without pdfjs. */
export function parseCopelFromLines(lines: PdfLine[]): ParsedFatura {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };
  const allText = lines.map(l => l.text).join('\n');
  if (!/copel/i.test(allText)) {
    result.notThisDistributor = true;
    result.errors.push('Não parece ser uma fatura COPEL.');
    return result;
  }
  result.distributorSig = 'COPEL-DIS';
  // UC: o nº da instalação/medidor encabeça cada linha da tabela de medição
  // ("0040682723 | CONSUMO kWh | ..."); é estável no mês e distinto por UC. O endereço
  // ("Endereço: R Henrique Gonzaga...") é a chave de dedup (sobrevive à renumeração).
  // Validado nas faturas Superfrio PR (CWBII 0040682723 · CWBIII 0040682733).
  const copelUc = allText.match(/(\d{8,})\s*\|\s*(?:CONSUMO|DEMANDA|EN\.EXCE)/i);
  if (copelUc) result.ucNumero = copelUc[1];
  const copelEnd = allText.match(/Endere[çc]o:\s*\|?\s*([^|]+?)\s*\|/i);
  if (copelEnd) result.ucEndereco = copelEnd[1].replace(/\s+/g, ' ').replace(/[.,\-/]/g, '').toUpperCase().trim();

  // Tariff group + modalidade / mercado
  const grp = findFirstMatch(lines, /\bA([1-4])\b[^|]*(Comercial|Industrial|Rural|Trifasico|Monofasico|Bifasico|Armazens)/i);
  const grpStr = grp ? `A${grp[1]}` : undefined;
  const isVerde = /TARIFA\s+HOR[ÁA]RIA\s+VERDE/i.test(allText);
  const isAzul = /TARIFA\s+HOR[ÁA]RIA\s+AZUL/i.test(allText);
  const isACL = /CLIENTE\s+LIVRE/i.test(allText) || /ENERGIA\s+ELETRICA\s+ACL/i.test(allText);
  result.classificacao = [grpStr, isVerde ? 'VERDE' : isAzul ? 'AZUL' : null, isACL ? 'Cliente Livre (ACL)' : 'Cativo']
    .filter(Boolean).join(' — ') || undefined;

  // Reference month
  const refM = allText.match(/Consumo\/Uso do Sistema:?\s*\|?\s*(\d{2})\/(\d{4})/i)
    || allText.match(/FATURA DO MES\s*\|?\s*(\d{2})\/(\d{4})/i);
  if (refM) result.refMes = `${refM[1]}/${refM[2]}`;

  // History table (last page) — rows starting with MM/YYYY with ≥6 bare numbers
  const seen = new Set<string>();
  for (const line of lines) {
    const mm = line.text.match(/^\s*(\d{2})\/(\d{4})\b/);
    if (!mm) continue;
    const nums = line.text.split('|').map(s => s.trim()).filter(t => /^\d+(\.\d+)?$/.test(t)).map(Number);
    if (nums.length < 6) continue;
    const iso = `${mm[2]}-${mm[1]}`;
    if (seen.has(iso)) continue;
    seen.add(iso);
    result.history.push({
      monthLabel: `${mm[1]}/${mm[2].slice(2)}`,
      monthIso: iso,
      consumoPonta: nums[0],
      consumoForaPonta: nums[1],
      consumoReservado: 0,
      demandaPonta: nums[2],
      demandaForaPonta: nums[3],
    });
    if (result.demandaContratadaFP == null && nums[5] > 0) result.demandaContratadaFP = nums[5];
  }
  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));

  if (result.history.length === 0) {
    result.errors.push('Histórico de consumo não reconhecido na última página da fatura COPEL.');
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ── CEMIG (Minas Gerais) — DANF3E / Nota Fiscal de Energia Elétrica ──────────
// History table "Histórico de Consumo": Mês/Ano | Demanda(HP,HFP) | Energia(HP,HFP,HR),
// months as PT abbreviations (MAI/25) and Brazilian number format (181.947 = 181947).
const CEMIG_MONTHS: Record<string, string> = {
  JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06',
  JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12',
};
const brNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

export async function parseCemigFatura(file: File, password?: string): Promise<ParsedFatura> {
  let lines: PdfLine[];
  try {
    lines = await extractLines(file, password);
  } catch (e) {
    const msg = (e as { name?: string; message?: string });
    if (/password/i.test(msg?.name || '') || /password/i.test(msg?.message || '')) {
      return { ok: false, errors: ['PDF protegido por senha.'], warnings: [], history: [], needsPassword: true };
    }
    return { ok: false, errors: ['Falha ao ler o PDF.'], warnings: [], history: [] };
  }
  return parseCemigFromLines(lines);
}

/** Pure parse of CEMIG lines — testable without pdfjs. */
export function parseCemigFromLines(lines: PdfLine[]): ParsedFatura {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };
  const allText = lines.map(l => l.text).join('\n');
  if (!/cemig/i.test(allText)) {
    result.notThisDistributor = true;
    result.errors.push('Não parece ser uma fatura CEMIG.');
    return result;
  }
  result.distributorSig = 'CEMIG-D';
  // UC = Nº da Instalação ("Instalação: | 3015051685"). Valida a separação de UCs no dedup.
  const cemigUc = allText.match(/Instala[çc][ãa]o:\s*\|?\s*(\d{6,})/i);
  if (cemigUc) result.ucNumero = cemigUc[1];
  const cemigDisc = allText.match(/desconto de\s*([\d.,]+)\s*%/i);
  if (cemigDisc) result.incentivadaLevelPct = brNum(cemigDisc[1]) / 100;

  // Tariff group + modalidade / mercado
  const grp = allText.match(/\bA([1-4])\s+Verde/i) || allText.match(/Subgrupo:?\s*\|?\s*A([1-4])/i);
  const grpStr = grp ? `A${grp[1]}` : undefined;
  const isVerde = /A[1-4]\s+Verde/i.test(allText) || /Tarifa\s+Verde/i.test(allText);
  const isAzul = /A[1-4]\s+Azul/i.test(allText) || /Tarifa\s+Azul/i.test(allText);
  const isACL = /TUSD\s+Livre/i.test(allText) || /\bLivre\b/i.test(allText);
  result.classificacao = [grpStr, isVerde ? 'VERDE' : isAzul ? 'AZUL' : null, isACL ? 'Cliente Livre (ACL)' : 'Cativo']
    .filter(Boolean).join(' — ') || undefined;

  // Reference month
  const refM = allText.match(/M[êe]s\/Ano:?\s*\|?\s*(\d{2})\/(\d{4})/i);
  if (refM) result.refMes = `${refM[1]}/${refM[2]}`;

  // Demanda contratada (Grandezas Contratadas) — words may be pipe-separated in extraction.
  const dem = allText.match(/Demanda[\s|]+Fora[\s|]+Ponta[\s|]+([\d.,]+)/i);
  if (dem) result.demandaContratadaFP = brNum(dem[1]);

  // History rows: "MAI/25  <demHP> <demHFP> <enHP> <enHFP> <enHR>" (first 5 numbers).
  const monthRe = /^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{2})$/i;
  const numRe = /^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+$/;
  const seen = new Set<string>();
  for (const line of lines) {
    const toks = line.text.split(/[|\s]+/).map(t => t.trim()).filter(Boolean);
    const mi = toks.findIndex(t => monthRe.test(t));
    if (mi < 0) continue;
    const m = toks[mi].match(monthRe)!;
    const mon = CEMIG_MONTHS[m[1].toUpperCase()];
    const iso = `20${m[2]}-${mon}`;
    if (seen.has(iso)) continue;
    const nums = toks.slice(mi + 1).filter(t => numRe.test(t)).map(brNum);
    if (nums.length < 5) continue;
    seen.add(iso);
    result.history.push({
      monthLabel: `${mon}/${m[2]}`,
      monthIso: iso,
      demandaPonta: nums[0],
      demandaForaPonta: nums[1],
      consumoPonta: nums[2],
      consumoForaPonta: nums[3],
      consumoReservado: nums[4] || 0,
    });
  }
  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));

  // Fallback for demanda contratada: peak billed FP demand from history.
  if (result.demandaContratadaFP == null && result.history.length > 0) {
    result.demandaContratadaFP = Math.max(...result.history.map(h => h.demandaForaPonta || 0)) || undefined;
  }

  if (result.history.length === 0) {
    result.errors.push('Histórico de consumo não reconhecido na fatura CEMIG.');
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ── Equatorial (PA/PI/MA/GO/AL) — DANF3E ─────────────────────────────────────
// "Histórico dos últimos meses" (page 2): bare PT months (descending) with columns
// Demanda(Ponta,FP,reativo) · Consumo(Ponta,FP,reativo) · HR(consumo,reativo). Years are
// inferred from the "Leitura Atual" date (most-recent row = billing month).
// Anchor on the razão social ("EQUATORIAL <UF> DISTRIBUIDORA") that every bill
// carries, with capital-city fallbacks. ORDER MATTERS: PA is LAST and strict
// (Belém/CELPA/"Equatorial Pará") — the old bare /Par[áa]/ matched the preposition
// "para" ("energia elétrica PARA não contribuinte"), so a Goiás bill was mislabeled PA.
const EQ_STATE_SIG: [RegExp, string][] = [
  [/Goi[áa]s|Goi[âa]nia|\bGO[\s|]+BRASIL/i, 'EQUATORIAL GO'],
  [/Piau[íi]|Teresina|\bPI[\s|]+BRASIL/i, 'EQUATORIAL PI'],
  [/Maranh[ãa]o|S[ãa]o\s*Lu[íi]s|\bMA[\s|]+BRASIL/i, 'EQUATORIAL MA'],
  [/Alagoas|Macei[óo]|\bAL[\s|]+BRASIL/i, 'EQUATORIAL AL'],
  [/Equatorial\s*Par[áa]|Bel[ée]m|\bCELPA\b|\bPA[\s|]+BRASIL/i, 'EQUATORIAL PA'],
];
// Detecta o estado da Equatorial pelo texto. Retorna a sig e se foi por padrão (baixa confiança).
// PA é o último e ESTRITO (a regex ingênua /Par[áa]/ pegava a preposição "para").
export function detectEquatorialSig(allText: string): { sig: string; matched: boolean } {
  const hit = EQ_STATE_SIG.find(([re]) => re.test(allText));
  return hit ? { sig: hit[1], matched: true } : { sig: 'EQUATORIAL PA', matched: false };
}
const PT_MONTHS3 = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

export async function parseEquatorialFatura(file: File, password?: string): Promise<ParsedFatura> {
  let lines: PdfLine[];
  try {
    lines = await extractLines(file, password);
  } catch {
    return { ok: false, errors: ['Falha ao ler o PDF.'], warnings: [], history: [] };
  }
  return parseEquatorialFromLines(lines);
}

/** Pure parse of Equatorial DANF3E lines — testable without pdfjs. */
export function parseEquatorialFromLines(lines: PdfLine[]): ParsedFatura {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };

  const allText = lines.map(l => l.text).join('\n');
  if (!/equatorial/i.test(allText)) {
    result.notThisDistributor = true;
    result.errors.push('Não parece ser uma fatura Equatorial.');
    return result;
  }
  const eqDet = detectEquatorialSig(allText);
  result.distributorSig = eqDet.sig;
  // Confiança baixa: caiu no default PA sem sinal claro do estado → avisa (evita erro silencioso).
  if (!eqDet.matched) (result.warnings ??= []).push('Estado da Equatorial não identificado com clareza — assumido PA. Confirme a distribuidora.');

  // Tariff group + modalidade. "Tipo de Tarifa: A4_LVAZ" → A4, Livre, Azul.
  const code = allText.match(/Tipo\s+de\s+Tarifa[\s:|]+A(\d)_?(\w+)/i);
  const grpStr = code ? `A${code[1]}` : (allText.match(/\bA([1-4])\b/) ? `A${RegExp.$1}` : undefined);
  const codeStr = code?.[2]?.toUpperCase() || '';
  const isAzul = /AZ/.test(codeStr) || /azul/i.test(allText);
  const isVerde = /V[DE]/.test(codeStr) || /verde/i.test(allText);
  const isACL = /\bLV/.test(codeStr) || /livre/i.test(allText);
  // Optante B: conexão física em Grupo A faturada como Grupo B (posto único, sem demanda) —
  // classificação "A OPT B3 … OPTANTE_B". O motor deve tratar como Grupo B.
  const isOptanteB = /\bOPT\s*B[123]?\b|OPTANTE[\s_]*B/i.test(allText);
  const bCls = allText.match(/\bB[123]\b/);
  result.classificacao = isOptanteB
    ? `${bCls ? bCls[0] : 'B'} optante — Grupo B (posto único)`
    : ([grpStr, isAzul ? 'AZUL' : isVerde ? 'VERDE' : null, isACL ? 'Cliente Livre (ACL)' : 'Cativo']
        .filter(Boolean).join(' — ') || undefined);

  // UC number (nova numeração padronizada REN 1095/24, formato pontuado) → nome/id da UC.
  const ucm = allText.match(/\d\.\d{3}\.\d{3}\.\d{3}-\d{2}/);
  if (ucm) result.ucNumero = ucm[0];
  // Endereço de instalação: chave de dedup ESTÁVEL entre faturas de meses diferentes — o
  // número da UC muda na padronização, o endereço não. Rua + CEP, normalizado.
  const rua = allText.match(/\b(?:RUA|AVENIDA|AV|ROD(?:OVIA)?|TRAVESSA|PRA[ÇC]A|ALAMEDA|ESTRADA)\b[^|\n]{3,60}/i);
  const cep = allText.match(/CEP:\s*(\d{8})/i);
  if (rua) result.ucEndereco = `${rua[0]}${cep ? ' ' + cep[1] : ''}`.replace(/\s+/g, ' ').replace(/[.,\-/]/g, '').toUpperCase().trim();

  // Anchor month = "Leitura Atual" date (2nd dd/mm/yyyy in the leitura block; dates may be
  // pipe-separated in extraction).
  const leit = allText.match(/\d{2}\/(\d{2})\/(\d{4})[\s|]+(\d{2})\/(\d{2})\/(\d{4})/);
  const anchor = leit ? Number(leit[5]) * 12 + (Number(leit[4]) - 1) : null;
  if (leit) result.refMes = `${leit[4]}/${leit[5]}`;

  // Demanda contratada
  const demP = allText.match(/Demanda\s+Contratada\s+Ponta[\s(kW):|]*([\d.,]+)/i);
  const demFP = allText.match(/Demanda\s+Contratada\s+Fora\s+Ponta[\s(kW):|]*([\d.,]+)/i);
  if (demFP) result.demandaContratadaFP = brNum(demFP[1]);
  else if (demP) result.demandaContratadaFP = brNum(demP[1]);

  // History rows: bare month + ≥6 numbers. Years assigned by descending position.
  const monthRe = new RegExp(`^(${PT_MONTHS3.join('|')})$`, 'i');
  const numRe = /^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/;
  let i = 0;
  for (const line of lines) {
    const toks = line.text.split(/[|\s]+/).map(t => t.trim()).filter(Boolean);
    const mi = toks.findIndex(t => monthRe.test(t));
    if (mi < 0) continue;
    // Equatorial GO Grupo A renders the label as "MON / YY" (3 tokens). Skip the "/ YY"
    // so the year isn't captured as demandaPonta — that shifted every column and made a
    // Superfrio GYN armazém bill unreadable. Fleury Grupo B has an empty month column and
    // uses the fallback below, so it's unaffected.
    let start = mi + 1;
    if (toks[mi + 1] === '/' && /^\d{2}$/.test(toks[mi + 2] || '')) start = mi + 3;
    const nums = toks.slice(start).filter(t => numRe.test(t)).map(brNum);
    if (nums.length < 6) continue; // skip chart-axis month labels (no numbers)
    const abs = anchor != null ? anchor - i : null;
    const iso = abs != null ? `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, '0')}` : `row-${i}`;
    result.history.push({
      monthLabel: abs != null ? `${String((abs % 12) + 1).padStart(2, '0')}/${String(Math.floor(abs / 12)).slice(2)}` : toks[mi],
      monthIso: iso,
      demandaPonta: nums[0],
      demandaForaPonta: nums[1],
      consumoPonta: nums[3],
      consumoForaPonta: nums[4],
      consumoReservado: nums[6] || 0,
    });
    i++;
  }
  // ── Grupo B fallback (baixa tensão) ───────────────────────────────────────
  // Grupo B Equatorial não tem posto nem demanda, e a coluna MÊS/ANO do histórico
  // sai VAZIA na extração — só "CONSUMO FATURADO(kWh) | DIAS | TIPO" (mais recente
  // primeiro). O loop Grupo A acima acha 0 linhas → o consumo não aparecia. Aqui
  // ancoramos a 1ª linha (com tipo de faturamento) no mês de referência e voltamos
  // um mês por linha. Validado nas 12 faturas Fleury (Equatorial GO, B1 e B3).
  // NB: consumo pode vir sem separador de milhar ("6693,00") → regex \d[\d.]*,\d{2}.
  if (result.history.length === 0 && anchor != null && /\bB[123]\b/.test(allText)) {
    const tipoRe = /\b(LIDA|LEITURA|ESTIMAD\w*|CALCULAD\w*|REVISAD\w*|PROPORCIONAL|M[ÉE]DIA)\b/i;
    let idx = 0;
    for (const line of lines) { // lines já ordenadas topo→base = recente→antigo
      if (!tipoRe.test(line.text)) continue;
      const cons = (line.text.match(/\d[\d.]*,\d{2}/g) || []).map(brNum).find(n => n >= 30 && n < 500000);
      if (cons == null) continue;
      const abs = anchor - idx;
      result.history.push({
        monthIso: `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, '0')}`,
        monthLabel: `${String((abs % 12) + 1).padStart(2, '0')}/${String(Math.floor(abs / 12)).slice(2)}`,
        consumoForaPonta: Math.round(cons), consumoPonta: 0, consumoReservado: 0, demandaPonta: 0, demandaForaPonta: 0,
      });
      idx++;
    }
    if (result.history.length > 0) {
      const clsB = allText.match(/\bB[123]\b[^\n|]{0,30}/i);
      result.classificacao = (clsB ? clsB[0].replace(/\s*\|.*/, '').trim() : 'B3') + ' — Grupo B';
    }
  }

  // Optante B fatura como Grupo B (posto único): soma ponta + fora ponta + reservado num
  // único consumo (foraPonta) — senão o motor bila só o FP e subconta o total.
  if (isOptanteB) {
    for (const h of result.history) {
      h.consumoForaPonta = (h.consumoForaPonta || 0) + (h.consumoPonta || 0) + (h.consumoReservado || 0);
      h.consumoPonta = 0; h.consumoReservado = 0; h.demandaPonta = 0; h.demandaForaPonta = 0;
    }
  }
  // Remove linhas totalmente zeradas (o mês-âncora mais antigo às vezes sai vazio) — evita o
  // falso alerta de "consumo fora-ponta zero".
  result.history = result.history.filter(h =>
    (h.consumoForaPonta || 0) > 0 || (h.consumoPonta || 0) > 0 || (h.consumoReservado || 0) > 0);

  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));

  if (result.demandaContratadaFP == null && result.history.length > 0) {
    result.demandaContratadaFP = Math.max(...result.history.map(h => h.demandaForaPonta || 0)) || undefined;
  }
  if (result.history.length === 0) {
    result.errors.push('Histórico de consumo não reconhecido na fatura Equatorial.');
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ── Light / Enel RJ (Rio de Janeiro) — DANF3E ────────────────────────────────
// History is metric-row-major: each line is "<metric> MON/YY <val> MON/YY <val> …".
// The distributor isn't named in the text (logo is an image) → identify by the metric-row
// layout + the emitter CNPJ in the access key (60444437 = Light).
function lightParsePairs(t: string): Record<string, number> {
  const map: Record<string, number> = {};
  const re = /\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{2})[\s|]*(\d[\d.,]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const mon = PT_MONTHS3.indexOf(m[1].toUpperCase());
    if (mon < 0) continue;
    map[`20${m[2]}-${String(mon + 1).padStart(2, '0')}`] = brNum(m[3]);
  }
  return map;
}

export async function parseLightFatura(file: File, password?: string): Promise<ParsedFatura> {
  let lines: PdfLine[];
  try {
    lines = await extractLines(file, password);
  } catch {
    return { ok: false, errors: ['Falha ao ler o PDF.'], warnings: [], history: [] };
  }
  return parseLightFromLines(lines);
}

/** Pure parse of Light / Enel RJ lines — testable without pdfjs. */
export function parseLightFromLines(lines: PdfLine[]): ParsedFatura {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };
  const allText = lines.map(l => l.text).join('\n');
  // Signature: the metric-row history "Consumo Fora Ponta MON/YY …" (unique to this layout).
  if (!/Consumo\s+Fora\s+Ponta[\s|]+[A-Z]{3}\/\d{2}/i.test(allText)) {
    result.notThisDistributor = true;
    result.errors.push('Não parece ser uma fatura Light/Enel RJ.');
    return result;
  }
  // Light and Enel RJ are DISTINCT distributors (different tariffs). Identify by the emitter
  // CNPJ root in the 44-digit access key (cUF[2] + AAMM[4] + CNPJ[14]): chars 6–13.
  // Light SESA = 60444437 · Enel Distribuição Rio = 33050071.
  const chave = allText.match(/\d{44}/);
  const cnpjRoot = chave ? chave[0].slice(6, 14) : '';
  result.distributorSig =
    cnpjRoot === '60444437' ? 'LIGHT SESA'
    : cnpjRoot === '33050071' ? 'ENEL RJ'
    : /enel/i.test(allText) ? 'ENEL RJ'
    : /light/i.test(allText) ? 'LIGHT SESA'
    : undefined;
  if (!result.distributorSig) {
    result.notThisDistributor = true;
    result.errors.push('Distribuidora do Rio não identificada (CNPJ desconhecido).');
    return result;
  }
  // UC: Light usa "Conta Contrato: 20007373938". As faturas Enel RJ caem neste mesmo parser
  // (layout metric-row) e têm o nº da UC embaralhado (glifos) → cai no endereço da instalação.
  const lightUc = allText.match(/Conta\s*Contrato:\s*\|?\s*(\d{6,})/i);
  if (lightUc) result.ucNumero = lightUc[1];
  if (!result.ucNumero) {
    const idx = allText.search(/INSTALA[ÇC][ÃA]O\s*\/\s*UNID/i);
    const inst = idx >= 0 ? allText.slice(idx) : allText;
    const r = inst.match(/\b(?:RUA|R\.|AVENIDA|AV|ROD(?:OVIA)?|BR-?\d|TRAVESSA|PRA[ÇC]A|ALAMEDA|ESTRADA|EST)\b[^|\n]{3,55}/i);
    const c = inst.match(/CEP:?\s*(\d{5}-?\d{3})/i);
    if (r) result.ucEndereco = `${r[0]}${c ? ' ' + c[1] : ''}`.replace(/\s+/g, ' ').replace(/[.,\-/]/g, '').toUpperCase().trim();
  }

  const lightDisc = allText.match(/Percentual de Desconto[^%\d]*([\d.,]+)\s*%/i);
  if (lightDisc) result.incentivadaLevelPct = brNum(lightDisc[1]) / 100;

  const grp = allText.match(/Grupo\s+A([1-4])/i);
  const isVerde = /A[1-4]\s*-?\s*Verde/i.test(allText);
  const isAzul = /A[1-4]\s*-?\s*Azul/i.test(allText);
  const isACL = /CCEE/i.test(allText) || /livre/i.test(allText);
  result.classificacao = [grp ? `A${grp[1]}` : null, isVerde ? 'VERDE' : isAzul ? 'AZUL' : null, isACL ? 'Cliente Livre (ACL)' : 'Cativo']
    .filter(Boolean).join(' — ') || undefined;

  const leit = allText.match(/\d{2}\/(\d{2})\/(\d{4})[\s|]+(\d{2})\/(\d{2})\/(\d{4})/);
  if (leit) result.refMes = `${leit[4]}/${leit[5]}`;

  // Metric rows
  let cFP: Record<string, number> = {}, cP: Record<string, number> = {}, dFP: Record<string, number> = {}, dP: Record<string, number> = {};
  for (const line of lines) {
    const t = line.text;
    if (!/[A-Z]{3}\/\d{2}/.test(t)) continue;
    if (/Consumo\s+Fora\s+Ponta/i.test(t)) cFP = lightParsePairs(t);
    else if (/Consumo\s+Ponta/i.test(t) && !/Reativ/i.test(t)) cP = lightParsePairs(t);
    else if (/Demanda\s+Fora\s+Ponta/i.test(t) && !/Reativ/i.test(t)) dFP = lightParsePairs(t);
    else if (/Demanda\s+Ponta/i.test(t) && !/Reativ/i.test(t)) dP = lightParsePairs(t);
  }
  const months = new Set([...Object.keys(cFP), ...Object.keys(cP), ...Object.keys(dFP), ...Object.keys(dP)]);
  for (const iso of months) {
    result.history.push({
      monthIso: iso,
      monthLabel: `${iso.slice(5)}/${iso.slice(2, 4)}`,
      consumoForaPonta: cFP[iso] || 0,
      consumoPonta: cP[iso] || 0,
      demandaForaPonta: dFP[iso] || 0,
      demandaPonta: dP[iso] || 0,
      consumoReservado: 0,
    });
  }
  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));

  if (result.history.length > 0) {
    result.demandaContratadaFP = Math.max(...result.history.map(h => Math.max(h.demandaForaPonta || 0, h.demandaPonta || 0))) || undefined;
  } else {
    result.errors.push('Histórico de consumo não reconhecido na fatura Light/Enel RJ.');
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ── Enel (RJ/CE/SP) — DANF3E with "HISTÓRICO DO FATURAMENTO" table ────────────
// Often password-protected. Table: MÊS/ANO | Demanda(Ponta,FP) | Consumo(Ponta,FP) | Nº dias.
export async function parseEnelFatura(file: File, password?: string): Promise<ParsedFatura> {
  let lines: PdfLine[];
  try {
    lines = await extractLines(file, password);
  } catch (e) {
    const msg = (e as { name?: string; message?: string });
    if (/password/i.test(msg?.name || '') || /password/i.test(msg?.message || '')) {
      return { ok: false, errors: ['PDF protegido por senha.'], warnings: [], history: [], needsPassword: true };
    }
    return { ok: false, errors: ['Falha ao ler o PDF.'], warnings: [], history: [] };
  }
  return parseEnelFromLines(lines);
}

/** Pure parse of Enel (RJ/SP/CE Grupo A) lines — testable without pdfjs. */
export function parseEnelFromLines(lines: PdfLine[]): ParsedFatura {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };
  const allText = lines.map(l => l.text).join('\n');
  if (!/HIST[ÓO]RICO\s+DO\s+FATURAMENTO/i.test(allText)) {
    result.notThisDistributor = true;
    result.errors.push('Não parece ser uma fatura Enel.');
    return result;
  }
  // State → sig (from the address). RJ default for this template.
  result.distributorSig = /CEAR[ÁA]|FORTALEZA/i.test(allText) ? 'ENEL CE'
    : /S[ÃA]O\s+PAULO/i.test(allText) ? 'ENEL SP'
    : 'ENEL RJ';
  // O nº da UC da Enel vem embaralhado (glifos não-Unicode) → usa o endereço da INSTALAÇÃO
  // como chave estável de UC (rua + CEP legíveis logo após "INSTALAÇÃO / UNID. CONSUMIDORA").
  const enelIdx = allText.search(/INSTALA[ÇC][ÃA]O\s*\/\s*UNID/i);
  const enelInst = enelIdx >= 0 ? allText.slice(enelIdx) : allText;
  const enelRua = enelInst.match(/\b(?:RUA|R\.|AVENIDA|AV|ROD(?:OVIA)?|BR-?\d|TRAVESSA|PRA[ÇC]A|ALAMEDA|ESTRADA|EST)\b[^|\n]{3,55}/i);
  const enelCep = enelInst.match(/CEP:?\s*(\d{5}-?\d{3})/i);
  if (enelRua) result.ucEndereco = `${enelRua[0]}${enelCep ? ' ' + enelCep[1] : ''}`.replace(/\s+/g, ' ').replace(/[.,\-/]/g, '').toUpperCase().trim();
  const enelBen = allText.match(/Benef[íi]cio\s+Tarif[áa]rio\s+L[íi]quido[\s|]*([\d.,]+)/i);
  if (enelBen) result.incentivadaBeneficio = brNum(enelBen[1]);

  const grp = allText.match(/\bA([1-4])\s*HOR[OÁA]?/i) || allText.match(/\bA([1-4])\b/);
  const isVerde = /VERDE/i.test(allText);
  const isAzul = /AZUL/i.test(allText);
  const isACL = /LIVRE/i.test(allText);
  result.classificacao = [grp ? `A${grp[1]}` : null, isVerde ? 'VERDE' : isAzul ? 'AZUL' : null, isACL ? 'Cliente Livre (ACL)' : 'Cativo']
    .filter(Boolean).join(' — ') || undefined;

  // Demanda contratada FP
  const dem = allText.match(/DEMANDA\s+FORA\s+PONTA\s*-?\s*KW[\s|]*([\d.,]+)/i);
  if (dem) result.demandaContratadaFP = brNum(dem[1]);

  // History rows: "MMM / YYYY  demP demFP conP conFP nDias" (first 4 numbers).
  const rowRe = /^[\s|]*(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s*\/\s*(\d{4})\b/i;
  const numRe = /^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/;
  const seen = new Set<string>();
  for (const line of lines) {
    const m = line.text.match(rowRe);
    if (!m) continue;
    const mon = PT_MONTHS3.indexOf(m[1].toUpperCase());
    const iso = `${m[2]}-${String(mon + 1).padStart(2, '0')}`;
    if (seen.has(iso)) continue;
    const nums = line.text.replace(rowRe, '').split(/[|\s]+/).map(t => t.trim()).filter(t => numRe.test(t)).map(brNum);
    if (nums.length < 4) continue;
    seen.add(iso);
    result.history.push({
      monthIso: iso,
      monthLabel: `${String(mon + 1).padStart(2, '0')}/${m[2].slice(2)}`,
      demandaPonta: nums[0],
      demandaForaPonta: nums[1],
      consumoPonta: nums[2],
      consumoForaPonta: nums[3],
      consumoReservado: 0,
    });
  }
  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));
  if (result.history.length > 0) result.refMes = result.history[result.history.length - 1].monthLabel.replace(/(\d{2})\/(\d{2})/, '$1/20$2');
  if (result.demandaContratadaFP == null && result.history.length > 0) {
    result.demandaContratadaFP = Math.max(...result.history.map(h => h.demandaForaPonta || 0)) || undefined;
  }
  if (result.history.length === 0) {
    result.errors.push('Histórico do faturamento não reconhecido na fatura Enel.');
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ── Neoenergia (Coelba BA / Cosern RN / Pernambuco / Elektro SP) — DANFE ─────
// Neoenergia bills carry NO numeric 12-month history (just a chart) → one PDF = one month.
// The current month is read from the "DEMONSTRATIVO DE CONSUMO" block (page 2), where each
// row is "<label> | leituraDe | leituraAté | CONSTANTE(700,00000) | CONSUMO | CONSUMO".
// The consumption is the token right after the ≥4-decimal medidor constant. Fallback: the
// billed items "Uso Sistema Encar.NP/FP | kWh | <consumo>". Validated on 26 Coelba bills
// (Superfrio/Austral, Simões Filho BA — UCs 50003328 and 08301). Encrypted: password is the
// UC code in the filename. Grupo A (Livre/Cativo) and Grupo B both supported.
export async function parseNeoenergiaFatura(file: File, password?: string): Promise<ParsedFatura> {
  let lines: PdfLine[];
  try {
    lines = await extractLines(file, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/password/i.test(msg)) return { ok: false, errors: ['Fatura protegida por senha.'], warnings: [], history: [], needsPassword: true };
    return { ok: false, errors: ['Falha ao ler o PDF.'], warnings: [], history: [] };
  }
  return parseNeoenergiaFromLines(lines);
}

/** Pure parse of Neoenergia DANFE lines — testable without pdfjs. */
export function parseNeoenergiaFromLines(lines: PdfLine[]): ParsedFatura {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };
  const allText = lines.map(l => l.text).join('\n');
  const isNeo = /neoenergia/i.test(allText)
    || /COMPANHIA DE ELETRICIDADE DO ESTADO DA BAHIA/i.test(allText) || /\bCOELBA\b/i.test(allText)
    || /\bCOSERN\b/i.test(allText) || /15\.139\.629\/0001-94/.test(allText);
  if (!isNeo) { result.notThisDistributor = true; result.errors.push('Não parece ser uma fatura Neoenergia.'); return result; }

  // Distributor UF
  result.distributorSig = /BAHIA|\bCOELBA\b|15\.139\.629/i.test(allText) ? 'COELBA'
    : /COSERN|RIO GRANDE DO NORTE/i.test(allText) ? 'COSERN'
    : /PERNAMBUCO|\bCELPE\b/i.test(allText) ? 'Neoenergia PE'
    : /ELEKTRO/i.test(allText) ? 'ELEKTRO' : 'NEOENERGIA';

  // Classificação → grupo/modalidade/mercado
  const clsLine = findLineContaining(lines, 'CLASSIFICAÇÃO:') || findLineContaining(lines, 'CLASSIFICACAO:');
  const clsRaw = clsLine ? clsLine.text.replace(/.*CLASSIFICA[ÇC][ÃA]O:\s*\|?\s*/i, '').split('|')[0].trim() : '';
  const isACL = /livre/i.test(clsRaw) || /livre/i.test(allText);
  const grpM = clsRaw.match(/\bA(\d)\b/) || allText.match(/\bA([1-4])\s+(?:Livre|Verde|Azul|Convencional|COMERCIAL)/i);
  const isGrupoB = !grpM && /\bB[123]\b/.test(clsRaw + ' ' + allText);
  result.classificacao = clsRaw
    ? `${clsRaw}${isACL ? ' — Cliente Livre (ACL)' : ''}`
    : (isGrupoB ? 'Grupo B' : undefined);

  // UC = código da instalação (após "ENDEREÇO: | <num>" no bloco do cliente)
  const instLine = lines.find(l => /ENDERE[ÇC]O:\s*\|\s*\d{6,}/i.test(l.text));
  if (instLine) result.ucNumero = instLine.text.match(/(\d{6,})/)?.[1];
  // Endereço da INSTALAÇÃO — ancorar no bloco "ENDEREÇO:" para NÃO pegar o endereço da
  // própria distribuidora (Coelba: "AV.EDGARD SANTOS ... SALVADOR" no topo). Sem isso, TODAS
  // as UCs colapsavam numa só (a sede da distribuidora virava a chave de dedup).
  const clientIdx = allText.search(/ENDERE[ÇC]O:/i);
  const clientText = clientIdx >= 0 ? allText.slice(clientIdx) : allText;
  const rua = clientText.match(/\b(?:RUA|R\.|AVENIDA|AV|ROD(?:OVIA)?|TRAVESSA|PRA[ÇC]A|ALAMEDA|ESTRADA|VILA|VIA|VA)\b[^|\n]{3,55}/i);
  const cepN = clientText.match(/\b(\d{5}-?\d{3})\b/);
  if (rua) {
    let addr = `${rua[0]}${cepN ? ' ' + cepN[1] : ''}`.replace(/\s+/g, ' ').replace(/[.,\-/]/g, '').toUpperCase().trim();
    if (result.ucNumero) addr = addr.replace(new RegExp(`\\b${result.ucNumero}\\b`, 'g'), '').replace(/\s+/g, ' ').trim();
    result.ucEndereco = addr;
  }

  // Ref month = LEITURA ATUAL
  const leit = allText.match(/LEITURA ATUAL\s*\|?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (leit) result.refMes = `${leit[2]}/${leit[3]}`;

  // Montante de uso contratado → demanda contratada FP
  const mont = allText.match(/Montante de Uso Contratado\s*\|?\s*(\d[\d.]*)/i);
  if (mont) result.demandaContratadaFP = parseBrNumber(mont[1]);

  // Value = token right after the medidor constant (≥4 decimals, e.g. "700,00000")
  const valAfterConst = (re: RegExp): number | null => {
    const l = lines.find(x => re.test(x.text));
    if (!l) return null;
    const toks = l.text.split('|').map(t => t.trim());
    const ci = toks.findIndex(t => /^\d[\d.]*,\d{4,}$/.test(t));
    if (ci >= 0 && toks[ci + 1] != null) return parseBrNumber(toks[ci + 1]);
    return null;
  };
  // Fallback for 1-page short bills: billed items "Uso Sistema Encar.NP/FP | kWh | <consumo>"
  const encItem = (re: RegExp): number | null => {
    const l = lines.find(x => re.test(x.text));
    if (!l) return null;
    const m = l.text.match(/kWh\s*\|\s*([\d.]+,\d{2})/i);
    return m ? parseBrNumber(m[1]) : null;
  };
  let cP = valAfterConst(/Consumo Ativo Na Ponta/i);
  let cFP = valAfterConst(/Consumo Ativo Fora de Ponta/i);
  if (cP == null) cP = encItem(/Uso Sistema Encar\.?\s*NP/i);
  if (cFP == null) cFP = encItem(/Uso Sistema Encar\.?\s*FP/i);
  const dP = valAfterConst(/Demanda M[áa]xima Na Ponta/i);
  const dFP = valAfterConst(/Demanda M[áa]xima Fora de Ponta/i);

  if (cP != null || cFP != null) {
    const [mm, yy] = (result.refMes || '/').split('/');
    result.history.push({
      monthLabel: yy ? `${mm}/${yy.slice(2)}` : (result.refMes || '?'),
      monthIso: yy ? `${yy}-${mm}` : 'atual',
      consumoPonta: isGrupoB ? 0 : (cP ?? 0),
      consumoForaPonta: isGrupoB ? (cFP ?? cP ?? 0) : (cFP ?? 0),
      consumoReservado: 0,
      demandaPonta: isGrupoB ? 0 : (dP ?? 0),
      demandaForaPonta: isGrupoB ? 0 : (dFP ?? 0),
    });
  }
  if (result.history.length === 0) {
    result.errors.push('Consumo não reconhecido na fatura Neoenergia (bloco Demonstrativo/Itens ausente).');
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ── Unified dispatcher ───────────────────────────────────────────────────────
// Tries every distributor parser with the same password (so encrypted bills — COPEL,
// Enel — work once a password is supplied). Returns the first match, or `needsPassword`
// so the caller can prompt and retry. Energisa is the (unencrypted) last resort.
export async function parseAnyFatura(file: File, password?: string): Promise<ParsedFatura> {
  const parsers = [parseCopelFatura, parseCemigFatura, parseEquatorialFatura, parseNeoenergiaFatura, parseLightFatura, parseEnelFatura, parseEnelGrupoBFatura, parseEdpSpFatura];
  for (const p of parsers) {
    const r = await p(file, password);
    if (r.needsPassword) return r;        // encrypted — caller must supply the password
    if (!r.notThisDistributor) return r;  // matched this distributor
  }
  return parseEnergisaFatura(file);
}

// ── ENEL CE / Coelce — Grupo B (baixa tensão, consumo único, sem demanda) ────
// History "MÊS/ANO | CONSUMO | DIAS" with the consumo sometimes on the next line, and
// numbers in dot-decimal ("2488.00" = 2488) — different from the Brazilian A-group bills.
const numFlex = (s: string) => /^\d+\.\d{1,2}$/.test(s) ? parseFloat(s) : brNum(s);

export async function parseEnelGrupoBFatura(file: File, password?: string): Promise<ParsedFatura> {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };
  let lines: PdfLine[];
  try {
    lines = await extractLines(file, password);
  } catch {
    result.errors.push('Falha ao ler o PDF.');
    return result;
  }
  const allText = lines.map(l => l.text).join('\n');
  const isCE = /Companhia\s+Energ[ée]tica\s+do\s+Cear[áa]/i.test(allText) || /COELCE/i.test(allText)
    || (/enel/i.test(allText) && /CEAR[ÁA]|FORTALEZA/i.test(allText));
  const grpB = /\bB[123]\b/.test(allText);
  if (!isCE || !grpB || /HIST[ÓO]RICO\s+DO\s+FATURAMENTO/i.test(allText)) {
    result.notThisDistributor = true;
    result.errors.push('Não parece ser uma fatura Enel CE Grupo B.');
    return result;
  }
  result.distributorSig = 'ENEL CE';
  const cls = allText.match(/\bB[123]\b[^\n|]{0,30}/i);
  result.classificacao = (cls ? cls[0].trim() : 'B3') + ' — Grupo B';
  const ref = allText.match(/(\d{2})\/(\d{4})/);
  if (ref) result.refMes = `${ref[1]}/${ref[2]}`;

  const monthRe = new RegExp(`\\b(${PT_MONTHS3.join('|')})\\s*/?\\s*(\\d{2})\\b`, 'i');
  const numTok = /^\d{2,7}(\.\d{1,2})?$/;
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(monthRe);
    if (!m) continue;
    const mon = PT_MONTHS3.indexOf(m[1].toUpperCase());
    const iso = `20${m[2]}-${String(mon + 1).padStart(2, '0')}`;
    if (seen.has(iso)) continue;
    let cons: number | null = null;
    for (let j = i; j < Math.min(i + 3, lines.length) && cons == null; j++) {
      const after = j === i ? lines[j].text.replace(monthRe, '') : lines[j].text;
      const nums = after.split(/[|\s]+/).map(t => t.trim()).filter(t => numTok.test(t)).map(numFlex).filter(n => n >= 60 && n < 100000);
      if (nums.length) cons = Math.round(nums[0]);
    }
    if (cons == null) continue;
    seen.add(iso);
    result.history.push({
      monthIso: iso, monthLabel: `${String(mon + 1).padStart(2, '0')}/${m[2]}`,
      consumoForaPonta: cons, consumoPonta: 0, consumoReservado: 0, demandaPonta: 0, demandaForaPonta: 0,
    });
  }
  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));
  if (result.history.length === 0) result.errors.push('Histórico de consumo (Grupo B) não reconhecido.');
  result.ok = result.errors.length === 0;
  return result;
}

// ── EDP São Paulo (Suzano etc.) — DANF3E ─────────────────────────────────────
// History columns by position: Mes/Ano | Consumo Ponta | Fora Ponta | Reservado | Demanda
// | ... | Total. Numbers are dot-decimal (15140.6). Often incentivada (Res.77/04 = ACL).
export async function parseEdpSpFatura(file: File, password?: string): Promise<ParsedFatura> {
  let lines: PdfLine[];
  try {
    lines = await extractLines(file, password);
  } catch {
    return { ok: false, errors: ['Falha ao ler o PDF.'], warnings: [], history: [] };
  }
  return parseEdpSpFromLines(lines);
}

/** Pure parse of EDP SP lines — testable without pdfjs. */
export function parseEdpSpFromLines(lines: PdfLine[]): ParsedFatura {
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };
  const allText = lines.map(l => l.text).join('\n');
  if (!/EDP\s*SP|EDP\s+S[ÃA]O\s+PAULO|EDP SP DISTRIB/i.test(allText)) {
    result.notThisDistributor = true;
    result.errors.push('Não parece ser uma fatura EDP SP.');
    return result;
  }
  result.distributorSig = 'EDP SP';
  // UC = nº da instalação após o nome do cliente na linha do período de medição
  // ("<CLIENTE> | 0151372625 | <unidade> : 01/09/2025 a 30/09/2025").
  const edpUc = allText.match(/\|\s*(\d{9,12})\s*\|[^|\n]*\d{2}\/\d{2}\/\d{4}\s+a\s+\d{2}\/\d{2}\/\d{4}/i);
  if (edpUc) result.ucNumero = edpUc[1];
  const isACL = /RES\.?\s*77|incentiv|\bLivre\b/i.test(allText);
  const grp = allText.match(/\bA([1-4])\b/);
  const isVerde = /VERDE/i.test(allText), isAzul = /AZUL/i.test(allText);
  result.classificacao = [grp ? `A${grp[1]}` : null, isVerde ? 'VERDE' : isAzul ? 'AZUL' : null, isACL ? 'Cliente Livre (ACL)' : 'Cativo']
    .filter(Boolean).join(' — ') || undefined;
  const ref = allText.match(/(\d{2})\/(\d{4})/);
  if (ref) result.refMes = `${ref[1]}/${ref[2]}`;

  const seen = new Set<string>();
  for (const line of lines) {
    const toks = line.text.split(/\s*\|\s*/).map(t => t.trim()).filter(Boolean);
    const mi = toks.findIndex(t => /^\d{2}\/\d{2}$/.test(t)); // MM/YY (not dd/mm/yyyy)
    if (mi < 0) continue;
    const [mm, yy] = toks[mi].split('/');
    const iso = `20${yy}-${mm}`;
    if (seen.has(iso)) continue;
    const nums = toks.slice(mi + 1).filter(t => /^\d[\d.,]*$/.test(t)).map(numFlex);
    if (nums.length < 4) continue;
    seen.add(iso);
    result.history.push({
      monthIso: iso, monthLabel: `${mm}/${yy}`,
      consumoPonta: Math.round(nums[0]),
      consumoForaPonta: Math.round(nums[1]),
      consumoReservado: Math.round(nums[2]),
      demandaForaPonta: nums[3],
      demandaPonta: 0,
    });
  }
  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));
  if (result.history.length > 0) {
    result.demandaContratadaFP = Math.max(...result.history.map(h => h.demandaForaPonta || 0)) || undefined;
  } else {
    result.errors.push('Histórico de faturamento não reconhecido na fatura EDP SP.');
  }
  result.ok = result.errors.length === 0;
  return result;
}

// ── Import reconciliation / health checks ────────────────────────────────────
// Catches the kinds of mistakes a best-effort parser can make (10×/100× number
// errors, missing months, zero consumption, missing demand) so the user can verify
// before trusting the import. Returns human-readable warnings (empty = looks healthy).
export function faturaHealth(p: ParsedFatura): string[] {
  // Inclui os avisos do próprio parser (ex.: estado da Equatorial em baixa confiança).
  const w: string[] = [...(p.warnings ?? [])];
  const h = p.history ?? [];
  if (h.length === 0) return [...w, 'Nenhum mês de histórico reconhecido — confira a fatura.'];
  if (h.length < 6) w.push(`Apenas ${h.length} mês(es) de histórico — o ideal são 12. Verifique a leitura da tabela.`);

  const fp = h.map(r => r.consumoForaPonta || 0);
  const nonzero = fp.filter(v => v > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) {
    w.push('Consumo fora-ponta zero em todos os meses — possível erro de leitura.');
  } else {
    const median = nonzero[Math.floor(nonzero.length / 2)];
    // 10×/100× outliers (e.g. dot-vs-comma parsing): any month far from the median.
    if (fp.some(v => v > median * 5)) w.push('Um mês tem consumo muito acima do padrão (possível erro de escala na leitura) — confira os valores.');
    if (fp.some(v => v > 0 && v < median / 5)) w.push('Um mês tem consumo muito abaixo do padrão — confira.');
    if (fp.some(v => v === 0)) w.push('Há mês(es) com consumo fora-ponta zero — confira se é real.');
    // Queda/salto estrutural: média da 1ª metade vs 2ª metade (pega casos tipo SSA −50%).
    if (h.length >= 6) {
      const half = Math.floor(fp.length / 2);
      const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
      const older = avg(fp.slice(0, half)), recent = avg(fp.slice(half));
      if (older > 0 && recent > 0) {
        const ch = (recent - older) / older;
        if (ch <= -0.3) w.push(`Consumo caiu ~${Math.round(-ch * 100)}% na metade mais recente — mudança estrutural? Use os meses recentes para dimensionar.`);
        else if (ch >= 0.4) w.push(`Consumo subiu ~${Math.round(ch * 100)}% na metade mais recente — confirme se é tendência real.`);
      }
    }
  }

  // Grupo A should have a contracted/billed demand.
  const isGrupoA = /A[1-4]/.test(p.classificacao || '') && !/\bB[123]\b/.test(p.classificacao || '');
  if (isGrupoA && !p.demandaContratadaFP) w.push('Demanda contratada não detectada (Grupo A) — informe manualmente.');

  return w;
}
