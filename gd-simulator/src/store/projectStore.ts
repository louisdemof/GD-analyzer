import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Project, ConsumptionUnit, Distributor, Plant, RateioAllocation } from '../engine/types';
import { createDefaultRateio } from '../engine/optimiser';
import { DISTRIBUTORS } from '../data/distributors';
import sampleData from '../../reference/SAMPLE_DATA.json';
import beloData from '../../reference/BELO_ALIMENTOS_DEMO.json';
import copelData from '../../reference/COPEL_DEMO.json';
import copelData2 from '../../reference/COPEL_DEMO_2.json';
import copelData3 from '../../reference/COPEL_DEMO_3.json';
import copelData4 from '../../reference/COPEL_DEMO_4.json';
import superfrioData from '../../reference/SUPERFRIO_CWBII_ACL_DEMO.json';
import superfrioPortfolioData from '../../reference/SUPERFRIO_PR_PORTFOLIO_DEMO.json';
import superfrioFrontloadData from '../../reference/SUPERFRIO_PR_FRONTLOAD_DEMO.json';
import superfrio5yData from '../../reference/SUPERFRIO_PR_5Y_DEMO.json';
import { saveProjectToDB, deleteProjectFromDB, loadAllProjectsFromDB, migrateFromLocalStorage, saveFolderToDB, loadAllFoldersFromDB, deleteFolderFromDB, type ClientFolder } from '../storage/projectDB';

interface ProjectStore {
  projects: Project[];
  currentProjectId: string | null;
  folders: ClientFolder[];
  isLoaded: boolean;

  // Init — load from IndexedDB
  initFromDB: () => Promise<void>;

  // Actions
  setCurrentProject: (id: string | null) => void;
  getCurrentProject: () => Project | null;
  createProject: (clientName: string, distributorId: string, folderId?: string) => Project;
  createProjectFromDistributor: (clientName: string, distributor: Distributor, folderId?: string) => Project;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  duplicateProject: (id: string) => Project | null;

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
  loadBeloAlimentosDemo: () => void;
  loadCopelDemo: () => void;
  loadCopelDemo2: () => void;
  loadCopelDemo3: () => void;
  loadCopelDemo4: () => void;
  loadSuperfrioCwbiiDemo: () => void;
  loadSuperfrioPortfolioDemo: () => void;
  loadSuperfrioFrontloadDemo: () => void;
  loadSuperfrio5yDemo: () => void;

  // Export/Import
  exportProject: (id: string) => string;
  importProject: (json: string) => void;

