import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { KPICards } from '../components/results/KPICards';
import { CostWaterfall } from '../components/results/CostWaterfall';
import { MonthlyChart } from '../components/results/MonthlyChart';
import { BankDynamics } from '../components/results/BankDynamics';
import { RateioTable } from '../components/results/RateioTable';
import { ScenarioPanel } from '../components/results/ScenarioPanel';
import { SensitivityAnalysis } from '../components/results/SensitivityAnalysis';
import type { OptimiserProgress } from '../engine/optimiser';
import type { RateioAllocation } from '../engine/types';
import OptimiserWorker from '../engine/optimiser.worker?worker';
import { generatePDF, downloadPDF } from '../engine/pdf';
import { exportResultsExcel } from '../engine/excel';
import { exportConsumptionExcel } from '../engine/consumptionExcel';

type ResultTab = 'resumo' | 'mensal' | 'banco' | 'rateio' | 'sensibilidades' | 'sensibilidade-geracao';

export function Results() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects, updateScenarios, updateRateio } = useProjectStore();
  const { runForProject, getResult, isRunning } = useSimulationStore();
  const project = projects.find(p => p.id === id);
  const [tab, setTab] = useState<ResultTab>('resumo');
  const [isOptimising, setIsOptimising] = useState(false);
  const [optimProgress, setOptimProgress] = useState<OptimiserProgress | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [previousRateio, setPreviousRateio] = useState<RateioAllocation | null>(null);
  const previousEconomia = useRef<number>(0);
  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // Cleanup worker and timeout on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (id) runForProject(id);
  }, [id, project?.scenarios, project?.rateio, project?.ucs.length]);

  const result = id ? getResult(id) : null;

  // Store current economia for comparison
  useEffect(() => {
    if (result) previousEconomia.current = result.summary.economiaLiquida;
  }, [result?.summary.economiaLiquida]);

  const cancelOptimisation = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    setIsOptimising(false);
    setOptimProgress(null);
    setToast('Optimização cancelada');
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleOptimise = useCallback(() => {
    if (!project) return;

    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }

    setIsOptimising(true);
    setPreviousRateio({ ...project.rateio });
    const beforeEconomia = previousEconomia.current;

    const worker = new OptimiserWorker();
    workerRef.current = worker;

    // 60-second timeout
    timeoutRef.current = setTimeout(() => {
      worker.terminate();
      workerRef.current = null;
      setIsOptimising(false);
      setOptimProgress(null);
      setToast('Optimização excedeu 60 segundos. Tente reduzir o número de UCs.');
      setTimeout(() => setToast(null), 8000);
    }, 60000);

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'progress') {
        setOptimProgress(e.data as OptimiserProgress);
      } else if (e.data.type === 'done') {
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
        const { allocation, bestEconomia } = e.data.result;
        updateRateio(project.id, allocation);

        const pctImprovement = beforeEconomia > 0
          ? ((bestEconomia - beforeEconomia) / beforeEconomia * 100).toFixed(1)
          : '—';
        setToast(
          `Rateio optimizado — Economia líquida: R$ ${bestEconomia.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} (${Number(pctImprovement) > 0 ? '+' : ''}${pctImprovement}% vs anterior)`
        );
        setTimeout(() => setToast(null), 8000);

        setIsOptimising(false);
        setOptimProgress(null);
        workerRef.current = null;
        worker.terminate();
      }
    };

    worker.onerror = () => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      setToast('Erro na optimização');
      setTimeout(() => setToast(null), 5000);
      setIsOptimising(false);
      setOptimProgress(null);
      workerRef.current = null;
      worker.terminate();
    };

    worker.postMessage({ project });
  }, [project, updateRateio]);

  const handleUndoRateio = useCallback(() => {
    if (!project || !previousRateio) return;
    updateRateio(project.id, previousRateio);
    setPreviousRateio(null);
    setToast('Rateio revertido para alocação anterior');
    setTimeout(() => setToast(null), 4000);
  }, [project, previousRateio, updateRateio]);

  const handleRateioChange = useCallback((rateio: RateioAllocation) => {
    if (!project) return;
    updateRateio(project.id, rateio);
  }, [project, updateRateio]);

  if (!project) {
    return <div className="p-6 text-slate-500">Projeto não encontrado.</div>;
  }

  const simError = useSimulationStore.getState().error;

  if (!result) {
    return (
      <div className="p-6 text-center">
        {isRunning ? (
          <p className="text-slate-500">Calculando simulacao...</p>
        ) : (
          <div className="max-w-md mx-auto mt-8 p-6 rounded-xl border border-red-200 bg-red-50">
            <p className="text-red-800 font-medium mb-2">Erro ao calcular simulacao</p>
            {simError && <p className="text-sm text-red-600 mb-4">{simError}</p>}
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => navigate(`/project/${id}`)}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg"
                style={{ backgroundColor: '#004B70' }}
              >
                Editar Projeto
              </button>
              <button
                onClick={() => { if (id) runForProject(id); }}
                className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const tabs: { key: ResultTab; label: string }[] = [
    { key: 'resumo', label: 'Resumo Executivo' },
    { key: 'mensal', label: 'Análise Mensal' },
    { key: 'banco', label: 'Banco de Créditos' },
    { key: 'rateio', label: 'Rateio' },
    { key: 'sensibilidades', label: 'Sensibilidades' },
    { key: 'sensibilidade-geracao', label: 'Sensibilidade Geracao' },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 text-white px-4 py-3 rounded-lg shadow-lg text-sm max-w-md animate-in">
          {toast}
          <button onClick={() => setToast(null)} className="ml-3 text-white/60 hover:text-white">✕</button>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{project.clientName} — Resultados</h1>
          <p className="text-xs text-slate-500">{project.plant.name} | {project.distributor.name}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/project/${id}`)}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            ← Editar Projeto
          </button>
          <button
            onClick={() => {
              const json = useProjectStore.getState().exportProject(project.id);
              const blob = new Blob([json], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${project.clientName.toLowerCase().replace(/\s+/g, '_')}_export.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Exportar JSON
          </button>
          <button
            onClick={async () => {
              setIsExportingPDF(true);
              try {
                const blob = await generatePDF(project, result);
                downloadPDF(blob, project.clientName);
              } catch (e) {
                setToast('Erro ao gerar PDF: ' + (e instanceof Error ? e.message : 'desconhecido'));
                setTimeout(() => setToast(null), 5000);
              }
              setIsExportingPDF(false);
            }}
            disabled={isExportingPDF}
            className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-60"
            style={{ backgroundColor: '#004B70' }}
          >
            {isExportingPDF ? 'Gerando PDF...' : 'Exportar PDF'}
          </button>
          <button
            onClick={() => {
              setIsExportingExcel(true);
              try {
                exportResultsExcel(project, result);
              } catch (e) {
                setToast('Erro ao gerar Excel: ' + (e instanceof Error ? e.message : 'desconhecido'));
                setTimeout(() => setToast(null), 5000);
              }
              setIsExportingExcel(false);
            }}
            disabled={isExportingExcel}
            className="px-4 py-2 text-sm border border-teal-500 text-teal-700 rounded-lg hover:bg-teal-50 disabled:opacity-60"
          >
            Exportar Excel
          </button>
          <button
            onClick={() => {
              try {
                exportConsumptionExcel(project);
              } catch (e) {
                setToast('Erro ao exportar consumo: ' + (e instanceof Error ? e.message : 'desconhecido'));
                setTimeout(() => setToast(null), 5000);
              }
            }}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Exportar Consumo
          </button>
        </div>
      </div>

      <KPICards summary={result.summary} months={result.months} />

      <div className="flex gap-1 mt-6 mb-4 border-b border-slate-200">
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
        {tab === 'resumo' && <CostWaterfall months={result.months} />}
        {tab === 'mensal' && <MonthlyChart months={result.months} />}
        {tab === 'banco' && (
          <BankDynamics
            result={result}
            ucs={project.ucs}
            months={result.months}
            ppaRate={project.plant.ppaRateRsBRLkWh}
            rateio={project.rateio}
            generation={result.months.map(m => m.generation)}
          />
        )}
        {tab === 'rateio' && (
          <div className="space-y-4">
            {/* Optimiser controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleOptimise}
                disabled={isOptimising}
                className="px-5 py-2.5 text-sm text-white rounded-lg font-medium disabled:opacity-60 transition-opacity"
                style={{ backgroundColor: '#004B70' }}
              >
                {isOptimising
                  ? `Optimizando... ${optimProgress?.message || 'Iniciando...'}`
                  : 'Optimizar Rateio (Maximizar Economia)'
                }
              </button>

              {isOptimising && (
                <button
                  onClick={cancelOptimisation}
                  className="px-4 py-2.5 text-sm border border-red-300 text-red-600 rounded-lg hover:bg-red-50"
                >
                  Cancelar
                </button>
              )}

              {previousRateio && !isOptimising && (
                <button
                  onClick={handleUndoRateio}
                  className="px-4 py-2.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Reverter para alocação anterior
                </button>
              )}

              {isOptimising && (
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                  <div className="flex-1 max-w-xs">
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all duration-300"
                        style={{ width: `${optimProgress?.pct || 0}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    Melhor: R$ {(optimProgress?.bestEconomia || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              )}
            </div>

            <RateioTable
              rateio={project.rateio}
              ucs={project.ucs}
              onRateioChange={handleRateioChange}
            />
          </div>
        )}
        {tab === 'sensibilidades' && (
          <ScenarioPanel
            scenarios={project.scenarios}
            onChange={updates => updateScenarios(project.id, updates)}
            onOptimise={handleOptimise}
            isOptimising={isOptimising}
            growthRate={project.growthRate}
            generationDegradation={project.generationDegradation}
            onProjectChange={updates => useProjectStore.getState().updateProject(project.id, updates)}
          />
        )}
        {tab === 'sensibilidade-geracao' && (
          <SensitivityAnalysis project={project} result={result} />
        )}
      </div>
    </div>
  );
}
