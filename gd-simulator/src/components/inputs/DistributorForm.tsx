import { useState, useEffect, useMemo, useCallback } from 'react';
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

  const handleRefresh = useCallback(() => {
    clearCache();
    loadANEEL(true);
  }, [loadANEEL]);

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

      {/* Tariff Fields — Sem tributos */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Tarifas sem tributos (R$/kWh)</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <CurrencyInput
            label="TUSD Grupo B"
            prefix="R$/kWh"
            value={d.tariffs.B_TUSD}
            onChange={v => handleTariffChange('B_TUSD', v)}
            showOverride={isTariffOverridden('B_TUSD', d.tariffs.B_TUSD)}
          />
          <CurrencyInput
            label="TE Grupo B"
            prefix="R$/kWh"
            value={d.tariffs.B_TE}
            onChange={v => handleTariffChange('B_TE', v)}
            showOverride={isTariffOverridden('B_TE', d.tariffs.B_TE)}
          />
          <CurrencyInput
            label="A4 Verde FP (TUSD+TE)"
            prefix="R$/kWh"
            value={d.tariffs.A_FP_TUSD_TE}
            onChange={v => handleTariffChange('A_FP_TUSD_TE', v)}
            showOverride={isTariffOverridden('A_FP_TUSD_TE', d.tariffs.A_FP_TUSD_TE)}
          />
          <CurrencyInput
            label="A4 Verde Ponta (TUSD+TE)"
            prefix="R$/kWh"
            value={d.tariffs.A_PT_TUSD_TE}
            onChange={v => handleTariffChange('A_PT_TUSD_TE', v)}
            showOverride={isTariffOverridden('A_PT_TUSD_TE', d.tariffs.A_PT_TUSD_TE)}
          />
          <CurrencyInput
            label="TE Fora Ponta (para FA)"
            prefix="R$/kWh"
            value={d.tariffs.A_TE_FP}
            onChange={v => handleTariffChange('A_TE_FP', v)}
            showOverride={isTariffOverridden('A_TE_FP', d.tariffs.A_TE_FP)}
          />
          <CurrencyInput
            label="TE Ponta (para FA)"
            prefix="R$/kWh"
            value={d.tariffs.A_TE_PT}
            onChange={v => handleTariffChange('A_TE_PT', v)}
            showOverride={isTariffOverridden('A_TE_PT', d.tariffs.A_TE_PT)}
          />
        </div>

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
      </div>

      {/* Computed values — read-only summary */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Tarifas com tributos (calculadas)
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <span className="block text-xs text-slate-500 mb-1">T_B3 (Grupo B)</span>
            <p className="text-lg font-mono font-bold text-slate-800">
              {d.T_B3 != null && d.T_B3 > 0 ? `R$ ${d.T_B3.toFixed(4)}` : '—'}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <span className="block text-xs text-slate-500 mb-1">T_AFP (A Fora Ponta)</span>
            <p className="text-lg font-mono font-bold text-slate-800">
              {d.T_AFP != null && d.T_AFP > 0 ? `R$ ${d.T_AFP.toFixed(4)}` : '—'}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <span className="block text-xs text-slate-500 mb-1">T_APT (A Ponta)</span>
            <p className="text-lg font-mono font-bold text-slate-800">
              {d.T_APT != null && d.T_APT > 0 ? `R$ ${d.T_APT.toFixed(4)}` : '—'}
            </p>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-3">
            <span className="block text-xs text-slate-500 mb-1">FA (Fator de Ajuste)</span>
            <p className="text-lg font-mono font-bold text-slate-800">
              {d.FA != null && d.FA > 0 ? d.FA.toFixed(4) : '—'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
