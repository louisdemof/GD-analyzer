import { useState } from 'react';
import type { Project } from '../../engine/types';
import { runSimulation } from '../../engine/simulation';

interface Props {
  project: Project;
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/**
 * Goal-seek: encontra o preço de energia TE (ACL, sem impostos) no qual a economia
 * líquida atinge um alvo (default 0% = PPA Helexia empata com a fatura ACL atual).
 * Mantém rateio, FA e demais premissas do projeto; só varia energyPriceSemImp.
 * Economia é monótona crescente em TE → busca binária.
 */
export function GoalSeekTEPanel({ project }: Props) {
  const [targetPct, setTargetPct] = useState(0);
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<{ te: number; allIn: number; current: number; target: number } | null>(null);

  if (project.marketType !== 'ACL' || !project.aclBaseline) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
        Goal-seek de TE disponível apenas para projetos no <strong>Mercado Livre (ACL)</strong>.
      </div>
    );
  }
  const acl = project.aclBaseline;

  const econPctAtTE = (teMWh: number): number => {
    const p: Project = {
      ...project,
      distributor: { ...project.distributor }, // isola mutação de FA
      aclBaseline: { ...acl, energyPriceSemImp: teMWh / 1000 },
    };
    const s = runSimulation(p).summary;
    return s.baselineSEM > 0 ? (s.economiaLiquida / s.baselineSEM) * 100 : 0;
  };

  const run = () => {
    setRunning(true);
    // Busca binária no TE (R$/MWh) tal que economia% == targetPct.
    let lo = 20, hi = 800;
    for (let i = 0; i < 44; i++) {
      const mid = (lo + hi) / 2;
      if (econPctAtTE(mid) > targetPct) hi = mid; else lo = mid;
    }
    const te = (lo + hi) / 2;
    const PC = acl.energyPisCofinsPct ?? 0.0925;
    const ICMS = (acl.energyIcms ?? true) ? project.distributor.taxes.ICMS : 0;
    const allIn = te / ((1 - PC) * (1 - ICMS));
    setRes({ te, allIn, current: (acl.energyPriceSemImp ?? 0) * 1000, target: targetPct });
    setRunning(false);
  };

  const PCpct = ((acl.energyPisCofinsPct ?? 0.0925) * 100).toFixed(2);
  const ICMSpct = (((acl.energyIcms ?? true) ? project.distributor.taxes.ICMS : 0) * 100).toFixed(0);
  const margin = res ? res.current - res.te : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Goal-seek — TE de equilíbrio (ACL)</h3>
        <p className="text-xs text-slate-500">
          Encontra o preço da energia TE no mercado livre (sem impostos) no qual a economia líquida atinge o alvo.
          Com alvo <strong>0%</strong>, é o TE em que o <strong>PPA fixo da Helexia empata com a fatura ACL atual</strong>.
          Mantém rateio, Fator de Ajuste e demais premissas; varia só o TE.
        </p>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Economia-alvo (%)</label>
          <input
            type="number"
            step="0.5"
            value={targetPct}
            onChange={e => setTargetPct(parseFloat(e.target.value) || 0)}
            className="w-28 px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="px-4 py-1.5 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {running ? 'Calculando…' : 'Calcular TE'}
        </button>
      </div>

      {res && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg bg-teal-50 border border-teal-200 p-3">
            <div className="text-[11px] text-slate-500">TE de equilíbrio (s/ imp.)</div>
            <div className="text-lg font-bold text-teal-800">R$ {fmt(res.te)}/MWh</div>
            <div className="text-[11px] text-slate-500">p/ economia = {res.target}%</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-[11px] text-slate-500">TE de equilíbrio (all-in)</div>
            <div className="text-lg font-bold text-slate-800">R$ {fmt(res.allIn)}/MWh</div>
            <div className="text-[11px] text-slate-500">+PIS/COFINS {PCpct}% +ICMS {ICMSpct}%</div>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-[11px] text-slate-500">TE atual (premissa)</div>
            <div className="text-lg font-bold text-slate-800">R$ {fmt(res.current)}/MWh</div>
          </div>
          <div className={`rounded-lg border p-3 ${margin >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
            <div className="text-[11px] text-slate-500">Margem (atual − equilíbrio)</div>
            <div className={`text-lg font-bold ${margin >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
              {margin >= 0 ? '+' : ''}{fmt(margin)} R$/MWh
            </div>
            <div className="text-[11px] text-slate-500">{margin >= 0 ? 'TE atual acima do equilíbrio → GD vence' : 'TE atual abaixo → GD perde'}</div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Acima do TE de equilíbrio, a energia ACL do cliente é cara o suficiente para o PPA fixo da Helexia gerar economia;
        abaixo, o PPA + rede superam a fatura ACL. Sobre o TE incidem <strong>PIS/COFINS {PCpct}%</strong> e <strong>ICMS {ICMSpct}%</strong> (por dentro).
      </p>
    </div>
  );
}
