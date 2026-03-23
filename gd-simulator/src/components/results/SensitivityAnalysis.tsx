import { useMemo } from 'react';
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

export function SensitivityAnalysis({ project }: Props) {
  const scenarios = useMemo<ScenarioResult[]>(() => {
    const factors = [
      { label: 'P90 (conservador)', factor: 0.90 },
      { label: 'P50 (base)', factor: 1.00 },
      { label: 'P10 (otimista)', factor: 1.10 },
    ];

    return factors.map(({ label, factor }) => {
      // Create modified project with scaled generation
      const scaledProfile = project.plant.p50Profile.map(v => Math.round(v * factor));
      const modifiedProject: Project = {
        ...project,
        plant: {
          ...project.plant,
          p50Profile: scaledProfile,
          useActual: false,
        },
        scenarios: {
          ...project.scenarios,
          useActualGeneration: false,
        },
      };
      return {
        label,
        factor,
        result: runSimulation(modifiedProject),
      };
    });
  }, [project]);

  const p90 = scenarios[0];
  const p50 = scenarios[1];
  const p10 = scenarios[2];

  // Chart data: Ano 1 vs Ano 2 with P90/P50/P10
  const chartData = useMemo(() => {
    return scenarios.map(s => {
      const year1 = s.result.months.slice(0, 12).reduce((sum, m) => sum + m.economia, 0);
      const year2 = s.result.months.slice(12, 24).reduce((sum, m) => sum + m.economia, 0);
      return { year1, year2 };
    });
  }, [scenarios]);

  const barChartData = [
    {
      name: 'Ano 1',
      P90: chartData[0].year1,
      P50: chartData[1].year1,
      P10: chartData[2].year1,
    },
    {
      name: 'Ano 2',
      P90: chartData[0].year2,
      P50: chartData[1].year2,
      P10: chartData[2].year2,
    },
  ];

  const metrics = [
    {
      label: 'Geracao Total',
      getValue: (s: ScenarioResult) => formatKWh(s.result.summary.totalGeneration),
      getRaw: (s: ScenarioResult) => s.result.summary.totalGeneration,
    },
    {
      label: 'Custo PPA Total',
      getValue: (s: ScenarioResult) => formatBRL(s.result.summary.totalPPACost),
      getRaw: (s: ScenarioResult) => s.result.summary.totalPPACost,
    },
    {
      label: 'Baseline SEM Helexia',
      getValue: (s: ScenarioResult) => formatBRL(s.result.summary.baselineSEM),
      getRaw: (s: ScenarioResult) => s.result.summary.baselineSEM,
    },
    {
      label: 'Economia Liquida',
      getValue: (s: ScenarioResult) => formatBRL(s.result.summary.economiaLiquida),
      getRaw: (s: ScenarioResult) => s.result.summary.economiaLiquida,
    },
    {
      label: 'Economia %',
      getValue: (s: ScenarioResult) => formatPct(s.result.summary.economiaPct),
      getRaw: (s: ScenarioResult) => s.result.summary.economiaPct,
    },
    {
      label: 'Economia/Mes',
      getValue: (s: ScenarioResult) => formatBRL(s.result.summary.economiaPerMonth),
      getRaw: (s: ScenarioResult) => s.result.summary.economiaPerMonth,
    },
    {
      label: 'Banco Residual',
      getValue: (s: ScenarioResult) => formatKWh(s.result.summary.bancoResidualKWh),
      getRaw: (s: ScenarioResult) => s.result.summary.bancoResidualKWh,
    },
    {
      label: 'Valor Total',
      getValue: (s: ScenarioResult) => formatBRL(s.result.summary.valorTotal),
      getRaw: (s: ScenarioResult) => s.result.summary.valorTotal,
    },
  ];

  function getDelta(p90Val: number, p50Val: number, p10Val: number, isP90: boolean): string {
    const base = p50Val;
    if (base === 0) return '—';
    const val = isP90 ? p90Val : p10Val;
    const delta = ((val - base) / Math.abs(base)) * 100;
    const sign = delta >= 0 ? '+' : '';
    return `${sign}${delta.toFixed(1)}%`;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-800 mb-1">Sensibilidade de Geracao</h3>
        <p className="text-sm text-slate-500">
          Comparacao entre cenarios P90 (90% da geracao P50), P50 (base) e P10 (110% da geracao P50).
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
                <span className="block text-xs font-normal text-slate-400">(0.90x)</span>
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
                <span className="block text-xs font-normal text-slate-400">(1.10x)</span>
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
                    <span className="block text-xs text-red-600">
                      {getDelta(p90Raw, p50Raw, p10Raw, true)}
                    </span>
                  </td>
                  <td
                    className="py-2 px-3 text-right text-white font-medium"
                    style={{ backgroundColor: '#004B70' }}
                  >
                    {m.getValue(p50)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <span className="text-slate-700">{m.getValue(p10)}</span>
                    <span className="block text-xs text-green-600">
                      {getDelta(p90Raw, p50Raw, p10Raw, false)}
                    </span>
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
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={v => `R$ ${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(value, name) => [
                (value as number).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }),
                name,
              ]}
            />
            <Legend />
            <Bar dataKey="P90" fill="#ef4444" name="P90 (conservador)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="P50" fill="#004B70" name="P50 (base)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="P10" fill="#22c55e" name="P10 (otimista)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
