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
  // Identification
  ucMatricula?: string;        // raw e.g. "0001935906-2026-03-3"
  ucNumero?: string;           // canonical e.g. "1935906-6"
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

async function extractLines(file: File): Promise<PdfLine[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
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
  const result: ParsedFatura = { ok: false, errors: [], warnings: [], history: [] };

  let lines: PdfLine[];
  try {
    lines = await extractLines(file);
  } catch (e) {
    result.errors.push('Não foi possível ler o PDF: ' + (e instanceof Error ? e.message : 'erro desconhecido'));
    return result;
  }

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

  // ── 13-month history ──
  // Find lines on page 2 (or any page) that contain month-year labels.
  // Use wide row gathering to merge wrapped left/right halves of the same row.
  const monthRe = /\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{2})\b/g;

  const seenMonths = new Set<string>();
  for (const line of lines) {
    const matches = [...line.text.matchAll(monthRe)];
    if (matches.length === 0) continue;
    for (const mm of matches) {
      const monthLabel = `${mm[1]}/${mm[2]}`;
      if (seenMonths.has(monthLabel)) continue;
      seenMonths.add(monthLabel);

      // Gather all numbers on this row's wide Y band
      const wide = gatherWideRow(lines, line.page, line.y, 6);
      // Take everything AFTER this month label until the next month label (or end)
      const afterLabel = wide.split(monthLabel)[1] || '';
      const beforeNextMonth = afterLabel.split(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/\d{2}\b/)[0] || '';
      // Extract all numbers
      const numStrs = beforeNextMonth.match(/[\d.,]+/g) || [];
      const nums = numStrs.map(parseBrNumber).filter(n => !isNaN(n));

      // Heuristic mapping by magnitude:
      //   numbers > 1000 → consumo kWh (in order: Ponta, FP, RSV)
      //   numbers 1-300 not following a kWh → demanda kW
      //   small numbers (< 50) without context → ERE/DRE, skip
      const consumos: number[] = [];
      const demandas: number[] = [];
      const lookForDemanda: boolean[] = []; // tracks if the next 1-300 number should be demanda
      let lastWasConsumo = false;
      for (const n of nums) {
        if (n >= 1000) {
          consumos.push(n);
          lookForDemanda.push(true);
          lastWasConsumo = true;
        } else if (n >= 1 && n < 1000 && lastWasConsumo) {
          // Likely demanda following a consumo
          demandas.push(n);
          lastWasConsumo = false;
        } else {
          lastWasConsumo = false;
        }
      }

      const yearShort = parseInt(mm[2], 10);
      const yearFull = yearShort < 50 ? 2000 + yearShort : 1900 + yearShort;
      const monthIso = `${yearFull}-${MONTH_PT_TO_NUM[mm[1]]}`;

      // Map: first consumo = Ponta, second = FP, third = RSV
      // First demanda = Ponta, second = FP
      const row: MonthRow = {
        monthLabel,
        monthIso,
        consumoPonta: consumos[0] ?? 0,
        consumoForaPonta: consumos[1] ?? 0,
        consumoReservado: consumos[2] ?? 0,
        demandaPonta: demandas[0] ?? 0,
        demandaForaPonta: demandas[1] ?? 0,
      };
      result.history.push(row);
    }
  }

  // Sort history by ISO month ascending (oldest first)
  result.history.sort((a, b) => a.monthIso.localeCompare(b.monthIso));

  if (result.history.length === 0) {
    result.warnings.push('Nenhuma linha do histórico de 13 meses foi reconhecida — verifique o layout do PDF.');
  }

  result.ok = result.errors.length === 0;
  return result;
}
