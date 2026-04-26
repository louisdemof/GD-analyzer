import { useMemo, useState } from 'react';
import type { SimulationSummary, MonthlyResult, Project } from '../../engine/types';
import { computeDerivedTariffs } from '../../engine/tariff';

interface Props {
  summary: SimulationSummary;
  months?: MonthlyResult[];
  project?: Project;
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function formatKWh(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kWh';
}

type InvoiceScope = 'total' | 'yearly' | 'monthly';

export function KPICards({ summary, months, project }: Props) {
  const [invoiceView, setInvoiceView] = useState(false);
  const [invoiceScope, setInvoiceScope] = useState<InvoiceScope>('yearly');
  const comRede = summary.baselineSEM - summary.economiaLiquida - summary.totalPPACost;
  const contractMonths = months?.length || 24;
  const durationLabel = contractMonths % 12 === 0 ? `${contractMonths / 12} anos` : `${contractMonths}m`;

  // Compute demanda separately (same value in SEM and COM — not compensated by SCEE)
  const monthlyDemandaR = useMemo(() => {
    if (!project) return 0;
    const dist = computeDerivedTariffs(project.distributor);
    const T_D = dist.T_A_DEMANDA ?? 0;
    if (T_D === 0) return 0;
    const monthlyKW = project.ucs
      .filter(uc => uc.isGrupoA && uc.id !== 'bat')
      .reduce((sum, uc) => sum + (uc.demandaFaturadaFP ?? 0), 0);
    return monthlyKW * T_D;
  }, [project]);
  const demandaTotal = monthlyDemandaR * contractMonths;

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
              {/* Scope toggle */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 mr-1">Visualizar como:</span>
                {([
                  { k: 'total', label: `Total contrato (${durationLabel})` },
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
            </div>
          )}
        </div>
      )}
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
