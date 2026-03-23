import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { SimulationResult } from '../../engine/types';

interface Props {
  bankPerUC: SimulationResult['bankPerUC'];
  ppaRate: number;
}

export function BankChart({ bankPerUC, ppaRate }: Props) {
  const data = bankPerUC
    .filter(b => b.finalBankCOM > 0 || b.finalBankSEM > 0)
    .map(b => ({
      name: b.name,
      bancoCOM: Math.round(b.finalBankCOM),
      bancoSEM: Math.round(b.finalBankSEM),
      bancoNet: Math.round(b.finalBankCOM - b.finalBankSEM),
      valueAtPPA: Math.round(b.valueAtPPA),
    }));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
          <Tooltip formatter={(value: number) => value.toLocaleString('pt-BR') + ' kWh'} />
          <Legend />
          <Bar dataKey="bancoCOM" name="Banco COM" fill="#2F927B" />
          <Bar dataKey="bancoSEM" name="Banco SEM" fill="#6692A8" />
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-3">UC</th>
              <th className="text-right py-2 px-3">Banco COM (kWh)</th>
              <th className="text-right py-2 px-3">Banco SEM (kWh)</th>
              <th className="text-right py-2 px-3">Banco Net (kWh)</th>
              <th className="text-right py-2 px-3">Valor @ PPA (R$)</th>
            </tr>
          </thead>
          <tbody>
            {bankPerUC.map(b => (
              <tr key={b.ucId} className="border-b border-slate-50">
                <td className="py-1.5 px-3 font-medium">{b.name}</td>
                <td className="py-1.5 px-3 text-right font-mono">{b.finalBankCOM.toLocaleString('pt-BR')}</td>
                <td className="py-1.5 px-3 text-right font-mono">{b.finalBankSEM.toLocaleString('pt-BR')}</td>
                <td className="py-1.5 px-3 text-right font-mono">{(b.finalBankCOM - b.finalBankSEM).toLocaleString('pt-BR')}</td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {b.valueAtPPA.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="py-2 px-3">TOTAL</td>
              <td className="py-2 px-3 text-right font-mono">
                {bankPerUC.reduce((a, b) => a + b.finalBankCOM, 0).toLocaleString('pt-BR')}
              </td>
              <td className="py-2 px-3 text-right font-mono">
                {bankPerUC.reduce((a, b) => a + b.finalBankSEM, 0).toLocaleString('pt-BR')}
              </td>
              <td className="py-2 px-3 text-right font-mono">
                {bankPerUC.reduce((a, b) => a + (b.finalBankCOM - b.finalBankSEM), 0).toLocaleString('pt-BR')}
              </td>
              <td className="py-2 px-3 text-right font-mono">
                {bankPerUC.reduce((a, b) => a + b.valueAtPPA, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
