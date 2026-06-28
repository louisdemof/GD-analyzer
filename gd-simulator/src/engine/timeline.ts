import type { Project } from './types';
import { getAllPlants, computeSimulationMonths } from './simulation';

// Non-blocking sanity checks on a project's timeline (PPA start date, PPA duration,
// simulation horizon, multi-plant alignment). These never stop a simulation — dates
// only drive labels — they surface footguns the engine would otherwise swallow.

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
  const maxPPA = Math.max(0, ...plants.map(p => p.contractMonths || 0));

  // Gap 3 — explicit horizon shorter than the longest PPA silently truncates that plant
  if (project.simulationMonths && project.simulationMonths > 0 && project.simulationMonths < maxPPA) {
    out.push({
      level: 'warning',
      message: `Horizonte de simulação (${project.simulationMonths} meses) é menor que o PPA mais longo (${maxPPA} meses) — a geração e o PPA dessa usina são truncados. Aumente o horizonte ou reduza o prazo.`,
    });
  }

  // Gap 1 — additional plants with a different start date are NOT offset (engine pins all to month 0)
  const extras = project.additionalPlants ?? [];
  const staggered = extras.filter(p => p.contractStartMonth && start && p.contractStartMonth !== start);
  if (staggered.length > 0) {
    out.push({
      level: 'warning',
      message: `${staggered.length} usina(s) adicional(is) têm data de início diferente da principal. O modelo assume que todas entram em operação em ${start}; um início posterior não é representado (só é possível encerrar antes do horizonte).`,
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

/** Last month index (0-based) at which any plant is still generating — for chart markers. */
export function lastPpaEndIndex(project: Project): number {
  const plants = getAllPlants(project);
  const maxPPA = Math.max(0, ...plants.map(p => p.contractMonths || 0));
  const horizon = computeSimulationMonths(project);
  return Math.min(maxPPA, horizon) - 1;
}
