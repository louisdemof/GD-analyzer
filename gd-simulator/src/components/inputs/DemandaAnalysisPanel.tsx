import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { ConsumptionUnit, Distributor } from '../../engine/types';
import { computeAllInTariff } from '../../engine/tariff';
import {
  computeAnnualDemandaCost,
  optimizeDemandaContratada,
} from '../../engine/demandaOptimizer';
import { FaturaUpload } from './FaturaUpload';

interface Props {
  ucs: ConsumptionUnit[];
  distributor: Distributor;
  onUpdate: (ucId: string, updates: Partial<ConsumptionUnit>) => void;
}

const MONTH_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function scenarioBadge(scenario: 'subutilizacao' | 'normal' | 'ultrapassagem') {
  if (scenario === 'subutilizacao') {
    return { label: 'Subutilização', bg: '#fef3c7', fg: '#b45309' };
  }
  if (scenario === 'ultrapassagem') {
    return { label: 'Ultrapassagem', bg: '#fee2e2', fg: '#dc2626' };
  }
  return { label: 'Normal', bg: '#dcfce7', fg: '#15803d' };
}

export function DemandaAnalysisPanel({ ucs, distributor, onUpdate }: Props) {
  const tariffSemTrib = distributor.tariffs.A_FP_DEMANDA ?? 0;
  const tariffComTrib = tariffSemTrib > 0 ? computeAllInTariff(tariffSemTrib, distributor.taxes) : 0;
  const grupoAUCs = useMemo(() => ucs.filter(u => u.isGrupoA), [ucs]);

  if (tariffSemTrib === 0) {
    return (
      <div className="p-4 bg-amber-50 border-l-4 border-amber-400 rounded-lg">
        <h3 className="text-sm font-semibold text-amber-800 mb-1">Tarifa de demanda não configurada</h3>
        <p className="text-sm text-amber-700">
          Configure a tarifa de demanda Grupo A Verde em <strong>Distribuidora &amp; Tarifas</strong> antes de usar a análise de demanda.
        </p>
      </div>
    );
  }

  if (grupoAUCs.length === 0) {
    return (
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
        Nenhuma UC Grupo A cadastrada neste projeto. A análise de demanda é exclusiva para Grupo A.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* PDF fatura import — auto-fills DC and DM history per UC */}
      <FaturaUpload ucs={grupoAUCs} onApply={onUpdate} />

      {/* Header info */}
      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Otimização da Demanda Contratada</h3>
        <p className="text-sm text-slate-600 mb-3">
          Com base no histórico de 12 meses de <strong>demanda medida (DM)</strong>, o otimizador calcula a DC que minimiza o custo
          total de demanda considerando três cenários: subutilização (DM &lt; DC), normal (DC ≤ DM ≤ DC × 1,05) e ultrapassagem (DM &gt; DC × 1,05, multa 100%).
        </p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-500">Tarifa demanda sem tributos:</span>{' '}
            <strong className="font-mono">R$ {tariffSemTrib.toFixed(2)}/kW/mês</strong>
          </div>
          <div>
            <span className="text-slate-500">Tarifa demanda com tributos:</span>{' '}
            <strong className="font-mono">R$ {tariffComTrib.toFixed(2)}/kW/mês</strong>
          </div>
        </div>
      </div>

      {/* Per-UC analysis */}
      {grupoAUCs.map(uc => (
        <UCDemandaCard key={uc.id} uc={uc} tariffComTrib={tariffComTrib} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

// ─── Per-UC sub-component ───────────────────────────────────────────
function UCDemandaCard({
  uc,
  tariffComTrib,
  onUpdate,
}: {
  uc: ConsumptionUnit;
  tariffComTrib: number;
  onUpdate: (ucId: string, updates: Partial<ConsumptionUnit>) => void;
}) {
  const dcAtual = uc.demandaContratadaFP ?? 0;
  const dmHistory = useMemo(() => {
    const arr = uc.demandaMedidaMensal ?? [];
    while (arr.length < 12) arr.push(0);
    return arr.slice(0, 12);
  }, [uc.demandaMedidaMensal]);

  const hasData = dmHistory.some(v => v > 0);

  const currentCost = useMemo(() => {
    if (!hasData || dcAtual === 0) return null;
    return computeAnnualDemandaCost(dcAtual, dmHistory, tariffComTrib);
  }, [dcAtual, dmHistory, tariffComTrib, hasData]);

  const optimal = useMemo(() => {
    if (!hasData) return null;
    return optimizeDemandaContratada(dmHistory, tariffComTrib);
  }, [dmHistory, tariffComTrib, hasData]);

  const optimalCost = useMemo(() => {
    if (!optimal || optimal.bestDC === 0) return null;
    return computeAnnualDemandaCost(optimal.bestDC, dmHistory, tariffComTrib);
  }, [optimal, dmHistory, tariffComTrib]);

  const savings = useMemo(() => {
    if (!currentCost || !optimalCost) return null;
    return currentCost.totalCost - optimalCost.totalCost;
  }, [currentCost, optimalCost]);

  const chartData = useMemo(() => {
    if (!optimal || optimal.sensitivity.length === 0) return [];
    return optimal.sensitivity;
  }, [optimal]);

  const updateDC = (val: number) => onUpdate(uc.id, { demandaContratadaFP: val });
  const updateDM = (monthIdx: number, val: number) => {
    const newArr = [...dmHistory];
    newArr[monthIdx] = val;
    onUpdate(uc.id, { demandaMedidaMensal: newArr });
  };

  return (
    <div className="border border-slate-200 rounded-xl p-5 bg-white">
      <div className="flex items-baseline justify-between mb-4">
        <h4 className="text-base font-semibold text-slate-800">{uc.name}</h4>
        <span className="text-xs text-slate-500 font-mono">{uc.tariffGroup}</span>
      </div>

      {/* DC and DM inputs */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        <div className="col-span-1">
          <label className="block text-xs font-medium text-slate-600 mb-1">Demanda Contratada (kW)</label>
          <input
            type="number"
            min={0}
            value={dcAtual}
            onChange={e => updateDC(parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-right focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <p className="text-[10px] text-slate-400 mt-1">Valor atual do contrato</p>
        </div>
        <div className="col-span-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Histórico Demanda Medida (12 meses, kW)
          </label>
          <div className="grid grid-cols-12 gap-1">
            {dmHistory.map((v, i) => (
              <div key={i} className="flex flex-col items-center">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={v || ''}
                  onChange={e => updateDM(i, parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full px-1 py-1 border border-slate-300 rounded text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
                <span className="text-[9px] text-slate-400 mt-0.5">{MONTH_SHORT[i]}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            Copie da seção "Consumo dos últimos 13 meses" da fatura (coluna demanda medida)
          </p>
        </div>
      </div>

      {hasData && dcAtual > 0 && currentCost && optimalCost && optimal && savings !== null && (
        <>
          {/* Comparison KPIs */}
          <div className="grid grid-cols-4 gap-3 mt-5 mb-5">
            <div className="p-3 bg-slate-50 rounded-lg border-l-4 border-slate-400">
              <div className="text-[10px] uppercase text-slate-500 font-semibold mb-1">DC Atual</div>
              <div className="text-lg font-bold text-slate-700 font-mono">{dcAtual} kW</div>
              <div className="text-[11px] text-slate-500 mt-1">{fmtBRL(currentCost.totalCost)}/ano</div>
            </div>
            <div className="p-3 bg-teal-50 rounded-lg border-l-4 border-teal-500">
              <div className="text-[10px] uppercase text-teal-700 font-semibold mb-1">DC Ótima Sugerida</div>
              <div className="text-lg font-bold text-teal-700 font-mono">{optimal.bestDC} kW</div>
              <div className="text-[11px] text-teal-600 mt-1">{fmtBRL(optimalCost.totalCost)}/ano</div>
            </div>
            <div className={`p-3 rounded-lg border-l-4 ${savings > 0 ? 'bg-emerald-50 border-emerald-500' : 'bg-slate-50 border-slate-400'}`}>
              <div className="text-[10px] uppercase text-slate-500 font-semibold mb-1">Economia Anual</div>
              <div className={`text-lg font-bold font-mono ${savings > 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                {fmtBRL(savings)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {currentCost.totalCost > 0 ? ((savings / currentCost.totalCost) * 100).toFixed(1) : '0'}% redução
              </div>
            </div>
            <div className={`p-3 rounded-lg border-l-4 ${currentCost.ultrapassagemMonths > 0 ? 'bg-red-50 border-red-500' : 'bg-slate-50 border-slate-400'}`}>
              <div className="text-[10px] uppercase text-slate-500 font-semibold mb-1">Status Atual</div>
              <div className="text-sm font-semibold text-slate-700">
                {currentCost.ultrapassagemMonths > 0 && (
                  <span className="text-red-600">{currentCost.ultrapassagemMonths}× ultrapassagem</span>
                )}
                {currentCost.subutilizacaoMonths > 0 && currentCost.ultrapassagemMonths === 0 && (
                  <span className="text-amber-600">{currentCost.subutilizacaoMonths}× subutilização</span>
                )}
                {currentCost.ultrapassagemMonths === 0 && currentCost.subutilizacaoMonths === 0 && (
                  <span className="text-emerald-600">Todos normais</span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {currentCost.subutilizacaoMonths > 0 && currentCost.ultrapassagemMonths > 0 && `${currentCost.subutilizacaoMonths} subutil + ${currentCost.ultrapassagemMonths} ultrap`}
                {currentCost.subutilizacaoMonths === 0 && currentCost.ultrapassagemMonths === 0 && '12 meses dentro da tolerância'}
              </div>
            </div>
          </div>

          {/* Per-month table */}
          <details className="mb-5">
            <summary className="text-sm font-semibold text-slate-700 cursor-pointer py-2">
              Detalhamento mensal (DC atual vs DC ótima)
            </summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-1.5 px-2 text-slate-500 font-medium">Mês</th>
                    <th className="text-right py-1.5 px-2 text-slate-500 font-medium">DM (kW)</th>
                    <th className="text-right py-1.5 px-2 text-slate-500 font-medium">Billed atual</th>
                    <th className="text-center py-1.5 px-2 text-slate-500 font-medium">Cenário atual</th>
                    <th className="text-right py-1.5 px-2 text-slate-500 font-medium">Custo atual</th>
                    <th className="text-right py-1.5 px-2 text-slate-500 font-medium">Billed ótimo</th>
                    <th className="text-right py-1.5 px-2 text-slate-500 font-medium">Custo ótimo</th>
                    <th className="text-right py-1.5 px-2 text-slate-500 font-medium">∆</th>
                  </tr>
                </thead>
                <tbody>
                  {currentCost.byMonth.map((m, i) => {
                    const opt = optimalCost.byMonth[i];
                    const delta = m.cost - opt.cost;
                    const badge = scenarioBadge(m.billing.scenario);
                    return (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-1.5 px-2 font-medium">{MONTH_SHORT[i]}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{m.dm.toFixed(1)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{m.billing.billed.toFixed(1)}</td>
                        <td className="py-1.5 px-2 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: badge.bg, color: badge.fg }}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmtBRL(m.cost)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{opt.billing.billed.toFixed(1)}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmtBRL(opt.cost)}</td>
                        <td className={`py-1.5 px-2 text-right font-mono font-semibold ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {delta !== 0 ? fmtBRL(delta) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-400 bg-slate-50">
                    <td className="py-2 px-2 font-semibold">Total ano</td>
                    <td colSpan={3}></td>
                    <td className="py-2 px-2 text-right font-mono font-bold">{fmtBRL(currentCost.totalCost)}</td>
                    <td></td>
                    <td className="py-2 px-2 text-right font-mono font-bold">{fmtBRL(optimalCost.totalCost)}</td>
                    <td className="py-2 px-2 text-right font-mono font-bold text-emerald-600">{fmtBRL(savings)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>

          {/* Sensitivity chart */}
          <div>
            <h5 className="text-sm font-semibold text-slate-700 mb-2">Sensibilidade: Custo anual × DC contratada</h5>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="dc" tick={{ fontSize: 10 }} label={{ value: 'Demanda Contratada (kW)', position: 'insideBottom', offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => 'R$ ' + (v / 1000).toFixed(0) + 'k'} />
                <Tooltip
                  formatter={(value) => [fmtBRL(Number(value) || 0), 'Custo anual']}
                  labelFormatter={(label) => `DC = ${label} kW`}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Line type="monotone" dataKey="cost" stroke="#2F927B" strokeWidth={2} dot={false} />
                <ReferenceLine x={dcAtual} stroke="#64748b" strokeDasharray="4 4" label={{ value: 'atual', fontSize: 10, fill: '#64748b', position: 'top' }} />
                <ReferenceLine x={optimal.bestDC} stroke="#15803d" strokeDasharray="4 4" label={{ value: 'ótima', fontSize: 10, fill: '#15803d', position: 'top' }} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-slate-400 mt-1">
              Curva em U: à esquerda paga-se muita ultrapassagem; à direita paga-se capacidade ociosa (take-or-pay). O ponto mínimo (linha verde) é a DC ótima.
            </p>
          </div>
        </>
      )}

      {(!hasData || dcAtual === 0) && (
        <p className="text-sm text-slate-500 italic mt-3">
          Preencha DC atual e pelo menos um valor de DM histórica para ver a análise.
        </p>
      )}
    </div>
  );
}
