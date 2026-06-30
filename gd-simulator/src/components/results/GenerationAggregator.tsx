import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { Project, SimulationResult } from '../../engine/types';
import { aggregatePlantGeneration } from '../../engine/simulation';

const COLORS = ['#004B70', '#2F927B', '#C6DA38', '#6692A8', '#b45309', '#7c3aed', '#dc2626', '#0891b2'];
const fmtMWh = (kwh: number) => (kwh / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MWh';

export function GenerationAggregator({ project, result }: { project: Project; result: SimulationResult }) {
  const agg = useMemo(() => aggregatePlantGeneration(project), [project]);

  // Monthly stacked data: one row per month, one key per plant.
  const data = useMemo(() => {
    const labels = result.months.map(m => m.label);
    return Array.from({ length: agg.totalMonths }, (_, i) => {
      const row: Record<string, number | string> = { mes: labels[i] ?? `M${i + 1}` };
      agg.perPlant.forEach((p, pi) => { row[`p${pi}`] = Math.round((p.series[i] || 0) / 1000 * 10) / 10; });
      return row;
    });
  }, [agg, result]);

  const monthsActive = agg.totalSeries.filter(v => v > 0).length || 1;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Geração agregada — todas as usinas do projeto</h3>
        <p className="text-xs text-slate-500 mb-3">
          Soma da geração (P50) de {agg.perPlant.length} usina(s), já com degradação, fator de performance e a janela
          de cada contrato. Valores em MWh/mês.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="mes" tick={{ fontSize: 9 }} interval={Math.max(0, Math.floor(agg.totalMonths / 16))} />
            <YAxis tick={{ fontSize: 9 }} label={{ value: 'MWh', angle: -90, position: 'insideLeft', fontSize: 10 }} />
            <Tooltip formatter={(v, name) => {
              const idx = Number(String(name).replace('p', ''));
              return [`${Number(v)} MWh`, agg.perPlant[idx]?.name ?? String(name)];
            }} />
            <Legend formatter={(name) => agg.perPlant[Number(String(name).replace('p', ''))]?.name ?? String(name)} wrapperStyle={{ fontSize: 10 }} />
            {agg.perPlant.map((_, pi) => (
              <Bar key={pi} dataKey={`p${pi}`} stackId="gen" fill={COLORS[pi % COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 overflow-x-auto">
        <h4 className="text-sm font-semibold text-slate-800 mb-3">Resumo por usina</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-3">Usina</th>
              <th className="py-2 px-3 text-right">Carga (kWac)</th>
              <th className="py-2 px-3 text-right">Geração total</th>
              <th className="py-2 px-3 text-right">Média mensal</th>
              <th className="py-2 px-3 text-right">% do total</th>
            </tr>
          </thead>
          <tbody>
            {agg.perPlant.map((p, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-1.5 pr-3 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  {p.name}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">{Math.round(p.capacityKWac).toLocaleString('pt-BR')}</td>
                <td className="py-1.5 px-3 text-right font-mono">{fmtMWh(p.total)}</td>
                <td className="py-1.5 px-3 text-right font-mono">{fmtMWh(p.total / monthsActive)}</td>
                <td className="py-1.5 px-3 text-right font-mono">{agg.grandTotal ? (p.total / agg.grandTotal * 100).toFixed(1) : '0.0'}%</td>
              </tr>
            ))}
            <tr className="font-semibold text-slate-800 border-t-2 border-slate-300">
              <td className="py-2 pr-3">TOTAL ({agg.perPlant.length} usinas)</td>
              <td className="py-2 px-3 text-right font-mono">
                {Math.round(agg.perPlant.reduce((a, p) => a + p.capacityKWac, 0)).toLocaleString('pt-BR')}
              </td>
              <td className="py-2 px-3 text-right font-mono text-teal-700">{fmtMWh(agg.grandTotal)}</td>
              <td className="py-2 px-3 text-right font-mono">{fmtMWh(agg.grandTotal / monthsActive)}</td>
              <td className="py-2 px-3 text-right font-mono">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