  // Folders
  createFolder: (name: string, color: string, description?: string) => ClientFolder;
  updateFolder: (id: string, updates: Partial<ClientFolder>) => void;
  deleteFolder: (id: string) => void;
  moveProjectToFolder: (projectId: string, folderId: string | null) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Re-span an existing rateio so its periods cover exactly months 0..contractMonths-1.
// Preserves the per-UC allocation fractions. Returns null when there's nothing to
// re-span (no periods) so the caller can rebuild a default rateio instead.
function respanRateio(rateio: RateioAllocation, contractMonths: number): RateioAllocation | null {
  const lastIdx = contractMonths - 1;
  if (!rateio || !rateio.periods || rateio.periods.length === 0) return null;
  // Keep periods that start within the contract, clamp their ends.
  const sorted = [...rateio.periods].sort((a, b) => a.start - b.start);
  const kept = sorted
    .filter(p => p.start <= lastIdx)
    .map(p => ({ ...p, end: Math.min(p.end, lastIdx) }));
  if (kept.length === 0) return null;
  // Ensure the tail is covered: stretch the last kept period to the contract end.
  kept[kept.length - 1] = { ...kept[kept.length - 1], end: lastIdx };
  return {
    periods: kept,
    // Span changed → previous optimisation is stale; flag for re-optimisation.
    isOptimised: false,
  };
}

// Loads a pre-built SUPERFRIO Paraná variant (front-load or 5-year) from its demo JSON,
// preserving the optimised rateio + additionalPlants + any escalation fields (no override).
function loadSuperfrioVariant(
  set: (fn: (state: ProjectStore) => Partial<ProjectStore>) => void,
  demo: any,
  id: string,
): void {
  const now = new Date().toISOString();
  const project: Project = {
    id,
    clientName: demo.clientName,
    marketType: demo.marketType,
    aclBaseline: demo.aclBaseline,
    distributor: demo.distributor as Distributor,
    plant: demo.plant as Plant,
    additionalPlants: demo.additionalPlants as Project['additionalPlants'],
    simulationMonths: demo.simulationMonths,
    ucs: demo.ucs as ConsumptionUnit[],
    scenarios: demo.scenarios,
    growthRate: demo.growthRate,
    generationDegradation: demo.generationDegradation,
    performanceFactor: demo.performanceFactor,
    tariffEscalationDistributor: demo.tariffEscalationDistributor,
    tariffEscalationPPA: demo.tariffEscalationPPA,
    rateio: demo.rateio as RateioAllocation, // otimizado — preservar
    createdAt: now,
    updatedAt: now,
  };
  set(state => ({
    projects: [...state.projects.filter(p => p.id !== id), project],
    currentProjectId: project.id,
  }));
  saveProjectToDB(project).catch(() => {});
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      projects: [],
      currentProjectId: null,
      folders: [],
      isLoaded: false,

      initFromDB: async () => {
        try {
          // Migrate from old localStorage
          await migrateFromLocalStorage();
          // Load from IndexedDB
          const dbProjects = await loadAllProjectsFromDB();
          const dbFolders = await loadAllFoldersFromDB();
          const current = get().projects;
          // Merge: IndexedDB projects + any in-memory that aren't in DB
          const merged = [...dbProjects];
          for (const p of current) {
            if (!merged.find(m => m.id === p.id)) merged.push(p);
          }
          set({ projects: merged, folders: dbFolders, isLoaded: true });

          // Defensive re-seed: if a demo project exists but has stale/empty UCs
          // (e.g. persisted from an earlier app version), re-seed from the shipped
          // JSON so the demo always reflects the latest seed data.
          const isStale = (projectId: string): boolean => {
            const p = merged.find(x => x.id === projectId);
            if (!p) return false;
            if (!p.ucs || p.ucs.length === 0) return true;
            const allConsumptionEmpty = p.ucs.every(uc => {
              const fp = uc.consumptionFP || [];
              return fp.length === 0 || fp.every(v => (v || 0) === 0);
            });
            if (allConsumptionEmpty) return true;
            return false;
          };
          // Demos also re-seed if no Grupo A UC has demanda yet
          // (added in a later release; old persisted demos lack it).
          const missingDemandaCheck = (projectId: string): boolean => {
            const p = merged.find(x => x.id === projectId);
            if (!p) return false;
            const grupoA = p.ucs.filter(uc => uc.isGrupoA && uc.id !== 'bat');
            if (grupoA.length === 0) return false;
            return grupoA.every(uc => !uc.demandaFaturadaFP || uc.demandaFaturadaFP === 0);
          };
          // Reseed when persisted demo lacks the icmsScope field (added recently).
          // Without this, old cached COPEL demos keep defaulting to TE_TUSD and the
          // TE_ONLY toggle in the JSON never takes effect.
          const missingIcmsScope = (projectId: string): boolean => {
            const p = merged.find(x => x.id === projectId);
            if (!p) return false;
            return p.distributor?.taxes?.icmsScope === undefined;
          };
          if (isStale('belo-alimentos-demo') || missingDemandaCheck('belo-alimentos-demo')) {
            get().loadBeloAlimentosDemo();
          }
          if (isStale('copasul-cs3-demo') || missingDemandaCheck('copasul-cs3-demo')) {
            get().loadDemoProject();
          }
          if (isStale('copel-demo') || missingDemandaCheck('copel-demo') || missingIcmsScope('copel-demo')) {
            get().loadCopelDemo();
          }
          if (isStale('copel-demo-2') || missingDemandaCheck('copel-demo-2') || missingIcmsScope('copel-demo-2')) {
            get().loadCopelDemo2();
          }
          if (isStale('copel-demo-3') || missingDemandaCheck('copel-demo-3') || missingIcmsScope('copel-demo-3')) {
            get().loadCopelDemo3();
          }
          // Demo 4 also re-seeds when the plant lacks intermediationFeePct
          // (added with the proposta scenario; old persisted copies miss it).
          const demo4 = merged.find(x => x.id === 'copel-demo-4');
          if (
            isStale('copel-demo-4') ||
            missingDemandaCheck('copel-demo-4') ||
            missingIcmsScope('copel-demo-4') ||
            (demo4 && demo4.plant?.intermediationFeePct === undefined)
          ) {
            get().loadCopelDemo4();
          }
        } catch {
          set({ isLoaded: true });
        }
      },

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
        saveProjectToDB(project).catch(() => {});
        return project;
      },

