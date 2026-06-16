import type { AttributionResult } from '../../engine/types';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';

interface Props {
  attribution: AttributionResult;
  plantName?: string;
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const fmtPct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '—');

const COLORS = {
  bank: '#94a3b8',       // slate-400
  ownGen: '#0d9488',     // teal-600
  batDistrib: '#f59e0b', // amber-500
  helexia: '#004B70',    // Helexia blue
  bare: '#dc2626',       // red-600 (cost without any assets)
};

export function AttributionPanel({ attribution, plantName }: Props) {
  const d = attribution.decomposition;
  const usina = plantName?.trim() || 'Usina Helexia';

  // Yearly aggregation for the stacked bar chart
  const yearly: Array<{ year: string; bank: number; ownGen: number; batDistrib: number; helexia: number }> = [];
  if (attribution.monthly.length) {
    const yearMap = new Map<number, { bank: number; ownGen: number; batDistrib: number; helexia: number }>();
    for (const m of attribution.monthly) {
      const y = Math.floor(m.monthIndex / 12) + 1;
      const cur = yearMap.get(y) ?? { bank: 0, ownGen: 0, batDistrib: 0, helexia: 0 };
      cur.bank += m.initialBankEffect;
      cur.ownGen += m.ownPlantsEffect;
      cur.batDistrib += m.batDistribEffect;
      cur.helexia += m.helexiaCS3Effect;
      yearMap.set(y, cur);
    }
    Array.from(yearMap.entries()).sort((a, b) => a[0] - b[0]).forEach(([y, v]) => {
      yearly.push({ year: `Y${y}`, ...v });
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Atribuição de Valor</h3>
        <p className="text-xs text-slate-500">
          Decomposição da economia total do cliente em 4 componentes — só o último ({usina}) envolve PPA.
          Os demais são valor dos ativos pré-existentes do cliente.
        </p>
        <p className="text-xs text-slate-500 mt-1">
          <strong>Atenção:</strong> a linha "{usina}" mostra o <em>valor líquido</em> que a Helexia entrega ao cliente
          (offset de rede menos PPA pago), não o PPA bruto pago. Para o PPA bruto, ver Custo COM Helexia &gt; PPA.
        </p>
      </div>

      {/* Decomposition table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Componente</th>
              <th className="text-right px-4 py-2 font-medium">Valor</th>
              <th className="text-right px-4 py-2 font-medium">% do total</th>
              <th className="text-left px-4 py-2 font-medium">Atribuível a</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-red-50/40">
              <td className="px-4 py-3 text-slate-700">Custo SEM ativos (linha de base)</td>
              <td className="px-4 py-3 text-right font-mono">{fmtBRL(d.bareBaseline)}</td>
              <td className="px-4 py-3 text-right text-slate-400">100,0%</td>
              <td className="px-4 py-3 text-slate-500 text-xs">conta cheia da distribuidora</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-slate-700">
                <span className="inline-block w-2 h-2 rounded mr-2 align-middle" style={{ backgroundColor: COLORS.bank }} />
                Banco inicial (créditos pré-existentes)
              </td>
              <td className="px-4 py-3 text-right font-mono text-emerald-700">−{fmtBRL(d.initialBankEffect)}</td>
              <td className="px-4 py-3 text-right text-slate-500">{fmtPct(d.initialBankEffect, d.totalCustomerBenefit)}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">cliente</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-slate-700">
                <span className="inline-block w-2 h-2 rounded mr-2 align-middle" style={{ backgroundColor: COLORS.ownGen }} />
                Geração própria (usinas do cliente)
              </td>
              <td className="px-4 py-3 text-right font-mono text-emerald-700">−{fmtBRL(d.ownPlantsEffect)}</td>
              <td className="px-4 py-3 text-right text-slate-500">{fmtPct(d.ownPlantsEffect, d.totalCustomerBenefit)}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">cliente</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-slate-700">
                <span className="inline-block w-2 h-2 rounded mr-2 align-middle" style={{ backgroundColor: COLORS.batDistrib }} />
                Distribuição BAT → outras UCs
              </td>
              <td className="px-4 py-3 text-right font-mono text-emerald-700">−{fmtBRL(d.batDistribEffect)}</td>
              <td className="px-4 py-3 text-right text-slate-500">{fmtPct(d.batDistribEffect, d.totalCustomerBenefit)}</td>
              <td className="px-4 py-3 text-slate-500 text-xs">cliente (rateio interno)</td>
            </tr>
            <tr className="bg-blue-50/40 border-t-2 border-slate-200">
              <td className="px-4 py-3 text-slate-700 font-semibold">
                <span className="inline-block w-2 h-2 rounded mr-2 align-middle" style={{ backgroundColor: COLORS.helexia }} />
                {usina} (valor líquido após PPA)
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold text-blue-800">−{fmtBRL(d.helexiaCS3Effect)}</td>
              <td className="px-4 py-3 text-right font-semibold text-blue-800">{fmtPct(d.helexiaCS3Effect, d.totalCustomerBenefit)}</td>
              <td className="px-4 py-3 text-slate-700 text-xs font-medium">Helexia</td>
            </tr>
            <tr className="bg-slate-50 font-semibold">
              <td className="px-4 py-3 text-slate-800">Custo COM Helexia (final)</td>
              <td className="px-4 py-3 text-right font-mono">{fmtBRL(d.bareBaseline - d.totalCustomerBenefit)}</td>
              <td className="px-4 py-3 text-right text-slate-500">
                {fmtPct(d.bareBaseline - d.totalCustomerBenefit, d.bareBaseline)}
              </td>
              <td className="px-4 py-3" />
            </tr>
            <tr className="font-semibold">
              <td className="px-4 py-3 text-slate-800">Economia total do cliente</td>
              <td className="px-4 py-3 text-right font-mono text-emerald-800">{fmtBRL(d.totalCustomerBenefit)}</td>
              <td className="px-4 py-3 text-right text-emerald-800">
                {fmtPct(d.totalCustomerBenefit, d.bareBaseline)}
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">soma dos 4 componentes</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Headline summary box */}
      <div className="rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4">
        <div className="text-xs uppercase tracking-wide text-blue-700 font-semibold mb-1">
          Atribuição Helexia (valor líquido após PPA)
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-bold text-blue-900 font-mono">{fmtBRL(d.helexiaCS3Effect)}</span>
          <span className="text-sm text-blue-700">
            de {fmtBRL(d.totalCustomerBenefit)} de economia total ({fmtPct(d.helexiaCS3Effect, d.totalCustomerBenefit)})
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          Valor líquido que a Helexia entrega: offset de rede pela usina menos o PPA pago à Helexia.
          Os demais componentes ({fmtBRL(d.totalCustomerBenefit - d.helexiaCS3Effect)}) já existiriam sem a Helexia.
        </p>
      </div>

      {/* Yearly stacked chart */}
      {yearly.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Decomposição anual da economia</h4>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={yearly} margin={{ top: 8, right: 12, bottom: 4, left: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#64748b" fontSize={12} />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                tickFormatter={(v: number) => `R$ ${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(v) => fmtBRL(typeof v === 'number' ? v : 0)}
                labelStyle={{ color: '#1e293b' }}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="bank" stackId="a" fill={COLORS.bank} name="Banco inicial" />
              <Bar dataKey="ownGen" stackId="a" fill={COLORS.ownGen} name="Geração própria" />
              <Bar dataKey="batDistrib" stackId="a" fill={COLORS.batDistrib} name="BAT → outras UCs" />
              <Bar dataKey="helexia" stackId="a" fill={COLORS.helexia} name={usina} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* {usina} detail — gross grid offset vs PPA paid */}
      {(() => {
        const semScenario = attribution.scenarios.find(s => s.name === 'withBATdistrib');
        const comScenario = attribution.scenarios.find(s => s.name === 'withCS3');
        if (!semScenario || !comScenario) return null;
        const grossGridOffset =
          (semScenario.totalRedeCost - comScenario.totalRedeCost) +
          (semScenario.totalIcmsAdditional - comScenario.totalIcmsAdditional);
        const ppaPaid = comScenario.totalPPACost;
        const netHelexia = grossGridOffset - ppaPaid;
        return (
          <div className="rounded-xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-700 mb-3">
              Detalhe {usina} — bruto vs líquido
            </h4>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="px-2 py-2 text-slate-700">
                    Offset bruto da rede pela usina Helexia
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-700">
                    +{fmtBRL(grossGridOffset)}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">
                    contas evitadas pela usina a tarifa cheia
                  </td>
                </tr>
                <tr>
                  <td className="px-2 py-2 text-slate-700">
                    (−) PPA pago à Helexia
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-rose-700">
                    −{fmtBRL(ppaPaid)}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500">
                    R$ {(comScenario.totalPPACost / Math.max(1, attribution.monthly.length) * 12).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}/ano · receita Helexia
                  </td>
                </tr>
                <tr className="bg-blue-50/40 font-semibold border-t-2 border-slate-200">
                  <td className="px-2 py-2 text-slate-800">
                    = Valor líquido entregue ao cliente
                  </td>
                  <td className="px-2 py-2 text-right font-mono text-blue-800">
                    {fmtBRL(netHelexia)}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-600">
                    bate com linha "{usina}" acima
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-3">
              <strong>Spread:</strong> a Helexia recebe {fmtBRL(ppaPaid)} via PPA, mas entrega {fmtBRL(grossGridOffset)} de offset à rede.
              A diferença ({fmtBRL(netHelexia)}) é o ganho do cliente — o que justifica o contrato.
            </p>
          </div>
        );
      })()}

      {/* Reconciliation footer */}
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer hover:text-slate-700">Reconciliação de cenários (auditoria)</summary>
        <div className="mt-3 rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full font-mono">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Cenário</th>
                <th className="text-right px-3 py-2 font-medium">Custo rede</th>
                <th className="text-right px-3 py-2 font-medium">PPA</th>
                <th className="text-right px-3 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {attribution.scenarios.map(s => (
                <tr key={s.name}>
                  <td className="px-3 py-2 text-slate-700 font-sans">{s.label}</td>
                  <td className="px-3 py-2 text-right">{fmtBRL(s.totalRedeCost)}</td>
                  <td className="px-3 py-2 text-right">{s.totalPPACost > 0 ? fmtBRL(s.totalPPACost) : '—'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-800">{fmtBRL(s.totalCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
