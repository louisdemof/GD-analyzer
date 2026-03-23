import type { MonthlyResult } from '../../engine/types';

interface Props {
  months: MonthlyResult[];
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function CostWaterfall({ months }: Props) {
  const totals = {
    generation: months.reduce((a, m) => a + m.generation, 0),
    sem: months.reduce((a, m) => a + m.sem.totalCost, 0),
    rede: months.reduce((a, m) => a + m.com.redeCost, 0),
    ppa: months.reduce((a, m) => a + m.ppaCost, 0),
    comTotal: months.reduce((a, m) => a + m.com.totalCost, 0),
    icms: months.reduce((a, m) => a + m.com.icmsAdditional, 0),
    economia: months.reduce((a, m) => a + m.economia, 0),
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="text-left py-2 px-2 text-slate-500">Mês</th>
            <th className="text-right py-2 px-2 text-slate-500">Geração (kWh)</th>
            <th className="text-right py-2 px-2 text-slate-500">Custo SEM</th>
            <th className="text-right py-2 px-2 text-slate-500 bg-slate-50" style={{ borderLeft: '2px solid #e2e8f0' }}>Custo Rede COM</th>
            <th className="text-right py-2 px-2 text-slate-500 bg-slate-50">Custo PPA</th>
            <th className="text-right py-2 px-2 text-slate-500 bg-slate-50 font-semibold" style={{ borderRight: '2px solid #e2e8f0' }}>Total COM</th>
            <th className="text-right py-2 px-2 text-slate-500">ICMS Add.</th>
            <th className="text-right py-2 px-2 text-slate-500 font-semibold">Economia</th>
            <th className="text-right py-2 px-2 text-slate-500 font-semibold">Acumulada</th>
          </tr>
        </thead>
        <tbody>
          {months.map(m => (
            <tr key={m.monthIndex} className="border-b border-slate-50 hover:bg-slate-50">
              <td className="py-1.5 px-2 font-medium">{m.label}</td>
              <td className="py-1.5 px-2 text-right font-mono">{m.generation.toLocaleString('pt-BR')}</td>
              <td className="py-1.5 px-2 text-right font-mono">{formatBRL(m.sem.totalCost)}</td>
              <td className="py-1.5 px-2 text-right font-mono bg-slate-50/50 text-blue-700" style={{ borderLeft: '2px solid #e2e8f0' }}>
                {formatBRL(m.com.redeCost)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono bg-slate-50/50 text-teal-700">
                {formatBRL(m.ppaCost)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono bg-slate-50/50 font-semibold" style={{ borderRight: '2px solid #e2e8f0' }}>
                {formatBRL(m.com.totalCost)}
              </td>
              <td className="py-1.5 px-2 text-right font-mono text-orange-600">
                {m.com.icmsAdditional > 0 ? formatBRL(m.com.icmsAdditional) : '—'}
              </td>
              <td className={`py-1.5 px-2 text-right font-mono font-semibold ${
                m.economia >= 0 ? 'text-teal-700' : 'text-red-600'
              }`}>
                {formatBRL(m.economia)}
              </td>
              <td className={`py-1.5 px-2 text-right font-mono font-semibold ${
                m.economiaAcum >= 0 ? 'text-teal-700' : 'text-red-600'
              }`}>
                {formatBRL(m.economiaAcum)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <td className="py-2 px-2">TOTAL</td>
            <td className="py-2 px-2 text-right font-mono">{totals.generation.toLocaleString('pt-BR')}</td>
            <td className="py-2 px-2 text-right font-mono">{formatBRL(totals.sem)}</td>
            <td className="py-2 px-2 text-right font-mono text-blue-700 bg-slate-50/50" style={{ borderLeft: '2px solid #e2e8f0' }}>
              {formatBRL(totals.rede)}
            </td>
            <td className="py-2 px-2 text-right font-mono text-teal-700 bg-slate-50/50">
              {formatBRL(totals.ppa)}
            </td>
            <td className="py-2 px-2 text-right font-mono bg-slate-50/50" style={{ borderRight: '2px solid #e2e8f0' }}>
              {formatBRL(totals.comTotal)}
            </td>
            <td className="py-2 px-2 text-right font-mono text-orange-600">{formatBRL(totals.icms)}</td>
            <td className="py-2 px-2 text-right font-mono text-teal-700">{formatBRL(totals.economia)}</td>
            <td className="py-2 px-2 text-right font-mono text-teal-700">
              {formatBRL(months[months.length - 1]?.economiaAcum ?? 0)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="text-[10px] text-slate-400 mt-2">
        Custo Rede COM = residual pago à distribuidora após compensação de créditos | Custo PPA = geração injetada × tarifa PPA Helexia
      </p>
    </div>
  );
}
