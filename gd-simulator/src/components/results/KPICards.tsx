import type { SimulationSummary, MonthlyResult } from '../../engine/types';

interface Props {
  summary: SimulationSummary;
  months?: MonthlyResult[];
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function formatKWh(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kWh';
}

export function KPICards({ summary, months }: Props) {
  const comRede = summary.baselineSEM - summary.economiaLiquida - summary.totalPPACost;
  const contractMonths = months?.length || 24;
  const durationLabel = contractMonths % 12 === 0 ? `${contractMonths / 12} anos` : `${contractMonths}m`;

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
      sub: 'Baseline sem geracao distribuida',
      color: 'bg-slate-50 border-slate-200 text-slate-700',
    },
    {
      label: `Custo COM Helexia (${durationLabel})`,
      value: formatBRL(summary.baselineSEM - summary.economiaLiquida),
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
    <div className="grid grid-cols-3 gap-4">
      {cards.map(c => (
        <div key={c.label} className={`rounded-xl border p-4 ${c.color}`}>
          <p className="text-xs font-medium opacity-70">{c.label}</p>
          <p className="text-xl font-bold mt-1">{c.value}</p>
          <p className="text-xs opacity-60 mt-1">{c.sub}</p>
        </div>
      ))}
    </div>
  );
}
