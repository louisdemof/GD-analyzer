import { useParams, useNavigate } from 'react-router-dom';
import { useState, useCallback } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { DistributorForm } from '../components/inputs/DistributorForm';
import { PlantForm } from '../components/inputs/PlantForm';
import { UCTable } from '../components/inputs/UCTable';
import { ConsumptionUpload } from '../components/inputs/ConsumptionUpload';
import { GenerationUpload } from '../components/inputs/GenerationUpload';
import { ClientDataUpload, type ImportedData } from '../components/inputs/ClientDataUpload';
import { createDefaultRateio } from '../engine/optimiser';

type Tab = 'distributor' | 'plant' | 'ucs';

export function ProjectEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects, updateProject, updateDistributor, updatePlant, addUC, updateUC, removeUC, updateRateio } = useProjectStore();
  const { runForProject } = useSimulationStore();
  const project = projects.find(p => p.id === id);
  const [tab, setTab] = useState<Tab>('distributor');

  const handleImport = useCallback(async (data: ImportedData) => {
    if (!project) return;

    // Update UCs
    // Remove all existing UCs first
    for (const uc of project.ucs) {
      removeUC(project.id, uc.id);
    }
    // Add imported UCs
    for (const uc of data.ucs) {
      addUC(project.id, uc);
    }

    // Update plant if provided
    if (data.plant) {
      const updatedPlant = {
        ...project.plant,
        ...data.plant,
        p50Profile: data.plant.p50Profile || project.plant.p50Profile,
      };
      updatePlant(project.id, updatedPlant);
    }

    // Update batBank if provided
    if (data.batBank) {
      updateProject(project.id, { batBank: data.batBank });
    }

    // Set default rateio for new UCs
    const updatedProject = useProjectStore.getState().projects.find(p => p.id === project.id);
    if (updatedProject) {
      const defaultRateio = createDefaultRateio(updatedProject);
      updateRateio(project.id, defaultRateio);
    }

    // Navigate to results — user can optimise from there
    navigate(`/results/${id}`);
  }, [project, id, navigate, removeUC, addUC, updatePlant, updateProject, updateRateio, runForProject]);

  if (!project) {
    return <div className="p-6 text-slate-500">Projeto não encontrado.</div>;
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'distributor', label: 'Distribuidora & Tarifas' },
    { key: 'plant', label: 'Planta Solar' },
    { key: 'ucs', label: 'Unidades Consumidoras' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{project.clientName}</h1>
          <p className="text-xs text-slate-500">Configuração do Projeto</p>
        </div>
        <button
          onClick={() => navigate(`/results/${id}`)}
          className="px-4 py-2 text-sm text-white rounded-lg font-medium"
          style={{ backgroundColor: '#2F927B' }}
        >
          Ver Resultados →
        </button>
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-teal-500 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        {tab === 'distributor' && (
          <DistributorForm
            distributor={project.distributor}
            onChange={d => updateDistributor(project.id, d)}
          />
        )}

        {tab === 'plant' && (
          <div className="space-y-6">
            <PlantForm
              plant={project.plant}
              onChange={p => updatePlant(project.id, p)}
              generationSource={project.generationSource}
              helexiaPlantCode={project.helexiaPlantCode}
              degradationPct={project.degradationPct ?? 0.5}
              lossPct={project.lossPct ?? 0}
              onProjectFieldChange={updates => updateProject(project.id, updates)}
            />
            <div>
              <h4 className="text-sm font-medium text-slate-700 mb-2">Upload Perfil de Geração</h4>
              <GenerationUpload
                onDataLoaded={profile => {
                  updatePlant(project.id, { ...project.plant, p50Profile: profile });
                }}
              />
            </div>
          </div>
        )}

        {tab === 'ucs' && (
          <div className="space-y-6">
            {/* Bulk upload section */}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Importação em Lote</h4>
              <ClientDataUpload
                contractStartMonth={project.plant.contractStartMonth}
                onImport={handleImport}
              />
            </div>

            <hr className="border-slate-200" />

            {/* Manual UC management */}
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Unidades Consumidoras ({project.ucs.length})</h4>
              <UCTable
                ucs={project.ucs}
                onAdd={uc => addUC(project.id, uc)}
                onUpdate={(ucId, updates) => updateUC(project.id, ucId, updates)}
                onRemove={ucId => removeUC(project.id, ucId)}
              />
            </div>

            {project.ucs.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-slate-700">Upload Consumo por UC</h4>
                {project.ucs.map(uc => (
                  <ConsumptionUpload
                    key={uc.id}
                    ucId={uc.id}
                    ucName={uc.name}
                    isGrupoA={uc.isGrupoA}
                    onDataLoaded={(fp, pt) => {
                      updateUC(project.id, uc.id, { consumptionFP: fp, consumptionPT: pt });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
