import { useState, useMemo } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar, Line, ReferenceLine } from 'recharts';
import type { MonthlyResult } from '../../engine/types';

interface Props {
  months: MonthlyResult[];
  ppaEndMonthIndex?: number;
}

type Granularity = 'mensal' | 'trimestral' | 'semestral' | 'anual';

interface ChartRow {
  label: string;
  custoSEM: number;
  ppaCost: number;
  redeComCost: number;
  economiaAcum: number;
  economia: number;
}

function defaultGranularity(months: number): Granularity {
  if (months <= 24) return 'mensal';
  if (months <= 60) return 'trimestral';
  return 'anual';
}

const BUCKET_SIZE: Record<Granularity, number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

function bucketLabel(granularity: Granularity, bucketIndex: number, firstMonthLabel: string, lastMonthLabel: string): string {
  if (granularity === 'mensal') return firstMonthLabel;
  // For multi-month buckets, show range: "Abr/26–Jun/26" or short form
  if (granularity === 'anual') {
    // Just show the year if all 12 months in same year, else range
    const firstYear = firstMonthLabel.split('/')[1] ?? '';
    const lastYear = lastMonthLabel.split('/')[1] ?? '';
    return firstYear === lastYear ? `Ano ${bucketIndex + 1} (${firstYear})` : `Ano ${bucketIndex + 1}`;
  }
  // Quarterly / semestral — show "Q1: Abr-Jun/26"
  const prefix = granularity === 'trimestral' ? `T${bucketIndex + 1}` : `S${bucketIndex + 1}`;
  // Compact: "T1: Abr–Jun" if same year, else with year on each
  const fStart = firstMonthLabel.split('/')[0];
  const fYear = firstMonthLabel.split('/')[1] ?? '';
  const lStart = lastMonthLabel.split('/')[0];
  const lYear = lastMonthLabel.split('/')[1] ?? '';
  if (fYear === lYear) return `${prefix} ${fStart}-${lStart}/${fYear}`;
  return `${prefix} ${fStart}/${fYear}-${lStart}/${lYear}`;
}

function aggregateByGranularity(months: MonthlyResult[], granularity: Granularity): ChartRow[] {
  const size = BUCKET_SIZE[granularity];
  const buckets: ChartRow[] = [];
  for (let i = 0; i < months.length; i += size) {
    const slice = months.slice(i, i + size);
    if (slice.length === 0) continue;
    const sumSEM = slice.reduce((a, m) => a + m.sem.totalCost, 0);
    const sumPPA = slice.reduce((a, m) => a + m.ppaCost, 0);
    const sumRede = slice.reduce((a, m) => a + m.com.redeCost, 0);
    const sumEconomia = slice.reduce((a, m) => a + m.economia, 0);
    // Economia acumulada: take the LAST value in the bucket (it's already cumulative)
    const lastAcum = slice[slice.length - 1].economiaAcum;
    buckets.push({
      label: bucketLabel(granularity, i / size, slice[0].label, slice[slice.length - 1].label),
      custoSEM: Math.round(sumSEM),
      ppaCost: Math.round(sumPPA),
      redeComCost: Math.round(sumRede),
      economiaAcum: Math.round(lastAcum),
      economia: Math.round(sumEconomia),
    });
  }
  return buckets;
}

