import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project, ConsumptionUnit, Distributor, Plant, RateioAllocation } from '../engine/types';
import { createDefaultRateio } from '../engine/optimiser';
import { DISTRIBUTORS } from '../data/distributors';
import sampleData from '../../reference/SAMPLE_DATA.json';

interface ProjectStore {
  projects: Project[];
  currentProjectId: string | null;

  // Actions
  setCurrentProject: (id: string | null) => void;
  getCurrentProject: () => Project | null;
  createProject: (clientName: string, distributorId: string) => Project;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  // UC management
  addUC: (projectId: string, uc: ConsumptionUnit) => void;
  updateUC: (projectId: string, ucId: string, updates: Partial<ConsumptionUnit>) => void;
  removeUC: (projectId: string, ucId: string) => void;

  // Plant
  updatePlant: (projectId: string, plant: Plant) => void;

  // Distributor
  updateDistributor: (projectId: string, distributor: Distributor) => void;

  // Rateio
  updateRateio: (projectId: string, rateio: RateioAllocation) => void;

  // Scenarios
  updateScenarios: (projectId: string, scenarios: Partial<Project['scenarios']>) => void;

  // Demo data
  loadDemoProject: () => void;

  // Export/Import
  exportProject: (id: string) => string;
  importProject: (json: string) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProjectId: null,

      setCurrentProject: (id) => set({ currentProjectId: id }),

      getCurrentProject: () => {
        const state = get();
        return state.projects.find(p => p.id === state.currentProjectId) ?? null;
      },

      createProject: (clientName, distributorId) => {
        const distributor = DISTRIBUTORS.find(d => d.id === distributorId) ?? DISTRIBUTORS[0];
        const now = new Date().toISOString();
        const project: Project = {
          id: generateId(),
          clientName,
          distributor,
          plant: {
            id: generateId(),
            name: '',
            capacityKWac: 0,
            distributor: distributorId,
            p50Profile: new Array(24).fill(0),
            useActual: false,
            ppaRateRsBRLkWh: 0,
            contractStartMonth: new Date().toISOString().slice(0, 7),
            contractMonths: 24,
          },
          ucs: [],
          scenarios: {
            icmsExempt: true,
            competitorDiscount: 0,
            useActualGeneration: false,
          },
          rateio: {
            periods: [
              { start: 0, end: 3, allocations: [] },
              { start: 4, end: 9, allocations: [] },
              { start: 10, end: 15, allocations: [] },
              { start: 16, end: 23, allocations: [] },
            ],
            isOptimised: false,
          },
          createdAt: now,
          updatedAt: now,
        };
        set(state => ({ projects: [...state.projects, project], currentProjectId: project.id }));
        return project;
      },

      updateProject: (id, updates) => set(state => ({
        projects: state.projects.map(p =>
          p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
        ),
      })),

      deleteProject: (id) => set(state => ({
        projects: state.projects.filter(p => p.id !== id),
        currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
      })),

      addUC: (projectId, uc) => set(state => ({
        projects: state.projects.map(p => {
          if (p.id !== projectId) return p;
          const updated = { ...p, ucs: [...p.ucs, uc], updatedAt: new Date().toISOString() };
          updated.rateio = createDefaultRateio(updated);
          return updated;
        }),
      })),

      updateUC: (projectId, ucId, updates) => set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId
            ? {
                ...p,
                ucs: p.ucs.map(uc => uc.id === ucId ? { ...uc, ...updates } : uc),
                updatedAt: new Date().toISOString(),
              }
            : p
        ),
      })),

      removeUC: (projectId, ucId) => set(state => ({
        projects: state.projects.map(p => {
          if (p.id !== projectId) return p;
          const updated = { ...p, ucs: p.ucs.filter(uc => uc.id !== ucId), updatedAt: new Date().toISOString() };
          updated.rateio = createDefaultRateio(updated);
          return updated;
        }),
      })),

      updatePlant: (projectId, plant) => set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId ? { ...p, plant, updatedAt: new Date().toISOString() } : p
        ),
      })),

      updateDistributor: (projectId, distributor) => set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId ? { ...p, distributor, updatedAt: new Date().toISOString() } : p
        ),
      })),

      updateRateio: (projectId, rateio) => set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId ? { ...p, rateio, updatedAt: new Date().toISOString() } : p
        ),
      })),

      updateScenarios: (projectId, scenarios) => set(state => ({
        projects: state.projects.map(p =>
          p.id === projectId
            ? { ...p, scenarios: { ...p.scenarios, ...scenarios }, updatedAt: new Date().toISOString() }
            : p
        ),
      })),

      loadDemoProject: () => {
        const demo = sampleData.project;
        const now = new Date().toISOString();
        const project: Project = {
          id: 'copasul-cs3-demo',
          clientName: demo.clientName,
          distributor: demo.distributor as Distributor,
          plant: demo.plant as Plant,
          ucs: demo.ucs as ConsumptionUnit[],
          batBank: demo.batBank,
          scenarios: demo.scenarios,
          rateio: {
            periods: [],
            isOptimised: false,
          },
          createdAt: now,
          updatedAt: now,
        };
        // Set default rateio
        project.rateio = createDefaultRateio(project);

        set(state => {
          // Always replace demo project with latest data
          const withoutDemo = state.projects.filter(p => p.id !== 'copasul-cs3-demo');
          return {
            projects: [...withoutDemo, project],
            currentProjectId: project.id,
          };
        });
      },

      exportProject: (id) => {
        const project = get().projects.find(p => p.id === id);
        return JSON.stringify(project, null, 2);
      },

      importProject: (json) => {
        const project = JSON.parse(json) as Project;
        project.id = generateId();
        project.updatedAt = new Date().toISOString();
        set(state => ({
          projects: [...state.projects, project],
          currentProjectId: project.id,
        }));
      },
    }),
    {
      name: 'gd-simulator-projects',
    }
  )
);
