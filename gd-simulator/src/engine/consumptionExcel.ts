import * as XLSX from 'xlsx';
import type { Project } from './types';

// ─── Types ────────────────────────────────────────────────────────
export interface ImportResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  updates: {
    ucs: { id: string; consumptionFP?: number[]; consumptionPT?: number[]; openingBank?: number; ownGeneration?: number[] }[];
    batBank?: { openingKWh?: number; toNHSPct?: number; toAMDPct?: number };
    growthRate?: number;
    p50Profile?: number[];
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────
const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function generateMonthLabels(contractStartMonth: string, count: number): string[] {
  const [yearStr, monthStr] = contractStartMonth.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) - 1; // 0-based
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const m = (month + i) % 12;
    const y = year + Math.floor((month + i) / 12);
    labels.push(`${MONTH_ABBR[m]}/${String(y).slice(-2)}`);
  }
  return labels;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function extendConsumption(base: number[], contractMonths: number, growthPerYear: number): number[] {
  if (base.length >= contractMonths) return base.slice(0, contractMonths);
  const extended = [...base];
  const seasonal = base.slice(0, Math.min(base.length, 12));
  while (extended.length < contractMonths) {
    const m = extended.length;
    const yearIdx = Math.floor(m / 12);
    const calMonth = m % 12;
    const baseVal = seasonal[calMonth] ?? base[m % base.length] ?? 0;
    extended.push(Math.round(baseVal * Math.pow(1 + growthPerYear, yearIdx)));
  }
  return extended;
}

