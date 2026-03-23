import { create } from 'zustand';
import type { SimulationResult } from '../engine/types';
import { runSimulation } from '../engine/simulation';
import { useProjectStore } from './projectStore';

interface SimulationStore {
  results: Record<string, SimulationResult>; // projectId → result
  isRunning: boolean;
  error: string | null;

  runForProject: (projectId: string) => void;
  getResult: (projectId: string) => SimulationResult | null;
  clearResult: (projectId: string) => void;
}

export const useSimulationStore = create<SimulationStore>()((set, get) => ({
  results: {},
  isRunning: false,
  error: null,

  runForProject: (projectId) => {
    const project = useProjectStore.getState().projects.find(p => p.id === projectId);
    if (!project) {
      set({ error: 'Project not found' });
      return;
    }

    set({ isRunning: true, error: null });

    try {
      const result = runSimulation(project);
      set(state => ({
        results: { ...state.results, [projectId]: result },
        isRunning: false,
      }));
    } catch (e) {
      set({
        isRunning: false,
        error: e instanceof Error ? e.message : 'Simulation error',
      });
    }
  },

  getResult: (projectId) => {
    return get().results[projectId] ?? null;
  },

  clearResult: (projectId) => {
    set(state => {
      const { [projectId]: _, ...rest } = state.results;
      return { results: rest };
    });
  },
}));
