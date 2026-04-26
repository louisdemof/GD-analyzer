import type { Project } from '../../engine/types';
import { Toggle } from '../shared/Toggle';

interface Props {
  scenarios: Project['scenarios'];
  onChange: (updates: Partial<Project['scenarios']>) => void;
  onOptimise: () => void;
  isOptimising: boolean;
  growthRate?: number;
  generationDegradation?: number;
  performanceFactor?: number;
  tariffEscalationDistributor?: number;
  tariffEscalationPPA?: number;
  onProjectChange?: (updates: Partial<Project>) => void;
}

export function ScenarioPanel({
  scenarios, onChange, onOptimise, isOptimising,
  growthRate = 0.025, generationDegradation = 0.005, performanceFactor = 1.0,
  tariffEscalationDistributor = 0, tariffEscalationPPA = 0,
  onProjectChange,
}: Props) {
  return (
    <div className="space-y-4 p-4 bg-slate-50 rounded-xl">
      <h3 className="text-sm font-semibold text-slate-700">Cenarios</h3>

      <Toggle
        checked={scenarios.icmsExempt}
        onChange={v => onChange({ icmsExempt: v })}
        label="Isencao ICMS ativa"
        description="Lei 14.300/2022 — SCEE minigeracao"
      />

      <Toggle
        checked={scenarios.useActualGeneration}
        onChange={v => onChange({ useActualGeneration: v })}
        label="Usar geracao real medida"
        description="Alternar entre P50 e dados reais"
      />

      <Toggle
        checked={!!scenarios.useOptimizedDemand}
        onChange={v => onChange({ useOptimizedDemand: v })}
        label="Aplicar DC otimizada na simulação"
        description="Usa a demanda contratada ótima (calculada na aba Demanda) para faturar SEM e COM. Reduz o total da fatura em ambos cenários."
      />

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Desconto competidor (Plin): {(scenarios.competitorDiscount * 100).toFixed(0)}%
        </label>
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={scenarios.competitorDiscount * 100}
          onChange={e => onChange({ competitorDiscount: parseInt(e.target.value) / 100 })}
          className="w-full accent-teal-600"
        />
        <div className="flex justify-between text-xs text-slate-400">
          <span>0%</span>
          <span>15%</span>
          <span>30%</span>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4 mt-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Premissas de Crescimento</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Crescimento anual do consumo
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={+(growthRate * 100).toFixed(1)}
                onChange={e => onProjectChange?.({ growthRate: parseFloat(e.target.value) / 100 || 0 })}
                className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center"
              />
              <span className="text-sm text-slate-500">% a.a.</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Padrao: 2,5%. Usado para contratos &gt; 12 meses.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Degradacao anual da geracao
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={3}
                step={0.1}
                value={+(generationDegradation * 100).toFixed(1)}
                onChange={e => onProjectChange?.({ generationDegradation: parseFloat(e.target.value) / 100 || 0 })}
                className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center"
              />
              <span className="text-sm text-slate-500">% a.a.</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Padrao: 0,5%. Degradacao dos modulos fotovoltaicos.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Fator de performance (P50 → real)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={50}
                max={100}
                step={1}
                value={+(performanceFactor * 100).toFixed(0)}
                onChange={e => {
                  const pct = parseFloat(e.target.value);
                  const val = isNaN(pct) ? 1.0 : Math.max(0.5, Math.min(1.0, pct / 100));
                  onProjectChange?.({ performanceFactor: val });
                }}
                className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center"
              />
              <span className="text-sm text-slate-500">% do P50</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Padrao: 100%. Reduza (ex: 90%) para refletir underperformance real.</p>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4 mt-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Reajuste Anual Tarifário</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Distribuidora (Energisa, etc.)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={20}
                step={0.1}
                value={+(tariffEscalationDistributor * 100).toFixed(2)}
                onChange={e => onProjectChange?.({ tariffEscalationDistributor: parseFloat(e.target.value) / 100 || 0 })}
                className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center"
              />
              <span className="text-sm text-slate-500">% a.a.</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Reajuste ANEEL típico 5-8%/ano. Aplicado às tarifas FP, PT, RSV e demanda.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              PPA Helexia
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={20}
                step={0.1}
                value={+(tariffEscalationPPA * 100).toFixed(2)}
                onChange={e => onProjectChange?.({ tariffEscalationPPA: parseFloat(e.target.value) / 100 || 0 })}
                className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center"
              />
              <span className="text-sm text-slate-500">% a.a.</span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Tipicamente IGPM/IPCA (3-5%/ano), conforme contrato.</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-2 italic">
          Reajustes compostos a partir do início do contrato. Ano 1 = base, Ano 2 = base × (1+r), etc.
        </p>
      </div>

      <button
        onClick={onOptimise}
        disabled={isOptimising}
        className="w-full py-2 px-4 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: '#004B70' }}
      >
        {isOptimising ? 'Optimizando...' : 'Optimizar Rateio'}
      </button>
    </div>
  );
}