function extendGeneration(base: number[], contractMonths: number, degradation: number): number[] {
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

// ─── Export ───────────────────────────────────────────────────────
export function exportConsumptionExcel(project: Project): void {
  const wb = XLSX.utils.book_new();
  const contractMonths = project.plant.contractMonths || 24;
  console.log(`[ExportConsumption] contractMonths=${contractMonths}, ucs=${project.ucs.length}, growthRate=${project.growthRate ?? 0.025}`);
  const growthRate = project.growthRate ?? 0.025;
  const genDegradation = project.generationDegradation ?? 0.005;
  const monthLabels = generateMonthLabels(project.plant.contractStartMonth, contractMonths);

  // Filter out BAT UC
  const ucs = project.ucs.filter(uc => uc.id !== 'bat');

  // ── Sheet 1: Consumo_Mensal ──
  {
    const headerRow1: (string | null)[] = [];
    // A-E: UC info
    headerRow1[0] = 'UC Info';
    headerRow1[1] = null;
    headerRow1[2] = null;
    headerRow1[3] = null;
    headerRow1[4] = null;
    // F onwards: consumptionFP header
    const fpEnd = 4 + contractMonths; // col index of last FP month
    headerRow1[5] = `consumptionFP (${contractMonths}m, com crescimento ${(growthRate * 100).toFixed(1)}%/a) →`;
    for (let i = 6; i <= fpEnd; i++) headerRow1[i] = null;
    // After FP: consumptionPT header
    const ptStart = fpEnd + 1;
    headerRow1[ptStart] = `consumptionPT (${contractMonths}m) →`;
    for (let i = ptStart + 1; i < ptStart + contractMonths; i++) headerRow1[i] = null;

    const headerRow2: string[] = ['ucId', 'ucName', 'tariffGroup', 'isGrupoA', 'openingBank'];
    for (const label of monthLabels) headerRow2.push(label); // FP
    for (const label of monthLabels) headerRow2.push(label); // PT

    const rows: (string | number | boolean)[][] = [];
    for (const uc of ucs) {
      const extFP = extendConsumption(uc.consumptionFP, contractMonths, growthRate);
      const extPT = extendConsumption(uc.consumptionPT || [], contractMonths, growthRate);
      const row: (string | number | boolean)[] = [
        uc.id,
        uc.name,
        uc.tariffGroup,
        uc.isGrupoA,
        round1(uc.openingBank),
      ];
      for (let i = 0; i < contractMonths; i++) row.push(round1(extFP[i] ?? 0));
      for (let i = 0; i < contractMonths; i++) row.push(round1(extPT[i] ?? 0));
      rows.push(row);
    }

    const aoa = [headerRow1, headerRow2, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Merge section headers
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 0, c: fpEnd } },
      { s: { r: 0, c: ptStart }, e: { r: 0, c: ptStart + contractMonths - 1 } },
    ];

    // Column widths
    const cols: XLSX.ColInfo[] = [
      { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
    ];
    for (let i = 0; i < contractMonths * 2; i++) cols.push({ wch: 10 });
    ws['!cols'] = cols;

    XLSX.utils.book_append_sheet(wb, ws, 'Consumo_Mensal');
  }

  // ── Sheet 2: Geracao_Propria ──
  {
    const ucsWithGen = ucs.filter(uc => uc.ownGeneration && uc.ownGeneration.length > 0);
    const header = ['ucId', 'ucName', ...monthLabels];
    const rows: (string | number)[][] = [];
    for (const uc of ucsWithGen) {
      const extGen = extendGeneration(uc.ownGeneration || [], contractMonths, genDegradation);
      const row: (string | number)[] = [uc.id, uc.name];
      for (let i = 0; i < contractMonths; i++) row.push(round1(extGen[i] ?? 0));
      rows.push(row);
    }
    const aoa = [header, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const cols: XLSX.ColInfo[] = [{ wch: 14 }, { wch: 22 }];
    for (let i = 0; i < contractMonths; i++) cols.push({ wch: 10 });
    ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, 'Geracao_Propria');
  }

  // ── Sheet 3: Planta_e_Bancos ──
  {
    const plant = project.plant;
    const data: (string | number)[][] = [
      ['contractStartMonth', plant.contractStartMonth],
      ['contractMonths', plant.contractMonths],
      ['growthRate', project.growthRate ?? 0],
      ['ppaRateRsBRLkWh', plant.ppaRateRsBRLkWh],
    ];
    if (project.batBank) {
      data.push(['batBank.openingKWh', project.batBank.openingKWh]);
      data.push(['batBank.toNHSPct', project.batBank.toNHSPct]);
      data.push(['batBank.toAMDPct', project.batBank.toAMDPct]);
    }
    data.push(['p50Profile', plant.p50Profile.map(v => round1(v)).join(',')]);

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Planta_e_Bancos');
  }

  // ── Sheet 4: Legenda ──
  {
    const legend = [
      ['GD Analyzer — Consumo Export'],
      [''],
      ['Sheet "Consumo_Mensal":'],
      ['  Colunas A-E: informações da UC (id, nome, grupo tarifário, grupo A/B, banco de abertura)'],
      ['  Colunas F-AC: consumo fora-ponta (kWh) para 24 meses'],
      ['  Colunas AD-BA: consumo ponta (kWh) para 24 meses (apenas Grupo A)'],
      [''],
      ['Sheet "Geracao_Propria":'],
      ['  UCs com geração própria (ex: NHS, AMD) e seus 24 valores mensais em kWh'],
      [''],
      ['Sheet "Planta_e_Bancos":'],
      ['  Parâmetros da planta e bancos de crédito em formato chave-valor'],
      ['  p50Profile é uma lista de 24 valores separados por vírgula'],
      [''],
      ['IMPORTAÇÃO:'],
      ['  Ao importar, apenas consumptionFP, consumptionPT, openingBank,'],
      ['  ownGeneration, batBank, growthRate e p50Profile serão atualizados.'],
      ['  Rateio, distribuidora, cenários, nomes de UCs e grupos tarifários NÃO são alterados.'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(legend);
    ws['!cols'] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Legenda');
  }

  // Download
  const filename = `${project.clientName.toLowerCase().replace(/\s+/g, '_')}_${project.id}_consumption.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ─── Import ───────────────────────────────────────────────────────
export async function importConsumptionExcel(file: File, project: Project): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. File size check
  if (file.size > 10 * 1024 * 1024) {
    return { success: false, errors: ['Arquivo excede 10 MB.'], warnings: [], updates: null };
  }

  let wb: XLSX.WorkBook;
  try {
    const arrayBuffer = await file.arrayBuffer();
    wb = XLSX.read(arrayBuffer);
  } catch {
    return { success: false, errors: ['Não foi possível ler o arquivo Excel.'], warnings: [], updates: null };
  }

  // 2. Check Consumo_Mensal exists
  if (!wb.SheetNames.includes('Consumo_Mensal')) {
    return { success: false, errors: ['Sheet "Consumo_Mensal" não encontrada.'], warnings: [], updates: null };
  }

  const updates: NonNullable<ImportResult['updates']> = { ucs: [] };

  // ── Parse Consumo_Mensal ──
  {
    const ws = wb.Sheets['Consumo_Mensal'];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // Find header row (row with ucId in col A)
    let headerRowIdx = -1;
    for (let r = 0; r < Math.min(aoa.length, 5); r++) {
      if (aoa[r] && String(aoa[r][0]).toLowerCase().trim() === 'ucid') {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx < 0) {
      errors.push('Cabeçalho "ucId" não encontrado na sheet Consumo_Mensal.');
      return { success: false, errors, warnings, updates: null };
    }

    const dataRows = aoa.slice(headerRowIdx + 1);

    for (let ri = 0; ri < dataRows.length; ri++) {
      const row = dataRows[ri];
      if (!row || !row[0]) continue;

      const ucId = String(row[0]).trim();
      // Match to project UC
      const projectUC = project.ucs.find(uc => uc.id === ucId);
      if (!projectUC) {
        warnings.push(`UC "${ucId}" (linha ${headerRowIdx + 2 + ri}) não encontrada no projeto — ignorada.`);
        continue;
      }

      // openingBank (col E = index 4)
      const openingBankRaw = row[4];
      let openingBank: number | undefined;
      if (openingBankRaw !== undefined && openingBankRaw !== null && openingBankRaw !== '') {
        const val = Number(openingBankRaw);
        if (isNaN(val)) {
          errors.push(`UC "${ucId}": openingBank não é numérico.`);
        } else if (val < 0) {
          errors.push(`UC "${ucId}": openingBank deve ser >= 0 (encontrado: ${val}).`);
        } else {
          openingBank = val;
        }
      }

      // consumptionFP cols F-AC (5-28)
      const consumptionFP: number[] = [];
      let fpValid = true;
      for (let c = 5; c <= 28; c++) {
        const v = row[c];
        if (v === undefined || v === null || v === '') {
          consumptionFP.push(0);
        } else {
          const num = Number(v);
          if (isNaN(num)) {
            errors.push(`UC "${ucId}": consumptionFP mês ${c - 5} não é numérico (valor: "${v}").`);
            fpValid = false;
            break;
          }
          consumptionFP.push(num);
        }
      }

      // consumptionPT cols AD-BA (29-52)
      const consumptionPT: number[] = [];
      for (let c = 29; c <= 52; c++) {
        const v = row[c];
        if (v === undefined || v === null || v === '') {
          consumptionPT.push(0);
        } else {
          const num = Number(v);
          if (isNaN(num)) {
            warnings.push(`UC "${ucId}": consumptionPT mês ${c - 29} não numérico — usando 0.`);
            consumptionPT.push(0);
          } else {
            consumptionPT.push(num);
          }
        }
      }

      if (!fpValid) continue;

      const ucUpdate: (typeof updates.ucs)[number] = { id: ucId };
      if (consumptionFP.length === 24) ucUpdate.consumptionFP = consumptionFP;
      if (consumptionPT.length === 24) ucUpdate.consumptionPT = consumptionPT;
      if (openingBank !== undefined) ucUpdate.openingBank = openingBank;
      updates.ucs.push(ucUpdate);
    }
  }

  // ── Parse Geracao_Propria (optional) ──
  if (wb.SheetNames.includes('Geracao_Propria')) {
    const ws = wb.Sheets['Geracao_Propria'];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // First row is header
    const dataRows = aoa.slice(1);
    for (const row of dataRows) {
      if (!row || !row[0]) continue;
      const ucId = String(row[0]).trim();
      const projectUC = project.ucs.find(uc => uc.id === ucId);
      if (!projectUC) {
        warnings.push(`Geracao_Propria: UC "${ucId}" não encontrada — ignorada.`);
        continue;
      }

      const ownGen: number[] = [];
      for (let c = 2; c < 26; c++) {
        const v = row[c];
        if (v === undefined || v === null || v === '') {
          ownGen.push(0);
        } else {
          const num = Number(v);
          ownGen.push(isNaN(num) ? 0 : num);
        }
      }

      // Find or create the UC update entry
      let ucUpdate = updates.ucs.find(u => u.id === ucId);
      if (!ucUpdate) {
        ucUpdate = { id: ucId };
        updates.ucs.push(ucUpdate);
      }
      ucUpdate.ownGeneration = ownGen;
    }
  }

  // ── Parse Planta_e_Bancos (optional) ──
  if (wb.SheetNames.includes('Planta_e_Bancos')) {
    const ws = wb.Sheets['Planta_e_Bancos'];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    const kvMap = new Map<string, string>();
    for (const row of aoa) {
      if (row && row[0]) {
        kvMap.set(String(row[0]).trim(), String(row[1] ?? '').trim());
      }
    }

    if (kvMap.has('growthRate')) {
      const val = Number(kvMap.get('growthRate'));
      if (!isNaN(val)) updates.growthRate = val;
    }

    if (kvMap.has('p50Profile')) {
      const raw = kvMap.get('p50Profile')!;
      const nums = raw.split(',').map(s => Number(s.trim()));
      if (nums.length === 24 && nums.every(n => !isNaN(n))) {
        updates.p50Profile = nums;
      } else {
        warnings.push(`p50Profile: esperado 24 valores numéricos separados por vírgula (encontrado ${nums.length}).`);
      }
    }

    if (kvMap.has('batBank.openingKWh') || kvMap.has('batBank.toNHSPct') || kvMap.has('batBank.toAMDPct')) {
      updates.batBank = {};
      const opening = Number(kvMap.get('batBank.openingKWh'));
      if (!isNaN(opening)) updates.batBank.openingKWh = opening;
      const nhs = Number(kvMap.get('batBank.toNHSPct'));
      if (!isNaN(nhs)) updates.batBank.toNHSPct = nhs;
      const amd = Number(kvMap.get('batBank.toAMDPct'));
      if (!isNaN(amd)) updates.batBank.toAMDPct = amd;
    }
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings, updates: null };
  }

  if (updates.ucs.length === 0 && !updates.batBank && updates.growthRate === undefined && !updates.p50Profile) {
    return { success: false, errors: ['Nenhum dado para importar foi encontrado.'], warnings, updates: null };
  }

  return { success: true, errors: [], warnings, updates };
}
