import { useState, useMemo } from 'react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { SimulationResult, UCMonthlyDetail, MonthlyResult, ConsumptionUnit, RateioAllocation } from '../../engine/types';

interface Props {
  result: SimulationResult;
  ucs: ConsumptionUnit[];
  months: MonthlyResult[];
  ppaRate: number;
  rateio: RateioAllocation;
  generation: number[];
}

function fmtKWh(v: number) { return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kWh'; }
function fmtBRL(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }

function getRateioFraction(rateio: RateioAllocation, ucId: string, monthIndex: number): number {
  for (const period of rateio.periods) {
    if (monthIndex >= period.start && monthIndex <= period.end) {
      const alloc = period.allocations.find(a => a.ucId === ucId);
      return alloc ? alloc.fraction : 0;
    }
  }
  return 0;
}

export function BankDynamics({ result, ucs, months, ppaRate, rateio, generation }: Props) {
  const activeUCs = ucs.filter(uc => uc.id !== 'bat');
  const [selectedUC, setSelectedUC] = useState(activeUCs[0]?.id || '');

  // Summary KPIs
  const totalBankCOM = result.bankPerUC.reduce((s, b) => s + b.finalBankCOM, 0);
  const totalBankSEM = result.bankPerUC.reduce((s, b) => s + b.finalBankSEM, 0);
  const netHelexia = totalBankCOM - totalBankSEM;

  // Chart data for selected UC
  const chartData = useMemo(() => {
    const comDetails = result.ucDetailsCOM[selectedUC] || [];
    const semDetails = result.ucDetailsSEM[selectedUC] || [];
    return months.map((m, i) => ({
      label: m.label,
      bankCOM: comDetails[i]?.bankEnd ?? 0,
      bankSEM: semDetails[i]?.bankEnd ?? 0,
      depleted: (comDetails[i]?.bankEnd ?? 0) === 0 || (semDetails[i]?.bankEnd ?? 0) === 0,
    }));
  }, [selectedUC, result, months]);

  // Detailed table for selected UC
  const comDetails = result.ucDetailsCOM[selectedUC] || [];
  const semDetails = result.ucDetailsSEM[selectedUC] || [];
  const selUC = ucs.find(u => u.id === selectedUC);

  // Summary table — all UCs at month 24, sorted by net contribution
  const summaryData = useMemo(() => {
    return [...result.bankPerUC]
      .map(b => ({
        ...b,
        netKWh: b.finalBankCOM - b.finalBankSEM,
        netValue: b.valueAtPPA,
        pctOfTotal: netHelexia > 0 ? ((b.finalBankCOM - b.finalBankSEM) / netHelexia) * 100 : 0,
        uc: ucs.find(u => u.id === b.ucId),
      }))
      .sort((a, b) => b.netKWh - a.netKWh);
  }, [result.bankPerUC, netHelexia, ucs]);

  const exportCSV = () => {
    const header = 'UC,Grupo,Banco SEM (kWh),Banco COM (kWh),Delta Helexia (kWh),Valor @ PPA (R$),% do Total';
    const rows = summaryData.map(d =>
      `${d.name},${d.uc?.tariffGroup || ''},${d.finalBankSEM},${d.finalBankCOM},${d.netKWh},${d.netValue.toFixed(2)},${d.pctOfTotal.toFixed(1)}%`
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'banco_creditos.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
          <p className="text-xs font-medium text-teal-600">Banco Residual COM Helexia</p>
          <p className="text-xl font-bold text-teal-800 mt-1">{fmtKWh(totalBankCOM)}</p>
          <p className="text-xs text-teal-600 mt-1">{fmtBRL(totalBankCOM * ppaRate)} @ PPA</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-medium text-blue-600">Contribuição Líquida Helexia</p>
          <p className="text-xl font-bold text-blue-800 mt-1">{fmtKWh(netHelexia)}</p>
          <p className="text-xs text-blue-600 mt-1">{fmtBRL(netHelexia * ppaRate)} @ PPA</p>
        </div>
      </div>

      {/* UC Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {activeUCs.map(uc => (
          <button
            key={uc.id}
            onClick={() => setSelectedUC(uc.id)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
              selectedUC === uc.id
                ? 'text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            style={selectedUC === uc.id ? { backgroundColor: '#004B70' } : undefined}
          >
            {uc.name}
          </button>
        ))}
      </div>

      {/* Bank Evolution Chart */}
      {selUC && (
        <div>
          <h4 className="text-sm font-medium text-slate-600 mb-2">
            Evolução do Banco — {selUC.name} ({selUC.tariffGroup})
          </h4>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value, name) => [
                  fmtKWh(value as number),
                  name === 'bankCOM' ? 'Banco COM' : 'Banco SEM',
                ]}
              />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
              <Area dataKey="bankSEM" name="bankSEM" fill="#6692A8" fillOpacity={0.2} stroke="#6692A8" strokeDasharray="5 5" strokeWidth={2} />
              <Area dataKey="bankCOM" name="bankCOM" fill="#2F927B" fillOpacity={0.15} stroke="#004B70" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly Detail Table */}
      {selUC && comDetails.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-600 mb-2">Detalhamento Mensal — {selUC.name}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-1.5 px-2 text-slate-500" rowSpan={2}>Mês</th>
                  <th className="text-right py-1.5 px-2 text-slate-500" rowSpan={2}>Cons. FP</th>
                  {selUC.isGrupoA && <th className="text-right py-1.5 px-2 text-slate-500" rowSpan={2}>Cons. PT</th>}
                  <th className="text-right py-1.5 px-2 text-slate-500" rowSpan={2}>Gen Própria</th>
                  <th className="text-center py-1 px-2 text-blue-600 font-semibold border-b border-blue-200" colSpan={3}>SEM Helexia</th>
                  <th className="text-center py-1 px-2 text-teal-600 font-semibold border-b border-teal-200" colSpan={4}>COM Helexia</th>
                  <th className="text-right py-1.5 px-2 text-slate-500 font-semibold" rowSpan={2}>Economia</th>
                </tr>
                <tr className="border-b border-slate-200">
                  <th className="text-right py-1 px-2 text-blue-500 text-[9px]">Banco Início</th>
                  <th className="text-right py-1 px-2 text-blue-500 text-[9px]">Banco Fim</th>
                  <th className="text-right py-1 px-2 text-blue-500 text-[9px]">Custo Rede</th>
                  <th className="text-right py-1 px-2 text-teal-500 text-[9px]">Injeção CS3</th>
                  <th className="text-right py-1 px-2 text-teal-500 text-[9px]">Banco Início</th>
                  <th className="text-right py-1 px-2 text-teal-500 text-[9px]">Banco Fim</th>
                  <th className="text-right py-1 px-2 text-teal-500 text-[9px]">Custo Rede</th>
                </tr>
              </thead>
              <tbody>
                {comDetails.map((cd, i) => {
                  const sd = semDetails[i];
                  const economia = (sd?.costRede ?? 0) - cd.costRede;
                  const isLast = i === 23;
                  const semBankDepleted = (sd?.bankEnd ?? 0) === 0;

                  return (
                    <tr
                      key={i}
                      className={`border-b border-slate-50 ${
                        isLast ? 'font-bold bg-slate-50' : ''
                      } ${semBankDepleted && (sd?.costRede ?? 0) > 0 ? 'bg-red-50/30' : ''}`}
                    >
                      <td className="py-1 px-2">{months[i]?.label}</td>
                      <td className="py-1 px-2 text-right font-mono">{(selUC.consumptionFP[i] || 0).toLocaleString('pt-BR')}</td>
                      {selUC.isGrupoA && <td className="py-1 px-2 text-right font-mono">{(selUC.consumptionPT[i] || 0).toLocaleString('pt-BR')}</td>}
                      <td className="py-1 px-2 text-right font-mono">{cd.ownGenerationUsed > 0 ? Math.round(cd.ownGenerationUsed).toLocaleString('pt-BR') : '—'}</td>
                      {/* SEM columns */}
                      <td className="py-1 px-2 text-right font-mono text-blue-700">{Math.round(sd?.bankStart ?? 0).toLocaleString('pt-BR')}</td>
                      <td className={`py-1 px-2 text-right font-mono ${semBankDepleted ? 'text-red-600 font-semibold' : 'text-blue-700'}`}>{Math.round(sd?.bankEnd ?? 0).toLocaleString('pt-BR')}</td>
                      <td className={`py-1 px-2 text-right font-mono ${(sd?.costRede ?? 0) > 0 ? 'text-red-600 font-semibold' : 'text-blue-700'}`}>{fmtBRL(sd?.costRede ?? 0)}</td>
                      {/* COM columns */}
                      <td className="py-1 px-2 text-right font-mono text-teal-700">{Math.round(generation[i] * getRateioFraction(rateio, selectedUC, i)).toLocaleString('pt-BR')}</td>
                      <td className="py-1 px-2 text-right font-mono text-teal-700">{Math.round(cd.bankStart).toLocaleString('pt-BR')}</td>
                      <td className="py-1 px-2 text-right font-mono text-teal-700">{Math.round(cd.bankEnd).toLocaleString('pt-BR')}</td>
                      <td className="py-1 px-2 text-right font-mono text-teal-700">{fmtBRL(cd.costRede)}</td>
                      {/* Economia */}
                      <td className={`py-1 px-2 text-right font-mono font-semibold ${economia >= 0 ? 'text-teal-700' : 'text-red-600'}`}>
                        {fmtBRL(economia)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold text-xs">
                  <td className="py-2 px-2" colSpan={selUC.isGrupoA ? 3 : 2}>TOTAL 24m</td>
                  <td className="py-2 px-2 text-right font-mono">{comDetails.reduce((s, d) => s + d.ownGenerationUsed, 0) > 0 ? fmtKWh(comDetails.reduce((s, d) => s + d.ownGenerationUsed, 0)) : '—'}</td>
                  <td colSpan={2}></td>
                  <td className="py-2 px-2 text-right font-mono text-blue-700">{fmtBRL(semDetails.reduce((s, d) => s + d.costRede, 0))}</td>
                  <td className="py-2 px-2 text-right font-mono text-teal-700">{fmtKWh(generation.reduce((s, g, i) => s + g * getRateioFraction(rateio, selectedUC, i), 0))}</td>
                  <td colSpan={2}></td>
                  <td className="py-2 px-2 text-right font-mono text-teal-700">{fmtBRL(comDetails.reduce((s, d) => s + d.costRede, 0))}</td>
                  <td className="py-2 px-2 text-right font-mono text-teal-700">{fmtBRL(semDetails.reduce((s, d) => s + d.costRede, 0) - comDetails.reduce((s, d) => s + d.costRede, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* All-UCs Summary Table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-slate-600">Resumo por UC — Mês 24</h4>
          <button onClick={exportCSV} className="text-xs text-teal-600 hover:text-teal-800 underline">
            Exportar CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-3 text-slate-500">UC</th>
                <th className="text-left py-2 px-3 text-slate-500">Grupo</th>
                <th className="text-right py-2 px-3 text-slate-500">Banco SEM (kWh)</th>
                <th className="text-right py-2 px-3 text-slate-500">Banco COM (kWh)</th>
                <th className="text-right py-2 px-3 text-slate-500">Δ Helexia (kWh)</th>
                <th className="text-right py-2 px-3 text-slate-500">Valor @ PPA (R$)</th>
                <th className="text-right py-2 px-3 text-slate-500">% do Total</th>
              </tr>
            </thead>
            <tbody>
              {summaryData.map((d, i) => {
                const isGrupoA = d.uc?.isGrupoA;
                return (
                  <tr
                    key={d.ucId}
                    className={`border-b border-slate-50 ${
                      isGrupoA ? 'bg-blue-50/30' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                    }`}
                  >
                    <td className={`py-1.5 px-3 font-medium ${isGrupoA ? 'text-blue-800' : ''}`}>{d.name}</td>
                    <td className="py-1.5 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        isGrupoA ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {d.uc?.tariffGroup}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono">{Math.round(d.finalBankSEM).toLocaleString('pt-BR')}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{Math.round(d.finalBankCOM).toLocaleString('pt-BR')}</td>
                    <td className={`py-1.5 px-3 text-right font-mono font-semibold ${d.netKWh >= 0 ? 'text-teal-700' : 'text-red-600'}`}>
                      {Math.round(d.netKWh).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono">{fmtBRL(d.netValue)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{d.pctOfTotal.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="py-2 px-3" colSpan={2}>TOTAL</td>
                <td className="py-2 px-3 text-right font-mono">{Math.round(totalBankSEM).toLocaleString('pt-BR')}</td>
                <td className="py-2 px-3 text-right font-mono">{Math.round(totalBankCOM).toLocaleString('pt-BR')}</td>
                <td className="py-2 px-3 text-right font-mono text-teal-700">{Math.round(netHelexia).toLocaleString('pt-BR')}</td>
                <td className="py-2 px-3 text-right font-mono">{fmtBRL(netHelexia * ppaRate)}</td>
                <td className="py-2 px-3 text-right font-mono">100.0%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
