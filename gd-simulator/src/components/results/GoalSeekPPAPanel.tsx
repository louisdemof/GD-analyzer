import { useState } from 'react';
import type { Project } from '../../engine/types';
import { goalSeekPPALength, type PPALengthResult } from '../../engine/ppaLengthOptimiser';
import { useProjectStore } from '../../store/projectStore';

interface Props {
  project: Project;
}

const brl = (v: number) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');

/**
 * Goal-seek: encontra o Prazo PPA (meses de contrato/injeção da usina) que MAXIMIZA a economia
 * do cliente para um horizonte FIXO. Quando a usina gera excedente, injetar por menos meses já
 * acumula créditos que cobrem todo o horizonte — então um PPA mais curto custa menos PPA ao
 * cliente com a mesma (ou maior) economia. Varre todos os prazos e re-simula.
 */
export function GoalSeekPPAPanel({ project }: Props) {
  const updateProject = useProjectStore(s => s.updateProject);
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<PPALengthResult | null>(null);

  const run = () => {
    setRunning(true);
    // defer so the "Calculando…" state paints before the sweep blocks the thread
    setTimeout(() => {
      setRes(goalSeekPPALength(project));
      setRunning(false);
    }, 20);
  };

  const applyBest = () => {
    if (!res) return;
    updateProject(project.id, {
      simulationMonths: res.horizon, // mantém o horizonte fixo ao encurtar o prazo
      plant: { ...project.plant, contractMonths: res.best.ppaMonths },
      additionalPlants: project.additionalPlants?.map(p => ({ ...p, contractMonths: res.best.ppaMonths })),
    });
  };

  const billLabel = project.scenarios.ppaBillingBasis === 'compensation' ? 'compensação' : 'injeção';
  const current = res?.points.find(p => p.ppaMonths === res.currentPPAMonths)
    ?? res?.points[res.points.length - 1];
  const gain = res && current ? res.best.economiaLiquida - current.economiaLiquida : 0;
  const maxEcon = res ? Math.max(...res.points.map(p => p.economiaLiquida)) : 1;
  const minEcon = res ? Math.min(0, ...res.points.map(p => p.economiaLiquida)) : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Goal-seek — melhor Prazo PPA (economia máx. do cliente)</h3>
        <p className="text-xs text-slate-500">
          Mantém o <strong>horizonte fixo</strong> e varre o <strong>Prazo PPA</strong> (meses de injeção da usina) para achar o que
          dá a <strong>maior economia ao cliente</strong>. Se a usina gera excedente, injetar por menos meses já acumula créditos que
          cobrem todo o horizonte — um PPA mais curto custa menos e rende igual ou mais. Faturamento atual: <strong>{billLabel}</strong>.
        </p>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="px-4 py-1.5 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {running ? 'Calculando…' : 'Otimizar Prazo PPA'}
      </button>

      {res && current && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg bg-teal-50 border border-teal-200 p-3">
              <div className="text-[11px] text-slate-500">Prazo PPA recomendado</div>
              <div className="text-lg font-bold text-teal-800">{res.best.ppaMonths} meses</div>
              <div className="text-[11px] text-slate-500">horizonte {res.horizon} m (fixo)</div>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
              <div className="text-[11px] text-slate-500">Economia no recomendado</div>
              <div className="text-lg font-bold text-emerald-700">{brl(res.best.economiaLiquida)}</div>
              <div className="text-[11px] text-slate-500">{res.best.economiaPct != null ? (res.best.economiaPct * 100).toFixed(1) + '%' : ''}</div>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
              <div className="text-[11px] text-slate-500">Prazo atual ({res.currentPPAMonths} m)</div>
              <div className="text-lg font-bold text-slate-800">{brl(current.economiaLiquida)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${gain > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
              <div className="text-[11px] text-slate-500">Ganho vs atual</div>
              <div className={`text-lg font-bold ${gain > 0 ? 'text-emerald-700' : 'text-slate-600'}`}>{gain > 0 ? '+' : ''}{brl(gain)}</div>
              <div className="text-[11px] text-slate-500">{gain > 0 ? 'encurtar o PPA rende mais' : 'prazo atual já é ótimo'}</div>
            </div>
          </div>

          {/* Curve: economia vs prazo PPA */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            <div className="text-[11px] font-semibold text-slate-600 mb-2">Economia do cliente × Prazo PPA (meses)</div>
            <div className="flex items-end gap-[2px] h-28">
              {res.points.map((p, i) => {
                const h = ((p.economiaLiquida - minEcon) / Math.max(1, maxEcon - minEcon)) * 100;
                const isBest = p.ppaMonths === res.best.ppaMonths;
                return (
                  <div key={i} className="flex-1 h-full flex flex-col justify-end items-center" title={`${p.ppaMonths}m: ${brl(p.economiaLiquida)}`}>
                    <div className={`w-full rounded-t ${isBest ? 'bg-teal-600' : 'bg-slate-300'}`} style={{ height: `${Math.max(1, h)}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>{res.points[0]?.ppaMonths}m</span>
              <span className="text-teal-700 font-semibold">▲ ótimo: {res.best.ppaMonths}m</span>
              <span>{res.points[res.points.length - 1]?.ppaMonths}m</span>
            </div>
          </div>

          {res.best.ppaMonths !== res.currentPPAMonths && (
            <button
              type="button"
              onClick={applyBest}
              className="px-4 py-1.5 text-sm font-medium rounded-lg border border-teal-500 text-teal-700 hover:bg-teal-50"
            >
              Aplicar prazo recomendado ({res.best.ppaMonths} m) ao projeto
            </button>
          )}

          <p className="text-[11px] text-slate-400">
            Varredura re-simula o projeto para cada prazo mantendo rateio, FA, faturamento e demais premissas. O ótimo é o menor
            prazo que atinge o pico de economia (empates → menor prazo = menor custo/risco). Confirme a validade dos créditos (60 meses).
          </p>
        </>
      )}
    </div>
  );
}
