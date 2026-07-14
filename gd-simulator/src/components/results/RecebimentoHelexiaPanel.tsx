import { useMemo } from 'react';
import type { Project, SimulationResult } from '../../engine/types';
import { getAllPlants, computeSimulationMonths } from '../../engine/simulation';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';

interface Props {
  project: Project;
  result: SimulationResult;
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
function kwh(v: number): string {
  return Math.round(v).toLocaleString('pt-BR') + ' kWh';
}

interface PlantSeries {
  name: string;
  ppaRate: number;
  intermPct: number;
  contractMonths: number;
  gen: number[];
  ppaGross: number[];
  interm: number[];
  helexiaNet: number[];
}

export function RecebimentoHelexiaPanel({ project, result }: Props) {
  const months = computeSimulationMonths(project);
  const plants = getAllPlants(project);
  const labels = result.months.map(m => m.label);
  const escPPA = project.tariffEscalationPPA ?? 0;
  const perf = project.performanceFactor ?? 1;
  const degr = project.generationDegradation ?? 0.005;
  const useActual = !!project.scenarios.useActualGeneration;
  const totalCapacity = plants.reduce((a, p) => a + (p.capacityKWac || 0), 0);

  // Per-plant generation + PPA receipts (mirrors the engine's generation logic).
  const series: PlantSeries[] = useMemo(() => {
    return plants.map(plant => {
      const base = (useActual && plant.actualProfile ? plant.actualProfile : plant.p50Profile).map(v => v * perf);
      const monthsP = Math.min(plant.contractMonths || months, months);
      const seasonal = base.slice(0, Math.min(base.length, 12));
      const gen: number[] = [];
      for (let m = 0; m < months; m++) {
        if (m >= monthsP) { gen.push(0); continue; }
        const factor = Math.pow(1 - degr, Math.floor(m / 12));
        const val = m < base.length ? base[m] : (seasonal[m % 12] ?? 0);
        gen.push(Math.round(val * factor));
      }
      const intermPct = plant.intermediationFeePct ?? 0;
      const ppaGross = gen.map((g, m) => g * plant.ppaRateRsBRLkWh * Math.pow(1 + escPPA, Math.floor(m / 12)));
      const interm = ppaGross.map(v => v * intermPct);
      const helexiaNet = ppaGross.map((v, i) => v - interm[i]);
      return {
        name: plant.name,
        ppaRate: plant.ppaRateRsBRLkWh,
        intermPct,
        contractMonths: plant.contractMonths || months,
        gen, ppaGross, interm, helexiaNet,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, months, useActual, perf, degr, escPPA]);

  // Faturamento por COMPENSAÇÃO: o PPA é cobrado sobre os kWh efetivamente compensados no mês
  // (do motor), não sobre a injeção por usina — créditos são fungíveis, então o recebimento é
  // consolidado (não decomposto por usina). Intermediação: média ponderada por capacidade.
  const billOnCompensation = project.scenarios.ppaBillingBasis === 'compensation';
  const blendedIntermPct = totalCapacity > 0
    ? plants.reduce((s, p) => s + (p.intermediationFeePct ?? 0) * (p.capacityKWac || 0), 0) / totalCapacity
    : (plants[0]?.intermediationFeePct ?? 0);
  const compByMonth = useMemo(() => {
    if (!billOnCompensation) return null;
    const ppa: number[] = [], kwh: number[] = [];
    const ucIds = Object.keys(result.ucDetailsCOM ?? {});
    for (let m = 0; m < months; m++) {
      ppa.push(result.months[m]?.ppaCost ?? 0);
      kwh.push(ucIds.reduce((k, id) => k + (result.ucDetailsCOM?.[id]?.[m]?.compensatedKWh ?? 0), 0));
    }
    return { ppa, kwh };
  }, [billOnCompensation, result, months]);

  // Monthly aggregation across all plants (or the compensation series when billing on compensation).
  const monthly = useMemo(() => {
    const rows: { month: string; ppa: number; interm: number; net: number; ppaAcum: number; intermAcum: number; netAcum: number; gen: number }[] = [];
    let ppaAcum = 0, intermAcum = 0, netAcum = 0;
    for (let m = 0; m < months; m++) {
      const ppa = compByMonth ? (compByMonth.ppa[m] || 0) : series.reduce((s, p) => s + (p.ppaGross[m] || 0), 0);
      const interm = compByMonth ? ppa * blendedIntermPct : series.reduce((s, p) => s + (p.interm[m] || 0), 0);
      const net = ppa - interm;
      const gen = compByMonth ? (compByMonth.kwh[m] || 0) : series.reduce((s, p) => s + (p.gen[m] || 0), 0);
      ppaAcum += ppa; intermAcum += interm; netAcum += net;
      rows.push({
        month: labels[m] ?? `M${m + 1}`,
        ppa: Math.round(ppa), interm: Math.round(interm), net: Math.round(net),
        ppaAcum: Math.round(ppaAcum), intermAcum: Math.round(intermAcum), netAcum: Math.round(netAcum),
        gen: Math.round(gen),
      });
    }
    return rows;
  }, [series, months, labels, compByMonth, blendedIntermPct]);

  // Rows for the per-usina table. Under compensation billing the receipt is pooled (not per-usina),
  // so show a single consolidated row instead of one per plant.
  const tableRows = billOnCompensation
    ? [{
        name: plants.length > 1 ? `Compensação (${plants.length} usinas)` : (plants[0]?.name ?? 'Usina'),
        ppaRate: plants[0]?.ppaRateRsBRLkWh ?? 0, intermPct: blendedIntermPct, contractMonths: months,
        gen: monthly.reduce((s, r) => s + r.gen, 0),
        gross: monthly.reduce((s, r) => s + r.ppa, 0),
        interm: monthly.reduce((s, r) => s + r.interm, 0),
        net: monthly.reduce((s, r) => s + r.net, 0),
      }]
    : series.map(p => ({
        name: p.name, ppaRate: p.ppaRate, intermPct: p.intermPct, contractMonths: p.contractMonths,
        gen: p.gen.reduce((a, b) => a + b, 0), gross: p.ppaGross.reduce((a, b) => a + b, 0),
        interm: p.interm.reduce((a, b) => a + b, 0), net: p.helexiaNet.reduce((a, b) => a + b, 0),
      }));

  const totalPPA = monthly.reduce((s, r) => s + r.ppa, 0);
  const totalInterm = monthly.reduce((s, r) => s + r.interm, 0);
  const totalNet = monthly.reduce((s, r) => s + r.net, 0);
  const totalGen = monthly.reduce((s, r) => s + r.gen, 0);
  const hasInterm = totalInterm > 0;
  const monthsWithRevenue = monthly.filter(r => r.ppa > 0).length;
  const avgMonthly = totalNet / Math.max(1, monthsWithRevenue);

  // "Fim PPA" marker: end of the longest PPA, if it ends before the horizon.
  const maxContract = Math.max(...plants.map(p => p.contractMonths || months));
  const fimPPA = maxContract > 0 && maxContract < months ? labels[maxContract - 1] : null;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Recebimento Helexia (PPA)</h3>
        <p className="text-xs text-slate-500">
          Receita mensal e acumulada da Helexia neste projeto (PPA paga pelo cliente sobre o kWh {billOnCompensation ? 'compensado' : 'injetado'}), por usina e total.
          {plants.length > 1 && ` Inclui ${plants.length} usinas (${totalCapacity.toLocaleString('pt-BR')} kWac total).`}
        </p>
      </div>
      {billOnCompensation && (
        <div className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-xs text-teal-900">
          <strong>Faturamento por compensação:</strong> a Helexia cobra o PPA sobre os kWh <strong>efetivamente compensados</strong> a cada mês
          (consumo abatido, incluindo saques do banco), não sobre a injeção. A receita segue o uso dos créditos ao longo do horizonte —
          por isso o recebimento é <strong>consolidado</strong> (não decomposto por usina, já que os créditos são fungíveis).
        </div>
      )}

      {/* KPI cards */}
      <div className={`grid gap-3 ${hasInterm ? 'grid-cols-5' : 'grid-cols-4'}`}>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1">PPA cliente paga (bruto)</div>
          <div className="font-mono text-lg font-bold text-slate-700">{brl(totalPPA)}</div>
          <div className="text-[10px] text-slate-500 mt-1">{months} meses simulados</div>
        </div>
        {hasInterm && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-[10px] text-amber-700 uppercase tracking-wide font-semibold mb-1">Taxa intermediação</div>
            <div className="font-mono text-lg font-bold text-amber-900">−{brl(totalInterm)}</div>
            <div className="text-[10px] text-amber-700 mt-1">{(totalInterm / Math.max(1, totalPPA) * 100).toFixed(1)}% do PPA</div>
          </div>
        )}
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3">
          <div className="text-[10px] text-teal-700 uppercase tracking-wide font-semibold mb-1">Receita Helexia (líquida)</div>
          <div className="font-mono text-lg font-bold text-teal-900">{brl(totalNet)}</div>
          <div className="text-[10px] text-teal-700 mt-1">após intermediação</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1">Média mensal Helexia</div>
          <div className="font-mono text-lg font-bold text-slate-800">{brl(avgMonthly)}</div>
          <div className="text-[10px] text-slate-500 mt-1">{monthsWithRevenue} meses com receita</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-1">Energia faturada</div>
          <div className="font-mono text-lg font-bold text-slate-800">{kwh(totalGen)}</div>
          <div className="text-[10px] text-slate-500 mt-1">Helexia líq: R$ {(totalNet / Math.max(1, totalGen)).toFixed(4)}/kWh</div>
        </div>
      </div>

      {/* Per-usina table */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
          <span className="font-semibold text-slate-800">Receita por usina</span>
          <span className="ml-2 text-xs text-slate-500">total horizonte</span>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Usina</th>
              <th className="text-right px-3 py-2 font-medium">PPA cliente (R$/kWh)</th>
              <th className="text-right px-3 py-2 font-medium">Taxa interm.</th>
              <th className="text-right px-3 py-2 font-medium">Prazo PPA</th>
              <th className="text-right px-3 py-2 font-medium">{billOnCompensation ? 'kWh compensados (faturados)' : 'Geração faturada (kWh)'}</th>
              <th className="text-right px-3 py-2 font-medium">PPA bruto (R$)</th>
              {hasInterm && <th className="text-right px-3 py-2 font-medium">Intermediário</th>}
              <th className="text-right px-3 py-2 font-medium">Helexia líq. (R$)</th>
              <th className="text-right px-3 py-2 font-medium">% líq.</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((p, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 text-right font-mono">R$ {p.ppaRate.toFixed(4)}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.intermPct > 0 ? `${(p.intermPct * 100).toFixed(1)}%` : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.contractMonths}m</td>
                  <td className="px-3 py-2 text-right font-mono">{Math.round(p.gen).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">{brl(p.gross)}</td>
                  {hasInterm && <td className="px-3 py-2 text-right font-mono text-amber-700">{p.interm > 0 ? `−${brl(p.interm)}` : '—'}</td>}
                  <td className="px-3 py-2 text-right font-mono font-semibold text-teal-800">{brl(p.net)}</td>
                  <td className="px-3 py-2 text-right font-mono">{totalNet > 0 ? (p.net / totalNet * 100).toFixed(1) : '—'}%</td>
                </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-bold bg-emerald-50/30">
              <td className="px-3 py-2">TOTAL</td>
              <td /><td /><td />
              <td className="px-3 py-2 text-right font-mono">{Math.round(totalGen).toLocaleString('pt-BR')}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-700">{brl(totalPPA)}</td>
              {hasInterm && <td className="px-3 py-2 text-right font-mono text-amber-700">−{brl(totalInterm)}</td>}
              <td className="px-3 py-2 text-right font-mono text-teal-900">{brl(totalNet)}</td>
              <td className="px-3 py-2 text-right font-mono">100%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Monthly chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h4 className="text-sm font-semibold text-slate-700">
            Receita mensal e acumulada {hasInterm && '(Helexia líquida + intermediação)'}
          </h4>
          <div className="text-xs text-slate-500">Barras = mensal · Linha = acumulado Helexia</div>
        </div>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={monthly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 10 }}
              interval={months > 28 ? 1 : 0}
              angle={months > 16 ? -45 : 0}
              textAnchor={months > 16 ? 'end' : 'middle'}
              height={months > 16 ? 70 : 30}
            />
            <YAxis yAxisId="month" orientation="left" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} />
            <YAxis yAxisId="acum" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v, name) => [brl(v as number), name]} />
            <Legend />
            <Bar yAxisId="month" dataKey="net" name="Helexia líquido (mês)" stackId="ppa" fill="#2F927B" radius={[2, 2, 0, 0]} maxBarSize={months <= 24 ? 18 : 12} />
            {hasInterm && <Bar yAxisId="month" dataKey="interm" name="Intermediação (mês)" stackId="ppa" fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={months <= 24 ? 18 : 12} />}
            <Line yAxisId="acum" dataKey="netAcum" name="Receita Helexia acumulada" stroke="#004B70" strokeWidth={2.5} dot={{ r: 3, fill: '#004B70' }} type="monotone" />
            {fimPPA && <ReferenceLine yAxisId="month" x={fimPPA} stroke="#dc2626" strokeDasharray="6 4" strokeWidth={2} label={{ value: 'Fim PPA', position: 'top', fill: '#dc2626' }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
