import type { ProjectStatus } from '../engine/types';

// Deal pipeline stages — label, chip styling, and select styling. Single source of truth.
export const STATUS_META: Record<ProjectStatus, { label: string; chip: string }> = {
  rascunho:   { label: 'Rascunho',   chip: 'bg-slate-100 text-slate-600' },
  proposta:   { label: 'Proposta enviada', chip: 'bg-blue-100 text-blue-700' },
  negociacao: { label: 'Em negociação',    chip: 'bg-amber-100 text-amber-800' },
  ganho:      { label: 'Ganho',      chip: 'bg-emerald-100 text-emerald-700' },
  perdido:    { label: 'Perdido',    chip: 'bg-rose-100 text-rose-600' },
};

export const STATUS_ORDER: ProjectStatus[] = ['rascunho', 'proposta', 'negociacao', 'ganho', 'perdido'];

export const statusOf = (s?: ProjectStatus): ProjectStatus => s ?? 'rascunho';
