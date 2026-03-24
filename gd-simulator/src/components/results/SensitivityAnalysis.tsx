import { useMemo, useRef, useState } from 'react';
import type { Project, SimulationResult } from '../../engine/types';
import { runSimulation } from '../../engine/simulation';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Props {
  project: Project;
  result: SimulationResult;
}

interface ScenarioResult {
  label: string;
  factor: number;
  result: SimulationResult;
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
function formatPct(v: number): string {
  return (v * 100).toFixed(1) + '%';
}
function formatKWh(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kWh';
}

function buildCacheKey(project: Project, p90Pct: number, p10Pct: number): string {
  const gen3 = project.plant.p50Profile.slice(0, 3).join(',');
  const rLen = JSON.stringify(project.rateio).length;
  const sc = `${project.scenarios.icmsExempt}_${project.scenarios.competitorDiscount}`;
  return `${project.id}_${gen3}_${sc}_${rLen}_${p90Pct}_${p10Pct}`;
}

export function SensitivityAnalysis({ project }: Props) {
  const [p90Pct, setP90Pct] = useState(90);
  const [p10Pct, setP10Pct] = useState(110);

  const cacheRef = useRef<{ key: string; scenarios: ScenarioResult[]; computedAt: number } | null>(null);

  const scenarios = useMemo<ScenarioResult[]>(() => {
    const key = buildCacheKey(project, p90Pct, p10Pct);

    // Return cached if key matches
    if (cacheRef.current && cacheRef.current.key === key) {
      return cacheRef.current.scenarios;
    }

    const factors = [
      { label: `P90 (${p90Pct}%)`, factor: p90Pct / 100 },
      { label: 'P50 (base)', factor: 1.00 },
      { label: `P10 (${p10Pct}%)`, factor: p10Pct / 100 },
    ];

    const results = factors.map(({ label, factor }) => {
      const scaledProfile = project.plant.p50Profile.map(v => Math.round(v * factor));
      const modifiedProject: Project = {
        ...project,
        plant: { ...project.plant, p50Profile: scaledProfile, useActual: false },
        scenarios: { ...project.scenarios, useActualGeneration: false },
      };
      return { label, factor, result: runSimulation(modifiedProject) };
    });

    cacheRef.current = { key, scenarios: results, computedAt: Date.now() };
    return results;
  }, [project, p90Pct, p10Pct]);

  const p90 = scenarios[0];
  const p50 = scenarios[1];
  const p10 = scenarios[2];

  const chartData = scenarios.map(s => ({
    year1: s.result.months.slice(0, 12).reduce((sum, m) => sum + m.economia, 0),
    year2: s.result.months.slice(12).reduce((sum, m) => sum + m.economia, 0),
  }));

  const barChartData = [
    { name: 'Ano 1', P90: chartData[0].year1, P50: chartData[1].year1, P10: chartData[2].year1 },
    { name: 'Ano 2', P90: chartData[0].year2, P50: chartData[1].year2, P10: chartData[2].year2 },
  ];

  const metrics = [
    { label: 'Geracao Total', getValue: (s: ScenarioResult) => formatKWh(s.result.summary.totalGeneration), getRaw: (s: ScenarioResult) => s.result.summary.totalGeneration },
    { label: 'Custo PPA Total', getValue: (s: ScenarioResult) => formatBRL(s.result.summary.totalPPACost), getRaw: (s: ScenarioResult) => s.result.summary.totalPPACost },
    { label: 'Baseline SEM Helexia', getValue: (s: ScenarioResult) => formatBRL(s.result.summary.baselineSEM), getRaw: (s: ScenarioResult) => s.result.summary.baselineSEM },
    { label: 'Economia Liquida', getValue: (s: ScenarioResult) => formatBRL(s.result.summary.economiaLiquida), getRaw: (s: ScenarioResult) => s.result.summary.economiaLiquida },
    { label: 'Economia %', getValue: (s: ScenarioResult) => formatPct(s.result.summary.economiaPct), getRaw: (s: ScenarioResult) => s.result.summary.economiaPct },
    { label: 'Economia/Mes', getValue: (s: ScenarioResult) => formatBRL(s.result.summary.economiaPerMonth), getRaw: (s: ScenarioResult) => s.result.summary.economiaPerMonth },
    { label: 'Banco Residual', getValue: (s: ScenarioResult) => formatKWh(s.result.summary.bancoResidualKWh), getRaw: (s: ScenarioResult) => s.result.summary.bancoResidualKWh },
    { label: 'Valor Total', getValue: (s: ScenarioResult) => formatBRL(s.result.summary.valorTotal), getRaw: (s: ScenarioResult) => s.result.summary.valorTotal },
  ];

  function getDelta(p90Val: number, p50Val: number, p10Val: number, isP90: boolean): string {
    if (p50Val === 0) return '—';
    const val = isP90 ? p90Val : p10Val;
    const delta = ((val - p50Val) / Math.abs(p50Val)) * 100;
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  }

  const timeSinceCompute = cacheRef.current ? Math.round((Date.now() - cacheRef.current.computedAt) / 1000) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800 mb-1">Sensibilidade de Geracao</h3>
          <p className="text-sm text-slate-500">
            Comparacao entre cenarios pessimista, base e otimista.
          </p>
        </div>
        {timeSinceCompute > 0 && (
          <span className="text-xs text-slate-400">
            Calculado ha {timeSinceCompute < 60 ? `${timeSinceCompute}s` : `${Math.round(timeSinceCompute / 60)}min`}
          </span>
        )}
      </div>

      {/* Configurable factors */}
      <div className="flex items-center gap-6 p-3 bg-slate-50 rounded-lg">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600 font-medium">Fator P90:</label>
          <input
            type="number"
            value={p90Pct}
            onChange={e => setP90Pct(Math.max(70, Math.min(99, Number(e.target.value))))}
            className="w-16 px-2 py-1 text-sm border border-slate-300 rounded text-center"
            min={70} max={99} step={1}
          />
          <span className="text-xs text-slate-400">%</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-600 font-medium">Fator P10:</label>
          <input
            type="number"
            value={p10Pct}
            onChange={e => setP10Pct(Math.max(101, Math.min(130, Number(e.target.value))))}
            className="w-16 px-2 py-1 text-sm border border-slate-300 rounded text-center"
            min={101} max={130} step={1}
          />
          <span className="text-xs text-slate-400">%</span>
        </div>
        <p className="text-[10px] text-slate-400 flex-1">
          Use os fatores do relatorio PVsyst se disponivel.
        </p>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 border-b border-slate-200 text-slate-500 font-medium">Metrica</th>
              <th className="text-right py-2 px-3 border-b border-slate-200 text-slate-500 font-medium">
                P90
                <span className="block text-xs font-normal text-slate-400">({(p90Pct / 100).toFixed(2)}x)</span>
              </th>
              <th
                className="text-right py-2 px-3 border-b-2 font-medium text-white"
                style={{ backgroundColor: '#004B70', borderBottomColor: '#004B70' }}
              >
                P50
                <span className="block text-xs font-normal text-white/70">(base)</span>
              </th>
              <th className="text-right py-2 px-3 border-b border-slate-200 text-slate-500 font-medium">
                P10
                <span className="block text-xs font-normal text-slate-400">({(p10Pct / 100).toFixed(2)}x)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m, idx) => {
              const p90Raw = m.getRaw(p90);
              const p50Raw = m.getRaw(p50);
              const p10Raw = m.getRaw(p10);
              return (
                <tr key={idx} className={idx % 2 === 0 ? 'bg-slate-50' : ''}>
                  <td className="py-2 px-3 text-slate-700 font-medium">{m.label}</td>
                  <td className="py-2 px-3 text-right">
                    <span className="text-slate-700">{m.getValue(p90)}</span>
                    <span className="block text-xs text-red-600">{getDelta(p90Raw, p50Raw, p10Raw, true)}</span>
                  </td>
                  <td className="py-2 px-3 text-right text-white font-medium" style={{ backgroundColor: '#004B70' }}>
                    {m.getValue(p50)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className="text-slate-700">{m.getValue(p10)}</span>
                    <span className="block text-xs text-green-600">{getDelta(p90Raw, p50Raw, p10Raw, false)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Grouped bar chart */}
      <div>
        <h4 className="text-sm font-medium text-slate-700 mb-3">Economia por Ano — P90 / P50 / P10</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={barChartData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$ ${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(value, name) => [
              (value as number).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }),
              name,
            ]} />
            <Legend />
            <Bar dataKey="P90" fill="#ef4444" name={`P90 (${p90Pct}%)`} radius={[3, 3, 0, 0]} />
            <Bar dataKey="P50" fill="#004B70" name="P50 (base)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="P10" fill="#22c55e" name={`P10 (${p10Pct}%)`} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
