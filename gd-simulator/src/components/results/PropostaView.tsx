import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { Project, SimulationResult } from '../../engine/types';

const BRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const KWH = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' kWh';
const PCT = (v: number) => (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';

interface Props { project: Project; result: SimulationResult }

// Client-ready one-screen proposal. Branded, print-friendly (Cmd+P → clean PDF),
// designed to be shown or screenshotted for the client — distinct from the analyst tabs.
export function PropostaView({ project, result }: Props) {
  const s = result.summary;
  const months = result.months;
  const comTotal = s.baselineSEM - s.economiaLiquida;
  const durationM = months.length;
  const durationLabel = durationM % 12 === 0 ? `${durationM / 12} ${durationM === 12 ? 'ano' : 'anos'}` : `${durationM} meses`;
  const paybackIdx = months.findIndex(m => m.economiaAcum > 0);
  const paybackLabel = paybackIdx >= 0 ? months[paybackIdx].label : '—';
  const isACL = project.marketType === 'ACL';

  const chartData = months.map(m => ({ label: m.label, acum: Math.round(m.economiaAcum) }));

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Header band */}
      <div className="bg-brand-navy px-8 py-6 flex items-center justify-between">
        <div>
          <img src={`${import.meta.env.BASE_URL}Helexia_logo_WHT_M.png`} alt="Helexia" className="h-7 mb-2" />
          <p className="text-white/70 text-xs tracking-wide uppercase">Proposta de Geração Distribuída</p>
        </div>
        <div className="text-right">
          {project.clientLogo
            ? <img src={project.clientLogo} alt="" className="h-10 ml-auto mb-1 object-contain" />
            : null}
          <p className="text-white font-semibold">{project.clientName}</p>
          <p className="text-white/60 text-xs">{new Date().toLocaleDateString('pt-BR')}</p>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Hero numbers */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl bg-brand-teal/10 border border-brand-teal/30 p-4">
            <p className="text-xs text-brand-teal-700 font-medium">Economia líquida ({durationLabel})</p>
            <p className="text-2xl font-bold text-brand-teal-700 mt-1">{BRL(s.economiaLiquida)}</p>
            <p className="text-xs text-brand-teal-700/80 mt-0.5">{PCT(s.economiaPct)} de redução</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <p className="text-xs text-slate-500 font-medium">Economia média / mês</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{BRL(s.economiaPerMonth)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <p className="text-xs text-slate-500 font-medium">Payback</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{paybackLabel}</p>
            <p className="text-xs text-slate-400 mt-0.5">economia &gt; 0</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <p className="text-xs text-slate-500 font-medium">Duração do contrato</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{durationLabel}</p>
          </div>
        </div>

        {/* SEM vs COM */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Custo total no período</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">SEM Helexia (hoje)</p>
              <p className="text-xl font-bold text-slate-700 mt-1">{BRL(s.baselineSEM)}</p>
            </div>
            <div className="rounded-xl border border-brand-teal/30 bg-brand-teal/5 p-4">
              <p className="text-xs text-brand-teal-700">COM Helexia</p>
              <p className="text-xl font-bold text-brand-teal-700 mt-1">{BRL(comTotal)}</p>
              <p className="text-xs text-brand-teal-700/80 mt-0.5">▼ {BRL(s.economiaLiquida)} de economia</p>
            </div>
          </div>
        </div>

        {/* Cumulative savings chart */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Economia acumulada ao longo do contrato</h3>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="propGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2F927B" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2F927B" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={Math.max(0, Math.floor(durationM / 12) - 1)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => [BRL(v as number), 'Economia acum.']} />
              <ReferenceLine y={0} stroke="#94a3b8" />
              <Area dataKey="acum" stroke="#004B70" strokeWidth={2} fill="url(#propGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Premissas */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Premissas</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <Premissa k="Distribuidora" v={project.distributor.name} />
            <Premissa k="Mercado" v={isACL ? 'Livre (ACL)' : 'Cativo'} />
            <Premissa k="PPA Helexia" v={`R$ ${project.plant.ppaRateRsBRLkWh.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/kWh`} />
            <Premissa k="Geração total (P50)" v={KWH(s.totalGeneration)} />
            <Premissa k="Unidades consumidoras" v={String(project.ucs.filter(u => u.id !== 'bat').length)} />
            <Premissa k="Banco residual" v={KWH(s.bancoResidualKWh)} />
            {project.distributor.resolution && (
              <div className="col-span-2 md:col-span-3">
                <Premissa k="Tarifa" v={project.distributor.resolution} />
              </div>
            )}
          </div>
        </div>

        <p className="text-[10px] text-slate-400 border-t border-slate-100 pt-4">
          Helexia Brasil — estimativa baseada em geração P50 e dados fornecidos. Valores reais podem variar
          conforme condições climáticas, alterações tarifárias e disponibilidade da usina. Não inclui CIP,
          reativo excedente nem subsídios.
        </p>
      </div>
    </div>
  );
}

function Premissa({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-50 py-1">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium text-slate-800 text-right">{v}</span>
    </div>
  );
}
