import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { DISTRIBUTORS } from '../data/distributors';
import { fetchANEELTariffs, aneelToDistributor, type ANEELDistributor } from '../data/aneelService';
import { parseEnergisaFatura, type ParsedFatura } from '../engine/faturaParser';
import { buildProjectFromFaturas } from '../engine/projectFromFaturas';
import type { Distributor } from '../engine/types';

interface ParsedItem {
  fileName: string;
  ok: boolean;
  parsed?: ParsedFatura;
  error?: string;
}

export function NewProject() {
  const [clientName, setClientName] = useState('');
  const [aneelList, setAneelList] = useState<ANEELDistributor[]>([]);
  const [selectedSig, setSelectedSig] = useState<string>('');
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Fatura import state
  const fileInput = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragActive, setDragActive] = useState(false);

  const { createProject, createProjectFromDistributor } = useProjectStore();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetchANEELTariffs(false)
      .then(result => {
        if (cancelled) return;
        if (result.distributors.length > 0) {
          setAneelList(result.distributors);
          if (result.distributors[0]) setSelectedSig(result.distributors[0].sigAgente);
        }
        if (result.error) setApiError(result.error);
        setLoading(false);
      })
      .catch(() => { setApiError('Erro ao carregar distribuidoras ANEEL'); setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return aneelList;
    const q = search.toLowerCase();
    return aneelList.filter(d =>
      d.sigAgente.toLowerCase().includes(q) || d.state.toLowerCase().includes(q)
    );
  }, [aneelList, search]);

  const selected = useMemo(
    () => aneelList.find(d => d.sigAgente === selectedSig),
    [aneelList, selectedSig]
  );

  const successItems = useMemo(() => items.filter(i => i.ok && i.parsed), [items]);
  const uniqueUCs = useMemo(
    () => new Set(successItems.map(i => i.parsed!.ucNumero || i.parsed!.ucMatricula)).size,
    [successItems]
  );
  const hasFaturas = successItems.length > 0;

  const processFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (arr.length === 0) return;
    setParsing(true);
    setProgress({ done: 0, total: arr.length });
    const results: ParsedItem[] = [];
    for (const file of arr) {
      try {
        const parsed = await parseEnergisaFatura(file);
        results.push({
          fileName: file.name,
          ok: parsed.ok,
          parsed,
          error: parsed.errors.join('; ') || undefined,
        });
      } catch (e) {
        results.push({
          fileName: file.name,
          ok: false,
          error: e instanceof Error ? e.message : 'Erro',
        });
      }
      setProgress(p => ({ ...p, done: p.done + 1 }));
      setItems([...results]);
    }
    setParsing(false);
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files) processFiles(e.dataTransfer.files);
  };

  const clearFaturas = () => {
    setItems([]);
    setProgress({ done: 0, total: 0 });
  };

  const handleSelectAneel = (d: ANEELDistributor) => {
    setSelectedSig(d.sigAgente);
    setSearch('');
    setDropdownOpen(false);
  };

  const handleSelectFallback = (d: Distributor) => {
    setSelectedSig('FALLBACK:' + d.id);
    setDropdownOpen(false);
  };

  const handleCreate = () => {
    if (!clientName.trim()) return;

    // Path A: faturas dropped → auto-build from parsed data
    if (hasFaturas) {
      try {
        const { project } = buildProjectFromFaturas(
          successItems.map(i => i.parsed!),
          clientName.trim(),
        );
        useProjectStore.setState(state => ({
          projects: [...state.projects, project],
          currentProjectId: project.id,
        }));
        import('../storage/projectDB').then(m => m.saveProjectToDB(project).catch(() => {}));
        navigate(`/project/${project.id}`);
        return;
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Erro ao construir projeto a partir das faturas');
        return;
      }
    }

    // Path B: ANEEL distributor selected
    if (selectedSig.startsWith('FALLBACK:')) {
      const id = selectedSig.slice('FALLBACK:'.length);
      const project = createProject(clientName.trim(), id);
      navigate(`/project/${project.id}`);
      return;
    }
    if (selected) {
      const distributor = aneelToDistributor(selected);
      const project = createProjectFromDistributor(clientName.trim(), distributor);
      navigate(`/project/${project.id}`);
      return;
    }
    // Last resort
    const project = createProject(clientName.trim(), DISTRIBUTORS[0].id);
    navigate(`/project/${project.id}`);
  };

  const displayLabel = useMemo(() => {
    if (selectedSig.startsWith('FALLBACK:')) {
      const id = selectedSig.slice('FALLBACK:'.length);
      const d = DISTRIBUTORS.find(x => x.id === id);
      return d ? `${d.name} (${d.state}) — bundled` : '';
    }
    if (selected) return `${selected.sigAgente} (${selected.state})`;
    return '';
  }, [selectedSig, selected]);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-1">Novo Projeto</h1>
      <p className="text-sm text-slate-500 mb-6">
        Crie manualmente ou solte faturas Energisa MS (PDF) para preencher tudo automaticamente.
      </p>

      <div className="space-y-5">
        {/* Client name — always */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Cliente</label>
          <input
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            placeholder="Ex: Belo Alimentos"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            autoFocus
          />
        </div>

        {/* Fatura drop zone — optional */}
        <div className="border border-slate-200 rounded-xl bg-slate-50 p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-700">
              Importar de Faturas <span className="text-xs font-normal text-slate-500">(opcional)</span>
            </h3>
            {hasFaturas && (
              <button onClick={clearFaturas} className="text-xs text-slate-500 hover:text-red-600">
                ✕ Remover faturas
              </button>
            )}
          </div>

          {!hasFaturas && !parsing && (
            <div
              onDragEnter={e => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={e => { e.preventDefault(); setDragActive(false); }}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInput.current?.click()}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                dragActive ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white hover:border-teal-400'
              }`}
            >
              <div className="text-2xl mb-1">📄</div>
              <p className="text-sm text-slate-700">
                Arraste e solte os PDFs das faturas — ou clique para selecionar
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Energisa MS (DANF3E). Múltiplos arquivos suportados — uma fatura por UC, ou várias.
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
          )}

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

          {hasFaturas && !parsing && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm text-slate-700">
                  <strong>{items.length}</strong> faturas processadas — <strong className="text-emerald-700">{uniqueUCs} UCs únicas</strong>
                </p>
              </div>
              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      <th className="text-left py-1.5 px-2 w-6">✓</th>
                      <th className="text-left py-1.5 px-2">Matrícula</th>
                      <th className="text-left py-1.5 px-2">Classificação</th>
                      <th className="text-right py-1.5 px-2">Histórico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1 px-2">
                          {it.ok ? <span className="text-emerald-600">✓</span> : <span className="text-red-600" title={it.error}>✗</span>}
                        </td>
                        <td className="py-1 px-2 font-mono">{it.parsed?.ucNumero || it.parsed?.ucMatricula || '—'}</td>
                        <td className="py-1 px-2 truncate max-w-xs">{(it.parsed?.classificacao || '').slice(0, 40)}</td>
                        <td className="py-1 px-2 text-right">{it.parsed?.history.length ?? 0}m</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-emerald-700">
                ✓ Distribuidora, tributos e {uniqueUCs} UCs com consumo + demanda serão criadas a partir das faturas.
              </p>
            </div>
          )}
        </div>

        {/* Distribuidora dropdown — hidden when faturas detected */}
        {!hasFaturas && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Distribuidora{' '}
              {!loading && aneelList.length > 0 && (
                <span className="text-xs text-slate-400 font-normal">
                  ({aneelList.length} disponíveis via ANEEL)
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type="text"
                value={dropdownOpen ? search : displayLabel}
                onChange={e => { setSearch(e.target.value); setDropdownOpen(true); }}
                onFocus={() => { setDropdownOpen(true); setSearch(''); }}
                placeholder={loading ? 'Carregando distribuidoras…' : 'Pesquise por nome ou estado (ex: EMS, MG, SP)…'}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              {dropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                  <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                    {filtered.length > 0 ? (
                      filtered.map(d => (
                        <button
                          key={d.sigAgente}
                          onClick={() => handleSelectAneel(d)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-teal-50 transition-colors flex items-center justify-between ${
                            selectedSig === d.sigAgente ? 'bg-teal-50' : ''
                          }`}
                        >
                          <span className="truncate">{d.sigAgente}</span>
                          <span className="ml-2 text-xs text-slate-400 shrink-0">{d.state}</span>
                        </button>
                      ))
                    ) : aneelList.length === 0 ? (
                      <>
                        <div className="px-3 py-2 text-xs text-slate-400">
                          Dados ANEEL indisponíveis — usando lista pré-cadastrada
                        </div>
                        {DISTRIBUTORS.map(d => (
                          <button
                            key={d.id}
                            onClick={() => handleSelectFallback(d)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                          >
                            {d.name} ({d.state})
                          </button>
                        ))}
                      </>
                    ) : (
                      <div className="px-3 py-3 text-sm text-slate-400">Nenhuma corresponde a &quot;{search}&quot;</div>
                    )}
                  </div>
                </>
              )}
            </div>
            {apiError && <p className="text-xs text-amber-700 mt-1">{apiError}</p>}
            <p className="text-xs text-slate-400 mt-1">
              Tarifas ANEEL preenchidas automaticamente. Você pode ajustar depois.
            </p>
          </div>
        )}

        {hasFaturas && (
          <div className="text-xs text-slate-500 italic px-1">
            Distribuidora detectada das faturas: <strong>Energisa Mato Grosso do Sul</strong>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={!clientName.trim() || (!selectedSig && !hasFaturas) || parsing}
            className="px-6 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2F927B' }}
          >
            {hasFaturas
              ? `Criar Projeto com ${uniqueUCs} UC${uniqueUCs !== 1 ? 's' : ''}`
              : 'Criar Projeto'}
          </button>
        </div>
      </div>
    </div>
  );
}
