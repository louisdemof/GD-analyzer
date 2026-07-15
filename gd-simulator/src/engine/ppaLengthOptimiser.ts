import type { Project } from './types';
import { runSimulation, computeSimulationMonths, getAllPlants } from './simulation';

export interface PPALengthPoint {
  ppaMonths: number;
  economiaLiquida: number;
  valorTotal: number;
  totalPPACost: number;
  economiaPct: number;
}

export interface PPALengthResult {
  horizon: number;            // fixed simulation horizon (months)
  currentPPAMonths: number;   // the project's current PPA length
  points: PPALengthPoint[];   // swept curve
  best: PPALengthPoint;       // shortest PPA that reaches (≈) the max client economy
  maxEconomia: number;        // the peak economiaLiquida found
}

// Goal-seek the PPA length (plant contract months) that maximises the CLIENT's net economy for
// a FIXED horizon. When the plant over-generates, injecting for fewer months can already bank
// enough credits to cover the whole horizon — so a shorter PPA costs the client less PPA for the
// same (or better) savings. We sweep every PPA length from `min` to the horizon, re-simulate, and
// return the shortest length that reaches the peak economy (ties → shorter is better: less cost/risk).
export function goalSeekPPALength(project: Project, opts?: { min?: number; step?: number }): PPALengthResult {
  const horizon = computeSimulationMonths(project);
  const plants = getAllPlants(project);
  const currentPPAMonths = Math.max(1, ...plants.map(p => p.contractMonths || horizon));
  const min = Math.max(1, opts?.min ?? 1);
  const max = horizon;
  const step = opts?.step ?? Math.max(1, Math.ceil((max - min + 1) / 60)); // cap ~60 sims

  const withPPA = (months: number): Project => ({
    ...project,
    simulationMonths: horizon, // hold the horizon fixed while the PPA length varies
    plant: { ...project.plant, contractMonths: months },
    additionalPlants: project.additionalPlants?.map(p => ({ ...p, contractMonths: months })),
  });

  const measure = (months: number): PPALengthPoint => {
    const s = runSimulation(withPPA(months)).summary;
    return { ppaMonths: months, economiaLiquida: s.economiaLiquida, valorTotal: s.valorTotal, totalPPACost: s.totalPPACost, economiaPct: s.economiaPct };
  };

  const points: PPALengthPoint[] = [];
  for (let m = min; m <= max; m += step) points.push(measure(m));
  if (points.length === 0 || points[points.length - 1].ppaMonths !== max) points.push(measure(max));

  const maxEconomia = Math.max(...points.map(p => p.economiaLiquida));
  // Tolerance: within R$1 or 0.1% of the peak counts as "as good" → pick the shortest such PPA.
  const tol = Math.max(1, Math.abs(maxEconomia) * 0.001);
  const best = points.find(p => p.economiaLiquida >= maxEconomia - tol) ?? points[0];

  return { horizon, currentPPAMonths, points, best, maxEconomia };
}
