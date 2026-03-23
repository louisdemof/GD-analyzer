import { useState, useCallback } from 'react';
import type { RateioAllocation, ConsumptionUnit } from '../../engine/types';

interface Props {
  rateio: RateioAllocation;
  ucs: ConsumptionUnit[];
  onRateioChange?: (rateio: RateioAllocation) => void;
}

const PERIOD_LABELS = ['P1 (M1-4)', 'P2 (M5-10)', 'P3 (M11-16)', 'P4 (M17-24)'];

export function RateioTable({ rateio, ucs, onRateioChange }: Props) {
  const [editingCell, setEditingCell] = useState<{ ucId: string; pi: number } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [manualPeriods, setManualPeriods] = useState<Set<number>>(new Set());

  const handleCellClick = useCallback((ucId: string, pi: number, currentPct: number) => {
    if (!onRateioChange) return;
    setEditingCell({ ucId, pi });
    setEditValue(currentPct.toFixed(1));
  }, [onRateioChange]);

  const handleCellCommit = useCallback(() => {
    if (!editingCell || !onRateioChange) return;
    const { ucId, pi } = editingCell;
    const newPct = parseFloat(editValue);
    if (isNaN(newPct) || newPct < 0 || newPct > 100) {
      setEditingCell(null);
      return;
    }

    const newFraction = newPct / 100;
    const period = rateio.periods[pi];
    const currentAlloc = period.allocations.find(a => a.ucId === ucId);
    const oldFraction = currentAlloc?.fraction ?? 0;
    const delta = newFraction - oldFraction;

    // Redistribute delta proportionally among other unlocked UCs
    const otherAllocs = period.allocations.filter(a => a.ucId !== ucId && a.fraction > 0);
    const otherSum = otherAllocs.reduce((s, a) => s + a.fraction, 0);

    const newAllocations = period.allocations.map(a => {
      if (a.ucId === ucId) return { ...a, fraction: newFraction };
      if (otherSum > 0 && a.fraction > 0) {
        const share = a.fraction / otherSum;
        return { ...a, fraction: Math.max(0, a.fraction - delta * share) };
      }
      return a;
    });

    const newPeriods = rateio.periods.map((p, i) =>
      i === pi ? { ...p, allocations: newAllocations } : p
    );

    setManualPeriods(prev => new Set(prev).add(pi));
    onRateioChange({ ...rateio, periods: newPeriods, isOptimised: false });
    setEditingCell(null);
  }, [editingCell, editValue, rateio, onRateioChange]);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 px-3 text-slate-500 font-medium">UC</th>
              <th className="text-left py-2 px-3 text-slate-500 font-medium w-16">Grupo</th>
              {PERIOD_LABELS.map((label, i) => (
                <th key={i} className="text-center py-2 px-3 text-slate-500 font-medium">
                  {label}
                  {manualPeriods.has(i) && <span className="ml-1" title="Editado manualmente">✏️</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ucs.map(uc => (
              <tr key={uc.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 px-3 font-medium">{uc.name}</td>
                <td className="py-1.5 px-3">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    uc.isGrupoA ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {uc.tariffGroup}
                  </span>
                </td>
                {rateio.periods.map((period, pi) => {
                  const alloc = period.allocations.find(a => a.ucId === uc.id);
                  const pct = (alloc?.fraction ?? 0) * 100;
                  const intensity = Math.min(pct / 30, 1);
                  const isEditing = editingCell?.ucId === uc.id && editingCell?.pi === pi;

                  return (
                    <td key={pi} className="py-1.5 px-3 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.1"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={handleCellCommit}
                          onKeyDown={e => { if (e.key === 'Enter') handleCellCommit(); if (e.key === 'Escape') setEditingCell(null); }}
                          autoFocus
                          className="w-16 px-1 py-0.5 border border-teal-500 rounded text-center text-xs font-mono focus:outline-none"
                        />
                      ) : (
                        <span
                          onClick={() => handleCellClick(uc.id, pi, pct)}
                          className={`inline-block px-2 py-0.5 rounded font-mono ${
                            onRateioChange ? 'cursor-pointer hover:ring-1 hover:ring-teal-400' : ''
                          }`}
                          style={{
                            backgroundColor: pct > 0
                              ? `rgba(47, 146, 123, ${intensity * 0.3})`
                              : 'transparent',
                            color: pct > 0 ? '#004B70' : '#94a3b8',
                          }}
                        >
                          {pct.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td className="py-2 px-3" colSpan={2}>TOTAL</td>
              {rateio.periods.map((period, pi) => {
                const total = period.allocations.reduce((a, b) => a + b.fraction, 0) * 100;
                const isOk = Math.abs(total - 100) <= 0.1;
                return (
                  <td key={pi} className={`py-2 px-3 text-center font-mono ${
                    isOk ? 'text-teal-700' : 'text-red-600 bg-red-50'
                  }`}>
                    {total.toFixed(1)}%
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-3 text-xs">
        {rateio.isOptimised ? (
          <span className="text-teal-600 font-medium">Optimizado</span>
        ) : (
          <span className="text-slate-400">
            {manualPeriods.size > 0 ? 'Editado manualmente' : 'Distribuição padrão (igual)'}
          </span>
        )}
        {rateio.lastOptimisedAt && (
          <span className="text-slate-400">
            — {new Date(rateio.lastOptimisedAt).toLocaleString('pt-BR')}
          </span>
        )}
        {onRateioChange && (
          <span className="text-slate-400">Clique em uma célula para editar</span>
        )}
      </div>
    </div>
  );
}
