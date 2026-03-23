import type { Plant } from '../../engine/types';
import { CurrencyInput } from '../shared/CurrencyInput';
import { Toggle } from '../shared/Toggle';

interface Props {
  plant: Plant;
  onChange: (p: Plant) => void;
}

export function PlantForm({ plant, onChange }: Props) {
  const update = (field: keyof Plant, value: unknown) => {
    onChange({ ...plant, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Planta</label>
          <input
            value={plant.name}
            onChange={e => update('name', e.target.value)}
            placeholder="Ex: CS3 Cassilândia"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Capacidade (kWac)</label>
          <input
            type="number"
            value={plant.capacityKWac}
            onChange={e => update('capacityKWac', parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <CurrencyInput
          label="PPA Rate (R$/kWh)"
          prefix="R$"
          value={plant.ppaRateRsBRLkWh}
          onChange={v => update('ppaRateRsBRLkWh', v)}
        />
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Início do Contrato</label>
          <input
            type="month"
            value={plant.contractStartMonth}
            onChange={e => update('contractStartMonth', e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          />
        </div>
      </div>

      <Toggle
        checked={plant.useActual}
        onChange={v => update('useActual', v)}
        label="Usar geração real medida"
        description="Alternar entre P50 (PVsyst) e dados reais"
      />

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Perfil de Geração P50 (kWh/mês) — 24 meses
        </label>
        <div className="grid grid-cols-6 gap-2">
          {plant.p50Profile.map((val, i) => (
            <input
              key={i}
              type="number"
              value={val}
              onChange={e => {
                const newProfile = [...plant.p50Profile];
                newProfile[i] = parseFloat(e.target.value) || 0;
                update('p50Profile', newProfile);
              }}
              placeholder={`M${i + 1}`}
              className="px-2 py-1 border border-slate-300 rounded text-xs font-mono text-center"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
