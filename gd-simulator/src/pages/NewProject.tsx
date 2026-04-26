import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { DISTRIBUTORS } from '../data/distributors';
import { fetchANEELTariffs, aneelToDistributor, type ANEELDistributor } from '../data/aneelService';
import type { Distributor } from '../engine/types';

export function NewProject() {
  const [clientName, setClientName] = useState('');
  const [aneelList, setAneelList] = useState<ANEELDistributor[]>([]);
  const [selectedSig, setSelectedSig] = useState<string>('');
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const { createProject, createProjectFromDistributor } = useProjectStore();
  const navigate = useNavigate();

  // Load ANEEL distribuidoras on mount
  useEffect(() => {
    let cancelled = false;
    fetchANEELTariffs(false)
      .then(result => {
        if (cancelled) return;
        if (result.distributors.length > 0) {
          setAneelList(result.distributors);
          // Auto-select first (alphabetical)
          if (result.distributors[0]) setSelectedSig(result.distributors[0].sigAgente);
        }
        if (result.error) setApiError(result.error);
        setLoading(false);
      })
      .catch(() => {
        setApiError('Erro ao carregar distribuidoras ANEEL');
        setLoading(false);
      });
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

  const handleSelectAneel = (d: ANEELDistributor) => {
    setSelectedSig(d.sigAgente);
    setSearch('');
    setDropdownOpen(false);
  };

  const handleSelectFallback = (d: Distributor) => {
    // Use fallback ID (matches existing createProject path)
    setSelectedSig('FALLBACK:' + d.id);
    setDropdownOpen(false);
  };

  const handleCreate = () => {
    if (!clientName.trim()) return;
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
    // Final fallback to first hardcoded
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
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-6">Novo Projeto</h1>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Cliente</label>
          <input
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            placeholder="Ex: Copasul"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            autoFocus
          />
        </div>

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
                    <div className="px-3 py-3 text-sm text-slate-400">Nenhuma distribuidora corresponde a &quot;{search}&quot;</div>
                  )}
                </div>
              </>
            )}
          </div>
          {apiError && (
            <p className="text-xs text-amber-700 mt-1">{apiError}</p>
          )}
          <p className="text-xs text-slate-400 mt-1">
            As tarifas serão preenchidas automaticamente da ANEEL ao criar o projeto. Você pode ajustar depois em Distribuidora &amp; Tarifas.
          </p>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={!clientName.trim() || (!selectedSig)}
            className="px-6 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2F927B' }}
          >
            Criar Projeto
          </button>
        </div>
      </div>
    </div>
  );
}
