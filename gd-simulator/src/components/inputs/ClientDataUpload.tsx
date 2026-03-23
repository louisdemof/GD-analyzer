import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import type { ConsumptionUnit, Plant, TariffGroup } from '../../engine/types';

interface Props {
  contractStartMonth: string;
  onImport: (data: ImportedData) => void;
}

export interface ImportedData {
  ucs: ConsumptionUnit[];
  plant?: Partial<Plant>;
  batBank?: {
    openingKWh: number;
    toNHSPct: number;
    toAMDPct: number;
    nhsUCId: string;
    amdUCId: string;
  };
}

interface ValidationResult {
  errors: string[];
  warnings: string[];
  summary: string;
  data: ImportedData | null;
}

const VALID_GROUPS: TariffGroup[] = ['B1', 'B2', 'B3', 'A4_VERDE', 'A4_AZUL', 'A3A', 'A3A_VERDE', 'A3A_AZUL', 'A3', 'A3_VERDE', 'A3_AZUL', 'A2', 'A2_VERDE', 'A2_AZUL', 'A1', 'A1_VERDE', 'A1_AZUL'];

function isGrupoA(tg: string): boolean {
  return tg.startsWith('A');
}

function generateMonths(start: string, n: number): string[] {
  const [y, m] = start.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

function parseUpload(workbook: XLSX.WorkBook, contractStart: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const months24 = generateMonths(contractStart, 24);

  // --- Sheet 1: UCs_Consumo ---
  const ucSheet = workbook.Sheets['UCs_Consumo'];
  if (!ucSheet) {
    errors.push('Sheet "UCs_Consumo" não encontrada');
    return { errors, warnings, summary: '', data: null };
  }

  const ucRows: Record<string, string>[] = XLSX.utils.sheet_to_json(ucSheet);
  if (ucRows.length === 0) {
    errors.push('Sheet "UCs_Consumo" está vazia');
    return { errors, warnings, summary: '', data: null };
  }

  // Group rows by UC_ID
  const ucMap = new Map<string, {
    name: string;
    group: TariffGroup;
    openingBank: number;
    fp: number[];
    pt: number[];
  }>();

  for (const row of ucRows) {
    const ucId = (row['UC_ID'] || '').toString().trim();
    const ucName = (row['UC_Nome'] || ucId).toString().trim();
    const group = (row['Grupo_Tarifario'] || 'B3').toString().trim().toUpperCase() as TariffGroup;
    const mes = (row['Mes'] || '').toString().trim();
    const fp = parseFloat(row['Consumo_FP_kWh'] || row['Consumo_Total_kWh'] || '0') || 0;
    const pt = parseFloat(row['Consumo_PT_kWh'] || '0') || 0;
    const bank = parseFloat(row['Banco_Inicial_kWh'] || '0') || 0;

    if (!ucId) continue;
    if (fp < 0) errors.push(`UC ${ucId} mês ${mes}: consumo FP negativo`);
    if (!VALID_GROUPS.includes(group)) errors.push(`UC ${ucId}: grupo tarifário inválido "${group}"`);

    if (!ucMap.has(ucId)) {
      ucMap.set(ucId, { name: ucName, group, openingBank: bank, fp: [], pt: [] });
    }
    const entry = ucMap.get(ucId)!;
    if (bank > 0 && entry.fp.length === 0) entry.openingBank = bank;
    entry.fp.push(fp);
    entry.pt.push(pt);
  }

  // Build UCs
  const ucs: ConsumptionUnit[] = [];
  for (const [ucId, data] of ucMap) {
    // Pad to 24 if short
    while (data.fp.length < 24) data.fp.push(data.fp[data.fp.length - 1] || 0);
    while (data.pt.length < 24) data.pt.push(data.pt[data.pt.length - 1] || 0);
    if (data.fp.length > 24) {
      warnings.push(`UC ${ucId}: ${data.fp.length} meses de dados — usando primeiros 24`);
    }

    const uc: ConsumptionUnit = {
      id: ucId.toLowerCase().replace(/\s+/g, '-'),
      name: data.name,
      tariffGroup: data.group,
      isGrupoA: isGrupoA(data.group),
      consumptionFP: data.fp.slice(0, 24),
      consumptionPT: data.pt.slice(0, 24),
      openingBank: data.openingBank,
    };
    ucs.push(uc);
  }

  // --- Sheet 2: Gerador_Proprio (optional) ---
  const genSheet = workbook.Sheets['Gerador_Proprio'];
  if (genSheet) {
    const genRows: Record<string, string>[] = XLSX.utils.sheet_to_json(genSheet);
    const genMap = new Map<string, number[]>();

    for (const row of genRows) {
      const ucId = (row['UC_ID'] || '').toString().trim().toLowerCase().replace(/\s+/g, '-');
      const kwh = parseFloat(row['Geracao_Real_kWh'] || row['Geracao_P50_kWh'] || '0') || 0;
      if (!genMap.has(ucId)) genMap.set(ucId, []);
      genMap.get(ucId)!.push(kwh);
    }

    for (const [ucId, gen] of genMap) {
      const uc = ucs.find(u => u.id === ucId);
      if (uc) {
        while (gen.length < 24) gen.push(gen[gen.length - 1] || 0);
        uc.ownGeneration = gen.slice(0, 24);
        warnings.push(`UC ${uc.name} tem geração própria — ${gen.reduce((a, b) => a + b, 0).toLocaleString()} kWh total`);
      }
    }
  }

  // --- Sheet 3: Usina_Helexia (optional) ---
  let plant: Partial<Plant> | undefined;
  const plantSheet = workbook.Sheets['Usina_Helexia'];
  if (plantSheet) {
    const plantRows: Record<string, string>[] = XLSX.utils.sheet_to_json(plantSheet);
    const fields = new Map<string, string>();
    for (const row of plantRows) {
      fields.set((row['Campo'] || '').toString().trim(), (row['Valor'] || '').toString().trim());
    }

    const p50: number[] = [];
    for (let i = 1; i <= 24; i++) {
      const key = `Geracao_P50_M${i}`;
      const val = parseFloat(fields.get(key) || '0') || 0;
      if (val > 0) p50.push(val);
    }

    if (fields.has('Nome_Usina') || fields.has('PPA_RS_kWh')) {
      plant = {
        name: fields.get('Nome_Usina') || '',
        capacityKWac: parseFloat(fields.get('Capacidade_kWac') || '0') || 0,
        ppaRateRsBRLkWh: parseFloat(fields.get('PPA_RS_kWh') || '0') || 0,
        contractStartMonth: fields.get('Mes_Inicio') || contractStart,
        contractMonths: parseInt(fields.get('Prazo_Meses') || '24') || 24,
        p50Profile: p50.length >= 12 ? p50 : undefined,
      } as Partial<Plant>;
    }
  }

  // --- Sheet 4: Banco_Stranded (optional) ---
  let batBank: ImportedData['batBank'] | undefined;
  const batSheet = workbook.Sheets['Banco_Stranded'];
  if (batSheet) {
    const batRows: Record<string, string>[] = XLSX.utils.sheet_to_json(batSheet);
    const fields = new Map<string, string>();
    for (const row of batRows) {
      fields.set((row['Campo'] || '').toString().trim(), (row['Valor'] || '').toString().trim());
    }

    if (fields.has('UC_Origem_ID')) {
      batBank = {
        openingKWh: parseFloat(fields.get('Banco_Inicial_kWh') || '0') || 0,
        nhsUCId: (fields.get('UC_Destino_1_ID') || '').toLowerCase().replace(/\s+/g, '-'),
        amdUCId: (fields.get('UC_Destino_2_ID') || '').toLowerCase().replace(/\s+/g, '-'),
        toNHSPct: parseFloat((fields.get('UC_Destino_1_Pct') || '50').replace('%', '')) / 100,
        toAMDPct: parseFloat((fields.get('UC_Destino_2_Pct') || '50').replace('%', '')) / 100,
      };
      warnings.push(`Banco stranded: ${batBank.openingKWh.toLocaleString()} kWh → ${batBank.nhsUCId} (${(batBank.toNHSPct * 100).toFixed(0)}%) + ${batBank.amdUCId} (${(batBank.toAMDPct * 100).toFixed(0)}%)`);
    }
  }

  const summary = `${ucs.length} UCs encontradas, ${months24.length} meses, ${ucs.filter(u => u.ownGeneration).length} com geração própria`;

  if (errors.length > 0) {
    return { errors, warnings, summary, data: null };
  }

  return { errors, warnings, summary, data: { ucs, plant, batBank } };
}

function generateTemplate(contractStart: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const months = generateMonths(contractStart, 24);

  // Sheet 1: UCs_Consumo
  const ucData = [
    ['UC_ID', 'UC_Nome', 'Grupo_Tarifario', 'Mes', 'Consumo_FP_kWh', 'Consumo_PT_kWh', 'Consumo_Total_kWh', 'Banco_Inicial_kWh', 'Observacoes'],
    // Example UC 1 - Grupo A
    ...months.map((m, i) => ['NHS', 'NHS Unidade', 'A4_VERDE', m, 45000, 8500, 53500, i === 0 ? 148516 : '', '']),
    // Example UC 2 - Grupo B
    ...months.map((m, i) => ['FILIAL1', 'Filial Dourados', 'B3', m, 4500, '', 4500, i === 0 ? 0 : '', '']),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(ucData);
  ws1['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'UCs_Consumo');

  // Sheet 2: Gerador_Proprio
  const genData = [
    ['UC_ID', 'UC_Nome', 'Usina_Nome', 'Capacidade_kWac', 'Mes', 'Geracao_Real_kWh', 'Geracao_P50_kWh', 'Usar_Real'],
    ...months.map(m => ['AMD', 'AMD Unidade', 'Usina Própria', 100, m, 5000, 4800, 'FALSE']),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(genData);
  XLSX.utils.book_append_sheet(wb, ws2, 'Gerador_Proprio');

  // Sheet 3: Usina_Helexia
  const plantData = [
    ['Campo', 'Valor', 'Unidade', 'Observacao'],
    ['Nome_Usina', 'CS3 Cassilândia', '—', 'Nome da usina Helexia'],
    ['Capacidade_kWac', 625, 'kWac', 'Potência AC instalada'],
    ['PPA_RS_kWh', 0.4425, 'R$/kWh', 'Tarifa PPA take-or-pay'],
    ['Mes_Inicio', contractStart, 'YYYY-MM', 'Início do contrato'],
    ['Prazo_Meses', 24, 'meses', 'Duração do contrato'],
    ...months.map((m, i) => [`Geracao_P50_M${i + 1}`, 130000, 'kWh', `Geração P50 ${m}`]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(plantData);
  ws3['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 10 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Usina_Helexia');

  // Sheet 4: Banco_Stranded
  const batData = [
    ['Campo', 'Valor', 'Observacao'],
    ['UC_Origem_ID', 'BAT', 'UC com banco stranded'],
    ['Banco_Inicial_kWh', 906739, 'Saldo do banco'],
    ['UC_Destino_1_ID', 'NHS', 'Primeiro UC destino'],
    ['UC_Destino_1_Pct', '50%', 'Fração para destino 1'],
    ['UC_Destino_2_ID', 'AMD', 'Segundo UC destino'],
    ['UC_Destino_2_Pct', '50%', 'Fração para destino 2'],
    ['Lag_Meses', 1, 'Lag T+1 para transferência'],
  ];
  const ws4 = XLSX.utils.aoa_to_sheet(batData);
  ws4['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 35 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'Banco_Stranded');

  // Sheet 5: Instruções
  const instrData = [
    ['INSTRUÇÕES — Template de Dados do Cliente'],
    [''],
    ['Sheet "UCs_Consumo":'],
    ['- Uma linha por mês por UC (24 linhas por UC)'],
    ['- UC_ID: código curto único (ex: NHS, AMD, FILIAL1)'],
    ['- Grupo_Tarifario: B1, B2, B3, A4_VERDE, A4_AZUL, A3A, A3, A2, A1'],
    ['- Consumo_PT_kWh: somente para Grupo A — deixe vazio para Grupo B'],
    ['- Banco_Inicial_kWh: preencher apenas na primeira linha de cada UC'],
    [''],
    ['Sheet "Gerador_Proprio":'],
    ['- Somente para UCs que têm geração solar própria'],
    ['- Deixe vazio se não há geração própria'],
    [''],
    ['Sheet "Usina_Helexia":'],
    ['- Dados da usina Helexia contratada'],
    ['- Geracao_P50_M1..M24: perfil mensal P50 em kWh'],
    [''],
    ['Sheet "Banco_Stranded":'],
    ['- Somente se existe banco de créditos stranded para redistribuir'],
    ['- Deixe vazio se não aplicável'],
  ];
  const ws5 = XLSX.utils.aoa_to_sheet(instrData);
  ws5['!cols'] = [{ wch: 70 }];
  XLSX.utils.book_append_sheet(wb, ws5, 'Instruções');

  return wb;
}

export function ClientDataUpload({ contractStartMonth, onImport }: Props) {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDownloadTemplate = useCallback(() => {
    const wb = generateTemplate(contractStartMonth);
    XLSX.writeFile(wb, 'template_dados_cliente.xlsx');
  }, [contractStartMonth]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const result = parseUpload(wb, contractStartMonth);
        setValidation(result);
      } catch (err) {
        setValidation({
          errors: [`Erro ao processar arquivo: ${err instanceof Error ? err.message : 'Erro desconhecido'}`],
          warnings: [],
          summary: '',
          data: null,
        });
      }
      setIsProcessing(false);
    };
    reader.readAsArrayBuffer(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [contractStartMonth]);

  const handleConfirmImport = useCallback(() => {
    if (validation?.data) {
      onImport(validation.data);
      setValidation(null);
    }
  }, [validation, onImport]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={handleDownloadTemplate}
          className="px-4 py-2.5 text-sm font-medium rounded-lg border-2 border-dashed border-slate-300 hover:border-teal-400 hover:bg-teal-50 transition-colors"
        >
          Baixar Template de Dados (.xlsx)
        </button>

        <label className="px-4 py-2.5 text-sm font-medium text-white rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          style={{ backgroundColor: '#004B70' }}
        >
          Importar Dados do Cliente (.xlsx)
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
        </label>

        {isProcessing && <span className="text-xs text-slate-500">Processando...</span>}
      </div>

      {/* Validation Results */}
      {validation && (
        <div className="border border-slate-200 rounded-lg p-4 space-y-3">
          {validation.summary && (
            <p className="text-sm font-medium text-slate-700">{validation.summary}</p>
          )}

          {validation.errors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-red-600">Erros ({validation.errors.length}):</p>
              {validation.errors.map((err, i) => (
                <p key={i} className="text-xs text-red-600 pl-3">• {err}</p>
              ))}
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-amber-600">Avisos ({validation.warnings.length}):</p>
              {validation.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-600 pl-3">• {w}</p>
              ))}
            </div>
          )}

          {validation.data && (
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleConfirmImport}
                className="px-4 py-2 text-sm text-white rounded-lg font-medium"
                style={{ backgroundColor: '#2F927B' }}
              >
                Confirmar Importação ({validation.data.ucs.length} UCs)
              </button>
              <button
                onClick={() => setValidation(null)}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
