import type { Project } from './types';
import { getAllPlants, computeSimulationMonths, plantStartOffset } from './simulation';

// Non-blocking sanity checks on a project's timeline (PPA start date, PPA duration,
// simulation horizon, multi-plant alignment). These never stop a simulation — dates
// only drive labels + per-plant offsets — they surface footguns the engine swallows.

export interface TimelineWarning {
  level: 'error' | 'warning';
  message: string;
}

const VALID_YM = /^\d{4}-(0[1-9]|1[0-2])$/;

function ymToIndex(ym: string): number | null {
  if (!VALID_YM.test(ym)) return null;
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

/** End month index (0-based) of each plant's PPA = offset + contractMonths − 1. */
function plantEndIndices(project: Project): number[] {
  const anchor = project.plant?.contractStartMonth ?? '';
  return getAllPlants(project).map(
    p => plantStartOffset(anchor, p.contractStartMonth) + (p.contractMonths || 24) - 1,
  );
}

/**
 * @param todayYM optional "AAAA-MM" reference for the past-date check (omit to skip it).
 */
export function timelineWarnings(project: Project, todayYM?: string): TimelineWarning[] {
  const out: TimelineWarning[] = [];
  const start = project.plant?.contractStartMonth;

  // Gap 2 — start date validity (invalid ⇒ "NaN/NaN" month labels)
  if (!start || !VALID_YM.test(start)) {
    out.push({ level: 'error', message: 'Data de início do PPA ausente ou inválida — use AAAA-MM (ex.: 2026-06). Os rótulos de mês ficarão incorretos.' });
  } else if (todayYM && VALID_YM.test(todayYM) && ymToIndex(start)! < ymToIndex(todayYM)!) {
    out.push({ level: 'warning', message: `Início do PPA (${start}) está no passado. Confirme a data de entrada em operação da usina.` });
  }

  const plants = getAllPlants(project);
  const maxEnd = Math.max(0, ...plantEndIndices(project)) + 1; // months of the longest-running plant

  // Gap 3 — explicit horizon shorter than the longest (offset + PPA) silently truncates that plant
  if (project.simulationMonths && project.simulationMonths > 0 && project.simulationMonths < maxEnd) {
    out.push({
      level: 'warning',
      message: `Horizonte de simulação (${project.simulationMonths} meses) é menor que a usina mais longa (${maxEnd} meses, incluindo atraso de entrada) — sua geração e PPA são truncados. Aumente o horizonte ou reduza o prazo.`,
    });
  }

  // Soft — atypical PPA term (terms are normally multiples of 6 months)
  for (const p of plants) {
    if (p.contractMonths && p.contractMonths % 6 !== 0) {
      out.push({ level: 'warning', message: `Prazo de PPA atípico (${p.contractMonths} meses) em "${p.name || 'usina'}". Confirme se é intencional.` });
    }
  }

  return out;
}

/**
 * Distinct PPA-end month indices (0-based), capped at the horizon, for chart markers.
 * With staggered durations this returns one per distinct end (e.g. [17, 23]).
 */
export function ppaEndIndices(project: Project): number[] {
  const horizon = computeSimulationMonths(project);
  const ends = plantEndIndices(project)
    .map(i => Math.min(i, horizon - 1))
    .filter(i => i >= 0);
  return [...new Set(ends)].sort((a, b) => a - b);
}

/** Backwards-compatible single marker: the last month any plant is still generating. */
export function lastPpaEndIndex(project: Project): number {
  const ends = ppaEndIndices(project);
  return ends.length ? ends[ends.length - 1] : computeSimulationMonths(project) - 1;
}
