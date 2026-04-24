import { useState, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useNavigate } from 'react-router-dom';

const FOLDER_COLORS = ['#004B70', '#2F927B', '#C6DA38', '#f97316', '#8b5cf6', '#ef4444', '#6b7280', '#92400e'];

export function Dashboard() {
  const { projects, folders, setCurrentProject, loadDemoProject, loadBeloAlimentosDemo, duplicateProject, importProject, createFolder, deleteFolder, moveProjectToFolder, updateFolder } = useProjectStore();
  const navigate = useNavigate();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null); // null = all
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredProjects = selectedFolder === null
    ? projects
    : selectedFolder === 'none'
      ? projects.filter(p => !p.folderId)
      : projects.filter(p => p.folderId === selectedFolder);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importProject(reader.result as string);
        navigate(`/project/${useProjectStore.getState().currentProjectId}`);
      } catch { alert('Ficheiro invalido'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDuplicate = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const clone = duplicateProject(id);
    if (clone) navigate(`/project/${clone.id}`);
  };

  const handleExport = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const json = useProjectStore.getState().exportProject(id);
    const p = projects.find(pp => pp.id === id);
    const name = (p?.clientName || 'projeto').toLowerCase().replace(/\s+/g, '_');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Helexia_${name}_${new Date().toISOString().slice(0, 10)}.gdproject.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolder(newFolderName.trim(), newFolderColor);
    setNewFolderName('');
    setShowNewFolder(false);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">GD Simulator</h1>
          <p className="text-sm text-slate-500 mt-1">Simulador de Geracao Distribuida — Helexia Brasil</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { loadDemoProject(); navigate('/project/copasul-cs3-demo'); }}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Demo Copasul
          </button>
          <button
            onClick={() => { loadBeloAlimentosDemo(); navigate('/project/belo-alimentos-demo'); }}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Demo Belo Alimentos
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Importar Projeto
          </button>
          <input ref={fileInputRef} type="file" accept=".json,.gdproject.json" className="hidden" onChange={handleImport} />
          <button
            onClick={() => navigate('/new')}
            className="px-4 py-2 text-sm text-white rounded-lg font-medium"
            style={{ backgroundColor: '#2F927B' }}
          >
            + Novo Projeto
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left panel — folders */}
        <div className="w-56 shrink-0">
          <div className="space-y-1">
            <button
              onClick={() => setSelectedFolder(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedFolder === null ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`}
            >
              Todos os Projetos ({projects.length})
            </button>
            <button
              onClick={() => setSelectedFolder('none')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedFolder === 'none' ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`}
            >
              Sem pasta ({projects.filter(p => !p.folderId).length})
            </button>

            <div className="pt-3 pb-1">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider px-3">Clientes</p>
            </div>

            {folders.map(f => (
              <div key={f.id} className="group flex items-center">
                <button
                  onClick={() => setSelectedFolder(f.id)}
                  className={`flex-1 text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${selectedFolder === f.id ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs text-slate-400 ml-auto">
                    {projects.filter(p => p.folderId === f.id).length}
                  </span>
                </button>
                <button
                  onClick={() => { if (confirm(`Eliminar pasta "${f.name}"?`)) deleteFolder(f.id); }}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 text-xs px-1"
                >
                  x
                </button>
              </div>
            ))}

            {showNewFolder ? (
              <div className="p-2 bg-slate-50 rounded-lg space-y-2">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                  placeholder="Nome do cliente"
                  className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded"
                />
                <div className="flex gap-1">
                  {FOLDER_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewFolderColor(c)}
                      className={`w-5 h-5 rounded-full ${newFolderColor === c ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div className="flex gap-1">
                  <button onClick={handleCreateFolder} className="px-2 py-1 text-xs text-white rounded" style={{ backgroundColor: '#004B70' }}>Criar</button>
                  <button onClick={() => setShowNewFolder(false)} className="px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 rounded">Cancelar</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowNewFolder(true)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-teal-600 hover:bg-teal-50"
              >
                + Nova pasta de cliente
              </button>
            )}
          </div>
        </div>

        {/* Right panel — projects */}
        <div className="flex-1">
          {filteredProjects.length === 0 ? (
            <div className="text-center py-16 bg-slate-50 rounded-xl">
              <p className="text-slate-500 text-sm">Nenhum projeto nesta vista.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {filteredProjects.map(p => {
                const folder = folders.find(f => f.id === p.folderId);
                return (
                  <div
                    key={p.id}
                    onClick={() => { setCurrentProject(p.id); navigate(`/project/${p.id}`); }}
                    className="p-4 border border-slate-200 rounded-xl cursor-pointer hover:border-teal-300 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        {folder && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: folder.color }} />
                            {folder.name}
                          </span>
                        )}
                        <h3 className="font-semibold text-slate-800 truncate">{p.clientName || 'Sem nome'}</h3>
                        <p className="text-xs text-slate-500 mt-1">{p.plant.name || 'Planta nao definida'}</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => handleDuplicate(e, p.id)} className="p-1 text-slate-400 hover:text-teal-600" title="Duplicar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        <button onClick={(e) => handleExport(e, p.id)} className="p-1 text-slate-400 hover:text-teal-600" title="Exportar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </button>
                        {folders.length > 0 && (
                          <select
                            onClick={e => e.stopPropagation()}
                            value={p.folderId || ''}
                            onChange={e => { e.stopPropagation(); moveProjectToFolder(p.id, e.target.value || null); }}
                            className="text-[10px] text-slate-400 bg-transparent border-none cursor-pointer p-0"
                            title="Mover para pasta"
                          >
                            <option value="">Sem pasta</option>
                            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
                      <span>{p.ucs.length} UCs</span>
                      <span>{p.plant.contractMonths || 24}m</span>
                      <span>{p.distributor.name || '—'}</span>
                    </div>
                    <p className="text-[10px] text-slate-300 mt-2">
                      {new Date(p.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