export function MonthlyChart({ months, ppaEndMonthIndex }: Props) {
  const [granularity, setGranularity] = useState<Granularity>(defaultGranularity(months.length));
  const data = useMemo(() => aggregateByGranularity(months, granularity), [months, granularity]);

  const isLong = months.length > 24;
  // x value (bucket label) where the PPA ends — null if not applicable
  const ppaEndLabel = useMemo(() => {
    if (ppaEndMonthIndex == null || ppaEndMonthIndex < 0 || ppaEndMonthIndex >= months.length - 1) return null;
    const size = BUCKET_SIZE[granularity];
    const bucketIndex = Math.floor((ppaEndMonthIndex + 1) / size);
    return data[Math.min(bucketIndex, data.length - 1)]?.label ?? null;
  }, [ppaEndMonthIndex, months.length, granularity, data]);
  // Adapt label rendering based on number of buckets (independent of granularity)
  const bucketCount = data.length;
  const rotateLabels = bucketCount > 16;
  // Skip labels to avoid overlap when too many
  const labelInterval = bucketCount > 40 ? 2 : bucketCount > 28 ? 1 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-medium text-slate-600">
          Custo {granularity === 'mensal' ? 'Mensal' : granularity === 'trimestral' ? 'Trimestral' : granularity === 'semestral' ? 'Semestral' : 'Anual'} — SEM vs COM Helexia
        </h4>
        <div className="flex gap-1 text-xs">
          {(['mensal', 'trimestral', 'semestral', 'anual'] as Granularity[]).map(g => {
            const isAvailable = months.length >= BUCKET_SIZE[g];
            return (
              <button
                key={g}
                disabled={!isAvailable}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1 rounded border transition-colors ${
                  granularity === g
                    ? 'bg-teal-600 text-white border-teal-600'
                    : isAvailable
                      ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                }`}
                title={!isAvailable ? `Contrato muito curto para esta granularidade` : ''}
              >
                {g === 'mensal' ? 'Mensal' : g === 'trimestral' ? 'Trimestral' : g === 'semestral' ? 'Semestral' : 'Anual'}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <ResponsiveContainer width="100%" height={isLong && granularity === 'mensal' ? 420 : 340}>
          <ComposedChart data={data} barCategoryGap={granularity === 'mensal' ? '20%' : '12%'}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              interval={labelInterval}
              angle={rotateLabels ? -45 : 0}
              textAnchor={rotateLabels ? 'end' : 'middle'}
              height={rotateLabels ? 70 : 30}
            />

            <YAxis
              yAxisId="cost"
              orientation="left"
              tick={{ fontSize: 10 }}
              tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
              domain={[0, 'auto']}
            />

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

            <Bar
              yAxisId="cost"
              dataKey="custoSEM"
              name="Custo SEM Helexia"
              fill="#004B70"
              opacity={0.85}
              stackId="sem"
              maxBarSize={granularity === 'mensal' ? 16 : 36}
              radius={[2, 2, 0, 0]}
            />

            <Bar
              yAxisId="cost"
              dataKey="ppaCost"
              name="PPA Helexia"
              fill="#2F927B"
              stackId="com"
              maxBarSize={granularity === 'mensal' ? 16 : 36}
            />

            <Bar
              yAxisId="cost"
              dataKey="redeComCost"
              name="Custo Rede COM"
              fill="rgb(102, 146, 168)"
              stackId="com"
              maxBarSize={granularity === 'mensal' ? 16 : 36}
              radius={[2, 2, 0, 0]}
            />

            <Line
              yAxisId="eco"
              dataKey="economiaAcum"
              name="Economia Acumulada"
              stroke="#C6DA38"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#C6DA38' }}
              type="monotone"
            />

            <ReferenceLine yAxisId="eco" y={0} stroke="#999" strokeDasharray="4 4" />

            {ppaEndLabel && (
              <ReferenceLine
                yAxisId="cost"
                x={ppaEndLabel}
                stroke="#dc2626"
                strokeDasharray="6 4"
                strokeWidth={2}
                label={{
                  value: 'Fim PPA',
                  position: 'top',
                  fill: '#dc2626',
                  fontSize: 10,
                  fontWeight: 'bold',
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-400 mt-1">
          SEM Helexia (navy) = custo total sem geração distribuída | COM Helexia = PPA (teal) + Rede residual (cinza)
          {granularity !== 'mensal' && ' | Custos somados por período; economia acumulada é o valor ao final do período'}
          {ppaEndLabel && ' | Linha vermelha = fim do PPA (após este ponto, sem injeção da usina; banco drena se houver crédito)'}
        </p>
      </div>

      <div className="pt-4 border-t border-slate-200">
        <div className="flex items-baseline justify-between mb-2">
          <h4 className="text-sm font-medium text-slate-600">
            Economia Líquida {granularity === 'mensal' ? 'Mensal' : granularity === 'trimestral' ? 'Trimestral' : granularity === 'semestral' ? 'Semestral' : 'Anual'}
          </h4>
          <div className="text-xs text-slate-500">
            Total horizonte:{' '}
            <span className="font-mono font-semibold text-emerald-700">
              {data.reduce((a, d) => a + d.economia, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
            </span>
            {' · '}
            Média:{' '}
            <span className="font-mono">
              {(data.reduce((a, d) => a + d.economia, 0) / Math.max(1, data.length)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={isLong && granularity === 'mensal' ? 260 : 220}>
          <ComposedChart data={data} barCategoryGap={granularity === 'mensal' ? '18%' : '12%'}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              interval={labelInterval}
              angle={rotateLabels ? -45 : 0}
              textAnchor={rotateLabels ? 'end' : 'middle'}
              height={rotateLabels ? 70 : 30}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(value, name) => [
                `R$ ${(value as number).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`,
                name,
              ]}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#999" strokeDasharray="4 4" />
            <Bar
              dataKey="economia"
              name="Economia Líquida"
              fill="#10b981"
              maxBarSize={granularity === 'mensal' ? 16 : 36}
              radius={[2, 2, 0, 0]}
            />
            {ppaEndLabel && (
              <ReferenceLine
                x={ppaEndLabel}
                stroke="#dc2626"
                strokeDasharray="6 4"
                strokeWidth={2}
                label={{
                  value: 'Fim PPA',
                  position: 'top',
                  fill: '#dc2626',
                  fontSize: 10,
                  fontWeight: 'bold',
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-400 mt-1">
          Economia = Custo SEM − (Rede COM + PPA Helexia + ICMS additional + PIS/COFINS additional). Barras verdes positivas = cliente economiza; negativas = COM mais caro que SEM nesse período.
        </p>
      </div>
    </div>
  );
}
