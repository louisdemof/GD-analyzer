import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { runSimulation } from '../engine/simulation';
import type { Project, SimulationSummary } from '../engine/types';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const KWH = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kWh';
const PCT = (v: number) => (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

interface Col { project: Project; summary: SimulationSummary | null; error?: string; months: number }

const MAX = 4;

export function Compare() {
  const navigate = useNavigate();
  const projects = useProjectStore(s => s.projects).filter(p => !p.deletedAt);
  const [selected, setSelected] = useState<string[]>(() => projects.slice(0, 2).map(p => p.id));

  const toggle = (id: string) => setSelected(s =>
    s.includes(id) ? s.filter(x => x !== id) : s.length >= MAX ? s : [...s, id]);

  const cols = useMemo<Col[]>(() => selected.map(id => {
    const project = projects.find(p => p.id === id)!;
    if (!project) return null as unknown as Col;
    try {
      const r = runSimulation(project);
      return { project, summary: r.summary, months: r.months.length };
    } catch (e) {
      return { project, summary: null, months: 0, error: e instanceof Error ? e.message : 'erro' };
    }
  }).filter(Boolean), [selected, projects]);

  // Best-per-metric highlighting (higher is better unless noted).
  const best = useMemo(() => {
    const ok = cols.filter(c => c.summary);
    const max = (f: (s: SimulationSummary) => number) => ok.length ? Math.max(...ok.map(c => f(c.summary!))) : null;
    return {
      economiaLiquida: max(s => s.economiaLiquida),
      economiaPct: max(s => s.economiaPct),
      valorTotal: max(s => s.valorTotal),
    };
  }, [cols]);

  const years = (m: number) => m / 12;
  const ringIf = (cond: boolean) => cond ? 'bg-emerald-50 text-emerald-700 font-semibold rounded' : '';

  const ROWS: { label: string; render: (c: Col) => React.ReactNode; cls?: (c: Col) => string }[] = [
    { label: 'Distribuidora', render: c => c.project.distributor?.name || '—' },
    { label: 'Mercado', render: c => c.project.marketType === 'ACL' ? 'Livre (ACL)' : 'Cativo' },
    { label: 'Horizonte', render: c => `${c.months} meses` },
    { label: 'PPA', render: c => `R$ ${(c.project.plant.ppaRateRsBRLkWh ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/kWh` },
    { label: 'Geração (P50)', render: c => c.summary ? KWH(c.summary.totalGeneration) : '—' },
    { label: 'Custo SEM', render: c => c.summary ? BRL(c.summary.baselineSEM) : '—' },
    { label: 'Custo COM', render: c => c.summary ? BRL(c.summary.baselineSEM - c.summary.economiaLiquida) : '—' },
    { label: 'Economia líquida', render: c => c.summary ? BRL(c.summary.economiaLiquida) : '—', cls: c => ringIf(!!c.summary && c.summary.economiaLiquida === best.economiaLiquida) },
    { label: 'Economia %', render: c => c.summary ? PCT(c.summary.economiaPct) : '—', cls: c => ringIf(!!c.summary && c.summary.economiaPct === best.economiaPct) },
    { label: 'Economia / ano', render: c => c.summary ? BRL(c.summary.economiaLiquida / Math.max(1, years(c.months))) : '—' },
    { label: 'PPA total p/ Helexia', render: c => c.summary ? BRL(c.summary.totalPPACost) : '—' },
    { label: 'Banco residual', render: c => c.summary ? KWH(c.summary.bancoResidualKWh) : '—' },
    { label: 'Valor total', render: c => c.summary ? BRL(c.summary.valorTotal) : '—', cls: c => ringIf(!!c.summary && c.summary.valorTotal === best.valorTotal) },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-slate-800">Comparar cenários</h1>
        <button onClick={() => navigate('/')} className="text-sm text-teal-600 hover:underline">← Dashboard</button>
      </div>
      <p className="text-sm text-slate-500 mb-5">Selecione até {MAX} projetos para comparar lado a lado (usa o rateio salvo de cada um).</p>

      {/* Project picker */}
      <div className="flex flex-wrap gap-2 mb-6">
        {projects.map(p => {
          const on = selected.includes(p.id);
          const disabled = !on && selected.length >= MAX;
          return (
            <button key={p.id} onClick={() => toggle(p.id)} disabled={disabled}
              className={`px-3 py-1.5 text-xs rounded-full border ${on ? 'bg-slate-700 text-white border-slate-700' : disabled ? 'opacity-40 border-slate-200' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              {p.clientName || 'Sem nome'}
            </button>
          );
        })}
      </div>

      {cols.length === 0 ? (
        <p className="text-sm text-slate-400">Selecione ao menos um projeto.</p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left py-3 px-4 font-medium text-slate-500 w-44">Métrica</th>
                {cols.map(c => (
                  <th key={c.project.id} className="text-right py-3 px-4 font-semibold text-slate-800 min-w-[160px]">
                    <button onClick={() => { useProjectStore.getState().setCurrentProject(c.project.id); navigate(`/results/${c.project.id}`); }}
                      className="hover:text-teal-700 hover:underline">{c.project.clientName || 'Sem nome'}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(row => (
                <tr key={row.label} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 px-4 text-slate-500">{row.label}</td>
                  {cols.map(c => (
                    <td key={c.project.id} className="py-2 px-4 text-right font-mono">
                      {c.error
                        ? <span className="text-red-500 text-xs">erro</span>
                        : <span className={`px-1.5 py-0.5 ${row.cls?.(c) ?? ''}`}>{row.render(c)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-3">Verde = melhor valor da linha entre os cenários selecionados. Clique no nome para abrir os resultados completos.</p>
    </div>
  );
}
