import { useState } from 'react';
import type { ConsumptionUnit, TariffGroup } from '../../engine/types';

interface Props {
  ucs: ConsumptionUnit[];
  onAdd: (uc: ConsumptionUnit) => void;
  onUpdate: (ucId: string, updates: Partial<ConsumptionUnit>) => void;
  onRemove: (ucId: string) => void;
}

const TARIFF_GROUPS: TariffGroup[] = [
  'B1', 'B2', 'B3',
  'A4_VERDE', 'A4_AZUL',
  'A3A', 'A3A_VERDE', 'A3A_AZUL',
  'A3', 'A3_VERDE', 'A3_AZUL',
  'A2', 'A2_VERDE', 'A2_AZUL',
  'A1', 'A1_VERDE', 'A1_AZUL',
];

const GROUP_LABELS: Record<TariffGroup, string> = {
  B1: 'B1 — Residencial',
  B2: 'B2 — Rural',
  B3: 'B3 — Comercial/Industrial',
  A4_VERDE: 'A4 Verde (<13.8 kV)',
  A4_AZUL: 'A4 Azul (<13.8 kV)',
  A3A: 'A3a (13.8 kV)',
  A3A_VERDE: 'A3a Verde (13.8 kV)',
  A3A_AZUL: 'A3a Azul (13.8 kV)',
  A3: 'A3 (30 kV)',
  A3_VERDE: 'A3 Verde (30 kV)',
  A3_AZUL: 'A3 Azul (30 kV)',
  A2: 'A2 (88 kV)',
  A2_VERDE: 'A2 Verde (88 kV)',
  A2_AZUL: 'A2 Azul (88 kV)',
  A1: 'A1 (230 kV+)',
  A1_VERDE: 'A1 Verde (230 kV+)',
  A1_AZUL: 'A1 Azul (230 kV+)',
};

function isGrupoA(tg: TariffGroup): boolean {
  return tg.startsWith('A');
}

export function UCTable({ ucs, onAdd, onUpdate, onRemove }: Props) {
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState<TariffGroup>('B3');
  const [newBank, setNewBank] = useState(0);

  const handleAdd = () => {
    if (!newName.trim()) return;
    const uc: ConsumptionUnit = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      name: newName.trim(),
      tariffGroup: newGroup,
      isGrupoA: isGrupoA(newGroup),
      consumptionFP: new Array(24).fill(0),
      consumptionPT: new Array(24).fill(0),
      openingBank: newBank,
    };
    onAdd(uc);
    setNewName('');
    setNewBank(0);
  };

  const handleGroupChange = (ucId: string, newTg: TariffGroup) => {
    onUpdate(ucId, {
      tariffGroup: newTg,
      isGrupoA: isGrupoA(newTg),
    });
  };

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-3 text-slate-500 font-medium">Nome</th>
              <th className="text-left py-2 px-3 text-slate-500 font-medium">Grupo Tarifário</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium">Banco Inicial (kWh)</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium">Consumo Médio FP</th>
              <th className="text-center py-2 px-3 text-slate-500 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {ucs.map(uc => {
              const avgFP = uc.consumptionFP.reduce((a, b) => a + b, 0) / 24;
              return (
                <tr key={uc.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={uc.name}
                      onChange={e => onUpdate(uc.id, { name: e.target.value })}
                      className="w-full px-2 py-1 border border-transparent hover:border-slate-300 focus:border-teal-500 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <select
                      value={uc.tariffGroup}
                      onChange={e => handleGroupChange(uc.id, e.target.value as TariffGroup)}
                      className={`px-2 py-1 rounded text-xs font-medium border cursor-pointer focus:outline-none focus:ring-1 focus:ring-teal-500 ${
                        uc.isGrupoA
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-400'
                          : 'bg-green-50 text-green-700 border-green-200 hover:border-green-400'
                      }`}
                    >
                      {TARIFF_GROUPS.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={uc.openingBank}
                      onChange={e => onUpdate(uc.id, { openingBank: parseFloat(e.target.value) || 0 })}
                      className="w-28 px-2 py-1 border border-transparent hover:border-slate-300 focus:border-teal-500 rounded text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-500">
                    {avgFP.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <button
                      onClick={() => onRemove(uc.id)}
                      className="text-red-500 hover:text-red-700 text-xs"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add new UC */}
      <div className="flex items-end gap-3 p-3 bg-slate-50 rounded-lg">
        <div className="flex-1">
          <label className="block text-xs font-medium text-slate-500 mb-1">Nome</label>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nome da UC"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Grupo Tarifário</label>
          <select
            value={newGroup}
            onChange={e => setNewGroup(e.target.value as TariffGroup)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {TARIFF_GROUPS.map(g => (
              <option key={g} value={g}>{GROUP_LABELS[g]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Banco (kWh)</label>
          <input
            type="number"
            value={newBank}
            onChange={e => setNewBank(parseFloat(e.target.value) || 0)}
            className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
        >
          Adicionar UC
        </button>
      </div>
    </div>
  );
}
