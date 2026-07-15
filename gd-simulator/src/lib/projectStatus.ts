import type { ProjectStatus } from '../engine/types';

// Deal pipeline stages — label, chip styling, and select styling. Single source of truth.
export const STATUS_META: Record<ProjectStatus, { label: string; chip: string; dot: string }> = {
  rascunho:   { label: 'Rascunho',   chip: 'bg-slate-100 text-slate-600',       dot: '#94a3b8' },
  analise:    { label: 'Análise enviada',  chip: 'bg-cyan-100 text-cyan-700',   dot: '#06b6d4' },
  proposta:   { label: 'Proposta enviada', chip: 'bg-blue-100 text-blue-700',   dot: '#3b82f6' },
  negociacao: { label: 'Em negociação',    chip: 'bg-amber-100 text-amber-800', dot: '#f59e0b' },
  ganho:      { label: 'Ganho',      chip: 'bg-emerald-100 text-emerald-700',   dot: '#10b981' },
  perdido:    { label: 'Perdido',    chip: 'bg-rose-100 text-rose-600',         dot: '#f43f5e' },
};

export const STATUS_ORDER: ProjectStatus[] = ['rascunho', 'analise', 'proposta', 'negociacao', 'ganho', 'perdido'];

export const statusOf = (s?: ProjectStatus): ProjectStatus => s ?? 'rascunho';
