import { useState, useMemo, useEffect, useRef } from 'react';
import type { Plant, Project } from '../../engine/types';
import { CurrencyInput } from '../shared/CurrencyInput';
import { Toggle } from '../shared/Toggle';
import {
  HELEXIA_PLANTS,
  getPlantsByDistribuidora,
  build24MonthProfile,
} from '../../data/helexiaPlants';
import type { HelexiaPlant } from '../../data/helexiaPlants';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  plant: Plant;
  onChange: (p: Plant) => void;
  generationSource?: Project['generationSource'];
  helexiaPlantCode?: string;
  degradationPct?: number;
  lossPct?: number;
  onProjectFieldChange?: (updates: Partial<Pick<Project, 'generationSource' | 'helexiaPlantCode' | 'degradationPct' | 'lossPct'>>) => void;
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function formatKWh(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

export function PlantForm({
  plant,
  onChange,
  generationSource = 'manual',
  helexiaPlantCode,
  degradationPct = 0.5,
  lossPct = 0,
  onProjectFieldChange,
}: Props) {
  const update = (field: keyof Plant, value: unknown) => {
    onChange({ ...plant, [field]: value });
  };

  // Debounce degradation/loss changes (400ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedProjectFieldChange = (updates: Partial<Pick<Project, 'degradationPct' | 'lossPct'>>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onProjectFieldChange?.(updates);
    }, 400);
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pendingPlant, setPendingPlant] = useState<HelexiaPlant | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedHelexiaPlant = useMemo(() => {
    if (!helexiaPlantCode) return null;
    return HELEXIA_PLANTS.find(p => p.codigo === helexiaPlantCode) ?? null;
  }, [helexiaPlantCode]);

  const plantsByDist = useMemo(() => getPlantsByDistribuidora(), []);

  const filteredPlants = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return plantsByDist;
    const result = new Map<string, HelexiaPlant[]>();
    for (const [dist, plants] of plantsByDist) {
      const filtered = plants.filter(p =>
        p.codigo.toLowerCase().includes(q) ||
        p.nome.toLowerCase().includes(q) ||
        p.distribuidora.toLowerCase().includes(q) ||
        p.cliente.toLowerCase().includes(q)
      );
      if (filtered.length > 0) result.set(dist, filtered);
    }
    return result;
  }, [searchQuery, plantsByDist]);

  // Build 24-month profile when selection or params change
  const profile24 = useMemo(() => {
    if (!selectedHelexiaPlant || !plant.contractStartMonth) return null;
    return build24MonthProfile(
      selectedHelexiaPlant,
      plant.contractStartMonth,
      (degradationPct ?? 0.5) / 100,
      (lossPct ?? 0) / 100,
    );
  }, [selectedHelexiaPlant, plant.contractStartMonth, degradationPct, lossPct]);

  // Auto-fill plant when helexia selection changes
  useEffect(() => {
    if (generationSource !== 'helexia_plant' || !selectedHelexiaPlant || !profile24) return;
    onChange({
      ...plant,
      name: `[${selectedHelexiaPlant.codigo}] ${selectedHelexiaPlant.nome}`,
      capacityKWac: selectedHelexiaPlant.potenciaAC,
      p50Profile: profile24,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHelexiaPlant?.codigo, profile24, generationSource]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectPlant = (p: HelexiaPlant) => {
    if (p.cliente && p.cliente !== 'SEM CLIENTE') {
      setPendingPlant(p);
    } else {
      confirmSelectPlant(p);
    }
    setIsDropdownOpen(false);
    setSearchQuery('');
  };

  const confirmSelectPlant = (p: HelexiaPlant) => {
    if (p.cliente && p.cliente !== 'SEM CLIENTE') {
      console.warn('[PlantSelector] Selected contracted plant:', p.codigo, p.nome, p.cliente);
    }
    onProjectFieldChange?.({ helexiaPlantCode: p.codigo });
    setPendingPlant(null);
  };

  const chartData = useMemo(() => {
    if (!profile24 || !plant.contractStartMonth) return [];
    const [yearStr, monthStr] = plant.contractStartMonth.split('-');
    const startYear = parseInt(yearStr, 10);
    const startMonth = parseInt(monthStr, 10) - 1;
    return profile24.map((val, i) => {
      const mIdx = (startMonth + i) % 12;
      const yr = startYear + Math.floor((startMonth + i) / 12);
      return {
        name: `${MONTH_LABELS[mIdx]}/${String(yr).slice(2)}`,
        kWh: val,
      };
    });
  }, [profile24, plant.contractStartMonth]);

  return (
    <div className="space-y-4">
      {/* Source toggle */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Fonte de Geracao</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="genSource"
              checked={generationSource === 'manual'}
              onChange={() => onProjectFieldChange?.({ generationSource: 'manual' })}
              className="accent-teal-600"
            />
            <span className="text-sm text-slate-700">Manual</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="genSource"
              checked={generationSource === 'helexia_plant'}
              onChange={() => onProjectFieldChange?.({ generationSource: 'helexia_plant' })}
              className="accent-teal-600"
            />
            <span className="text-sm text-slate-700">Usina Helexia</span>
          </label>
        </div>
      </div>

      {/* Common fields: PPA rate and contract start */}
      <div className="grid grid-cols-2 gap-3">
        <CurrencyInput
          label="PPA Rate (R$/kWh)"
          prefix="R$"
          value={plant.ppaRateRsBRLkWh}
          onChange={v => update('ppaRateRsBRLkWh', v)}
        />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Inicio do Contrato</label>
          <input
            type="month"
            value={plant.contractStartMonth}
            onChange={e => update('contractStartMonth', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
      </div>

      {generationSource === 'helexia_plant' ? (
        <div className="space-y-4">
          {/* Plant selector */}
          <div ref={dropdownRef} className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-1">Selecionar Usina</label>
            <input
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              placeholder="Buscar por codigo, nome, distribuidora..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            />
            {isDropdownOpen && (
              <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-lg">
                {filteredPlants.size === 0 ? (
                  <div className="px-3 py-2 text-sm text-slate-400">Nenhuma usina encontrada</div>
                ) : (
                  Array.from(filteredPlants.entries()).map(([dist, plants]) => (
                    <div key={dist}>
                      <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 bg-slate-50 sticky top-0">
                        {dist}
                      </div>
                      {plants.map(p => {
                        const isAvailable = p.cliente === 'SEM CLIENTE';
                        const isSelected = p.codigo === helexiaPlantCode;
                        return (
                          <button
                            key={p.codigo}
                            onClick={() => handleSelectPlant(p)}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${
                              isSelected ? 'bg-teal-50' : ''
                            }`}
                          >
                            <span
                              className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                                isAvailable ? 'bg-green-500' : 'bg-slate-400'
                              }`}
                            />
                            <span className="truncate">
                              <span className="font-mono font-medium">[{p.codigo}]</span>{' '}
                              {p.nome} — {p.distribuidora} — {p.potenciaAC.toLocaleString('pt-BR')} kWac
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Selected plant info card */}
          {selectedHelexiaPlant && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-800">
                  [{selectedHelexiaPlant.codigo}] {selectedHelexiaPlant.nome}
                </h4>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    selectedHelexiaPlant.cliente === 'SEM CLIENTE'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {selectedHelexiaPlant.cliente === 'SEM CLIENTE' ? 'Disponivel' : selectedHelexiaPlant.cliente}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3 text-xs text-slate-600">
                <div>
                  <span className="block text-slate-400">Distribuidora</span>
                  <span className="font-medium">{selectedHelexiaPlant.distribuidora}</span>
                </div>
                <div>
                  <span className="block text-slate-400">Potencia AC</span>
                  <span className="font-medium">{selectedHelexiaPlant.potenciaAC.toLocaleString('pt-BR')} kW</span>
                </div>
                <div>
                  <span className="block text-slate-400">Potencia DC</span>
                  <span className="font-medium">{selectedHelexiaPlant.potenciaDC.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kWp</span>
                </div>
                <div>
                  <span className="block text-slate-400">Geracao Anual P50</span>
                  <span className="font-medium">{selectedHelexiaPlant.geracaoAnualP50.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MWh</span>
                </div>
              </div>
              <div className="text-xs text-slate-500">
                Ano de exposicao solar: {selectedHelexiaPlant.anoExposicaoSolar} | Ano de geracao: {selectedHelexiaPlant.anoGeracao}
              </div>
            </div>
          )}

          {/* Contracted plant warning banner */}
          {selectedHelexiaPlant && selectedHelexiaPlant.cliente !== 'SEM CLIENTE' && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex items-start gap-2">
              <span className="text-orange-500 text-lg leading-none">!</span>
              <p className="text-xs text-orange-700">
                Usina contratada com <strong>{selectedHelexiaPlant.cliente}</strong> — confirme disponibilidade com o time comercial antes de enviar proposta ao cliente.
              </p>
            </div>
          )}

          {/* Confirmation modal for contracted plants */}
          {pendingPlant && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
              <div className="bg-white rounded-xl p-6 shadow-xl max-w-md mx-4">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Usina com cliente ativo</h3>
                <p className="text-sm text-slate-600 mb-4">
                  A usina <strong>{pendingPlant.codigo} — {pendingPlant.nome}</strong> esta atualmente contratada com <strong>{pendingPlant.cliente}</strong>.
                </p>
                <p className="text-sm text-slate-500 mb-6">
                  Verifique a disponibilidade com o time comercial antes de incluir esta usina numa proposta.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setPendingPlant(null)}
                    className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => confirmSelectPlant(pendingPlant)}
                    className="px-4 py-2 text-sm text-white rounded-lg"
                    style={{ backgroundColor: '#004B70' }}
                  >
                    Continuar mesmo assim
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Degradation and loss inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Degradacao anual (%)
              </label>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={degradationPct}
                onChange={e => debouncedProjectFieldChange({ degradationPct: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <p className="text-xs text-slate-400 mt-0.5">Padrao: 0.5% a.a.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Perdas adicionais (%)
              </label>
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={lossPct}
                onChange={e => debouncedProjectFieldChange({ lossPct: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
              <p className="text-xs text-slate-400 mt-0.5">Padrao: 0%</p>
            </div>
          </div>

          {/* 24-month profile chart */}
          {profile24 && chartData.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Perfil de Geracao 24 meses (kWh/mes)
              </label>
              <div className="bg-white border border-slate-200 rounded-lg p-3">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value) => [formatKWh(value as number) + ' kWh', 'Geracao']}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Bar dataKey="kWh" fill="#004B70" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex justify-between text-xs text-slate-500 mt-2 px-1">
                  <span>Total 24m: {formatKWh(profile24.reduce((a, b) => a + b, 0))} kWh</span>
                  <span>Media mensal: {formatKWh(profile24.reduce((a, b) => a + b, 0) / 24)} kWh</span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Manual mode - original fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Planta</label>
              <input
                value={plant.name}
                onChange={e => update('name', e.target.value)}
                placeholder="Ex: CS3 Cassilandia"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Capacidade (kWac)</label>
              <input
                type="number"
                value={plant.capacityKWac}
                onChange={e => update('capacityKWac', parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <Toggle
            checked={plant.useActual}
            onChange={v => update('useActual', v)}
            label="Usar geracao real medida"
            description="Alternar entre P50 (PVsyst) e dados reais"
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Perfil de Geracao P50 (kWh/mes) — 24 meses
            </label>
            <div className="grid grid-cols-6 gap-2">
              {plant.p50Profile.map((val, i) => (
                <input
                  key={i}
                  type="number"
                  value={val}
                  onChange={e => {
                    const newProfile = [...plant.p50Profile];
                    newProfile[i] = parseFloat(e.target.value) || 0;
                    update('p50Profile', newProfile);
                  }}
                  placeholder={`M${i + 1}`}
                  className="px-2 py-1 border border-slate-300 rounded text-xs font-mono text-center"
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
