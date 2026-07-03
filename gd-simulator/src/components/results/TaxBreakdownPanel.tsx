import { useState } from 'react';
import type { Project, SimulationResult } from '../../engine/types';
import { computeTaxBreakdown } from '../../engine/taxBreakdown';

interface Props {
  project: Project;
  result: SimulationResult;
}

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
function fmtKWh(v: number): string {
  return Math.round(v).toLocaleString('pt-BR');
}

export function TaxBreakdownPanel({ project, result }: Props) {
  // 'all' = contract total; otherwise month index 0..N-1
  const [selectedMonth, setSelectedMonth] = useState<'all' | number>('all');
  const monthArg = selectedMonth === 'all' ? undefined : selectedMonth;
  const tb = computeTaxBreakdown(project, result, monthArg);
  const PC = tb.distributor.pisRate + tb.distributor.cofinsRate;
  const scopeLabel =
    tb.distributor.icmsScope === 'TE_ONLY' ? 'TE apenas (parcial)' :
    tb.distributor.icmsScope === 'NONE' ? 'Sem isenção (NONE)' :
    'TE+TUSD (total)';
  const pcLabel = tb.distributor.pisCofinsExempt ? 'Sim (padrão)' : 'Não — leak na compensação';
  const icmsLabel = tb.scenarios.icmsExempt ? 'Sim' : 'Não — leak total';

  // Monthly aggregate totals for the footer
  const monthlyTotals = tb.monthly.reduce(
    (acc, m) => ({
      consumo: acc.consumo + m.consumoKWh,
      semRede: acc.semRede + m.semRede,
      comRede: acc.comRede + m.comRede,
      comPPA: acc.comPPA + m.comPPA,
      comTotal: acc.comTotal + m.comTotal,
      economia: acc.economia + m.economia,
    }),
    { consumo: 0, semRede: 0, comRede: 0, comPPA: 0, comTotal: 0, economia: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Detalhe de Impostos por UC</h3>
        <p className="text-xs text-slate-500">
          Composição da fatura (sem impostos / PIS+COFINS / ICMS, separado entre TE e TUSD),
          mostrando SEM Helexia · Rede COM (residual + impostos) · PPA Helexia · Total COM · Economia.
          Use para verificar o impacto exato de cada configuração de isenção / escopo de ICMS.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-1">
        <div className="font-semibold text-slate-700 mb-1">Configuração ativa</div>
        <div><span className="text-slate-500">Distribuidora:</span> <span className="font-medium">{tb.distributor.name} ({tb.distributor.state})</span></div>
        <div><span className="text-slate-500">ICMS:</span> <span className="font-mono">{(tb.distributor.icmsRate*100).toFixed(0)}%</span> · <span className="text-slate-500">PIS+COFINS:</span> <span className="font-mono">{(PC*100).toFixed(2)}%</span></div>
        <div><span className="text-slate-500">Isenção ICMS:</span> <span className="font-medium">{icmsLabel}</span> · <span className="text-slate-500">Escopo:</span> <span className="font-medium">{scopeLabel}</span></div>
        <div><span className="text-slate-500">Isenção PIS/COFINS:</span> <span className="font-medium">{pcLabel}</span></div>
      </div>

      {/* Period selector — choose contract total or a specific month */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
        <label className="font-medium text-slate-700">Período:</label>
        <select
          value={selectedMonth === 'all' ? 'all' : String(selectedMonth)}
          onChange={e => setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">Total do contrato ({tb.contractMonths} meses)</option>
          {result.months.map(m => (
            <option key={m.monthIndex} value={m.monthIndex}>{m.label}</option>
          ))}
        </select>
        {selectedMonth !== 'all' && (
          <span className="text-slate-500">
            Mostrando dados de <strong>{tb.monthLabel}</strong> apenas. Valores por UC e demanda
            referem-se a esse mês individual.
          </span>
        )}
      </div>

      {/* Per-UC breakdown */}
      {tb.ucs.map(u => {
        const totalCom = u.totalCOM; // already includes PPA
        const comRede = u.totalCOM - (u.ppaHelexia ?? 0);
        return (
          <div key={u.ucId} className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
              <span className="font-semibold text-slate-800">{u.ucName}</span>
              <span className="ml-2 text-xs text-slate-500">{u.tariffGroup} · {u.isGrupoA ? 'Grupo A' : 'Grupo B'}</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Componente</th>
                  <th className="text-right px-3 py-2 font-medium">SEM Helexia (R$)</th>
                  <th className="text-right px-3 py-2 font-medium bg-slate-100">Rede COM (R$)</th>
                  <th className="text-right px-3 py-2 font-medium bg-slate-100">PPA Helexia (R$)</th>
                  <th className="text-right px-3 py-2 font-medium bg-slate-100 border-l border-slate-300">Total COM (R$)</th>
                  <th className="text-right px-3 py-2 font-medium">Economia (R$)</th>
                </tr>
              </thead>
              <tbody>
                {u.postos.map((p, pi) => (
                  <PostoRows key={pi} posto={p} />
                ))}
                {u.demanda && (
                  <>
                    <tr className="bg-slate-50 border-t border-slate-200">
                      <td className="px-3 py-2 font-medium text-slate-700" colSpan={6}>
                        Demanda contratada ({u.demanda.kW} kW × {u.demanda.months} meses)
                      </td>
                    </tr>
                    {u.demanda.lines.map((line, i) => (
                      <tr key={`dem-${i}`} className="border-b border-slate-50">
                        <td className="px-3 py-1.5 text-slate-600">{line.label}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmtBRL(line.sem)}</td>
                        <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50">{fmtBRL(line.com)}</td>
                        <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50 text-slate-400">—</td>
                        <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50 border-l border-slate-200">{fmtBRL(line.com)}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-400">—</td>
                      </tr>
                    ))}
                    <tr className="border-b border-slate-200 font-semibold bg-slate-50">
                      <td className="px-3 py-1.5">Subtotal Demanda</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtBRL(u.demanda.subtotal)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtBRL(u.demanda.subtotal)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-400">—</td>
                      <td className="px-3 py-1.5 text-right font-mono border-l border-slate-200">{fmtBRL(u.demanda.subtotal)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-400">—</td>
                    </tr>
                  </>
                )}
                {u.beneficioIncentivadaLines ? (
                  u.beneficioIncentivadaLines.map((ln, i) => {
                    const credit = ln.value < 0; // <0 = crédito (reduz SEM) ; >0 = custo (energia ACL)
                    const mag = Math.abs(ln.value);
                    const sign = credit ? '−' : '+';
                    return (
                      <tr key={i} className={`border-b border-slate-100 ${credit ? 'bg-emerald-50/40' : 'bg-sky-50/40'}`}>
                        <td className={`px-3 py-2 font-medium ${credit ? 'text-emerald-800' : 'text-sky-800'}`}>{ln.label}</td>
                        <td className={`px-3 py-2 text-right font-mono ${credit ? 'text-emerald-700' : 'text-sky-700'}`}>{sign}{fmtBRL(mag)}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400 border-l border-slate-200">—</td>
                        <td className={`px-3 py-2 text-right font-mono ${credit ? 'text-rose-600' : 'text-emerald-700'}`}>{sign}{fmtBRL(mag)}</td>
                      </tr>
                    );
                  })
                ) : u.beneficioIncentivada !== undefined && (
                  <tr className="border-b border-slate-100 bg-emerald-50/40">
                    <td className="px-3 py-2 text-emerald-800 font-medium">Benefício/Subsídio incentivada (energia ACL + desconto TUSD/demanda)</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">−{fmtBRL(u.beneficioIncentivada)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400 border-l border-slate-200">—</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-600">−{fmtBRL(u.beneficioIncentivada)}</td>
                  </tr>
                )}
                {u.ajusteSEM !== undefined && (
                  <tr className="border-b border-slate-100 bg-amber-50/40">
                    <td className="px-3 py-2 text-amber-800 font-medium">Ajuste reajuste tarifário (SEM real)</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-700">−{fmtBRL(u.ajusteSEM)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400 border-l border-slate-200">—</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-600">−{fmtBRL(u.ajusteSEM)}</td>
                  </tr>
                )}
                {u.ajusteRedeCOM !== undefined && (
                  <tr className="border-b border-slate-100 bg-amber-50/40">
                    <td className="px-3 py-2 text-amber-800 font-medium">Ajuste reajuste tarifário / FA (rede COM)</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-700">−{fmtBRL(u.ajusteRedeCOM)}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                    <td className="px-3 py-2 text-right font-mono text-amber-700 border-l border-slate-200">−{fmtBRL(u.ajusteRedeCOM)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">+{fmtBRL(u.ajusteRedeCOM)}</td>
                  </tr>
                )}
                {u.ppaHelexia !== undefined && (
                  <tr className="border-b border-slate-100 bg-blue-50/40">
                    <td className="px-3 py-2 text-slate-700 font-medium">PPA Helexia</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-400">—</td>
                    <td className="px-3 py-2 text-right font-mono text-blue-800 font-semibold">{fmtBRL(u.ppaHelexia)}</td>
                    <td className="px-3 py-2 text-right font-mono text-blue-800 border-l border-slate-200">{fmtBRL(u.ppaHelexia)}</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-600">−{fmtBRL(u.ppaHelexia)}</td>
                  </tr>
                )}
                <tr className="border-t-2 border-slate-300 font-bold bg-emerald-50/30">
                  <td className="px-3 py-2">TOTAL UC</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtBRL(u.totalSEM)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtBRL(comRede)}</td>
                  <td className="px-3 py-2 text-right font-mono text-blue-800">{fmtBRL(u.ppaHelexia ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono border-l border-slate-300">{fmtBRL(totalCom)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${u.totalSEM - totalCom >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {fmtBRL(u.totalSEM - totalCom)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Monthly aggregate breakdown — SEM vs Rede COM vs PPA Helexia vs Total */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
          <span className="font-semibold text-slate-800">Resumo Mensal — Distribuidora vs PPA Helexia</span>
          <span className="ml-2 text-xs text-slate-500">somatório de todas as UCs por mês</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Mês</th>
                <th className="text-right px-3 py-2 font-medium">Consumo (kWh)</th>
                <th className="text-right px-3 py-2 font-medium">SEM Helexia (R$)</th>
                <th className="text-right px-3 py-2 font-medium bg-slate-100">Rede COM (R$)</th>
                <th className="text-right px-3 py-2 font-medium bg-slate-100">PPA Helexia (R$)</th>
                <th className="text-right px-3 py-2 font-medium bg-slate-100 border-l border-slate-300">Total COM (R$)</th>
                <th className="text-right px-3 py-2 font-medium">Economia (R$)</th>
              </tr>
            </thead>
            <tbody>
              {tb.monthly.map(m => (
                <tr key={m.monthIndex} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-3 py-1.5 font-medium">{m.label}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmtKWh(m.consumoKWh)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{fmtBRL(m.semRede)}</td>
                  <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50">{fmtBRL(m.comRede)}</td>
                  <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50 text-blue-700">{fmtBRL(m.comPPA)}</td>
                  <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50 font-semibold border-l border-slate-200">{fmtBRL(m.comTotal)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${m.economia >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                    {fmtBRL(m.economia)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-bold bg-slate-50">
                <td className="px-3 py-2">TOTAL</td>
                <td className="px-3 py-2 text-right font-mono">{fmtKWh(monthlyTotals.consumo)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtBRL(monthlyTotals.semRede)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtBRL(monthlyTotals.comRede)}</td>
                <td className="px-3 py-2 text-right font-mono text-blue-800">{fmtBRL(monthlyTotals.comPPA)}</td>
                <td className="px-3 py-2 text-right font-mono border-l border-slate-300">{fmtBRL(monthlyTotals.comTotal)}</td>
                <td className={`px-3 py-2 text-right font-mono ${monthlyTotals.economia >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {fmtBRL(monthlyTotals.economia)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-slate-400 italic">
        Math: componentes calculados "por dentro" (T_sem / ((1−PIS−COFINS) × (1−ICMS))) — cada linha
        soma à tarifa all-in × kWh que cai na fatura. <strong>Rede COM</strong> inclui o residual após
        compensação SCEE + o leak sobre kWh compensado (ICMS sobre TUSD quando escopo "TE apenas";
        PIS+COFINS quando não isento). <strong>Total COM</strong> = Rede COM + PPA Helexia.
        <strong> Economia</strong> = SEM − Total COM (negativa significa que o PPA Helexia + leaks superam o ganho).
      </p>
    </div>
  );
}

function PostoRows({ posto }: { posto: ReturnType<typeof computeTaxBreakdown>['ucs'][0]['postos'][0] }) {
  return (
    <>
      <tr className="bg-slate-50 border-t border-slate-200">
        <td className="px-3 py-2 font-medium text-slate-700" colSpan={6}>
          Posto {posto.posto} · SEM residual: {fmtKWh(posto.consumoSEM)} kWh · COM residual: {fmtKWh(posto.consumoCOM)} kWh · COM compensado: {fmtKWh(posto.compensadoCOM)} kWh
        </td>
      </tr>
      {posto.lines.map((line, i) => (
        <tr key={i} className="border-b border-slate-50">
          <td className="px-3 py-1.5 text-slate-600">{line.label}</td>
          <td className="px-3 py-1.5 text-right font-mono">{fmtBRL(line.sem)}</td>
          <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50">{fmtBRL(line.com)}</td>
          <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50 text-slate-400">—</td>
          <td className="px-3 py-1.5 text-right font-mono bg-slate-50/50 border-l border-slate-200">{fmtBRL(line.com)}</td>
          <td className={`px-3 py-1.5 text-right font-mono ${line.delta >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
            {fmtBRL(line.delta)}
          </td>
        </tr>
      ))}
      <tr className="border-b border-slate-200 font-semibold bg-slate-50">
        <td className="px-3 py-1.5">Subtotal {posto.posto}</td>
        <td className="px-3 py-1.5 text-right font-mono">{fmtBRL(posto.subtotalSEM)}</td>
        <td className="px-3 py-1.5 text-right font-mono">{fmtBRL(posto.subtotalCOM)}</td>
        <td className="px-3 py-1.5 text-right font-mono text-slate-400">—</td>
        <td className="px-3 py-1.5 text-right font-mono border-l border-slate-200">{fmtBRL(posto.subtotalCOM)}</td>
        <td className={`px-3 py-1.5 text-right font-mono ${posto.subtotalSEM - posto.subtotalCOM >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
          {fmtBRL(posto.subtotalSEM - posto.subtotalCOM)}
        </td>
      </tr>
    </>
  );
}
