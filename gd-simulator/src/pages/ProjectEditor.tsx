import { useParams, useNavigate } from 'react-router-dom';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useAuth } from '../auth/AuthContext';
import { cloudMyRole, cloudProjectOwnerEmail, cloudProjectUpdatedAt, type MyRole } from '../storage/cloudSync';
import { ShareDialog } from '../components/ShareDialog';
import { AuditPanel } from '../components/AuditPanel';
import { useSimulationStore } from '../store/simulationStore';
import { DistributorForm } from '../components/inputs/DistributorForm';
import { PlantForm } from '../components/inputs/PlantForm';
import { AdditionalPlants } from '../components/inputs/AdditionalPlants';
import { UCTable } from '../components/inputs/UCTable';
import { ConsumptionUpload } from '../components/inputs/ConsumptionUpload';
import { GenerationUpload } from '../components/inputs/GenerationUpload';
import { ClientDataUpload, type ImportedData } from '../components/inputs/ClientDataUpload';
import { DemandaAnalysisPanel } from '../components/inputs/DemandaAnalysisPanel';
import { FaturaEspelho } from '../components/inputs/FaturaEspelho';
import { createDefaultRateio } from '../engine/optimiser';
import { computeDerivedTariffs } from '../engine/tariff';
import { timelineWarnings } from '../engine/timeline';
import { exportConsumptionExcel, importConsumptionExcel, type ImportResult } from '../engine/consumptionExcel';
import type { ACLBaseline } from '../engine/types';

type Tab = 'distributor' | 'plant' | 'ucs' | 'demanda' | 'fatura';

