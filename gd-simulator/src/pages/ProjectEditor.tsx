import { useParams, useNavigate } from 'react-router-dom';
import { useState, useCallback, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { DistributorForm } from '../components/inputs/DistributorForm';
import { PlantForm } from '../components/inputs/PlantForm';
import { UCTable } from '../components/inputs/UCTable';
import { ConsumptionUpload } from '../components/inputs/ConsumptionUpload';
import { GenerationUpload } from '../components/inputs/GenerationUpload';
import { ClientDataUpload, type ImportedData } from '../components/inputs/ClientDataUpload';
import { createDefaultRateio } from '../engine/optimiser';
import { exportConsumptionExcel, importConsumptionExcel, type ImportResult } from '../engine/consumptionExcel';

type Tab = 'distributor' | 'plant' | 'ucs';

export function ProjectEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects, updateProject, updateDistributor, updatePlant, addUC, updateUC, removeUC, updateRateio } = useProjectStore();
  const { runForProject } = useSimulationStore();
  const project = projects.find(p => p.id === id);
  const [tab, setTab] = useState<Tab>('distributor');
  const [toast, setToast] = useState<string | null>(null);
  const [importModal, setImportModal] = useState<{ type: 'confirm' | 'error'; result: ImportResult } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImportRef = useRef<ImportResult | null>(null);

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

  const handleConsumptionFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    // Reset input so re-selecting the same file triggers change
    e.target.value = '';

    const result = await importConsumptionExcel(file, project);
    if (!result.success) {
      setImportModal({ type: 'error', result });
    } else {
      pendingImportRef.current = result;
      setImportModal({ type: 'confirm', result });
    }
  }, [project]);

  const applyConsumptionImport = useCallback(() => {
    const result = pendingImportRef.current;
    if (!result?.updates || !project) return;

    const { updates: u } = result;
    for (const ucUp of u.ucs) {
      const partial: Record<string, unknown> = {};
      if (ucUp.consumptionFP) partial.consumptionFP = ucUp.consumptionFP;
      if (ucUp.consumptionPT) partial.consumptionPT = ucUp.consumptionPT;
      if (ucUp.openingBank !== undefined) partial.openingBank = ucUp.openingBank;
      if (ucUp.ownGeneration) partial.ownGeneration = ucUp.ownGeneration;
      updateUC(project.id, ucUp.id, partial);
    }

    if (u.growthRate !== undefined) {
      updateProject(project.id, { growthRate: u.growthRate });
    }

    if (u.p50Profile) {
      updatePlant(project.id, { ...project.plant, p50Profile: u.p50Profile });
    }

    if (u.batBank && project.batBank) {
      const updated = { ...project.batBank };
      if (u.batBank.openingKWh !== undefined) updated.openingKWh = u.batBank.openingKWh;
      if (u.batBank.toNHSPct !== undefined) updated.toNHSPct = u.batBank.toNHSPct;
      if (u.batBank.toAMDPct !== undefined) updated.toAMDPct = u.batBank.toAMDPct;
      updateProject(project.id, { batBank: updated });
    }

    setImportModal(null);
    pendingImportRef.current = null;
    setToast(`Consumo importado com sucesso para ${u.ucs.length} UC(s).`);
    setTimeout(() => setToast(null), 5000);
  }, [project, updateUC, updateProject, updatePlant]);

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
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-md">
          {toast}
          <button onClick={() => setToast(null)} className="ml-3 text-white/60 hover:text-white">&#x2715;</button>
        </div>
      )}

      {/* Import Modal */}
      {importModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4">
            {importModal.type === 'error' ? (
              <>
                <h3 className="text-lg font-semibold text-red-700 mb-3">Erros na importacao</h3>
                <ul className="text-sm text-red-600 space-y-1 mb-4 max-h-60 overflow-y-auto">
                  {importModal.result.errors.map((err, i) => <li key={i}>• {err}</li>)}
                </ul>
                {importModal.result.warnings.length > 0 && (
                  <ul className="text-sm text-amber-600 space-y-1 mb-4">
                    {importModal.result.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                  </ul>
                )}
                <button
                  onClick={() => setImportModal(null)}
                  className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Fechar
                </button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-slate-800 mb-3">Confirmar importacao</h3>
                <p className="text-sm text-slate-600 mb-2">
                  Importar consumo de {importModal.result.updates?.ucs.length ?? 0} UC(s)?
                </p>
                {importModal.result.updates?.p50Profile && (
                  <p className="text-sm text-slate-600 mb-1">+ Atualizar perfil P50</p>
                )}
                {importModal.result.updates?.growthRate !== undefined && (
                  <p className="text-sm text-slate-600 mb-1">+ Atualizar taxa de crescimento</p>
                )}
                {importModal.result.updates?.batBank && (
                  <p className="text-sm text-slate-600 mb-1">+ Atualizar banco BAT</p>
                )}
                {importModal.result.warnings.length > 0 && (
                  <ul className="text-sm text-amber-600 space-y-1 my-3">
                    {importModal.result.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                  </ul>
                )}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={applyConsumptionImport}
                    className="px-4 py-2 text-sm text-white rounded-lg font-medium"
                    style={{ backgroundColor: '#2F927B' }}
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => { setImportModal(null); pendingImportRef.current = null; }}
                    className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Hidden file input for consumption import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleConsumptionFileChange}
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{project.clientName}</h1>
          <p className="text-xs text-slate-500">Configuracao do Projeto</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportConsumptionExcel(project)}
            className="px-4 py-2 text-sm border border-teal-500 text-teal-700 rounded-lg hover:bg-teal-50"
          >
            Exportar Consumo (.xlsx)
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Importar Consumo (.xlsx)
          </button>
          <button
            onClick={() => navigate(`/results/${id}`)}
            className="px-4 py-2 text-sm text-white rounded-lg font-medium"
            style={{ backgroundColor: '#2F927B' }}
          >
            Ver Resultados →
          </button>
        </div>
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
