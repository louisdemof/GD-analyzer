import { useMemo, useState } from 'react';
import type { SimulationSummary, MonthlyResult, Project, SimulationResult } from '../../engine/types';
import { computeDerivedTariffs } from '../../engine/tariff';

interface Props {
  summary: SimulationSummary;
  months?: MonthlyResult[];
  project?: Project;
  result?: SimulationResult;
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function formatKWh(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kWh';
}

type InvoiceScope = 'total' | 'yearly' | 'monthly';
type InvoiceMode = 'agregado' | 'por-uc';

export function KPICards({ summary, months, project, result }: Props) {
  const [invoiceView, setInvoiceView] = useState(false);
  const [invoiceScope, setInvoiceScope] = useState<InvoiceScope>('yearly');
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>('agregado');
  const comRede = summary.baselineSEM - summary.economiaLiquida - summary.totalPPACost;
  const contractMonths = months?.length || 24;
  const durationLabel = contractMonths % 12 === 0 ? `${contractMonths / 12} anos` : `${contractMonths}m`;

  // Compute demanda separately (same value in SEM and COM — not compensated by SCEE)
  const T_DEMANDA = useMemo(() => {
    if (!project) return 0;
    return computeDerivedTariffs(project.distributor).T_A_DEMANDA ?? 0;
  }, [project]);
  const monthlyDemandaR = useMemo(() => {
    if (!project || T_DEMANDA === 0) return 0;
    return project.ucs
      .filter(uc => uc.isGrupoA && uc.id !== 'bat')
      .reduce((sum, uc) => sum + (uc.demandaFaturadaFP ?? 0), 0) * T_DEMANDA;
  }, [project, T_DEMANDA]);
  const demandaTotal = monthlyDemandaR * contractMonths;

  // Per-UC breakdown (used when "Por UC" mode is selected)
  const perUCBreakdown = useMemo(() => {
    if (!project || !result) return [];
    const scopeMonths = invoiceScope === 'yearly' ? Math.min(12, contractMonths)
      : invoiceScope === 'monthly' ? 1 : contractMonths;
    const monthSlice = (arr: { costRede: number; icmsAdditional: number }[] | undefined): { rede: number; icms: number } => {
      if (!arr) return { rede: 0, icms: 0 };
      const slice = invoiceScope === 'yearly' ? arr.slice(0, 12)
        : invoiceScope === 'monthly' ? arr.slice(0, 1)
        : arr;
      const rede = slice.reduce((s, m) => s + (m.costRede || 0), 0);
      const icms = slice.reduce((s, m) => s + (m.icmsAdditional || 0), 0);
      // For "monthly" scope, average instead of summing one month
      if (invoiceScope === 'monthly') {
        return { rede: arr.reduce((s, m) => s + (m.costRede || 0), 0) / Math.max(1, arr.length),
                 icms: arr.reduce((s, m) => s + (m.icmsAdditional || 0), 0) / Math.max(1, arr.length) };
      }
      return { rede, icms };
    };

    return project.ucs.filter(uc => uc.id !== 'bat').map(uc => {
      const sem = monthSlice(result.ucDetailsSEM[uc.id]);
      const com = monthSlice(result.ucDetailsCOM[uc.id]);
      const ucDemandaKW = uc.isGrupoA ? (uc.demandaFaturadaFP ?? 0) : 0;
      const dem = ucDemandaKW * T_DEMANDA * scopeMonths;
      // SEM rede already includes demanda (engine adds it). Energia = rede - demanda.
      const semEnergia = Math.max(0, sem.rede - dem);
      const comEnergiaResidual = Math.max(0, com.rede - dem);
      const semTotal = sem.rede;
      const comTotal = com.rede + sem.icms; // include any ICMS additional
      const economia = semTotal - comTotal; // per-UC economia (excludes shared PPA)
      return {
        ucId: uc.id,
        ucName: uc.name,
        tariffGroup: uc.tariffGroup,
        isGrupoA: uc.isGrupoA,
        energia: semEnergia,
        demanda: dem,
        semTotal,
        comEnergiaResidual,
        comTotal,
        economia, // ∆ rede only — PPA is shared and not allocated per UC
      };
    });
  }, [project, result, invoiceScope, contractMonths, T_DEMANDA]);

  // Decomposition over full contract (used in KPI cards above)
  const semEnergia = summary.baselineSEM - demandaTotal;
  const comTotal = summary.baselineSEM - summary.economiaLiquida;

  // Scope-aware values for the invoice breakdown panel.
  // - 'total':   full contract
  // - 'yearly':  Year 1 (months 0..11), or full contract if <12m
  // - 'monthly': average per month over the contract
  const scopeData = useMemo(() => {
    if (invoiceScope === 'yearly') {
      const y1 = months?.slice(0, Math.min(12, months.length)) ?? [];
      const monthsInY1 = y1.length || 12;
      const sumSEM = y1.reduce((a, m) => a + m.sem.totalCost, 0);
      const sumPPA = y1.reduce((a, m) => a + m.ppaCost, 0);
      const sumRede = y1.reduce((a, m) => a + m.com.redeCost, 0);
      const sumIcms = y1.reduce((a, m) => a + (m.com.icmsAdditional || 0), 0);
      const sumEco = y1.reduce((a, m) => a + m.economia, 0);
      const dem = monthlyDemandaR * monthsInY1;
      return {
        scopeLabel: 'Ano 1',
        sem: sumSEM, energia: sumSEM - dem, demanda: dem,
        rede: sumRede, ppa: sumPPA, icmsAdd: sumIcms,
        comTotal: sumRede + sumPPA + sumIcms,
        economia: sumEco,
        energiaResidual: Math.max(0, sumRede - dem),
      };
    }
    if (invoiceScope === 'monthly') {
      const m = contractMonths || 1;
      return {
        scopeLabel: 'Mensal médio',
        sem: summary.baselineSEM / m,
        energia: (summary.baselineSEM - demandaTotal) / m,
        demanda: monthlyDemandaR,
        rede: comRede / m,
        ppa: summary.totalPPACost / m,
        icmsAdd: 0,
        comTotal: comTotal / m,
        economia: summary.economiaLiquida / m,
        energiaResidual: Math.max(0, (comRede - demandaTotal) / m),
      };
    }
    return {
      scopeLabel: durationLabel,
      sem: summary.baselineSEM,
      energia: semEnergia,
      demanda: demandaTotal,
      rede: comRede,
      ppa: summary.totalPPACost,
      icmsAdd: 0,
      comTotal,
      economia: summary.economiaLiquida,
      energiaResidual: Math.max(0, comRede - demandaTotal),
    };
  }, [invoiceScope, months, contractMonths, monthlyDemandaR, summary, demandaTotal, comRede, comTotal, semEnergia, durationLabel]);

  // Find payback month
  let paybackLabel = '';
  if (months && months.length > 0) {
    const paybackIdx = months.findIndex(m => m.economiaAcum > 0);
    if (paybackIdx >= 0) {
      paybackLabel = `Payback: ${months[paybackIdx].label} (mes ${paybackIdx + 1})`;
    }
  }

  const cards = [
    {
      label: 'Economia Liquida',
      value: formatBRL(summary.economiaLiquida),
      sub: `${(summary.economiaPct * 100).toFixed(1)}% de reducao` + (paybackLabel ? ` | ${paybackLabel}` : ''),
      color: 'bg-teal-50 border-teal-200 text-teal-700',
    },
    {
      label: `Custo SEM Helexia (${durationLabel})`,
      value: formatBRL(summary.baselineSEM),
      sub: demandaTotal > 0
        ? `Energia ${formatBRL(semEnergia)} + Demanda ${formatBRL(demandaTotal)}`
        : 'Baseline sem geracao distribuida',
      color: 'bg-slate-50 border-slate-200 text-slate-700',
    },
    {
      label: `Custo COM Helexia (${durationLabel})`,
      value: formatBRL(comTotal),
      sub: `Rede ${formatBRL(comRede)} + PPA ${formatBRL(summary.totalPPACost)}`,
      color: 'bg-blue-50 border-blue-200 text-blue-700',
    },
    {
      label: 'VALOR TOTAL',
      value: formatBRL(summary.valorTotal),
      sub: 'Economia + Banco Net @ PPA',
      color: 'bg-lime-50 border-lime-300 text-lime-800',
    },
    {
      label: 'Banco Residual COM',
      value: formatKWh(summary.bancoResidualKWh),
      sub: formatBRL(summary.bancoResidualValue) + ' @ PPA',
      color: 'bg-blue-50 border-blue-200 text-blue-700',
    },
    {
      label: 'Risco ICMS',
      value: formatBRL(summary.icmsRisk),
      sub: 'Se isenção perdida',
      color: summary.icmsRisk > 0 ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-slate-50 border-slate-200 text-slate-500',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {cards.map(c => (
          <div key={c.label} className={`rounded-xl border p-4 ${c.color}`}>
            <p className="text-xs font-medium opacity-70">{c.label}</p>
            <p className="text-xl font-bold mt-1">{c.value}</p>
            <p className="text-xs opacity-60 mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Invoice breakdown toggle — shows what the distributor bills vs what Helexia bills */}
      {demandaTotal > 0 && (
        <div className="border border-slate-200 rounded-xl bg-white">
          <button
            onClick={() => setInvoiceView(v => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-xl"
          >
            <span>
              <span className="mr-2">{invoiceView ? '▾' : '▸'}</span>
              Visão Fatura — Como o cliente enxerga o custo ({durationLabel})
            </span>
            <span className="text-xs text-slate-500">
              {invoiceView ? 'Recolher' : 'Expandir'}
            </span>
          </button>

          {invoiceView && (
            <div className="px-4 pb-4 space-y-3">
              {/* Scope + mode toggles */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-500">Período:</span>
                  {([
                    { k: 'total', label: `Total (${durationLabel})` },
                    { k: 'yearly', label: 'Ano 1' },
                    { k: 'monthly', label: 'Mensal médio' },
                  ] as const).map(opt => (
                    <button
                      key={opt.k}
                      onClick={() => setInvoiceScope(opt.k)}
                      className={`px-3 py-1 rounded border transition-colors ${
                        invoiceScope === opt.k
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-slate-500">Visão:</span>
                  {([
                    { k: 'agregado', label: 'Agregado' },
                    { k: 'por-uc', label: 'Por UC' },
                  ] as const).map(opt => (
                    <button
                      key={opt.k}
                      onClick={() => setInvoiceMode(opt.k)}
                      className={`px-3 py-1 rounded border transition-colors ${
                        invoiceMode === opt.k
                          ? 'bg-navy-600 text-white border-slate-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                      style={invoiceMode === opt.k ? { backgroundColor: '#004B70', color: 'white', borderColor: '#004B70' } : {}}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {invoiceMode === 'por-uc' ? (
                <PorUCTable rows={perUCBreakdown} scopeLabel={scopeData.scopeLabel} />
              ) : (
              <div className="grid grid-cols-2 gap-4">
                {/* SEM Helexia — one invoice from distributor */}
                <div className="border border-slate-300 rounded-lg p-4 bg-slate-50">
                  <h4 className="text-sm font-semibold text-slate-800 mb-3 border-b border-slate-300 pb-2">
                    SEM Helexia — Fatura Distribuidora
                    <span className="text-[11px] text-slate-500 font-normal ml-1">({scopeData.scopeLabel})</span>
                  </h4>
                  <div className="space-y-2 text-sm">
                    <InvoiceLine label="Energia (FP + PT + RSV)" value={scopeData.energia} />
                    <InvoiceLine label="Demanda contratada" value={scopeData.demanda} note="Não compensada" />
                    <div className="border-t border-slate-300 pt-2 mt-2 flex justify-between font-semibold text-slate-800">
                      <span>Total Fatura Energisa</span>
                      <span className="font-mono">{formatBRL(scopeData.sem)}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-2 italic">
                      Obs: não inclui CIP, reativo excedente, subsídios rurais — valores marginais ignorados na simulação
                    </div>
                  </div>
                </div>

                {/* COM Helexia — two invoices (distributor + Helexia) */}
                <div className="border border-teal-300 rounded-lg p-4 bg-teal-50">
                  <h4 className="text-sm font-semibold text-slate-800 mb-3 border-b border-teal-300 pb-2">
                    COM Helexia — Fatura Distribuidora + Fatura Helexia
                    <span className="text-[11px] text-slate-500 font-normal ml-1">({scopeData.scopeLabel})</span>
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="text-xs text-slate-600 uppercase font-semibold mt-1">Distribuidora</div>
                    <InvoiceLine label="Energia residual" value={scopeData.energiaResidual} note={scopeData.energiaResidual === 0 ? 'Totalmente compensada' : undefined} />
                    <InvoiceLine label="Demanda contratada" value={scopeData.demanda} note="Idêntica ao SEM" />
                    <div className="border-t border-slate-300 pt-1 mt-1 flex justify-between text-slate-700 text-xs">
                      <span>Subtotal Energisa</span>
                      <span className="font-mono">{formatBRL(scopeData.rede)}</span>
                    </div>

                    <div className="text-xs text-slate-600 uppercase font-semibold mt-3">Helexia</div>
                    <InvoiceLine label="PPA (geração × tarifa)" value={scopeData.ppa} />

                    <div className="border-t-2 border-teal-400 pt-2 mt-2 flex justify-between font-semibold text-slate-800">
                      <span>Total COM Helexia</span>
                      <span className="font-mono">{formatBRL(scopeData.comTotal)}</span>
                    </div>
                    <div className="mt-2 flex justify-between text-teal-700 font-semibold text-sm">
                      <span>Economia líquida</span>
                      <span className="font-mono">−{formatBRL(scopeData.economia)}</span>
                    </div>
                  </div>
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PorUCRow {
  ucId: string;
  ucName: string;
  tariffGroup: string;
  isGrupoA: boolean;
  energia: number;
  demanda: number;
  semTotal: number;
  comEnergiaResidual: number;
  comTotal: number;
  economia: number;
}

function PorUCTable({ rows, scopeLabel }: { rows: PorUCRow[]; scopeLabel: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500 italic">Nenhuma UC para exibir.</p>;
  }
  const totals = rows.reduce((acc, r) => ({
    energia: acc.energia + r.energia,
    demanda: acc.demanda + r.demanda,
    semTotal: acc.semTotal + r.semTotal,
    comEnergiaResidual: acc.comEnergiaResidual + r.comEnergiaResidual,
    comTotal: acc.comTotal + r.comTotal,
    economia: acc.economia + r.economia,
  }), { energia: 0, demanda: 0, semTotal: 0, comEnergiaResidual: 0, comTotal: 0, economia: 0 });

  return (
    <div className="border border-slate-200 rounded-lg overflow-x-auto bg-white">
      <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-200">
        Detalhamento por UC — período: <strong>{scopeLabel}</strong>. Economia mostrada é redução do custo de rede (não inclui PPA, que é compartilhado).
      </div>
      <table className="w-full text-xs">
        <thead className="bg-slate-50">
          <tr>
            <th className="text-left py-2 px-3">UC</th>
            <th className="text-left py-2 px-3">Grupo</th>
            <th className="text-right py-2 px-3 bg-slate-100" colSpan={3}>SEM Helexia (Distribuidora)</th>
            <th className="text-right py-2 px-3 bg-teal-50" colSpan={2}>COM Helexia (Distribuidora)</th>
            <th className="text-right py-2 px-3 bg-emerald-50">∆ Rede</th>
          </tr>
          <tr className="border-t border-slate-200">
            <th className="text-left py-1.5 px-3"></th>
            <th className="text-left py-1.5 px-3"></th>
            <th className="text-right py-1.5 px-3 bg-slate-100">Energia</th>
            <th className="text-right py-1.5 px-3 bg-slate-100">Demanda</th>
            <th className="text-right py-1.5 px-3 bg-slate-100">Total</th>
            <th className="text-right py-1.5 px-3 bg-teal-50">Energia residual</th>
            <th className="text-right py-1.5 px-3 bg-teal-50">Total</th>
            <th className="text-right py-1.5 px-3 bg-emerald-50">Economia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.ucId} className={i % 2 ? 'bg-slate-50' : ''}>
              <td className="py-1.5 px-3">{r.ucName}</td>
              <td className="py-1.5 px-3 text-slate-500">{r.tariffGroup}</td>
              <td className="py-1.5 px-3 text-right font-mono">{formatBRL(r.energia)}</td>
              <td className="py-1.5 px-3 text-right font-mono">{r.isGrupoA ? formatBRL(r.demanda) : <span className="text-slate-400">—</span>}</td>
              <td className="py-1.5 px-3 text-right font-mono font-semibold">{formatBRL(r.semTotal)}</td>
              <td className="py-1.5 px-3 text-right font-mono text-teal-700">{formatBRL(r.comEnergiaResidual)}</td>
              <td className="py-1.5 px-3 text-right font-mono font-semibold text-teal-800">{formatBRL(r.comTotal)}</td>
              <td className="py-1.5 px-3 text-right font-mono font-semibold text-emerald-700">{formatBRL(r.economia)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-400 bg-slate-100 font-semibold">
            <td className="py-2 px-3" colSpan={2}>TOTAL</td>
            <td className="py-2 px-3 text-right font-mono">{formatBRL(totals.energia)}</td>
            <td className="py-2 px-3 text-right font-mono">{formatBRL(totals.demanda)}</td>
            <td className="py-2 px-3 text-right font-mono">{formatBRL(totals.semTotal)}</td>
            <td className="py-2 px-3 text-right font-mono">{formatBRL(totals.comEnergiaResidual)}</td>
            <td className="py-2 px-3 text-right font-mono">{formatBRL(totals.comTotal)}</td>
            <td className="py-2 px-3 text-right font-mono text-emerald-700">{formatBRL(totals.economia)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function InvoiceLine({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-slate-600">
        {label}
        {note && <span className="text-[10px] text-slate-400 ml-1 italic">({note})</span>}
      </span>
      <span className="font-mono text-slate-800">{formatBRL(value)}</span>
    </div>
  );
}
