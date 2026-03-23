import type { Project } from '../../engine/types';
import { Toggle } from '../shared/Toggle';

interface Props {
  scenarios: Project['scenarios'];
  onChange: (updates: Partial<Project['scenarios']>) => void;
  onOptimise: () => void;
  isOptimising: boolean;
}

export function ScenarioPanel({ scenarios, onChange, onOptimise, isOptimising }: Props) {
  return (
    <div className="space-y-4 p-4 bg-slate-50 rounded-xl">
      <h3 className="text-sm font-semibold text-slate-700">Cenários</h3>

      <Toggle
        checked={scenarios.icmsExempt}
        onChange={v => onChange({ icmsExempt: v })}
        label="Isenção ICMS ativa"
        description="Lei 14.300/2022 — SCEE minigeração"
      />

      <Toggle
        checked={scenarios.useActualGeneration}
        onChange={v => onChange({ useActualGeneration: v })}
        label="Usar geração real medida"
        description="Alternar entre P50 e dados reais"
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

      <button
        onClick={onOptimise}
        disabled={isOptimising}
        className="w-full py-2 px-4 bg-navy-600 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: '#004B70' }}
      >
        {isOptimising ? 'Optimizando...' : 'Optimizar Rateio'}
      </button>
    </div>
  );
}
