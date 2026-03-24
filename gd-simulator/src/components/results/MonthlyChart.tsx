import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar, Line, ReferenceLine } from 'recharts';
import type { MonthlyResult } from '../../engine/types';

interface Props {
  months: MonthlyResult[];
}

export function MonthlyChart({ months }: Props) {
  const data = months.map(m => ({
    label: m.label,
    custoSEM: Math.round(m.sem.totalCost),
    ppaCost: Math.round(m.ppaCost),
    redeComCost: Math.round(m.com.redeCost),
    economiaAcum: Math.round(m.economiaAcum),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium text-slate-600 mb-2">Custo Mensal SEM vs COM Helexia</h4>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={data} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />

            {/* Left axis — monthly costs */}
            <YAxis
              yAxisId="cost"
              orientation="left"
              tick={{ fontSize: 10 }}
              tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
              domain={[0, 'auto']}
            />

            {/* Right axis — economia acumulada */}
            <YAxis
              yAxisId="eco"
              orientation="right"
              tick={{ fontSize: 10 }}
              tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
            />

            <Tooltip
              formatter={(value, name) => [
                `R$ ${Math.abs(value as number).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`,
                name,
              ]}
            />
            <Legend />

            {/* SEM Helexia — navy — tall bar — own stack so it renders left */}
            <Bar
              yAxisId="cost"
              dataKey="custoSEM"
              name="Custo SEM Helexia"
              fill="#004B70"
              opacity={0.85}
              stackId="sem"
              maxBarSize={16}
              radius={[2, 2, 0, 0]}
            />

            {/* COM — PPA component — teal — bottom of stack */}
            <Bar
              yAxisId="cost"
              dataKey="ppaCost"
              name="PPA Helexia"
              fill="#2F927B"
              stackId="com"
              maxBarSize={16}
            />

            {/* COM — Rede component — grey-blue — top of stack */}
            <Bar
              yAxisId="cost"
              dataKey="redeComCost"
              name="Custo Rede COM"
              fill="rgb(102, 146, 168)"
              stackId="com"
              maxBarSize={16}
              radius={[2, 2, 0, 0]}
            />

            {/* Economia acumulada — lime line — right axis */}
            <Line
              yAxisId="eco"
              dataKey="economiaAcum"
              name="Economia Acumulada"
              stroke="#C6DA38"
              strokeWidth={2.5}
              dot={{ r: 2, fill: '#C6DA38' }}
              type="monotone"
            />

            {/* Zero reference line */}
            <ReferenceLine yAxisId="eco" y={0} stroke="#999" strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-400 mt-1">
          SEM Helexia (navy) = custo total sem geracao distribuida | COM Helexia = PPA (lime) + Rede residual (teal)
        </p>
      </div>
    </div>
  );
}
