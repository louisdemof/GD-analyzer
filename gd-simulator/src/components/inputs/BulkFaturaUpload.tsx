import { useState, useRef } from 'react';
import { parseEnergisaFatura, type ParsedFatura } from '../../engine/faturaParser';
import { buildProjectFromFaturas } from '../../engine/projectFromFaturas';
import type { Project } from '../../engine/types';

interface Props {
  onCreate: (project: Project) => void;
  onCancel: () => void;
}

interface ParsedItem {
  fileName: string;
  ok: boolean;
  parsed?: ParsedFatura;
  error?: string;
}

export function BulkFaturaUpload({ onCreate, onCancel }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [clientName, setClientName] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragActive, setDragActive] = useState(false);

  const processFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (arr.length === 0) return;
    setParsing(true);
    setProgress({ done: 0, total: arr.length });
    const results: ParsedItem[] = [];
    for (const file of arr) {
      try {
        const parsed = await parseEnergisaFatura(file);
        results.push({ fileName: file.name, ok: parsed.ok, parsed, error: parsed.errors.join('; ') || undefined });
      } catch (e) {
        results.push({ fileName: file.name, ok: false, error: e instanceof Error ? e.message : 'Erro' });
      }
      setProgress(prev => ({ ...prev, done: prev.done + 1 }));
      // Update partial results so the user sees progress
      setItems([...results]);
    }
    setParsing(false);
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) processFiles(files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
  };

  const handleCreate = () => {
    const successful = items.filter(i => i.ok && i.parsed).map(i => i.parsed!);
    if (successful.length === 0) return;
    try {
      const { project } = buildProjectFromFaturas(successful, clientName);
      onCreate(project);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao construir projeto');
    }
  };

  const successCount = items.filter(i => i.ok).length;
  const uniqueUCs = new Set(items.filter(i => i.ok).map(i => i.parsed!.ucNumero || i.parsed!.ucMatricula)).size;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Criar Projeto a Partir de Faturas</h2>
        <button onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700">✕ Fechar</button>
      </div>

      <p className="text-sm text-slate-600">
        Solte ou selecione múltiplas faturas Energisa MS (PDFs). Cada fatura define uma UC do projeto;
        o histórico de 12 meses preenche o consumo + demanda. Faturas duplicadas (mesma UC) ficam só na mais recente.
      </p>

      {/* Client name */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Nome do cliente</label>
        <input
          type="text"
          value={clientName}
          onChange={e => setClientName(e.target.value)}
          placeholder="ex: Belo Alimentos"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
        />
      </div>

      {/* Drop zone */}
      <div
        onDragEnter={e => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInput.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragActive ? 'border-teal-500 bg-teal-50' : 'border-slate-300 hover:border-teal-400 hover:bg-slate-50'
        }`}
      >
        <div className="text-3xl mb-2">📄</div>
        <p className="text-sm text-slate-700 font-medium">
          Arraste e solte os PDFs das faturas aqui
        </p>
        <p className="text-xs text-slate-500 mt-1">
          ou clique para selecionar — múltiplos arquivos suportados
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={handleFiles}
          className="hidden"
        />
      </div>

      {/* Progress */}
      {parsing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-sm text-blue-800">
            Processando {progress.done} / {progress.total} faturas…
          </p>
          <div className="mt-2 h-1.5 bg-blue-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Results */}
      {items.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              {items.length} faturas processadas — {successCount} OK, {uniqueUCs} UCs únicas
            </h3>
          </div>
          <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 sticky top-0">
                <tr>
                  <th className="text-left py-1.5 px-2">Status</th>
                  <th className="text-left py-1.5 px-2">Arquivo</th>
                  <th className="text-left py-1.5 px-2">Matrícula</th>
                  <th className="text-left py-1.5 px-2">Classificação</th>
                  <th className="text-right py-1.5 px-2">Histórico</th>
                  <th className="text-left py-1.5 px-2">Ref</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 px-2">
                      {it.ok
                        ? <span className="text-emerald-600">✓</span>
                        : <span className="text-red-600" title={it.error}>✗</span>}
                    </td>
                    <td className="py-1 px-2 font-mono text-[11px] truncate max-w-xs">{it.fileName}</td>
                    <td className="py-1 px-2 font-mono">{it.parsed?.ucNumero || it.parsed?.ucMatricula || '—'}</td>
                    <td className="py-1 px-2 text-[11px]">{(it.parsed?.classificacao || '').slice(0, 50)}</td>
                    <td className="py-1 px-2 text-right">{it.parsed?.history.length ?? 0}m</td>
                    <td className="py-1 px-2 text-[11px]">{it.parsed?.refMes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {items.length > 0 && !parsing && (
        <div className="flex gap-2 justify-end pt-3 border-t border-slate-200">
          <button onClick={onCancel} className="px-4 py-2 text-sm border border-slate-300 rounded-lg">Cancelar</button>
          <button
            onClick={handleCreate}
            disabled={successCount === 0}
            className="px-4 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2F927B' }}
          >
            Criar Projeto com {uniqueUCs} UC{uniqueUCs !== 1 ? 's' : ''}
          </button>
        </div>
      )}
    </div>
  );
}
