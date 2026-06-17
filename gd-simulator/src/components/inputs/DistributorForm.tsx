import { useState, useEffect, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Distributor } from '../../engine/types';
import { computeDerivedTariffs } from '../../engine/tariff';
import { CurrencyInput } from '../shared/CurrencyInput';
import {
  fetchANEELTariffs,
  aneelToDistributor,
  getCacheFetchedAt,
  clearCache,
  getRuralIrriganteDiscount,
  computeReservadoTariffs,
  ICMS_BY_STATE,
  DEFAULT_PIS,
  DEFAULT_COFINS,
  type ANEELDistributor,
} from '../../data/aneelService';
import { DISTRIBUTORS } from '../../data/distributors';

interface Props {
  distributor: Distributor;
  onChange: (d: Distributor) => void;
}

export function DistributorForm({ distributor, onChange }: Props) {
  // ANEEL data state
  const [aneelDistributors, setAneelDistributors] = useState<ANEELDistributor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(getCacheFetchedAt());

  // Search state for the dropdown
  const [search, setSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Track ANEEL source values to show override dots
  const [aneelSource, setAneelSource] = useState<ANEELDistributor | null>(null);

  // Load ANEEL data on mount
  useEffect(() => {
    loadANEEL(false);
  }, []);

  const loadANEEL = useCallback(async (forceRefresh: boolean) => {
    setIsLoading(true);
    setApiError(null);
    try {
      const result = await fetchANEELTariffs(forceRefresh);
      if (result.distributors.length > 0) {
        setAneelDistributors(result.distributors);
        setLastFetched(result.fetchedAt);
        if (result.error) setApiError(result.error);
      } else {
        setApiError(result.error || 'Nenhum dado retornado da ANEEL');
      }
    } catch {
      setApiError('Erro ao buscar tarifas ANEEL');
    }
    setIsLoading(false);
  }, []);

  const handleRefresh = useCallback(async () => {
    clearCache();
    setIsLoading(true);
    setApiError(null);
    try {
      const result = await fetchANEELTariffs(true);
      if (result.distributors.length > 0) {
        setAneelDistributors(result.distributors);
        setLastFetched(result.fetchedAt);
        if (result.error) setApiError(result.error);
        // Re-apply fresh tariffs to currently-selected distributor, if any match
        const current = result.distributors.find(d => d.sigAgente === distributor.id);
        if (current) {
          setAneelSource(current);
          onChange(aneelToDistributor(current));
        }
      } else {
        setApiError(result.error || 'Nenhum dado retornado da ANEEL');
      }
    } catch {
      setApiError('Erro ao buscar tarifas ANEEL');
    }
    setIsLoading(false);
  }, [distributor.id, onChange]);

  // Filtered distributor list for search
  const filteredDistributors = useMemo(() => {
    if (!search.trim()) return aneelDistributors;
    const q = search.toLowerCase();
    return aneelDistributors.filter(
      d => d.sigAgente.toLowerCase().includes(q)
        || d.state.toLowerCase().includes(q)
    );
  }, [aneelDistributors, search]);

  // Select a distributor from ANEEL list
  const handleSelectANEEL = useCallback((aneel: ANEELDistributor) => {
    setAneelSource(aneel);
    const d = aneelToDistributor(aneel);
    onChange(d);
    setSearch('');
    setDropdownOpen(false);
  }, [onChange]);

  // Select from hardcoded fallback
  const handleSelectFallback = useCallback((d: Distributor) => {
    setAneelSource(null);
    onChange(computeDerivedTariffs(d));
    setDropdownOpen(false);
  }, [onChange]);

  // Update a tariff field
  const handleTariffChange = useCallback((field: keyof Distributor['tariffs'], value: number) => {
    const updated = {
      ...distributor,
      tariffs: { ...distributor.tariffs, [field]: value },
    };
    onChange(computeDerivedTariffs(updated));
  }, [distributor, onChange]);

  // Per-posto TUSD/TE split handler — edit TUSD and TE separately and recombine
  const handlePostoSplitChange = useCallback((posto: 'FP' | 'PT', part: 'TUSD' | 'TE', value: number) => {
    const combinedField = posto === 'FP' ? 'A_FP_TUSD_TE' : 'A_PT_TUSD_TE';
    const teField = posto === 'FP' ? 'A_TE_FP' : 'A_TE_PT';
    const curTE = distributor.tariffs[teField];
    const curCombined = distributor.tariffs[combinedField];
    const curTUSD = Math.max(0, curCombined - curTE);
    const newTE = part === 'TE' ? value : curTE;
    const newCombined = newTE + (part === 'TUSD' ? value : curTUSD);
    const updated = {
      ...distributor,
      tariffs: { ...distributor.tariffs, [teField]: newTE, [combinedField]: newCombined },
    };
    onChange(computeDerivedTariffs(updated));
  }, [distributor, onChange]);

  // Tax view toggle + markup input local state
  const [taxView, setTaxView] = useState<'sem' | 'com'>('sem');
  const [markupInput, setMarkupInput] = useState<string>(
    () => (distributor.tariffMarkupPct ? (distributor.tariffMarkupPct * 100).toFixed(2) : ''),
  );

  // Apply markup: multiply every sem-impostos tariff by (1 + X%)
  const handleApplyMarkup = useCallback(() => {
    const n = parseFloat(markupInput.replace(',', '.'));
    if (isNaN(n)) return;
    const r = 1 + n / 100;
    const base = distributor.tariffsBaseline ?? { ...distributor.tariffs };
    const tariffs: Distributor['tariffs'] = {
      ...base,
      B_TUSD: base.B_TUSD * r,
      B_TE: base.B_TE * r,
      A_FP_TUSD_TE: base.A_FP_TUSD_TE * r,
      A_PT_TUSD_TE: base.A_PT_TUSD_TE * r,
      A_TE_FP: base.A_TE_FP * r,
      A_TE_PT: base.A_TE_PT * r,
      A_RSV_TUSD_TE: base.A_RSV_TUSD_TE == null ? undefined : base.A_RSV_TUSD_TE * r,
      B_RSV_TUSD_TE: base.B_RSV_TUSD_TE == null ? undefined : base.B_RSV_TUSD_TE * r,
      A_FP_DEMANDA: base.A_FP_DEMANDA == null ? undefined : base.A_FP_DEMANDA * r,
    };
    onChange(computeDerivedTariffs({
      ...distributor,
      tariffs,
      tariffsBaseline: base,
      tariffMarkupPct: n / 100,
    }));
  }, [distributor, onChange, markupInput]);

  // Reset markup: restore baseline tariffs
  const handleResetMarkup = useCallback(() => {
    if (!distributor.tariffsBaseline) {
      setMarkupInput('');
      return;
    }
    setMarkupInput('');
    onChange(computeDerivedTariffs({
      ...distributor,
      tariffs: { ...distributor.tariffsBaseline },
      tariffsBaseline: undefined,
      tariffMarkupPct: undefined,
    }));
  }, [distributor, onChange]);

  // Gross-up sem-impostos value to all-in (com impostos)
  const grossUp = useCallback((value: number) => {
    const pisCofins = distributor.taxes.PIS + distributor.taxes.COFINS;
    const icms = distributor.taxes.ICMS;
    if (pisCofins >= 1 || icms >= 1) return value;
    return value / ((1 - pisCofins) * (1 - icms));
  }, [distributor.taxes]);

  // Update a tax field
  const handleTaxChange = useCallback((field: keyof Distributor['taxes'], value: number) => {
    const updated = {
      ...distributor,
      taxes: { ...distributor.taxes, [field]: value },
    };
    onChange(computeDerivedTariffs(updated));
  }, [distributor, onChange]);

  // Check if a tariff field was overridden from ANEEL source
  const isTariffOverridden = useCallback((field: keyof ANEELDistributor, currentValue: number) => {
    if (!aneelSource) return false;
    const sourceVal = aneelSource[field];
    if (typeof sourceVal !== 'number') return false;
    return Math.abs(sourceVal - currentValue) > 0.0001;
  }, [aneelSource]);

  // Defaults for tax fields
  const defaultICMS = ICMS_BY_STATE[distributor.state] ?? 0.25;
  const isICMSOverridden = Math.abs(distributor.taxes.ICMS - defaultICMS) > 0.0001;
  const isPISOverridden = Math.abs(distributor.taxes.PIS - DEFAULT_PIS) > 0.0001;
  const isCOFINSOverridden = Math.abs(distributor.taxes.COFINS - DEFAULT_COFINS) > 0.0001;

  const d = distributor;

  return (
    <div className="space-y-6">
      {/* API Error Banner */}
      {apiError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          {apiError}
        </div>
      )}

      {/* Distributor Selector */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Distribuidora</label>
        <div className="relative">
          <input
            type="text"
            value={dropdownOpen ? search : (d.name ? `${d.name} (${d.state})` : '')}
            onChange={e => {
              setSearch(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => {
              setDropdownOpen(true);
              setSearch('');
            }}
            placeholder={isLoading ? 'Carregando distribuidoras...' : 'Pesquisar distribuidora por nome ou estado...'}
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
                {filteredDistributors.length > 0 ? (
                  filteredDistributors.map(dd => (
                    <button
                      key={dd.sigAgente}
                      onClick={() => handleSelectANEEL(dd)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50 transition-colors flex items-center justify-between"
                    >
                      <span className="truncate">{dd.sigAgente}</span>
                      <span className="ml-2 text-xs text-slate-400 shrink-0">
                        {dd.state}
                      </span>
                    </button>
                  ))
                ) : aneelDistributors.length === 0 ? (
                  <>
                    <div className="px-3 py-2 text-xs text-slate-400">
                      Dados ANEEL indisponíveis — usando distribuidoras pré-cadastradas
                    </div>
                    {DISTRIBUTORS.map(dd => (
                      <button
                        key={dd.id}
                        onClick={() => handleSelectFallback(dd)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-teal-50 transition-colors"
                      >
                        {dd.name} ({dd.state})
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="px-3 py-3 text-xs text-slate-400 text-center">
                    Nenhuma distribuidora encontrada para "{search}"
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Refresh button + last fetched */}
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="text-xs text-teal-600 hover:text-teal-800 underline disabled:text-slate-400 disabled:no-underline"
          >
            {isLoading ? 'Carregando...' : 'Atualizar tarifas ANEEL'}
          </button>
          {lastFetched && (
            <span className="text-xs text-slate-400">
              Dados de {new Date(lastFetched).toLocaleDateString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </span>
          )}
        </div>
      </div>

      {/* Tariff Fields — por componente */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Tarifas por componente</h3>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setTaxView('sem')}
              className={`px-3 py-1.5 transition-colors ${taxView === 'sem' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Sem impostos (editar)
            </button>
            <button
              type="button"
              onClick={() => setTaxView('com')}
              className={`px-3 py-1.5 transition-colors border-l border-slate-300 ${taxView === 'com' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Com impostos (calculadas)
            </button>
          </div>
        </div>

        {/* Markup tarifário (sensibilidade) */}
        <div className="mb-4 rounded-lg border border-slate-200 bg-amber-50/40 p-3">
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs font-semibold text-slate-700">Markup tarifário (sensibilidade)</label>
            <div className="relative group">
              <span className="text-slate-400 cursor-help text-xs">?</span>
              <div className="absolute top-full left-0 mt-2 w-72 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                Multiplica todas as tarifas sem impostos (TUSD, TE, demanda) por (1 + X%) para simular um aumento (ou redução) homologado pela distribuidora. "Resetar" volta aos valores ANEEL/base. Não afeta tributos (ICMS/PIS/COFINS).
              </div>
            </div>
            {d.tariffMarkupPct != null && d.tariffMarkupPct !== 0 && (
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${d.tariffMarkupPct > 0 ? 'bg-amber-200 text-amber-900' : 'bg-blue-200 text-blue-900'}`}>
                {d.tariffMarkupPct > 0 ? '+' : ''}{(d.tariffMarkupPct * 100).toFixed(2)}% ativo
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.1"
                value={markupInput}
                onChange={e => setMarkupInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleApplyMarkup();
                  }
                }}
                placeholder="0,00"
                className="w-24 px-2 py-1 border border-slate-300 rounded text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <span className="text-xs text-slate-500">%</span>
            </div>
            <button
              type="button"
              onClick={handleApplyMarkup}
              className="px-3 py-1 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
            >
              Aplicar markup
            </button>
            <button
              type="button"
              onClick={handleResetMarkup}
              disabled={d.tariffsBaseline == null && (d.tariffMarkupPct ?? 0) === 0}
              className="px-3 py-1 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Resetar tarifas
            </button>
            <span className="text-[10px] text-slate-500 ml-2">
              Exemplo: 5 → aumenta TUSD+TE+demanda em 5% sobre a base
            </span>
          </div>
        </div>

        {taxView === 'sem' ? (
          <div className="space-y-5">
            <TariffGroup title="Grupo B (baixa tensão)">
              <CurrencyInput
                label="TUSD"
                prefix="R$/kWh"
                value={d.tariffs.B_TUSD}
                onChange={v => handleTariffChange('B_TUSD', v)}
                showOverride={isTariffOverridden('B_TUSD', d.tariffs.B_TUSD)}
              />
              <CurrencyInput
                label="TE"
                prefix="R$/kWh"
                value={d.tariffs.B_TE}
                onChange={v => handleTariffChange('B_TE', v)}
                showOverride={isTariffOverridden('B_TE', d.tariffs.B_TE)}
              />
            </TariffGroup>
            <TariffGroup title="Grupo A4 Verde — Fora Ponta">
              <CurrencyInput
                label="TUSD"
                prefix="R$/kWh"
                value={Math.max(0, d.tariffs.A_FP_TUSD_TE - d.tariffs.A_TE_FP)}
                onChange={v => handlePostoSplitChange('FP', 'TUSD', v)}
              />
              <CurrencyInput
                label="TE"
                prefix="R$/kWh"
                value={d.tariffs.A_TE_FP}
                onChange={v => handlePostoSplitChange('FP', 'TE', v)}
                showOverride={isTariffOverridden('A_TE_FP', d.tariffs.A_TE_FP)}
              />
            </TariffGroup>
            <TariffGroup title="Grupo A4 Verde — Ponta">
              <CurrencyInput
                label="TUSD"
                prefix="R$/kWh"
                value={Math.max(0, d.tariffs.A_PT_TUSD_TE - d.tariffs.A_TE_PT)}
                onChange={v => handlePostoSplitChange('PT', 'TUSD', v)}
              />
              <CurrencyInput
                label="TE"
                prefix="R$/kWh"
                value={d.tariffs.A_TE_PT}
                onChange={v => handlePostoSplitChange('PT', 'TE', v)}
                showOverride={isTariffOverridden('A_TE_PT', d.tariffs.A_TE_PT)}
              />
            </TariffGroup>
            <TariffGroup title="Demanda Grupo A Verde">
              <CurrencyInput
                label="R$/kW/mês"
                prefix="R$/kW"
                value={d.tariffs.A_FP_DEMANDA ?? 0}
                onChange={v => handleTariffChange('A_FP_DEMANDA', v)}
              />
              <div />
            </TariffGroup>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 italic mb-2">
              Tarifas all-in (TE_sem ou TUSD_sem) ÷ ((1 − PIS − COFINS) × (1 − ICMS)). Edite na aba "Sem impostos" para ajustar.
            </p>
            <ComputedTariffRow
              group="Grupo B"
              tusd={d.tariffs.B_TUSD}
              te={d.tariffs.B_TE}
              grossUp={grossUp}
            />
            <ComputedTariffRow
              group="A4 Verde Fora Ponta"
              tusd={Math.max(0, d.tariffs.A_FP_TUSD_TE - d.tariffs.A_TE_FP)}
              te={d.tariffs.A_TE_FP}
              grossUp={grossUp}
            />
            <ComputedTariffRow
              group="A4 Verde Ponta"
              tusd={Math.max(0, d.tariffs.A_PT_TUSD_TE - d.tariffs.A_TE_PT)}
              te={d.tariffs.A_TE_PT}
              grossUp={grossUp}
            />
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700 mb-2">Demanda Grupo A Verde</div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-slate-500">Sem impostos</div>
                  <div className="font-mono font-semibold text-slate-700">R$ {(d.tariffs.A_FP_DEMANDA ?? 0).toFixed(4)}/kW</div>
                </div>
                <div>
                  <div className="text-slate-500">Com impostos (all-in)</div>
                  <div className="font-mono font-semibold text-slate-900">R$ {grossUp(d.tariffs.A_FP_DEMANDA ?? 0).toFixed(4)}/kW</div>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mt-2">
              <div className="text-xs font-semibold text-slate-600 mb-2">FA — Fator de Ajuste (TE_FP / TE_PT)</div>
              <div className="font-mono font-bold text-slate-800">
                {d.FA != null && d.FA > 0 ? d.FA.toFixed(4) : '—'}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Horário reservado — rural irrigante/aquicultor
            </h4>
            <div className="relative group">
              <span className="text-slate-400 cursor-help text-xs">?</span>
              <div className="absolute bottom-full left-0 mb-2 w-80 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                REN 1000 Art. 186. Reservado = posto Fora Ponta com desconto. Centro-Oeste:
                80% Grupo A → tarifa RSV = FP × 0,20. 67% Grupo B → tarifa RSV = B × 0,33.
                Deixe zerado se a UC não for irrigante/aquicultor.
              </div>
            </div>
            {(() => {
              const disc = getRuralIrriganteDiscount(distributor.state);
              if (!disc) return null;
              return (
                <button
                  type="button"
                  onClick={() => {
                    const rsv = computeReservadoTariffs(
                      distributor.tariffs.A_FP_TUSD_TE,
                      distributor.tariffs.B_TUSD + distributor.tariffs.B_TE,
                      distributor.state,
                    );
                    if (!rsv) return;
                    const updated = {
                      ...distributor,
                      tariffs: { ...distributor.tariffs, ...rsv },
                    };
                    onChange(computeDerivedTariffs(updated));
                  }}
                  className="ml-auto text-xs text-teal-600 hover:text-teal-700 underline"
                >
                  Preencher com desconto {distributor.state} ({(disc.grupoA * 100).toFixed(0)}% A / {(disc.grupoB * 100).toFixed(0)}% B)
                </button>
              );
            })()}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <CurrencyInput
              label="Grupo A Reservado (TUSD+TE)"
              prefix="R$/kWh"
              value={d.tariffs.A_RSV_TUSD_TE ?? 0}
              onChange={v => handleTariffChange('A_RSV_TUSD_TE', v)}
            />
            <CurrencyInput
              label="Grupo B Reservado (TUSD+TE)"
              prefix="R$/kWh"
              value={d.tariffs.B_RSV_TUSD_TE ?? 0}
              onChange={v => handleTariffChange('B_RSV_TUSD_TE', v)}
            />
          </div>
        </div>
      </div>

      {/* Tax Fields */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Tributos</h3>
        <div className="grid grid-cols-3 gap-4">
          {/* ICMS */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-slate-700">ICMS (%)</label>
              {isICMSOverridden && (
                <span className="inline-block w-2 h-2 rounded-full bg-orange-400" title="Modificado do padrão estadual" />
              )}
              <div className="relative group">
                <span className="text-slate-400 cursor-help text-xs">?</span>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                  ICMS é imposto estadual. O padrão é para o estado da distribuidora selecionada. Altere se o cliente tem alíquota diferente (ex: rural/agro).
                </div>
              </div>
            </div>
            <input
              type="number"
              step="0.01"
              value={(d.taxes.ICMS * 100).toFixed(2)}
              onChange={e => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) handleTaxChange('ICMS', val / 100);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {isICMSOverridden && (
              <button
                onClick={() => handleTaxChange('ICMS', defaultICMS)}
                className="text-xs text-teal-600 hover:text-teal-800 underline mt-1"
              >
                Resetar para {(defaultICMS * 100).toFixed(0)}% ({d.state})
              </button>
            )}
          </div>

          {/* PIS */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-slate-700">PIS (%)</label>
              {isPISOverridden && (
                <span className="inline-block w-2 h-2 rounded-full bg-orange-400" title="Modificado do padrão federal" />
              )}
              <div className="relative group">
                <span className="text-slate-400 cursor-help text-xs">?</span>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                  Tributo federal. Padrão 1,53%. Altere apenas se o cliente opera em regime tributário diferente (ex: Simples Nacional).
                </div>
              </div>
            </div>
            <input
              type="number"
              step="0.001"
              value={(d.taxes.PIS * 100).toFixed(3)}
              onChange={e => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) handleTaxChange('PIS', val / 100);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {isPISOverridden && (
              <button
                onClick={() => handleTaxChange('PIS', DEFAULT_PIS)}
                className="text-xs text-teal-600 hover:text-teal-800 underline mt-1"
              >
                Resetar para {(DEFAULT_PIS * 100).toFixed(2)}%
              </button>
            )}
          </div>

          {/* COFINS */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label className="text-sm font-medium text-slate-700">COFINS (%)</label>
              {isCOFINSOverridden && (
                <span className="inline-block w-2 h-2 rounded-full bg-orange-400" title="Modificado do padrão federal" />
              )}
              <div className="relative group">
                <span className="text-slate-400 cursor-help text-xs">?</span>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                  Tributo federal. Padrão 7,03%. Altere apenas se o cliente opera em regime tributário diferente (ex: Simples Nacional).
                </div>
              </div>
            </div>
            <input
              type="number"
              step="0.001"
              value={(d.taxes.COFINS * 100).toFixed(3)}
              onChange={e => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) handleTaxChange('COFINS', val / 100);
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {isCOFINSOverridden && (
              <button
                onClick={() => handleTaxChange('COFINS', DEFAULT_COFINS)}
                className="text-xs text-teal-600 hover:text-teal-800 underline mt-1"
              >
                Resetar para {(DEFAULT_COFINS * 100).toFixed(2)}%
              </button>
            )}
          </div>
        </div>

        {/* ICMS scope — TE+TUSD vs TE only (state-driven) */}
        <div className="mt-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <label className="text-sm font-medium text-slate-700">Escopo da isenção de ICMS</label>
            <div className="relative group">
              <span className="text-slate-400 cursor-help text-xs">?</span>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                Define se a isenção de ICMS sobre kWh compensado pela GD cobre só a parcela TE (energia) ou TE+TUSD. Pós-LC 194/2022, vários estados (PR/SC/RS/SP) isentam só TE → o ICMS sobre TUSD-Fio B continua sendo cobrado sobre o kWh compensado. Aplica-se quando "Isencao ICMS ativa" está ligada nos Cenários.
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {([
              { v: 'TE_TUSD', label: 'TE + TUSD (total)', desc: 'Isenção cobre tarifa completa — sem leak de ICMS' },
              { v: 'TE_ONLY', label: 'TE apenas (parcial)', desc: 'TUSD-Fio B segue tributado sobre kWh compensado' },
              { v: 'NONE', label: 'Sem isenção', desc: 'ICMS cobrado sobre TE + TUSD do kWh compensado' },
            ] as const).map(opt => {
              const active = (d.taxes.icmsScope ?? 'TE_TUSD') === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => onChange(computeDerivedTariffs({
                    ...distributor,
                    taxes: { ...distributor.taxes, icmsScope: opt.v },
                  }))}
                  className={`flex-1 text-left px-3 py-2 rounded-lg border text-xs transition-colors ${active ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-[10px] opacity-75 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* PIS/COFINS isenção (federal, per-client) */}
        <div className="mt-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <label className="text-sm font-medium text-slate-700">Isenção de PIS/COFINS sobre kWh compensado</label>
            <div className="relative group">
              <span className="text-slate-400 cursor-help text-xs">?</span>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30">
                Federal — STJ Tema 986 / Lei 13.169/2015. Maioria dos clientes consegue (ação judicial ou regime), mas caso-a-caso. Desligue se o cliente não tem isenção: PIS+COFINS continuará sendo cobrado sobre o kWh compensado.
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {([
              { v: true, label: 'Isenta (padrão)', desc: 'STJ Tema 986 — não cobra PIS/COFINS sobre compensação' },
              { v: false, label: 'Não isenta', desc: 'Cliente paga PIS+COFINS sobre kWh compensado (leak)' },
            ] as const).map(opt => {
              const active = (d.taxes.pisCofinsExempt ?? true) === opt.v;
              return (
                <button
                  key={String(opt.v)}
                  type="button"
                  onClick={() => onChange(computeDerivedTariffs({
                    ...distributor,
                    taxes: { ...distributor.taxes, pisCofinsExempt: opt.v },
                  }))}
                  className={`flex-1 text-left px-3 py-2 rounded-lg border text-xs transition-colors ${active ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'}`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-[10px] opacity-75 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TariffGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold text-slate-700 mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function ComputedTariffRow({
  group,
  tusd,
  te,
  grossUp,
}: {
  group: string;
  tusd: number;
  te: number;
  grossUp: (value: number) => number;
}) {
  const teCom = grossUp(te);
  const tusdCom = grossUp(tusd);
  const semTotal = tusd + te;
  const comTotal = teCom + tusdCom;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold text-slate-700 mb-2">{group}</div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <div className="text-slate-500 mb-1">TUSD</div>
          <div className="font-mono text-slate-600">Sem: R$ {tusd.toFixed(4)}</div>
          <div className="font-mono font-semibold text-slate-900">Com: R$ {tusdCom.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-slate-500 mb-1">TE</div>
          <div className="font-mono text-slate-600">Sem: R$ {te.toFixed(4)}</div>
          <div className="font-mono font-semibold text-slate-900">Com: R$ {teCom.toFixed(4)}</div>
        </div>
        <div className="border-l border-slate-200 pl-3">
          <div className="text-slate-500 mb-1">TUSD + TE</div>
          <div className="font-mono text-slate-600">Sem: R$ {semTotal.toFixed(4)}</div>
          <div className="font-mono font-bold text-teal-700">Com: R$ {comTotal.toFixed(4)}</div>
        </div>
      </div>
    </div>
  );
}