      createProjectFromDistributor: (clientName, distributor, folderId) => {
        const now = new Date().toISOString();
        const project: Project = {
          id: generateId(),
          clientName,
          distributor,
          plant: {
            id: generateId(),
            name: '',
            capacityKWac: 0,
            distributor: distributor.id,
            p50Profile: new Array(24).fill(0),
            useActual: false,
            ppaRateRsBRLkWh: 0,
            contractStartMonth: new Date().toISOString().slice(0, 7),
            contractMonths: 24,
          },
          ucs: [],
          scenarios: { icmsExempt: true, competitorDiscount: 0, useActualGeneration: false },
          rateio: {
            periods: [
              { start: 0, end: 3, allocations: [] },
              { start: 4, end: 9, allocations: [] },
              { start: 10, end: 15, allocations: [] },
              { start: 16, end: 23, allocations: [] },
            ],
            isOptimised: false,
          },
          folderId,
          createdAt: now,
          updatedAt: now,
        };
        set(state => ({ projects: [...state.projects, project], currentProjectId: project.id }));
        saveProjectToDB(project).catch(() => {});
        return project;
      },

      updateProject: (id, updates) => {
        set(state => ({
          projects: state.projects.map(p =>
            p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
          ),
        }));
        const updated = get().projects.find(p => p.id === id);
        if (updated) saveProjectToDB(updated).catch(() => {});
      },

      deleteProject: (id) => {
        set(state => ({
          projects: state.projects.filter(p => p.id !== id),
          currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
        }));
        deleteProjectFromDB(id).catch(() => {});
      },

      duplicateProject: (id) => {
        const source = get().projects.find(p => p.id === id);
        if (!source) return null;
        const now = new Date().toISOString();
        const clone: Project = {
          ...JSON.parse(JSON.stringify(source)),
          id: generateId(),
          clientName: source.clientName + ' — Copia',
          createdAt: now,
          updatedAt: now,
        };
        clone.rateio = { ...clone.rateio, isOptimised: false };
        set(state => ({ projects: [...state.projects, clone], currentProjectId: clone.id }));
        saveProjectToDB(clone).catch(() => {});
        return clone;
      },

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

