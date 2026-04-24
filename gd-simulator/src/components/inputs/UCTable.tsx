import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ConsumptionUnit, TariffGroup } from '../../engine/types';

interface Props {
  ucs: ConsumptionUnit[];
  contractStartMonth?: string; // "YYYY-MM", drives month labels on the chart
  onAdd: (uc: ConsumptionUnit) => void;
  onUpdate: (ucId: string, updates: Partial<ConsumptionUnit>) => void;
  onRemove: (ucId: string) => void;
}

const MONTH_ABBR = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function monthLabels(contractStart: string | undefined, count: number): string[] {
  if (!contractStart) return Array.from({ length: count }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
  const [yStr, mStr] = contractStart.split('-');
  const y0 = parseInt(yStr, 10);
  const m0 = parseInt(mStr, 10) - 1;
  return Array.from({ length: count }, (_, i) => {
    const m = (m0 + i) % 12;
    const y = y0 + Math.floor((m0 + i) / 12);
    return `${MONTH_ABBR[m]}/${String(y).slice(-2)}`;
  });
}

const TARIFF_GROUPS: TariffGroup[] = [
  'B1', 'B2', 'B3',
  'A4_VERDE', 'A4_AZUL',
  'A3A', 'A3A_VERDE', 'A3A_AZUL',
  'A3', 'A3_VERDE', 'A3_AZUL',
  'A2', 'A2_VERDE', 'A2_AZUL',
  'A1', 'A1_VERDE', 'A1_AZUL',
];

const GROUP_LABELS: Record<TariffGroup, string> = {
  B1: 'B1 — Residencial',
  B2: 'B2 — Rural',
  B3: 'B3 — Comercial/Industrial',
  A4_VERDE: 'A4 Verde (<13.8 kV)',
  A4_AZUL: 'A4 Azul (<13.8 kV)',
  A3A: 'A3a (13.8 kV)',
  A3A_VERDE: 'A3a Verde (13.8 kV)',
  A3A_AZUL: 'A3a Azul (13.8 kV)',
  A3: 'A3 (30 kV)',
  A3_VERDE: 'A3 Verde (30 kV)',
  A3_AZUL: 'A3 Azul (30 kV)',
  A2: 'A2 (88 kV)',
  A2_VERDE: 'A2 Verde (88 kV)',
  A2_AZUL: 'A2 Azul (88 kV)',
  A1: 'A1 (230 kV+)',
  A1_VERDE: 'A1 Verde (230 kV+)',
  A1_AZUL: 'A1 Azul (230 kV+)',
};

function isGrupoA(tg: TariffGroup): boolean {
  return tg.startsWith('A');
}

export function UCTable({ ucs, contractStartMonth, onAdd, onUpdate, onRemove }: Props) {
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState<TariffGroup>('B3');
  const [newBank, setNewBank] = useState(0);

  const handleAdd = () => {
    if (!newName.trim()) return;
    const uc: ConsumptionUnit = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: newName.trim(),
      tariffGroup: newGroup,
      isGrupoA: isGrupoA(newGroup),
      consumptionFP: new Array(24).fill(0),
      consumptionPT: new Array(24).fill(0),
      openingBank: newBank,
    };
    onAdd(uc);
    setNewName('');
    setNewBank(0);
  };

  const handleGroupChange = (ucId: string, newTg: TariffGroup) => {
    onUpdate(ucId, {
      tariffGroup: newTg,
      isGrupoA: isGrupoA(newTg),
    });
  };

  const anyHasRSV = ucs.some(uc => uc.consumptionReservado && uc.consumptionReservado.some(v => v > 0));
  const anyGrupoA = ucs.some(uc => uc.isGrupoA);

  // Aggregated stacked chart data — sum FP/PT/RSV across all UCs per month
  const aggregatedChart = useMemo(() => {
    if (ucs.length === 0) return [];
    const labels = monthLabels(contractStartMonth, 24);
    const data: { month: string; FP: number; PT: number; RSV: number; total: number }[] = [];
    for (let m = 0; m < 24; m++) {
      let fp = 0, pt = 0, rsv = 0;
      for (const uc of ucs) {
        fp += uc.consumptionFP[m] || 0;
        pt += (uc.consumptionPT || [])[m] || 0;
        rsv += (uc.consumptionReservado || [])[m] || 0;
      }
      data.push({ month: labels[m], FP: Math.round(fp), PT: Math.round(pt), RSV: Math.round(rsv), total: Math.round(fp + pt + rsv) });
    }
    return data;
  }, [ucs, contractStartMonth]);

  const hasAnyConsumption = aggregatedChart.some(d => d.total > 0);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-3 text-slate-500 font-medium">Nome</th>
              <th className="text-left py-2 px-3 text-slate-500 font-medium">Grupo Tarifário</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium">Banco Inicial (kWh)</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium">Consumo Médio FP</th>
              {anyGrupoA && <th className="text-right py-2 px-3 text-slate-500 font-medium">Média Ponta</th>}
              {anyHasRSV && <th className="text-right py-2 px-3 text-slate-500 font-medium">Média Reservado</th>}
              {anyGrupoA && <th className="text-right py-2 px-3 text-slate-500 font-medium">Demanda FP (kW)</th>}
              <th className="text-center py-2 px-3 text-slate-500 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {ucs.map(uc => {
              const avgFP = uc.consumptionFP.reduce((a, b) => a + b, 0) / 24;
              const avgPT = (uc.consumptionPT || []).reduce((a, b) => a + b, 0) / 24;
              const avgRSV = uc.consumptionReservado
                ? uc.consumptionReservado.reduce((a, b) => a + b, 0) / 24
                : 0;
              const hasRSV = !!uc.consumptionReservado && uc.consumptionReservado.some(v => v > 0);
              return (
                <tr key={uc.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={uc.name}
                      onChange={e => onUpdate(uc.id, { name: e.target.value })}
                      className="w-full px-2 py-1 border border-transparent hover:border-slate-300 focus:border-teal-500 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <select
                      value={uc.tariffGroup}
                      onChange={e => handleGroupChange(uc.id, e.target.value as TariffGroup)}
                      className={`px-2 py-1 rounded text-xs font-medium border cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal-500 ${
                        uc.isGrupoA
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-400'
                          : 'bg-green-50 text-green-700 border-green-200 hover:border-green-400'
                      }`}
                    >
                      {TARIFF_GROUPS.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={uc.openingBank}
                      onChange={e => onUpdate(uc.id, { openingBank: parseFloat(e.target.value) || 0 })}
                      className="w-28 px-2 py-1 border border-transparent hover:border-slate-300 focus:border-teal-500 rounded text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-500">
                    {avgFP.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  </td>
                  {anyGrupoA && (
                    <td className="py-2 px-3 text-right font-mono text-slate-500">
                      {uc.isGrupoA ? avgPT.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'}
                    </td>
                  )}
                  {anyHasRSV && (
                    <td className="py-2 px-3 text-right font-mono text-slate-500">
                      {hasRSV ? avgRSV.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'}
                    </td>
                  )}
                  {anyGrupoA && (
                    <td className="py-2 px-3 text-right font-mono">
                      {uc.isGrupoA ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={uc.demandaContratadaFP ?? 0}
                          onChange={e => onUpdate(uc.id, { demandaContratadaFP: parseFloat(e.target.value) || 0 })}
                          className="w-20 px-2 py-1 border border-transparent hover:border-slate-300 focus:border-teal-500 rounded text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                  )}
                  <td className="py-2 px-3 text-center space-x-2">
                    <button
                      onClick={() => {
                        if (hasRSV) {
                          onUpdate(uc.id, { consumptionReservado: undefined });
                        } else {
                          onUpdate(uc.id, { consumptionReservado: new Array(24).fill(0) });
                        }
                      }}
                      className="text-xs text-slate-500 hover:text-teal-600"
                      title={hasRSV ? 'Desativar horário reservado' : 'Ativar horário reservado (rural irrigante)'}
                    >
                      {hasRSV ? 'Sem reservado' : '+ Reservado'}
                    </button>
                    <button
                      onClick={() => onRemove(uc.id)}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Aggregated consumption chart — stacked FP / PT / RSV across all UCs */}
      {hasAnyConsumption && (
        <div className="p-4 bg-slate-50 rounded-lg">
          <div className="flex items-baseline justify-between mb-3">
            <h4 className="text-sm font-semibold text-slate-700">Consumo agregado (todas as UCs)</h4>
            <span className="text-xs text-slate-400">
              Total 24m: {aggregatedChart.reduce((a, d) => a + d.total, 0).toLocaleString('pt-BR')} kWh
            </span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={aggregatedChart} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
              <Tooltip
                formatter={(value) => [(Number(value) || 0).toLocaleString('pt-BR') + ' kWh', '']}
                labelStyle={{ color: '#0f172a', fontWeight: 600 }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="FP" stackId="a" fill="#2F927B" name="Fora Ponta" />
              {anyGrupoA && <Bar dataKey="PT" stackId="a" fill="#004B70" name="Ponta" />}
              {anyHasRSV && <Bar dataKey="RSV" stackId="a" fill="#f59e0b" name="Reservado" />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Add new UC */}
      <div className="flex items-end gap-3 p-3 bg-slate-50 rounded-lg">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Nome</label>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nome da UC"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Grupo Tarifário</label>
          <select
            value={newGroup}
            onChange={e => setNewGroup(e.target.value as TariffGroup)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {TARIFF_GROUPS.map(g => (
              <option key={g} value={g}>{GROUP_LABELS[g]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Banco (kWh)</label>
          <input
            type="number"
            value={newBank}
            onChange={e => setNewBank(parseFloat(e.target.value) || 0)}
            className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
        >
          Adicionar UC
        </button>
      </div>
    </div>
  );
}
