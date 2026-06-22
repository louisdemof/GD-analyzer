import { useState, useMemo } from 'react';
import type { Project } from '../../engine/types';
import { computeDerivedTariffs } from '../../engine/tariff';

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
function monthLabel(start: string, i: number): string {
  const [y, m] = (start || '2026-01').split('-').map(Number);
  const d = (m - 1) + i;
  const yy = y + Math.floor(d / 12);
  const mm = ((d % 12) + 12) % 12;
  return `${MONTHS[mm]}/${String(yy).slice(2)}`;
}
const f = (n: number, d = 2) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Fatura Espelho — reconstrói, linha a linha, a fatura da DISTRIBUIDORA (lado fio) a
 * partir das tarifas + consumo, para validar contra a fatura real (meta: < 1%).
 * Espelha a lógica do SEM em bank.ts: TUSD cobrada cheia, benefício incentivada credita
 * só a base (impostos sobre a cheia); energia (TE) da comercializadora mostrada à parte.
 */
export function FaturaEspelho({ project }: { project: Project }) {
  const ucs = project.ucs.filter(u => u.id !== 'bat');
  const [ucId, setUcId] = useState(ucs[0]?.id ?? '');
  const [month, setMonth] = useState(0);
  const [real, setReal] = useState('');

  const uc = ucs.find(u => u.id === ucId) ?? ucs[0];
  const dist = useMemo(() => computeDerivedTariffs(project.distributor), [project.distributor]);
  const taxes = project.distributor.taxes;
  const g = 1 / ((1 - taxes.PIS - taxes.COFINS) * (1 - taxes.ICMS));
  const isACL = project.marketType === 'ACL';
  const acl = isACL ? (uc?.aclBaselineOverride ?? project.aclBaseline) : null;

  if (!uc) return <div className="text-sm text-slate-500">Adicione uma UC para gerar a fatura espelho.</div>;

  const consFP = uc.consumptionFP?.[month] ?? 0;
  const consPT = uc.consumptionPT?.[month] ?? 0;
  const dem = uc.demandaFaturadaFP ?? 0;

  // Tarifa "cheia" (com impostos): ACL = só TUSD (fio); Cativo = TUSD+TE bundled.
  const tFP = isACL ? (dist.T_AFP_TUSD ?? 0) : (dist.T_AFP ?? 0);
  const tPT = isACL ? (dist.T_APT_TUSD ?? 0) : (dist.T_APT ?? 0);
  const tDem = dist.T_A_DEMANDA ?? 0;

  // Descontos incentivada (só ACL). Benefício por unidade = desc × base_sem (= tarifa/g).
  const dFP = acl ? (acl.tusdDiscountConsumo ?? 0) : 0;
  const dPT = acl ? (acl.tusdDiscountConsumoPT ?? acl.tusdDiscountConsumo ?? 0) : 0;
  const dDem = acl ? (acl.tusdDiscountDemanda ?? 0) : 0;
  const benFP = dFP * (tFP / g);
  const benPT = dPT * (tPT / g);
  const benDem = dDem * (tDem / g);

  // Energia (TE) comprada na ACL — impostos próprios (PIS/COFINS ~9,25% + ICMS estadual).
  const teSem = acl?.energyPriceSemImp ?? 0;
  const tePC = acl ? (acl.energyPisCofinsPct ?? 0.0925) : 0;
  const teCom = acl ? teSem / ((1 - tePC) * (1 - taxes.ICMS)) : 0;

  // Valores das linhas
  const vFP = consFP * tFP;
  const vPT = consPT * tPT;
  const vDem = dem * tDem;
  const vBen = -(consFP * benFP + consPT * benPT + dem * benDem);
  const totalFio = vFP + vPT + vDem + vBen;
  const vEnergia = (consFP + consPT) * teCom;
  const totalCliente = totalFio + vEnergia;

  const realN = parseFloat(real.replace(/\./g, '').replace(',', '.')) || 0;
  const delta = realN > 0 ? ((totalFio - realN) / realN) * 100 : null;

  // ICMS / PIS-COFINS embutidos em cada linha (sobre a cheia)
  const icmsOf = (v: number) => v * taxes.ICMS / (1 + taxes.ICMS);
  const pcOf = (v: number) => v * (taxes.PIS + taxes.COFINS) / (1 + taxes.PIS + taxes.COFINS);

  const rows: { item: string; qtd: string; tarifa: number; valor: number; muted?: boolean; credit?: boolean }[] = [
    { item: isACL ? 'TUSD Energia Fora Ponta' : 'Consumo Fora Ponta (TUSD+TE)', qtd: `${f(consFP, 0)} kWh`, tarifa: tFP, valor: vFP },
    { item: isACL ? 'TUSD Energia Ponta' : 'Consumo Ponta (TUSD+TE)', qtd: `${f(consPT, 0)} kWh`, tarifa: tPT, valor: vPT },
    { item: 'Demanda', qtd: `${f(dem, 2)} kW`, tarifa: tDem, valor: vDem },
  ];
  if (isACL && vBen < 0) rows.push({ item: `Benefício/Subsídio incentivada (FP ${(dFP * 100).toFixed(0)}% · PT ${(dPT * 100).toFixed(0)}% · dem ${(dDem * 100).toFixed(0)}%)`, qtd: '—', tarifa: 0, valor: vBen, credit: true });

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Fatura Espelho — {isACL ? 'Distribuidora (fio)' : 'Cativo'}</h3>
          <p className="text-xs text-slate-500">Reconstrução linha a linha para validar contra a fatura real (meta &lt; 1%).</p>
        </div>
        <div className="flex gap-2">
          <select value={ucId} onChange={e => setUcId(e.target.value)} className="px-2 py-1.5 border border-slate-300 rounded text-sm">
            {ucs.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="px-2 py-1.5 border border-slate-300 rounded text-sm">
            {(uc.consumptionFP ?? []).map((_, i) => <option key={i} value={i}>{monthLabel(project.plant.contractStartMonth, i)}</option>)}
          </select>
        </div>
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="text-left py-2 px-3 font-medium">Item de Fatura</th>
              <th className="text-right py-2 px-3 font-medium">Quant.</th>
              <th className="text-right py-2 px-3 font-medium">Tarifa (c/ trib)</th>
              <th className="text-right py-2 px-3 font-medium">Valor (R$)</th>
              <th className="text-right py-2 px-3 font-medium">ICMS</th>
              <th className="text-right py-2 px-3 font-medium">PIS/COFINS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className={`py-1.5 px-3 ${r.credit ? 'text-emerald-700' : 'text-slate-700'}`}>{r.item}</td>
                <td className="py-1.5 px-3 text-right text-slate-500 tabular-nums">{r.qtd}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{r.tarifa ? f(r.tarifa, 6) : '—'}</td>
                <td className={`py-1.5 px-3 text-right tabular-nums font-medium ${r.credit ? 'text-emerald-700' : ''}`}>{f(r.valor)}</td>
                <td className="py-1.5 px-3 text-right text-slate-400 tabular-nums">{r.credit ? '—' : f(icmsOf(r.valor))}</td>
                <td className="py-1.5 px-3 text-right text-slate-400 tabular-nums">{r.credit ? '—' : f(pcOf(r.valor))}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <td className="py-2 px-3" colSpan={3}>TOTAL DISTRIBUIDORA (fio)</td>
              <td className="py-2 px-3 text-right tabular-nums">{f(totalFio)}</td>
              <td colSpan={2}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Detalhamento do cálculo do benefício incentivada */}
      {isACL && vBen < 0 && (
        <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-emerald-800 mb-1">Cálculo do Benefício/Subsídio incentivada</h4>
          <p className="text-[11px] text-slate-500 mb-2">
            Desconto incide só sobre a <strong>base da TUSD (sem impostos)</strong>; ICMS + PIS/COFINS continuam sobre a cheia.
            Crédito por unidade = desconto × base, onde base = tarifa cheia ÷ {f(g, 4)} (gross-up).
          </p>
          <table className="w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left py-1">Posto</th>
                <th className="text-right py-1">Quant.</th>
                <th className="text-right py-1">Base s/imp</th>
                <th className="text-right py-1">Desconto</th>
                <th className="text-right py-1">Crédito/un</th>
                <th className="text-right py-1">Total (R$)</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[
                { p: 'Fora Ponta', q: consFP, qu: 'kWh', base: tFP / g, d: dFP, cred: benFP },
                { p: 'Ponta', q: consPT, qu: 'kWh', base: tPT / g, d: dPT, cred: benPT },
                { p: 'Demanda', q: dem, qu: 'kW', base: tDem / g, d: dDem, cred: benDem },
              ].map(r => (
                <tr key={r.p} className="border-t border-emerald-100">
                  <td className="text-left py-1">{r.p}</td>
                  <td className="text-right py-1 text-slate-500">{f(r.q, 0)} {r.qu}</td>
                  <td className="text-right py-1">{f(r.base, 5)}</td>
                  <td className="text-right py-1">{(r.d * 100).toFixed(2)}%</td>
                  <td className="text-right py-1">{f(r.cred, 5)}</td>
                  <td className="text-right py-1 font-medium text-emerald-700">{f(r.q * r.cred)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-emerald-200 font-semibold text-emerald-800">
                <td className="text-left py-1.5" colSpan={5}>Total benefício (= SUBSIDIO/Benefício na fatura)</td>
                <td className="text-right py-1.5">{f(-vBen)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Validação contra fatura real */}
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Total real da fatura distribuidora (R$)</label>
          <input value={real} onChange={e => setReal(e.target.value)} placeholder="ex: 82.878,00" inputMode="decimal"
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-48" />
        </div>
        {delta !== null && (
          <div className={`px-4 py-2 rounded-lg text-sm font-semibold ${Math.abs(delta) <= 1 ? 'bg-emerald-50 text-emerald-700' : Math.abs(delta) <= 3 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
            Δ = {delta > 0 ? '+' : ''}{f(delta, 2)}% {Math.abs(delta) <= 1 ? '✓ dentro de 1%' : ''}
            <span className="font-normal text-slate-500 ml-2">(modelo {f(totalFio)} vs real {f(realN)})</span>
          </div>
        )}
      </div>

      {isACL && (
        <div className="border border-slate-200 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><span className="text-slate-600">Energia (TE) — comercializadora @ R${f(teSem * 1000, 0)}/MWh s/imp</span><span className="tabular-nums">{f(vEnergia)}</span></div>
          <div className="flex justify-between font-semibold mt-1 pt-1 border-t border-slate-200"><span>CUSTO TOTAL CLIENTE (fio + energia)</span><span className="tabular-nums">{f(totalCliente)}</span></div>
          <p className="text-[11px] text-slate-500 mt-2">
            A energia é faturada à parte pela comercializadora (na COPEL aparece via ICMS-ST e é deduzida). A validação &lt;1% é sobre o <strong>total da distribuidora (fio)</strong> acima.
          </p>
        </div>
      )}
    </div>
  );
}