      updatePlant: (projectId, plant) => {
        set(state => ({
          projects: state.projects.map(p => {
            if (p.id !== projectId) return p;
            const updated = { ...p, plant, updatedAt: new Date().toISOString() };
            // If the contract (PPA) duration changed, re-span the rateio so its
            // periods cover the new month range. Otherwise the tail months fall
            // outside every period, get zero injected credits, and the economy
            // is understated. Allocation fractions are preserved.
            const oldMonths = p.plant.contractMonths || 24;
            const newMonths = plant.contractMonths || 24;
            if (newMonths !== oldMonths) {
              updated.rateio = respanRateio(updated.rateio, newMonths) ?? createDefaultRateio(updated);
            }
            return updated;
          }),
        }));
        const updated = get().projects.find(p => p.id === projectId);
        if (updated) saveProjectToDB(updated).catch(() => {});
      },

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
        saveProjectToDB(project).catch(() => {});
      },

      loadBeloAlimentosDemo: () => {
        const demo = beloData.project;
        const now = new Date().toISOString();
        const project: Project = {
          id: 'belo-alimentos-demo',
          clientName: demo.clientName,
          distributor: demo.distributor as Distributor,
          plant: demo.plant as Plant,
          ucs: demo.ucs as ConsumptionUnit[],
          scenarios: demo.scenarios,
          growthRate: demo.growthRate,
          generationDegradation: demo.generationDegradation,
          performanceFactor: demo.performanceFactor,
          rateio: { periods: [], isOptimised: false },
          createdAt: now,
          updatedAt: now,
        };
        project.rateio = createDefaultRateio(project);

        set(state => {
          const withoutDemo = state.projects.filter(p => p.id !== 'belo-alimentos-demo');
          return {
            projects: [...withoutDemo, project],
            currentProjectId: project.id,
          };
        });
        saveProjectToDB(project).catch(() => {});
      },

      loadCopelDemo: () => {
        const demo = copelData.project;
        const now = new Date().toISOString();
        const project: Project = {
          id: 'copel-demo',
          clientName: demo.clientName,
          distributor: demo.distributor as Distributor,
          plant: demo.plant as Plant,
          ucs: demo.ucs as ConsumptionUnit[],
          scenarios: demo.scenarios,
          growthRate: demo.growthRate,
          generationDegradation: demo.generationDegradation,
          performanceFactor: demo.performanceFactor,
          rateio: { periods: [], isOptimised: false },
          createdAt: now,
          updatedAt: now,
        };
        project.rateio = createDefaultRateio(project);

        set(state => {
          const withoutDemo = state.projects.filter(p => p.id !== 'copel-demo');
          return {
            projects: [...withoutDemo, project],
            currentProjectId: project.id,
          };
        });
        saveProjectToDB(project).catch(() => {});
      },

      loadCopelDemo2: () => {
        const demo = copelData2.project;
        const now = new Date().toISOString();
        const project: Project = {
          id: 'copel-demo-2',
          clientName: demo.clientName,
          distributor: demo.distributor as Distributor,
          plant: demo.plant as Plant,
          ucs: demo.ucs as ConsumptionUnit[],
          scenarios: demo.scenarios,
          growthRate: demo.growthRate,
          generationDegradation: demo.generationDegradation,
          performanceFactor: demo.performanceFactor,
          rateio: { periods: [], isOptimised: false },
          createdAt: now,
          updatedAt: now,
        };
        project.rateio = createDefaultRateio(project);

        set(state => {
          const withoutDemo = state.projects.filter(p => p.id !== 'copel-demo-2');
          return {
            projects: [...withoutDemo, project],
            currentProjectId: project.id,
          };
        });
        saveProjectToDB(project).catch(() => {});
      },

      loadCopelDemo3: () => {
        const demo = copelData3.project;
        const now = new Date().toISOString();
        const project: Project = {
          id: 'copel-demo-3',
          clientName: demo.clientName,
          distributor: demo.distributor as Distributor,
          plant: demo.plant as Plant,
          additionalPlants: demo.additionalPlants as Project['additionalPlants'],
          ucs: demo.ucs as ConsumptionUnit[],
          scenarios: demo.scenarios,
          growthRate: demo.growthRate,
          generationDegradation: demo.generationDegradation,
          performanceFactor: demo.performanceFactor,
          rateio: { periods: [], isOptimised: false },
          createdAt: now,
          updatedAt: now,
        };
        project.rateio = createDefaultRateio(project);

        set(state => {
          const withoutDemo = state.projects.filter(p => p.id !== 'copel-demo-3');
          return {
            projects: [...withoutDemo, project],
            currentProjectId: project.id,
          };
        });
        saveProjectToDB(project).catch(() => {});
      },

      loadCopelDemo4: () => {
        const demo = copelData4.project;
        const now = new Date().toISOString();
        const project: Project = {
          id: 'copel-demo-4',
          clientName: demo.clientName,
          distributor: demo.distributor as Distributor,
          plant: demo.plant as Plant,
          additionalPlants: demo.additionalPlants as Project['additionalPlants'],
          simulationMonths: demo.simulationMonths,
          ucs: demo.ucs as ConsumptionUnit[],
          scenarios: demo.scenarios,
          growthRate: demo.growthRate,
          generationDegradation: demo.generationDegradation,
          performanceFactor: demo.performanceFactor,
          rateio: { periods: [], isOptimised: false },
          createdAt: now,
          updatedAt: now,
        };
        project.rateio = createDefaultRateio(project);

        set(state => {
          const withoutDemo = state.projects.filter(p => p.id !== 'copel-demo-4');
          return {
            projects: [...withoutDemo, project],
            currentProjectId: project.id,
          };
        });
        saveProjectToDB(project).catch(() => {});
      },

      // SUPERFRIO CWBII — baseline ACL (mercado livre). The COPEL distributor here is a
      // PROJECT-SCOPED copy with tariffs calibrated to CWBII's invoice — it does NOT touch
      // the shared COPEL config or any other COPEL demo.
      loadSuperfrioCwbiiDemo: () => {
        const demo = superfrioData.project;
        const now = new Date().toISOString();
        const project: Project = {
          id: 'superfrio-cwbii-acl',
          clientName: demo.clientName,
          marketType: demo.marketType as Project['marketType'],
          aclBaseline: demo.aclBaseline as Project['aclBaseline'],
          distributor: demo.distributor as Distributor,
          plant: demo.plant as Plant,
          simulationMonths: demo.simulationMonths,
          ucs: demo.ucs as ConsumptionUnit[],
          scenarios: demo.scenarios,
          growthRate: demo.growthRate,
          generationDegradation: demo.generationDegradation,
          performanceFactor: demo.performanceFactor,
          rateio: { periods: [], isOptimised: false },
          createdAt: now,
          updatedAt: now,
        };
        project.rateio = createDefaultRateio(project);

        set(state => {
          const withoutDemo = state.projects.filter(p => p.id !== 'superfrio-cwbii-acl');
          return {
            projects: [...withoutDemo, project],
            currentProjectId: project.id,
          };
        });
        saveProjectToDB(project).catch(() => {});
      },

      // SUPERFRIO Paraná — 5 UCs + 3× Alto Paraná (HAP02-04), rateio JÁ OTIMIZADO
      // (não sobrescrever com createDefaultRateio). Cenário Dez/2027 (energia ACL 268
      // + reajuste + descontos), FA desativado (COPEL). Distribuidora project-scoped.
      loadSuperfrioPortfolioDemo: () => {
        const demo = superfrioPortfolioData.project;
        const now = new Date().toISOString();
        const project: Project = {
          id: 'superfrio-pr-portfolio',
          clientName: demo.clientName,
          marketType: demo.marketType as Project['marketType'],
          aclBaseline: demo.aclBaseline as Project['aclBaseline'],
          distributor: demo.distributor as Distributor,
          plant: demo.plant as Plant,
          additionalPlants: demo.additionalPlants as Project['additionalPlants'],
          simulationMonths: demo.simulationMonths,
          ucs: demo.ucs as ConsumptionUnit[],
          scenarios: demo.scenarios,
          growthRate: demo.growthRate,
          generationDegradation: demo.generationDegradation,
          performanceFactor: demo.performanceFactor,
          rateio: demo.rateio as Project['rateio'], // otimizado — preservar
          createdAt: now,
          updatedAt: now,
        };
        set(state => {
          const withoutDemo = state.projects.filter(p => p.id !== 'superfrio-pr-portfolio');
          return { projects: [...withoutDemo, project], currentProjectId: project.id };
        });
        saveProjectToDB(project).catch(() => {});
      },

      // Variante A: 3 HAP + HAP05 nos 12 primeiros meses (front-load do banco). 24m. ~+9,2%.
      // Variante B: 5 anos, energia +13,5%/a (tariffEscalationDistributor + energyEscalationPct)
      // vs PPA +5%/a IPCA (tariffEscalationPPA). Rateio otimizado por cobertura. ~+15,7%.
      loadSuperfrioFrontloadDemo: () => loadSuperfrioVariant(set, superfrioFrontloadData.project, 'superfrio-pr-frontload'),
      loadSuperfrio5yDemo: () => loadSuperfrioVariant(set, superfrio5yData.project, 'superfrio-pr-5y'),

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
        saveProjectToDB(project).catch(() => {});
      },

      // ─── Folders ──────────────────────────────────────────
      createFolder: (name, color, description) => {
        const folder: ClientFolder = {
          id: generateId(),
          name,
          description,
          color,
          createdAt: new Date().toISOString(),
          projectIds: [],
        };
        set(state => ({ folders: [...state.folders, folder] }));
        saveFolderToDB(folder).catch(() => {});
        return folder;
      },

      updateFolder: (id, updates) => {
        set(state => ({
          folders: state.folders.map(f => f.id === id ? { ...f, ...updates } : f),
        }));
        const updated = get().folders.find(f => f.id === id);
        if (updated) saveFolderToDB(updated).catch(() => {});
      },

      deleteFolder: (id) => {
        // Unassign projects from this folder
        const folder = get().folders.find(f => f.id === id);
        if (folder) {
          for (const pid of folder.projectIds) {
            const p = get().projects.find(pp => pp.id === pid);
            if (p) {
              set(state => ({
                projects: state.projects.map(pp => pp.id === pid ? { ...pp, folderId: undefined } : pp),
              }));
            }
          }
        }
        set(state => ({ folders: state.folders.filter(f => f.id !== id) }));
        deleteFolderFromDB(id).catch(() => {});
      },

      moveProjectToFolder: (projectId, folderId) => {
        // Remove from old folder
        set(state => ({
          folders: state.folders.map(f => ({
            ...f,
            projectIds: f.projectIds.filter(id => id !== projectId),
          })),
          projects: state.projects.map(p =>
            p.id === projectId ? { ...p, folderId: folderId ?? undefined, updatedAt: new Date().toISOString() } : p
          ),
        }));
        // Add to new folder
        if (folderId) {
          set(state => ({
            folders: state.folders.map(f =>
              f.id === folderId ? { ...f, projectIds: [...f.projectIds, projectId] } : f
            ),
          }));
        }
        // Save
        const updated = get().projects.find(p => p.id === projectId);
        if (updated) saveProjectToDB(updated).catch(() => {});
        for (const f of get().folders) {
          saveFolderToDB(f).catch(() => {});
        }
      },
    }),
    {
      name: 'gd-simulator-projects',
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as { projects?: unknown[]; currentProjectId?: string | null };
        if (!state || !state.projects) return { projects: [], currentProjectId: null };
        const projects = (state.projects as Record<string, unknown>[]).map(migrateProject);
        return { projects, currentProjectId: state.currentProjectId ?? null };
      },
    }
  )
);