export function ProjectEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects, updateProject, updateDistributor, updatePlant, addUC, updateUC, removeUC, updateRateio, syncFromCloud } = useProjectStore();
  const { runForProject } = useSimulationStore();
  const project = projects.find(p => p.id === id);
  const [tab, setTab] = useState<Tab>('distributor');
  const [toast, setToast] = useState<string | null>(null);
  const [importModal, setImportModal] = useState<{ type: 'confirm' | 'error'; result: ImportResult } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const pendingImportRef = useRef<ImportResult | null>(null);

  // Access / ownership info (cloud only).
  const { cloudEnabled } = useAuth();
  const [myRole, setMyRole] = useState<MyRole>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  useEffect(() => {
    if (!cloudEnabled || !id) return;
    cloudMyRole(id).then(setMyRole).catch(() => {});
    cloudProjectOwnerEmail(id).then(setOwnerEmail).catch(() => {});
  }, [cloudEnabled, id]);
  const isViewer = myRole === 'viewer';

  // Concurrent-edit guard: poll the cloud's logical timestamp; if it's newer than the
  // copy we hold, someone else saved a change → warn (avoid silently working on a stale base).
  const [conflict, setConflict] = useState(false);
  const localUpdatedAt = project?.updatedAt;
  useEffect(() => {
    if (!cloudEnabled || !id || !localUpdatedAt) return;
    let alive = true;
    const check = async () => {
      const cloudTs = await cloudProjectUpdatedAt(id);
      if (alive && cloudTs && cloudTs > localUpdatedAt) setConflict(true);
    };
    const iv = setInterval(check, 20000);
    check();
    return () => { alive = false; clearInterval(iv); };
  }, [cloudEnabled, id, localUpdatedAt]);

  // Carrega o logo do cliente (PNG/JPEG) como data URL para exibir no PDF.
  const handleLogoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !project) return;
    if (file.size > 2_000_000) { alert('Imagem muito grande (máx. ~2 MB). Use um PNG/JPEG menor.'); return; }
    const reader = new FileReader();
    reader.onload = () => updateProject(project.id, { clientLogo: String(reader.result) });
    reader.readAsDataURL(file);
  }, [project, updateProject]);

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

    // Create new UCs first so subsequent updateUC calls find them.
    for (const newUC of u.ucsToCreate) {
      addUC(project.id, newUC);
    }

    for (const ucUp of u.ucs) {
      const partial: Record<string, unknown> = {};
      if (ucUp.consumptionFP) partial.consumptionFP = ucUp.consumptionFP;
      if (ucUp.consumptionPT) partial.consumptionPT = ucUp.consumptionPT;
      if (ucUp.consumptionReservado) partial.consumptionReservado = ucUp.consumptionReservado;
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
    const createdMsg = u.ucsToCreate.length > 0 ? `${u.ucsToCreate.length} UC(s) criada(s), ` : '';
    setToast(`Consumo importado: ${createdMsg}${u.ucs.length} UC(s) atualizada(s).`);
    setTimeout(() => setToast(null), 5000);
  }, [project, addUC, updateUC, updateProject, updatePlant]);

  if (!project) {
    return <div className="p-6 text-slate-500">Projeto não encontrado.</div>;
  }


  const tabs: { key: Tab; label: string }[] = [
    { key: 'distributor', label: 'Distribuidora & Tarifas' },
    { key: 'plant', label: 'Planta Solar' },
    { key: 'ucs', label: 'Unidades Consumidoras' },
    { key: 'demanda', label: 'Demanda' },
    { key: 'fatura', label: 'Fatura Espelho' },
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

      {/* Timeline sanity warnings (non-blocking) */}
      {(() => {
        const tl = timelineWarnings(project, new Date().toISOString().slice(0, 7));
        if (tl.length === 0) return null;
        const hasError = tl.some(w => w.level === 'error');
        return (
          <div className={`mb-4 rounded-lg border p-3 text-sm ${hasError ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
            <p className={`font-medium mb-1 ${hasError ? 'text-red-700' : 'text-amber-800'}`}>
              {hasError ? '⛔ Verifique a linha do tempo' : '⚠️ Avisos da linha do tempo'}
            </p>
            <ul className={`space-y-0.5 ${hasError ? 'text-red-600' : 'text-amber-700'}`}>
              {tl.map((w, i) => <li key={i}>• {w.message}</li>)}
            </ul>
          </div>
        );
      })()}

      {/* Import Modal */}
      {importModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4">
            {importModal.type === 'error' ? (
              <>
                <h3 className="text-lg font-semibold text-red-700 mb-3">Erros na importação</h3>
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
                <h3 className="text-lg font-semibold text-slate-800 mb-3">Confirmar importação</h3>
                <p className="text-sm text-slate-600 mb-2">
                  Importar consumo de {importModal.result.updates?.ucs.length ?? 0} UC(s)?
                </p>
                {(importModal.result.updates?.ucsToCreate.length ?? 0) > 0 && (
                  <p className="text-sm text-teal-700 mb-1">
                    + Criar {importModal.result.updates!.ucsToCreate.length} UC(s) novas automaticamente
                  </p>
                )}
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

      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={handleLogoChange}
      />

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {project.clientLogo && (
            <img src={project.clientLogo} alt="logo" className="h-12 max-w-[140px] object-contain border border-slate-200 rounded bg-white p-1" />
          )}
          <div>
            <h1 className="text-xl font-bold text-slate-800">{project.clientName}</h1>
            <p className="text-xs text-slate-500">
              Configuração do Projeto · {' '}
              <button onClick={() => logoInputRef.current?.click()} className="text-teal-600 hover:underline">
                {project.clientLogo ? 'trocar logo' : '🖼️ adicionar logo do cliente'}
              </button>
              {project.clientLogo && (
                <button onClick={() => updateProject(project.id, { clientLogo: undefined })} className="ml-2 text-rose-500 hover:underline">remover</button>
              )}
            </p>
          </div>
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

      {/* Creator / access info */}
      {cloudEnabled && (ownerEmail || myRole) && (
        <div className="mb-4 text-xs text-slate-500 flex items-center gap-3 flex-wrap">
          {ownerEmail && <span>Criado por: <strong className="text-slate-700">{ownerEmail}</strong></span>}
          {myRole && (
            <span>
              Seu acesso:{' '}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                myRole === 'owner' ? 'bg-blue-100 text-blue-700'
                : myRole === 'admin' ? 'bg-violet-100 text-violet-700'
                : myRole === 'editor' ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-200 text-slate-600'
              }`}>
                {myRole === 'owner' ? 'Proprietário' : myRole === 'admin' ? 'Admin' : myRole === 'editor' ? 'Editor' : 'Leitor'}
              </span>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowAudit(true)}
              className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs"
            >
              🕑 Histórico
            </button>
            {(myRole === 'owner' || myRole === 'admin') && (
              <button
                onClick={() => setShowShare(true)}
                className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-xs"
              >
                ⚙️ Gerenciar acesso & admins
              </button>
            )}
          </div>
        </div>
      )}
      {showShare && project && (
        <ShareDialog projectId={project.id} projectName={project.clientName || 'Projeto'} onClose={() => setShowShare(false)} />
      )}
      {showAudit && project && (
        <AuditPanel projectId={project.id} projectName={project.clientName || 'Projeto'} onClose={() => setShowAudit(false)} />
      )}
      {isViewer && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          👁️ Acesso somente leitura — você pode visualizar este projeto, mas não editá-lo. Peça a um admin para mudar sua permissão.
        </div>
      )}
      {conflict && (
        <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800 flex items-center justify-between gap-3">
          <span>⚠️ Este projeto foi alterado por outra pessoa. Recarregue para ver a versão mais recente (evite sobrescrever o trabalho dela).</span>
          <button
            onClick={async () => { await syncFromCloud(); setConflict(false); }}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-medium hover:bg-orange-700"
          >
            Recarregar
          </button>
        </div>
      )}

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
       <fieldset disabled={isViewer} className="contents">
        {tab === 'distributor' && (
          <div className="space-y-6">
            {/* Mercado do cliente — define o baseline (cenário SEM) */}
            <div className="border border-slate-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">Mercado do cliente (cenário atual / SEM)</h3>
              <p className="text-xs text-slate-500 mb-3">
                Cativo → tarifa regulada (TUSD+TE). ACL → energia comprada no mercado livre + TUSD com desconto de fonte incentivada.
              </p>
              <div className="grid grid-cols-2 gap-2 max-w-md">
                {(['CATIVO', 'ACL'] as const).map(mt => {
                  const active = (project.marketType ?? 'CATIVO') === mt;
                  return (
                    <button
                      key={mt}
                      type="button"
                      onClick={() => updateProject(project.id, {
                        marketType: mt,
                        aclBaseline: mt === 'ACL'
                          ? (project.aclBaseline ?? { energyPriceSemImp: 0.300, energyIndexation: 'FIXO', tusdDiscountConsumo: 0, tusdDiscountConsumoPT: 0, tusdDiscountDemanda: 0 })
                          : project.aclBaseline,
                      })}
                      className={`text-left px-3 py-2 rounded-lg border transition-colors ${active ? 'border-teal-500 bg-teal-50' : 'border-slate-300 bg-white hover:border-teal-400'}`}
                    >
                      <div className="text-sm font-medium text-slate-800">{mt === 'ACL' ? 'Mercado Livre (ACL)' : 'Mercado Cativo'}</div>
                      <div className="text-xs text-slate-500">{mt === 'ACL' ? 'Energia ACL + TUSD c/ desconto' : 'Tarifa regulada (TUSD+TE)'}</div>
                    </button>
                  );
                })}
              </div>

              {(project.marketType ?? 'CATIVO') === 'ACL' && (() => {
                const acl: ACLBaseline = project.aclBaseline ?? { energyPriceSemImp: 0.300, tusdDiscountConsumo: 0, tusdDiscountDemanda: 0 };
                const set = (patch: Partial<ACLBaseline>) => updateProject(project.id, { aclBaseline: { ...acl, ...patch } });
                // Lock-in: no ACL o preço da energia (TE) é travado por contrato (sem reajuste).
                // Travado ⟺ energyEscalationPct === 0. Destravar repõe um reajuste default (5%).
                const teLocked = (acl.energyEscalationPct ?? 0) === 0;
                const tePC = (acl.energyPisCofins ?? true) ? (acl.energyPisCofinsPct ?? 0.0925) : 0;
                const teICMS = (acl.energyIcms ?? true) ? project.distributor.taxes.ICMS : 0;
                const teAllIn = (acl.energyPriceSemImp ?? 0) * 1000 / ((1 - tePC) * (1 - teICMS));
                const incLevel = acl.incentivadaLevel ?? 0;
                const incOn = incLevel > 0; // discounts derived per UC → manual fields locked
                const fields: { label: string; get: () => number; set: (n: number) => void; step?: string; disabled?: boolean }[] = [
                  { label: 'Energia TE (R$/MWh, s/ imp.)', get: () => Math.round((acl.energyPriceSemImp ?? 0) * 1000), set: n => set({ energyPriceSemImp: n / 1000 }) },
                  { label: 'Reajuste energia (%/ano)', get: () => Math.round((acl.energyEscalationPct ?? 0) * 1000) / 10, set: n => set({ energyEscalationPct: n / 100 }), step: '0.1', disabled: teLocked },
                  { label: 'Desc. TUSD consumo FP (%)', get: () => Math.round((acl.tusdDiscountConsumo ?? 0) * 1000) / 10, set: n => set({ tusdDiscountConsumo: n / 100 }), step: '0.1', disabled: incOn },
                  { label: 'Desc. TUSD consumo PT (%)', get: () => Math.round((acl.tusdDiscountConsumoPT ?? acl.tusdDiscountConsumo ?? 0) * 1000) / 10, set: n => set({ tusdDiscountConsumoPT: n / 100 }), step: '0.1', disabled: incOn },
                  { label: 'Desc. TUSD demanda (%)', get: () => Math.round((acl.tusdDiscountDemanda ?? 0) * 1000) / 10, set: n => set({ tusdDiscountDemanda: n / 100 }), step: '0.1', disabled: incOn },
                ];
                return (
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="col-span-2 md:col-span-3 flex items-center gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={() => set({ energyEscalationPct: teLocked ? 0.05 : 0 })}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${teLocked ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-700 border-slate-300'}`}
                      >
                        {teLocked ? '🔒 TE travado (lock-in ACL)' : '🔓 TE com reajuste'}
                      </button>
                      <span className="text-[11px] text-slate-500">
                        {teLocked
                          ? 'Preço da energia fixo pelo contrato ACL — sem reajuste (típico). Destrave para simular energia subindo.'
                          : 'Energia reajusta pelo % ao lado. Trave para fixar o preço pelo prazo do contrato.'}
                      </span>
                    </div>
                    <div className="col-span-2 md:col-span-3 flex items-center gap-2 flex-wrap">
                      <label className="text-xs font-medium text-slate-600">Energia incentivada (fonte):</label>
                      <select
                        value={incLevel}
                        onChange={e => set({ incentivadaLevel: parseFloat(e.target.value) })}
                        className="text-sm border border-slate-300 rounded px-2 py-1 bg-white"
                      >
                        <option value={0}>Nenhuma (descontos manuais)</option>
                        <option value={0.5}>I50 — 50%</option>
                        <option value={0.8}>I80 — 80%</option>
                        <option value={1}>I100 — 100%</option>
                      </select>
                      {incOn && (
                        <span className="text-[11px] text-emerald-700">
                          ✓ Descontos derivados por UC (Verde: FP 0% · PT = nível×(1−TUSD_FP/TUSD_PT) · demanda = nível; Azul: energia 0% · demanda = nível) a partir das tarifas ANEEL. Campos abaixo bloqueados.
                        </span>
                      )}
                    </div>
                    {fields.map(f => (
                      <div key={f.label}>
                        <label className="block text-xs font-medium text-slate-600 mb-1">{f.label}</label>
                        <input
                          type="number"
                          step={f.step ?? '1'}
                          value={f.get()}
                          disabled={f.disabled}
                          onChange={e => f.set(parseFloat(e.target.value) || 0)}
                          className={`w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${f.disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
                        />
                      </div>
                    ))}
                    <p className="col-span-2 md:col-span-3 text-[11px] text-slate-500">
                      <strong>TE R$ {((acl.energyPriceSemImp ?? 0) * 1000).toFixed(0)}/MWh sem imp. → R$ {teAllIn.toFixed(0)}/MWh all-in</strong> (+PIS/COFINS {(tePC * 100).toFixed(2)}% +ICMS {(teICMS * 100).toFixed(0)}%, por dentro).{' '}
                      A energia ACL é tributada (PIS/COFINS+ICMS) e os descontos de TUSD reduzem o cenário atual.
                      Ao adotar GD (cativo) o cliente perde o desconto de demanda — refletido na economia.
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Fator de Ajuste (FA) toggle */}
            <div className="border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">Fator de Ajuste (FA) — compensação ponta ↔ fora-ponta</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                    REN 1000: compensar 1 kWh de <strong>ponta</strong> consome 1/FA créditos fora-ponta (FA = TE_FP/TE_PT). Algumas
                    distribuidoras (ex.: <strong>COPEL</strong>) não aplicam o FA na operação → créditos fora-ponta compensam ponta <strong>1:1</strong>,
                    o que <strong>aumenta a economia</strong> do cliente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateProject(project.id, { scenarios: { ...project.scenarios, applyFatorAjuste: !(project.scenarios.applyFatorAjuste !== false) } })}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium whitespace-nowrap ${
                    project.scenarios.applyFatorAjuste === false ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  {project.scenarios.applyFatorAjuste === false ? 'FA desativado — 1:1 (COPEL) ✓' : 'FA aplicado (REN 1000) — clique p/ desativar'}
                </button>
              </div>
            </div>

            <DistributorForm
              distributor={project.distributor}
              onChange={d => updateDistributor(project.id, d)}
            />
          </div>
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
              performanceFactor={project.performanceFactor ?? 1.0}
              tariffEscalationPPA={project.tariffEscalationPPA ?? 0}
              tariffEscalationDistributor={project.tariffEscalationDistributor ?? 0}
              simulationMonths={project.simulationMonths}
              additionalPlants={project.additionalPlants ?? []}
              onAdditionalPlantsChange={plants => updateProject(project.id, { additionalPlants: plants })}
              onProjectFieldChange={updates => updateProject(project.id, updates)}
            />
            <AdditionalPlants
              primary={project.plant}
              additionalPlants={project.additionalPlants ?? []}
              onChange={plants => updateProject(project.id, { additionalPlants: plants })}
              distributorId={project.distributor.id}
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
                contractStartMonth={project.plant.contractStartMonth}
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

        {tab === 'demanda' && (
          <DemandaAnalysisPanel
            ucs={project.ucs}
            distributor={project.distributor}
            onUpdate={(ucId, updates) => updateUC(project.id, ucId, updates)}
          />
        )}

        {tab === 'fatura' && <FaturaEspelho project={project} />}
       </fieldset>
      </div>
    </div>
  );
}
