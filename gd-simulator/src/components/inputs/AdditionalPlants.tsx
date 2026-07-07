import { useMemo } from 'react';
import type { Plant } from '../../engine/types';
import { CurrencyInput } from '../shared/CurrencyInput';
import { HELEXIA_PLANTS, build24MonthProfile } from '../../data/helexiaPlants';
import type { HelexiaPlant } from '../../data/helexiaPlants';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  primary: Plant;
  additionalPlants: Plant[];
  onChange: (plants: Plant[]) => void;
  distributorId?: string;
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function monthLabel(startMonth: string | undefined, idx: number): string {
  if (!startMonth) return `M${idx + 1}`;
  const [y, mo] = startMonth.split('-').map(Number);
  if (!y || !mo) return `M${idx + 1}`;
  const d = new Date(y, mo - 1 + idx, 1);
  return `${MONTH_LABELS[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

// Build a generation profile of `months` length from a Helexia plant, cycling
// the 24-month base pattern if the contract is longer.
function buildProfileForMonths(hp: HelexiaPlant, startMonth: string, months: number): number[] {
  const base = build24MonthProfile(hp, startMonth);
  const arr = base.slice(0, months);
  while (arr.length < months) arr.push(base[arr.length % 24] ?? 0);
  return arr;
}

// Construct a Plant from a Helexia plant selection.
function plantFromHelexia(hp: HelexiaPlant, startMonth: string, months: number, ppaRate: number): Plant {
  return {
    id: `${hp.codigo}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${hp.codigo} ${hp.nome}`,
    capacityKWac: hp.potenciaAC,
    distributor: hp.distribuidora || '',
    p50Profile: buildProfileForMonths(hp, startMonth, months),
    useActual: false,
    ppaRateRsBRLkWh: ppaRate,
    contractStartMonth: startMonth,
    contractMonths: months,
  };
}

export function AdditionalPlants({ primary, additionalPlants: plants, onChange, distributorId }: Props) {
  // ALL Helexia plants are selectable (portfolio rotation). Those in the same
  // distribuidora as the project are surfaced first (autoconsumo remoto is only
  // physically valid within the same concession); every other plant follows in a
  // second group so nothing is blocked.
  const { sameDistPlants, otherPlants } = useMemo(() => {
    const d = (distributorId || '').toUpperCase();
    const matches = (p: HelexiaPlant) => {
      const dist = (p.distribuidora || '').toUpperCase();
      return !!d && !!dist && (d.includes(dist) || dist.includes(d));
    };
    if (!d) return { sameDistPlants: HELEXIA_PLANTS, otherPlants: [] as HelexiaPlant[] };
    return {
      sameDistPlants: HELEXIA_PLANTS.filter(matches),
      otherPlants: HELEXIA_PLANTS.filter(p => !matches(p)),
    };
  }, [distributorId]);
  const options = useMemo(() => [...sameDistPlants, ...otherPlants], [sameDistPlants, otherPlants]);

  const addPlant = () => {
    const used = new Set([primary.name, ...plants.map(p => p.name)]);
    const next = options.find(o => !used.has(`${o.codigo} ${o.nome}`)) ?? options[0];
    if (!next) return;
    onChange([...plants, plantFromHelexia(next, primary.contractStartMonth, primary.contractMonths, primary.ppaRateRsBRLkWh)]);
  };

  const removePlant = (idx: number) => onChange(plants.filter((_, i) => i !== idx));

  // Switch a card to a different Helexia plant (keeps its PPA rate).
  const selectHelexia = (idx: number, codigo: string) => {
    const hp = HELEXIA_PLANTS.find(p => p.codigo === codigo);
    if (!hp) return;
    const cur = plants[idx];
    const rebuilt = plantFromHelexia(
      hp,
      cur.contractStartMonth || primary.contractStartMonth,
      cur.contractMonths || primary.contractMonths,
      cur.ppaRateRsBRLkWh,
    );
    const next = [...plants];
    next[idx] = rebuilt;
    onChange(next);
  };

  const setField = (idx: number, field: keyof Plant, value: unknown) => {
    const next = [...plants];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  };

  const totalMWh = (primary.p50Profile.reduce((a, b) => a + b, 0)
    + plants.reduce((a, p) => a + p.p50Profile.reduce((x, y) => x + y, 0), 0)) / 1000;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">Usinas adicionais</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Outras usinas Helexia injetando créditos no mesmo cliente. Contratos compartilham a data de início da usina principal; PPA e prazo podem ser ajustados por usina.
          </p>
        </div>
        <button
          type="button"
          onClick={addPlant}
          className="px-3 py-1.5 text-xs text-white rounded-lg font-medium"
          style={{ backgroundColor: '#004B70' }}
        >
          + Adicionar usina
        </button>
      </div>

      {plants.length === 0 ? (
        <p className="text-xs text-slate-400 italic">
          Nenhuma usina adicional. Use o botão acima para acrescentar (ex: HAP03 ao lado do HAP02).
        </p>
      ) : (
        <div className="space-y-3">
          {plants.map((p, n) => {
            const codigo = HELEXIA_PLANTS.find(h => p.name.startsWith(h.codigo))?.codigo ?? '';
            const totalKWh = Math.round(p.p50Profile.reduce((a, b) => a + b, 0));
            const chartData = p.p50Profile.map((kWh, i) => ({
              label: monthLabel(p.contractStartMonth || primary.contractStartMonth, i),
              kWh,
            }));
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs font-medium text-slate-500">Usina #{n + 2}</span>
                  <select
                    value={codigo}
                    onChange={e => selectHelexia(n, e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="">— escolher usina Helexia —</option>
                    {sameDistPlants.length > 0 && (
                      <optgroup label={distributorId ? `Mesma distribuidora (${distributorId})` : 'Todas as usinas'}>
                        {sameDistPlants.map(o => (
                          <option key={o.codigo} value={o.codigo}>{o.codigo} · {o.nome} ({o.potenciaAC} kWac)</option>
                        ))}
                      </optgroup>
                    )}
                    {otherPlants.length > 0 && (
                      <optgroup label="Outras distribuidoras — compensação exige mesma concessão">
                        {otherPlants.map(o => (
                          <option key={o.codigo} value={o.codigo}>{o.codigo} · {o.nome} ({o.potenciaAC} kWac) · {o.distribuidora}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => removePlant(n)}
                    className="text-xs text-red-600 hover:text-red-700 px-2 py-1 hover:bg-red-50 rounded"
                  >
                    Remover
                  </button>
                </div>

                <div className="grid grid-cols-6 gap-2 text-xs">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Nome</label>
                    <input
                      type="text"
                      value={p.name}
                      onChange={e => setField(n, 'name', e.target.value)}
                      className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Capacidade (kWac)</label>
                    <input
                      type="number"
                      value={p.capacityKWac}
                      onChange={e => setField(n, 'capacityKWac', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white font-mono text-right"
                    />
                  </div>
                  <CurrencyInput
                    label="PPA"
                    prefix="R$/kWh"
                    value={p.ppaRateRsBRLkWh}
                    onChange={v => setField(n, 'ppaRateRsBRLkWh', v)}
                  />
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Taxa interm. (%)</label>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={100}
                      value={((p.intermediationFeePct ?? 0) * 100).toFixed(2)}
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        setField(n, 'intermediationFeePct', isNaN(v) ? 0 : Math.max(0, Math.min(1, v / 100)));
                      }}
                      className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white font-mono text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Prazo PPA (meses)</label>
                    <input
                      type="number"
                      min={1}
                      max={240}
                      value={p.contractMonths}
                      onChange={e => setField(n, 'contractMonths', Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white font-mono text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-0.5">Início (entra em op.)</label>
                    <input
                      type="month"
                      value={p.contractStartMonth || primary.contractStartMonth}
                      min={primary.contractStartMonth || undefined}
                      onChange={e => setField(n, 'contractStartMonth', e.target.value)}
                      className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white"
                      title="Mês de entrada em operação. Igual à usina principal = entra junto; posterior = entra depois (offset)."
                    />
                  </div>
                </div>

                <div className="mt-2 bg-white rounded border border-slate-200 p-2">
                  <div className="text-[10px] font-semibold text-slate-600 mb-1">Perfil P50 mensal (kWh) — {p.contractMonths} meses</div>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                      <YAxis stroke="#94a3b8" tick={{ fontSize: 9 }} tickFormatter={v => Number(v) >= 1000 ? `${(Number(v) / 1000).toFixed(0)}k` : `${v}`} />
                      <Tooltip formatter={value => `${Math.round(value as number).toLocaleString('pt-BR')} kWh`} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                      <Bar dataKey="kWh" fill="#2F927B" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-2 bg-white rounded border border-slate-200 p-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-slate-600">Perfil de Geração P50 (kWh/mês) — {p.contractMonths} meses</span>
                    <span className="text-[10px] text-slate-400">edite as células para ajustar</span>
                  </div>
                  <div className="grid grid-cols-6 gap-1.5">
                    {p.p50Profile.map((v, i) => (
                      <div key={i} className="flex flex-col">
                        <span className="text-[9px] text-slate-400 text-center mb-0.5">{monthLabel(p.contractStartMonth || primary.contractStartMonth, i)}</span>
                        <input
                          type="number"
                          value={v}
                          onChange={e => {
                            const arr = [...p.p50Profile];
                            arr[i] = parseFloat(e.target.value) || 0;
                            setField(n, 'p50Profile', arr);
                          }}
                          className="px-1.5 py-1 border border-slate-300 rounded text-[10px] font-mono text-right focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-700">Total no período ({p.contractMonths} meses):</span>
                    <span className="font-mono font-bold text-teal-700">
                      {totalKWh.toLocaleString('pt-BR')} kWh
                      <span className="text-slate-500 ml-2 font-normal">({(totalKWh / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MWh)</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="rounded-lg bg-teal-50 border border-teal-200 p-3 text-xs">
            <div className="font-semibold text-teal-900 mb-1">Geração total ({plants.length + 1} usinas)</div>
            <div className="font-mono text-teal-700">
              {totalMWh.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MWh ao longo de {primary.contractMonths} meses
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
