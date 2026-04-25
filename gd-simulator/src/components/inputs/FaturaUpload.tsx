import { useState, useRef, useMemo } from 'react';
import type { ConsumptionUnit } from '../../engine/types';
import { parseEnergisaFatura, type ParsedFatura } from '../../engine/faturaParser';

interface Props {
  ucs: ConsumptionUnit[];
  onApply: (ucId: string, updates: Partial<ConsumptionUnit>) => void;
}

const MONTH_LABELS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export function FaturaUpload({ ucs, onApply }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedFatura | null>(null);
  const [editedHistory, setEditedHistory] = useState<ParsedFatura['history']>([]);
  const [editedDC, setEditedDC] = useState<number>(0);
  const [selectedUcId, setSelectedUcId] = useState<string>('');
  const [applyOpts, setApplyOpts] = useState({ dc: true, dmHistory: true, consumptionHistory: false });
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const result = await parseEnergisaFatura(file);
      setParsing(false);
      if (!result.ok) {
        setError(result.errors.join('; ') || 'Erro ao parsear');
        return;
      }
      setParsed(result);
      setEditedHistory(result.history.slice());
      setEditedDC(result.demandaContratadaFP ?? 0);
      // Auto-suggest UC by ucNumero match
      const suggestion = ucs.find(uc =>
        result.ucNumero && uc.id.includes(result.ucNumero.split('-')[0])
      ) || ucs.find(uc =>
        result.ucNumero && uc.name.includes(result.ucNumero.split('-')[0])
      ) || ucs[0];
      if (suggestion) setSelectedUcId(suggestion.id);
    } catch (err) {
      setParsing(false);
      setError(err instanceof Error ? err.message : 'Falha ao processar PDF');
    }
  };

  // Last 12 months of history (most recent first → reversed for chronological array)
  const last12 = useMemo(() => {
    if (editedHistory.length === 0) return [];
    return editedHistory.slice(-12); // chronological (parser already sorted)
  }, [editedHistory]);

  const apply = () => {
    if (!parsed || !selectedUcId) return;
    const updates: Partial<ConsumptionUnit> = {};
    if (applyOpts.dc && editedDC > 0) {
      updates.demandaContratadaFP = editedDC;
    }
    if (applyOpts.dmHistory && last12.length > 0) {
      // Build 12-month DM array (FP only, in chronological order)
      const dms = last12.map(r => r.demandaForaPonta || 0);
      // Pad to 12 if needed
      while (dms.length < 12) dms.push(0);
      updates.demandaMedidaMensal = dms.slice(0, 12);
      // Also set demandaFaturadaFP to the average so the SEM cost reflects it
      const avg = dms.filter(v => v > 0).reduce((a, b) => a + b, 0) / Math.max(1, dms.filter(v => v > 0).length);
      if (avg > 0) updates.demandaFaturadaFP = Math.round(avg);
    }
    if (applyOpts.consumptionHistory && last12.length >= 12) {
      // Build 24-month arrays by repeating last 12 (engine extends with growth anyway)
      const fp = last12.map(r => Math.round(r.consumoForaPonta || 0));
      const pt = last12.map(r => Math.round(r.consumoPonta || 0));
      const rsv = last12.map(r => Math.round(r.consumoReservado || 0));
      // Fill 24 months by repeating
      const fp24 = [...fp, ...fp];
      const pt24 = [...pt, ...pt];
      const rsv24 = [...rsv, ...rsv];
      updates.consumptionFP = fp24;
      updates.consumptionPT = pt24;
      if (rsv.some(v => v > 0)) {
        updates.consumptionReservado = rsv24;
      }
    }
    onApply(selectedUcId, updates);
    setParsed(null); // close preview
  };

  const cancel = () => { setParsed(null); setError(null); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => fileInput.current?.click()}
          disabled={parsing}
          className="px-4 py-2 text-sm border border-teal-300 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 disabled:opacity-50 font-medium"
        >
          {parsing ? 'Processando…' : '📄 Importar Fatura PDF (Energisa MS)'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFile}
          className="hidden"
        />
        {error && (
          <span className="text-sm text-red-600">⚠ {error}</span>
        )}
      </div>

      {parsed && (
        <div className="border-2 border-teal-300 rounded-xl p-4 bg-white space-y-4">
          <div className="flex items-baseline justify-between border-b border-slate-200 pb-3">
            <h3 className="text-base font-semibold text-slate-800">Pré-visualização da Fatura</h3>
            <button onClick={cancel} className="text-sm text-slate-500 hover:text-slate-700">✕ Cancelar</button>
          </div>

          {/* Identification */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500 text-xs">UC Matrícula:</span>
              <div className="font-mono">{parsed.ucMatricula || '—'}</div>
            </div>
            <div>
              <span className="text-slate-500 text-xs">Referência:</span>
              <div>{parsed.refMes || '—'}</div>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500 text-xs">Classificação:</span>
              <div className="text-xs">{parsed.classificacao || '—'}</div>
            </div>
          </div>

          {/* Demanda contratada (editable) */}
          <div className="grid grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Demanda Contratada FP (kW)</label>
              <input
                type="number"
                min={0}
                value={editedDC || 0}
                onChange={e => setEditedDC(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-mono text-right"
              />
            </div>
            <div className="text-xs text-slate-500 col-span-2 pb-2">
              {parsed.taxes && (
                <span>
                  Tributos detectados:&nbsp;
                  PIS {parsed.taxes.PIS != null ? (parsed.taxes.PIS * 100).toFixed(2) + '%' : 'n/a'}&nbsp;·&nbsp;
                  COFINS {parsed.taxes.COFINS != null ? (parsed.taxes.COFINS * 100).toFixed(2) + '%' : 'n/a'}&nbsp;·&nbsp;
                  ICMS {parsed.taxes.ICMS != null ? (parsed.taxes.ICMS * 100).toFixed(0) + '%' : 'n/a'}
                </span>
              )}
            </div>
          </div>

          {/* History table — editable */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              Histórico — {editedHistory.length} meses extraídos (mais recentes em destaque)
            </label>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left py-1.5 px-2">Mês</th>
                    <th className="text-right py-1.5 px-2">Cons. Ponta</th>
                    <th className="text-right py-1.5 px-2">Cons. F.Ponta</th>
                    <th className="text-right py-1.5 px-2">Cons. Reservado</th>
                    <th className="text-right py-1.5 px-2">Dem. Ponta</th>
                    <th className="text-right py-1.5 px-2 bg-amber-50">Dem. F.Ponta</th>
                  </tr>
                </thead>
                <tbody>
                  {editedHistory.map((row, i) => {
                    const isLast12 = i >= editedHistory.length - 12;
                    const updateField = (field: keyof ParsedFatura['history'][number], val: number) => {
                      const next = [...editedHistory];
                      next[i] = { ...next[i], [field]: val };
                      setEditedHistory(next);
                    };
                    return (
                      <tr key={row.monthIso} className={`border-t border-slate-100 ${isLast12 ? '' : 'opacity-50'}`}>
                        <td className="py-1 px-2 font-medium">{row.monthLabel}</td>
                        <td className="py-1 px-2 text-right">
                          <input type="number" value={row.consumoPonta || 0}
                            onChange={e => updateField('consumoPonta', parseFloat(e.target.value) || 0)}
                            className="w-20 text-right font-mono text-xs px-1 py-0.5 border border-transparent hover:border-slate-300 rounded" />
                        </td>
                        <td className="py-1 px-2 text-right">
                          <input type="number" value={row.consumoForaPonta || 0}
                            onChange={e => updateField('consumoForaPonta', parseFloat(e.target.value) || 0)}
                            className="w-24 text-right font-mono text-xs px-1 py-0.5 border border-transparent hover:border-slate-300 rounded" />
                        </td>
                        <td className="py-1 px-2 text-right">
                          <input type="number" value={row.consumoReservado || 0}
                            onChange={e => updateField('consumoReservado', parseFloat(e.target.value) || 0)}
                            className="w-24 text-right font-mono text-xs px-1 py-0.5 border border-transparent hover:border-slate-300 rounded" />
                        </td>
                        <td className="py-1 px-2 text-right">
                          <input type="number" value={row.demandaPonta || 0}
                            onChange={e => updateField('demandaPonta', parseFloat(e.target.value) || 0)}
                            className="w-16 text-right font-mono text-xs px-1 py-0.5 border border-transparent hover:border-slate-300 rounded" />
                        </td>
                        <td className="py-1 px-2 text-right bg-amber-50">
                          <input type="number" value={row.demandaForaPonta || 0}
                            onChange={e => updateField('demandaForaPonta', parseFloat(e.target.value) || 0)}
                            className="w-16 text-right font-mono text-xs px-1 py-0.5 border border-transparent hover:border-slate-300 rounded" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Linhas com transparência (&gt; 12 meses) são informativas; só os 12 mais recentes serão aplicados.
              Edite valores diretamente nas células se algum extraído estiver errado.
            </p>
          </div>

          {/* Apply target + options */}
          <div className="border-t border-slate-200 pt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Aplicar à UC do projeto:</label>
              <select
                value={selectedUcId}
                onChange={e => setSelectedUcId(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-sm"
              >
                <option value="">— selecione —</option>
                {ucs.map(uc => (
                  <option key={uc.id} value={uc.id}>{uc.name} ({uc.tariffGroup})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Campos a aplicar:</label>
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={applyOpts.dc} onChange={e => setApplyOpts(o => ({ ...o, dc: e.target.checked }))} />
                  <span>Demanda contratada ({editedDC} kW)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={applyOpts.dmHistory} onChange={e => setApplyOpts(o => ({ ...o, dmHistory: e.target.checked }))} />
                  <span>Histórico DM (12 meses) + Demanda Faturada média</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={applyOpts.consumptionHistory} onChange={e => setApplyOpts(o => ({ ...o, consumptionHistory: e.target.checked }))} />
                  <span>Consumo FP/PT/Reservado (sobrescreve 24m com 12m × 2)</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-slate-200">
            <button onClick={cancel} className="px-4 py-2 text-sm border border-slate-300 rounded-lg">Cancelar</button>
            <button
              onClick={apply}
              disabled={!selectedUcId}
              className="px-4 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-50"
              style={{ backgroundColor: '#2F927B' }}
            >
              Aplicar à UC
            </button>
          </div>

          {parsed.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 space-y-0.5 pt-2">
              {parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
