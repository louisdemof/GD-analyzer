import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { DISTRIBUTORS } from '../data/distributors';
import { fetchANEELTariffs, aneelToDistributor, type ANEELDistributor } from '../data/aneelService';
import { parseAnyFatura, faturaHealth, type ParsedFatura } from '../engine/faturaParser';
import { buildProjectFromFaturas, analyzeFaturaSet } from '../engine/projectFromFaturas';
import type { OptimiserProgress } from '../engine/optimiser';
import type { RateioAllocation } from '../engine/types';
import OptimiserWorker from '../engine/optimiser.worker?worker';
import { computeDerivedTariffs } from '../engine/tariff';
import type { Distributor } from '../engine/types';

interface ParsedItem {
  fileName: string;
  ok: boolean;
  parsed?: ParsedFatura;
  error?: string;
  health?: string[];
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
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeProgress, setOptimizeProgress] = useState<OptimiserProgress | null>(null);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragActive, setDragActive] = useState(false);

  const { createProject, createProjectFromDistributor, updateProject } = useProjectStore();
  const navigate = useNavigate();

  // Market environment of the client today (drives the SEM baseline: captive vs ACL).
  const [marketType, setMarketType] = useState<'CATIVO' | 'ACL'>('CATIVO');
  const [aclEnergyPrice, setAclEnergyPrice] = useState('300'); // R$/MWh sem impostos
  const [aclDiscCons, setAclDiscCons] = useState('44');        // % desconto TUSD consumo
  const [aclDiscDem, setAclDiscDem] = useState('49');          // % desconto TUSD demanda

  // Patch applied to every newly-created project so the engine knows the baseline.
  const buildMarketPatch = (): Partial<import('../engine/types').Project> =>
    marketType === 'ACL'
      ? {
          marketType: 'ACL',
          aclBaseline: {
            energyPriceSemImp: (parseFloat(aclEnergyPrice) || 0) / 1000,
            energyIndexation: 'FIXO',
            tusdDiscountConsumo: (parseFloat(aclDiscCons) || 0) / 100,
            tusdDiscountDemanda: (parseFloat(aclDiscDem) || 0) / 100,
          },
        }
      : { marketType: 'CATIVO' };

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
  // Dedup preview: collapses same-UC bills by installation address (survives REN 1095/24
  // renumbering) and explains consolidations/renumberings before the project is created.
  const faturaAnalysis = useMemo(() => analyzeFaturaSet(successItems.map(i => i.parsed!)), [successItems]);
  const uniqueUCs = faturaAnalysis.ucCount;
  const hasFaturas = successItems.length > 0;

  const processFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f =>
      f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (arr.length === 0) return;
    setParsing(true);
    setProgress({ done: 0, total: arr.length });
    const results: ParsedItem[] = [];
    let sharedPw: string | undefined; // prompted once for encrypted bills, reused as last resort
    // Encrypted bills (COPEL, Coelba/Neoenergia) usam como senha um código numérico do nome do
    // arquivo — que pode estar em QUALQUER posição ("SSA - 13410 - Jun26.pdf" → 13410, e cada UC
    // tem a sua). Extraímos os candidatos (3–8 dígitos, sem anos) e testamos um a um.
    const pwCandidates = (name: string): string[] =>
      [...new Set(name.match(/\d{3,8}/g) || [])]
        .filter(g => !/^(19|20)\d{2}$/.test(g)) // descarta anos (2025, 2026…)
        .sort((a, b) => b.length - a.length);   // mais longo primeiro (código de UC antes de mês)
    for (const file of arr) {
      try {
        let parsed = await parseAnyFatura(file); // 1ª tentativa sem senha (faturas abertas)
        if (parsed.needsPassword) {
          // testa os números do nome do arquivo; cada arquivo pode ter senha própria
          for (const pw of [...pwCandidates(file.name), ...(sharedPw ? [sharedPw] : [])]) {
            parsed = await parseAnyFatura(file, pw);
            if (!parsed.needsPassword) break;
          }
        }
        if (parsed.needsPassword) {
          if (!sharedPw) {
            const pw = window.prompt(`"${file.name}" está protegido por senha. Informe a senha (será reutilizada para os demais):`);
            if (pw) sharedPw = pw;
          }
          if (sharedPw) parsed = await parseAnyFatura(file, sharedPw);
        }
        results.push({
          fileName: file.name,
          ok: parsed.ok,
          parsed,
          error: parsed.needsPassword
            ? 'PDF protegido — senha não encontrada no nome do arquivo (ex.: o nº da UC "SSA - 13410 - ...").'
            : (parsed.errors.join('; ') || undefined),
          health: parsed.ok ? faturaHealth(parsed) : undefined,
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

    const marketPatch = buildMarketPatch();

    // Path A: faturas dropped → auto-build from parsed data
    if (hasFaturas) {
      try {
        const { project: built, warnings } = buildProjectFromFaturas(
          successItems.map(i => i.parsed!),
          clientName.trim(),
        );
        // Persist the import warnings (UC consolidation, REN 1095/24 renumbering) on the
        // project so they stay documented inside the editor, not just at upload time.
        const project = { ...built, ...marketPatch, importWarnings: warnings.length ? warnings : undefined };
        const finish = (proj: typeof project) => {
          useProjectStore.setState(state => ({ projects: [...state.projects, proj], currentProjectId: proj.id }));
          import('../storage/projectDB').then(m => m.saveProjectToDB(proj).catch(() => {}));
          navigate(`/project/${proj.id}`);
        };
        // Auto-otimiza o rateio na criação (maximiza a economia) quando há 2+ UCs, em BACKGROUND
        // (worker) → não trava a tela, sem limite de UCs. 1 UC = rateio trivial (100%).
        const nUCs = project.ucs.filter(u => u.id !== 'bat').length;
        if (nUCs >= 2) {
          setOptimizing(true);
          const withDerived = { ...project, distributor: computeDerivedTariffs(project.distributor) };
          const worker = new OptimiserWorker();
          const done = (rateio?: RateioAllocation) => {
            worker.terminate();
            setOptimizing(false); setOptimizeProgress(null);
            finish(rateio ? { ...withDerived, rateio } : project);
          };
          // Fallback adaptativo: projetos grandes podem levar minutos → limite generoso; se estourar,
          // segue com o rateio padrão (o usuário reotimiza na aba Rateio).
          const to = setTimeout(() => done(), nUCs > 8 ? 300_000 : 90_000);
          worker.onmessage = (e: MessageEvent) => {
            if (e.data.type === 'progress') setOptimizeProgress(e.data as OptimiserProgress);
            else if (e.data.type === 'done') { clearTimeout(to); done(e.data.result.allocation as RateioAllocation); }
          };
          worker.onerror = () => { clearTimeout(to); done(); };
          worker.postMessage({ project: withDerived });
        } else {
          finish(project);
        }
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
      updateProject(project.id, marketPatch);
      navigate(`/project/${project.id}`);
      return;
    }
    if (selected) {
      const distributor = aneelToDistributor(selected);
      const project = createProjectFromDistributor(clientName.trim(), distributor);
      updateProject(project.id, marketPatch);
      navigate(`/project/${project.id}`);
      return;
    }
    // Last resort
    const project = createProject(clientName.trim(), DISTRIBUTORS[0].id);
    updateProject(project.id, marketPatch);
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
        Crie manualmente ou solte faturas (Energisa, COPEL, CEMIG, Equatorial, Light, Enel) para preencher tudo automaticamente.
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

        {/* Mercado do cliente HOJE — define o baseline (SEM) da simulação */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Mercado do cliente (hoje)</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              ['CATIVO', 'Mercado Cativo', 'Tarifa regulada (TUSD+TE)'],
              ['ACL', 'Mercado Livre (ACL)', 'Energia na ACL + TUSD c/ desconto'],
            ] as const).map(([val, title, sub]) => (
              <button
                key={val}
                type="button"
                onClick={() => setMarketType(val)}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                  marketType === val ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white hover:border-teal-400'
                }`}
              >
                <div className="text-sm font-medium text-slate-800">{title}</div>
                <div className="text-xs text-slate-500">{sub}</div>
              </button>
            ))}
          </div>

          {marketType === 'ACL' && (
            <div className="mt-3 grid grid-cols-3 gap-3 border border-slate-200 rounded-lg bg-slate-50 p-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Energia TE (R$/MWh, s/ imp.)</label>
                <input
                  value={aclEnergyPrice}
                  onChange={e => setAclEnergyPrice(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Desc. TUSD consumo (%)</label>
                <input
                  value={aclDiscCons}
                  onChange={e => setAclDiscCons(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Desc. TUSD demanda (%)</label>
                <input
                  value={aclDiscDem}
                  onChange={e => setAclDiscDem(e.target.value)}
                  inputMode="decimal"
                  className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <p className="col-span-3 text-[11px] text-slate-500">
                O baseline (cenário atual) usará energia comprada na ACL + TUSD com esses descontos de fonte incentivada.
                Ao adotar GD, o cliente migra para o cativo e <strong>perde o desconto de demanda</strong> (refletido na economia).
              </p>
            </div>
          )}
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
                Energisa MS, COPEL, CEMIG, Equatorial (PA/PI/MA/GO/AL), Neoenergia/Coelba (BA/RN/PE), Light e Enel (RJ/CE/SP). Protegidas (COPEL/Coelba): a senha costuma ser o nº da UC no nome do arquivo. Faturas mensais (Coelba) são consolidadas por UC automaticamente.
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
              {faturaAnalysis.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-1">
                  {faturaAnalysis.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-900 leading-snug">{w}</p>
                  ))}
                </div>
              )}
              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      <th className="text-left py-1.5 px-2 w-6">✓</th>
                      <th className="text-left py-1.5 px-2">Distribuidora</th>
                      <th className="text-left py-1.5 px-2">Matrícula</th>
                      <th className="text-left py-1.5 px-2">Classificação</th>
                      <th className="text-right py-1.5 px-2">Histórico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <Fragment key={i}>
                        <tr className="border-t border-slate-100">
                          <td className="py-1 px-2">
                            {it.ok
                              ? (it.health && it.health.length > 0
                                  ? <span className="text-amber-500" title={it.health.join('\n')}>⚠</span>
                                  : <span className="text-emerald-600">✓</span>)
                              : <span className="text-red-600" title={it.error}>✗</span>}
                          </td>
                          <td className="py-1 px-2 text-slate-600" title="Confira se bate com a distribuidora real da fatura">{it.parsed?.distributorSig || '—'}</td>
                          <td className="py-1 px-2 font-mono">{it.parsed?.ucNumero || it.parsed?.ucMatricula || '—'}</td>
                          <td className="py-1 px-2 truncate max-w-xs">{(it.parsed?.classificacao || '').slice(0, 40)}</td>
                          <td className="py-1 px-2 text-right">{it.parsed?.history.length ?? 0}m</td>
                        </tr>
                        {it.ok && it.health && it.health.length > 0 && (
                          <tr>
                            <td></td>
                            <td colSpan={4} className="px-2 pb-1 text-[10px] text-amber-700">
                              {it.health.map((h, j) => <div key={j}>⚠ {h}</div>)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
            Distribuidora detectada das faturas: <strong>{
              (() => {
                const sig = successItems[0]?.parsed?.distributorSig;
                return sig === 'COPEL-DIS' ? 'COPEL Distribuição (PR)'
                  : sig === 'CEMIG-D' ? 'CEMIG Distribuição (MG)'
                  : sig?.startsWith('EQUATORIAL') ? `Equatorial (${sig.split(' ')[1]})`
                  : sig === 'LIGHT SESA' ? 'Light (RJ)'
                  : sig?.startsWith('ENEL') ? `Enel (${sig.split(' ')[1]})`
                  : sig === 'EDP SP' ? 'EDP São Paulo'
                  : 'Energisa Mato Grosso do Sul';
              })()
            }</strong>
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

      {optimizing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl px-6 py-5 w-[340px]">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-semibold text-slate-800">Otimizando o rateio das UCs…</p>
            </div>
            <p className="text-xs text-slate-500">{optimizeProgress?.message ?? 'Distribuindo os créditos para maximizar a economia do cliente.'}</p>
            <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-teal-500 transition-all" style={{ width: `${Math.max(3, Math.min(100, optimizeProgress?.pct ?? 8))}%` }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