function migrateProject(p: Record<string, unknown>): Project {
  const plant = (p.plant ?? {}) as Record<string, unknown>;
  const scenarios = (p.scenarios ?? {}) as Record<string, unknown>;
  const dist = (p.distributor ?? {}) as Record<string, unknown>;
  const tariffs = (dist.tariffs ?? {}) as Record<string, unknown>;
  const taxes = (dist.taxes ?? {}) as Record<string, unknown>;

  return {
    id: (p.id as string) ?? generateId(),
    clientName: (p.clientName as string) ?? 'Sem nome',
    distributor: {
      id: (dist.id as string) ?? '',
      name: (dist.name as string) ?? '',
      state: (dist.state as string) ?? '',
      resolution: (dist.resolution as string) ?? '',
      tariffs: {
        B_TUSD: (tariffs.B_TUSD as number) ?? 0,
        B_TE: (tariffs.B_TE as number) ?? 0,
        A_FP_TUSD_TE: (tariffs.A_FP_TUSD_TE as number) ?? 0,
        A_PT_TUSD_TE: (tariffs.A_PT_TUSD_TE as number) ?? 0,
        A_TE_FP: (tariffs.A_TE_FP as number) ?? 0,
        A_TE_PT: (tariffs.A_TE_PT as number) ?? 0,
        A_RSV_TUSD_TE: tariffs.A_RSV_TUSD_TE as number | undefined,
        B_RSV_TUSD_TE: tariffs.B_RSV_TUSD_TE as number | undefined,
        A_FP_DEMANDA: tariffs.A_FP_DEMANDA as number | undefined,
      },
      taxes: {
        ICMS: (taxes.ICMS as number) ?? 0.17,
        PIS: (taxes.PIS as number) ?? 0.0153,
        COFINS: (taxes.COFINS as number) ?? 0.0703,
        icmsScope: (taxes.icmsScope as 'TE_TUSD' | 'TE_ONLY' | 'NONE' | undefined) ?? 'TE_TUSD',
        pisCofinsExempt: (taxes.pisCofinsExempt as boolean | undefined) ?? true,
      },
      tariffMarkupPct: dist.tariffMarkupPct as number | undefined,
      tariffsBaseline: dist.tariffsBaseline as Distributor['tariffs'] | undefined,
    },
    plant: {
      id: (plant.id as string) ?? generateId(),
      name: (plant.name as string) ?? '',
      capacityKWac: (plant.capacityKWac as number) ?? 0,
      distributor: (plant.distributor as string) ?? '',
      p50Profile: (plant.p50Profile as number[]) ?? new Array(24).fill(0),
      actualProfile: (plant.actualProfile as number[] | undefined),
      useActual: (plant.useActual as boolean) ?? false,
      ppaRateRsBRLkWh: (plant.ppaRateRsBRLkWh as number) ?? 0,
      contractStartMonth: (plant.contractStartMonth as string) ?? '2026-06',
      contractMonths: (plant.contractMonths as number) ?? 24,
      intermediationFeePct: plant.intermediationFeePct as number | undefined,
    },
    additionalPlants: p.additionalPlants as Project['additionalPlants'],
    simulationMonths: p.simulationMonths as number | undefined,
    ucs: (p.ucs as Project['ucs']) ?? [],
    batBank: p.batBank as Project['batBank'],
    generationSource: (p.generationSource as Project['generationSource']) ?? 'manual',
    helexiaPlantCode: p.helexiaPlantCode as string | undefined,
    degradationPct: p.degradationPct as number | undefined,
    lossPct: p.lossPct as number | undefined,
    scenarios: {
      icmsExempt: (scenarios.icmsExempt as boolean) ?? true,
      competitorDiscount: (scenarios.competitorDiscount as number) ?? 0,
      useActualGeneration: (scenarios.useActualGeneration as boolean) ?? false,
    },
    rateio: (p.rateio as Project['rateio']) ?? { periods: [], isOptimised: false },
    createdAt: (p.createdAt as string) ?? new Date().toISOString(),
    updatedAt: (p.updatedAt as string) ?? new Date().toISOString(),
  };
}
