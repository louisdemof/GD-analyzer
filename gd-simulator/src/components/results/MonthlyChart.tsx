import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar, Line, LineChart } from 'recharts';
import type { MonthlyResult } from '../../engine/types';

interface Props {
  months: MonthlyResult[];
}

function fmtBRL(v: number) {
  return `R$ ${v.toLocaleString('pt-BR')}`;
}

export function MonthlyChart({ months }: Props) {
  const data = months.map(m => ({
    label: m.label,
    custoSEM: Math.round(m.sem.totalCost),
    custoRede: Math.round(m.com.redeCost),
    custoPPA: Math.round(m.ppaCost),
    economia: Math.round(m.economia),
    economiaAcum: Math.round(m.economiaAcum),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium text-slate-600 mb-2">Custo Mensal SEM vs COM Helexia</h4>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(value, name) => [fmtBRL(value as number), name as string]} />
            <Legend />
            <Bar dataKey="custoSEM" name="Custo SEM" fill="#004B70" opacity={0.6} />
            <Bar dataKey="custoRede" name="Custo Rede COM" stackId="com" fill="#6692A8" />
            <Bar dataKey="custoPPA" name="Custo PPA" stackId="com" fill="#2F927B" />
            <Line dataKey="economia" name="Economia" stroke="#C6DA38" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-400 mt-1">
          COM Helexia = Custo Rede (residual pago à distribuidora) + PPA (pago à Helexia pela injeção)
        </p>
      </div>

      <div>
        <h4 className="text-sm font-medium text-slate-600 mb-2">Economia Acumulada</h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(value) => fmtBRL(value as number)} />
            <Line dataKey="economiaAcum" name="Economia Acumulada" stroke="#2F927B" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
