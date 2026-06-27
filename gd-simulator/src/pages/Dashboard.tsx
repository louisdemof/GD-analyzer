import { useState, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ShareDialog } from '../components/ShareDialog';

const FOLDER_COLORS = ['#004B70', '#2F927B', '#C6DA38', '#f97316', '#8b5cf6', '#ef4444', '#6b7280', '#92400e'];

export function Dashboard() {
  const { projects, folders, setCurrentProject, loadDemoProject, loadBeloAlimentosDemo, loadCopelDemo, loadCopelDemo2, loadCopelDemo3, loadCopelDemo4, loadSuperfrioCwbiiDemo, loadSuperfrioPortfolioDemo, loadSuperfrioFrontloadDemo, loadSuperfrio5yDemo, duplicateProject, importProject, createFolder, deleteFolder, moveProjectToFolder, updateFolder } = useProjectStore();
  const navigate = useNavigate();
  const { cloudEnabled } = useAuth();
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string } | null>(null);
  const [showDemos, setShowDemos] = useState(false);
  // Drag-and-drop: id of the folder currently hovered while dragging a project ('none' = Sem pasta)
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const dropProject = (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveProjectToFolder(id, folderId);
    setDragOverFolder(null);
  };
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
          <h1 className="text-2xl font-bold text-slate-800">GD Analyzer</h1>
          <p className="text-sm text-slate-500 mt-1">Simulador de Geracao Distribuida — Helexia Brasil</p>
        </div>
        <div className="flex gap-2">
          {/* Demos — tucked into a dropdown to declutter the header */}
          <div className="relative">
            <button
              onClick={() => setShowDemos(v => !v)}
              className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Demos ▾
            </button>
            {showDemos && (
              <div
                className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-30 p-2 max-h-[70vh] overflow-auto"
                onMouseLeave={() => setShowDemos(false)}
              >
                <p className="text-[10px] text-slate-400 uppercase tracking-wider px-2 py-1">Projetos de demonstração</p>
                {([
                  { label: 'Demo Copasul', fn: loadDemoProject, route: 'copasul-cs3-demo' },
                  { label: 'Demo Belo Alimentos', fn: loadBeloAlimentosDemo, route: 'belo-alimentos-demo' },
                  { label: 'Demo COPEL (PR)', fn: loadCopelDemo, route: 'copel-demo' },
                  { label: 'Simulação 2 COPEL', fn: loadCopelDemo2, route: 'copel-demo-2' },
                  { label: 'Simulação 3 COPEL (HAP02+HAP03)', fn: loadCopelDemo3, route: 'copel-demo-3' },
                  { label: 'Simulação 4 COPEL — Proposta', fn: loadCopelDemo4, route: 'copel-demo-4' },
                  { label: 'SUPERFRIO CWBII — ACL', fn: loadSuperfrioCwbiiDemo, route: 'superfrio-cwbii-acl' },
                  { label: 'SUPERFRIO Paraná — Portfólio (5 UCs + HAP)', fn: loadSuperfrioPortfolioDemo, route: 'superfrio-pr-portfolio' },
                  { label: 'SUPERFRIO PR — Portfólio +HAP05 front-load', fn: loadSuperfrioFrontloadDemo, route: 'superfrio-pr-frontload' },
                  { label: 'SUPERFRIO PR — 5 anos · TE travado', fn: loadSuperfrio5yDemo, route: 'superfrio-pr-5y' },
                ] as const).map(d => (
                  <button
                    key={d.route}
                    onClick={() => { setShowDemos(false); d.fn(); navigate(`/project/${d.route}`); }}
                    className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-slate-50 text-slate-700"
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>
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
              onDragOver={e => { e.preventDefault(); setDragOverFolder('none'); }}
              onDragLeave={() => setDragOverFolder(null)}
              onDrop={e => dropProject(e, null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedFolder === 'none' ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'} ${dragOverFolder === 'none' ? 'ring-2 ring-teal-400 bg-teal-50' : ''}`}
            >
              Sem pasta ({projects.filter(p => !p.folderId).length})
            </button>

            <div className="pt-3 pb-1">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider px-3">Clientes</p>
            </div>

            {folders.map(f => (
              <div key={f.id} className="group flex items-center"
                onDragOver={e => { e.preventDefault(); setDragOverFolder(f.id); }}
                onDragLeave={() => setDragOverFolder(null)}
                onDrop={e => dropProject(e, f.id)}>
                <button
                  onClick={() => setSelectedFolder(f.id)}
                  className={`flex-1 text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${selectedFolder === f.id ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'} ${dragOverFolder === f.id ? 'ring-2 ring-teal-400 bg-teal-50' : ''}`}
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
                    draggable
                    onDragStart={e => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onClick={() => { setCurrentProject(p.id); navigate(`/project/${p.id}`); }}
                    title="Arraste para uma pasta à esquerda"
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
                      <div className="flex gap-1">
                        <button onClick={(e) => handleDuplicate(e, p.id)} className="p-1 text-slate-400 hover:text-teal-600" title="Duplicar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                        <button onClick={(e) => handleExport(e, p.id)} className="p-1 text-slate-400 hover:text-teal-600" title="Exportar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </button>
                        {cloudEnabled && (
                          <button onClick={(e) => { e.stopPropagation(); setShareTarget({ id: p.id, name: p.clientName || 'Sem nome' }); }} className="p-1 text-slate-400 hover:text-teal-600" title="Compartilhar">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                          </button>
                        )}
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

      {shareTarget && (
        <ShareDialog projectId={shareTarget.id} projectName={shareTarget.name} onClose={() => setShareTarget(null)} />
      )}
    </div>
  );
}
