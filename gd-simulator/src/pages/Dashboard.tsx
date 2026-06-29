import { useState, useRef, useEffect } from 'react';
import { Button } from '../components/ui/Button';
import type { ProjectStatus } from '../engine/types';
import { STATUS_META, STATUS_ORDER, statusOf } from '../lib/projectStatus';
import { useProjectStore } from '../store/projectStore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { cloudIncomingShares } from '../storage/cloudSync';
import { ShareDialog } from '../components/ShareDialog';

const FOLDER_COLORS = ['#004B70', '#2F927B', '#C6DA38', '#f97316', '#8b5cf6', '#ef4444', '#6b7280', '#92400e'];

export function Dashboard() {
  const { projects, folders, setCurrentProject, loadDemoProject, loadBeloAlimentosDemo, loadCopelDemo, loadCopelDemo2, loadCopelDemo3, loadCopelDemo4, loadSuperfrioCwbiiDemo, loadSuperfrioPortfolioDemo, loadSuperfrioFrontloadDemo, loadSuperfrio5yDemo, duplicateProject, importProject, createFolder, deleteFolder, moveProjectToFolder, updateFolder, updateProject, deleteProject } = useProjectStore();
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
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'created'>('updated');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null);
  const [view, setView] = useState<'cards' | 'table'>(() =>
    (localStorage.getItem('gd-dashboard-view') as 'cards' | 'table') || 'cards');
  useEffect(() => { localStorage.setItem('gd-dashboard-view', view); }, [view]);

  // "Shared with me" = projects that appear in my incoming shares (someone else owns them).
  // Anything else — including local-only demos and offline projects — counts as mine.
  // (Don't infer shared from "not in cloud-owned": that misflags local-only projects.)
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!cloudEnabled) return;
    cloudIncomingShares().then(list => setSharedIds(new Set(list.map(s => s.projectId)))).catch(() => {});
  }, [cloudEnabled, projects.length]);
  const isShared = (id: string) => sharedIds.has(id);

  // Soft delete: trashed projects (deletedAt set) are hidden from every normal view
  // and live only in the Lixeira scope.
  const active = projects.filter(p => !p.deletedAt);
  const trashedProjects = projects.filter(p => !!p.deletedAt);
  const sharedCount = active.filter(p => isShared(p.id)).length;
  const sharingActive = sharedCount > 0;

  // Is the project in one of MY folders? (shared projects carry the owner's folderId,
  // which won't match my folders, so they fall outside folder/Sem-pasta views.)
  const inMyFolder = (p: typeof projects[number]) => folders.some(f => f.id === p.folderId);

  // scope → folder → search → status, then sort.
  // 'Todos' = everything active I can see (owned + shared). Folders/'Sem pasta' = my own org.
  const filteredProjects = (() => {
    let list = selectedFolder === 'trash'
      ? trashedProjects
      : selectedFolder === 'shared'
      ? active.filter(p => isShared(p.id))
      : selectedFolder === null
        ? active
        : selectedFolder === 'none'
          ? active.filter(p => !inMyFolder(p) && !isShared(p.id))
          : active.filter(p => p.folderId === selectedFolder);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(p =>
      (p.clientName || '').toLowerCase().includes(q) ||
      (p.plant?.name || '').toLowerCase().includes(q) ||
      (p.distributor?.name || '').toLowerCase().includes(q));
    if (statusFilter) list = list.filter(p => statusOf(p.status) === statusFilter);
    const sorted = [...list];
    sorted.sort((a, b) =>
      sortBy === 'name' ? (a.clientName || '').localeCompare(b.clientName || '')
      : sortBy === 'created' ? (b.createdAt || '').localeCompare(a.createdAt || '')
      : (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return sorted;
  })();

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importProject(reader.result as string);
        navigate(`/project/${useProjectStore.getState().currentProjectId}`);
      } catch { alert('Ficheiro inválido'); }
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

  // Soft delete → moves to Lixeira (reversible).
  const handleDelete = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`Mover "${name}" para a lixeira? Você poderá restaurar depois.`)) {
      updateProject(id, { deletedAt: new Date().toISOString() });
    }
  };
  const handleRestore = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    updateProject(id, { deletedAt: null });
  };
  const handlePurge = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (confirm(`Excluir DEFINITIVAMENTE "${name}"? Esta ação não pode ser desfeita.`)) {
      deleteProject(id);
    }
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolder(newFolderName.trim(), newFolderColor);
    setNewFolderName('');
    setShowNewFolder(false);
  };

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // One project card. showFolderBadge=false in the grouped view (header already shows it).
  const renderCard = (p: typeof projects[number], showFolderBadge = true) => {
    const folder = folders.find(f => f.id === p.folderId);
    const shared = isShared(p.id);
    return (
      <div
        key={p.id}
        draggable
        onDragStart={e => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; }}
        onClick={() => { setCurrentProject(p.id); navigate(`/project/${p.id}`); }}
        title={shared ? 'Compartilhado com você — arraste para organizar nas suas pastas' : 'Arraste para uma pasta à esquerda'}
        className="p-4 border border-slate-200 rounded-xl cursor-pointer hover:border-teal-300 hover:shadow-sm transition-all group"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {shared && (
              <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 mb-1">🔗 compartilhado</span>
            )}
            {showFolderBadge && !shared && folder && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: folder.color }} />
                {folder.name}
              </span>
            )}
            <h3 className="font-semibold text-slate-800 truncate">{p.clientName || 'Sem nome'}</h3>
            <p className="text-xs text-slate-500 mt-1">{p.plant.name || 'Planta não definida'}</p>
          </div>
          <div className="flex gap-1">
            <button onClick={(e) => handleDuplicate(e, p.id)} className="p-1 text-slate-400 hover:text-teal-600" title="Duplicar">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            </button>
            <button onClick={(e) => handleExport(e, p.id)} className="p-1 text-slate-400 hover:text-teal-600" title="Exportar">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </button>
            {cloudEnabled && !shared && (
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
            <button onClick={(e) => handleDelete(e, p.id, p.clientName || 'Sem nome')} className="p-1 text-slate-400 hover:text-red-600" title="Excluir">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
          <span>{p.ucs.length} UCs</span>
          <span>{p.plant.contractMonths || 24}m</span>
          <span>{p.distributor.name || '—'}</span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-slate-300">
            {new Date(p.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
          <select
            value={statusOf(p.status)}
            onClick={e => e.stopPropagation()}
            onChange={e => { e.stopPropagation(); updateProject(p.id, { status: e.target.value as ProjectStatus }); }}
            title="Status do negócio"
            className={`text-[10px] font-medium rounded-full px-2 py-0.5 border-none cursor-pointer focus:outline-none ${STATUS_META[statusOf(p.status)].chip}`}
          >
            {STATUS_ORDER.map(st => <option key={st} value={st}>{STATUS_META[st].label}</option>)}
          </select>
        </div>
      </div>
    );
  };

  // Dense table view (flat, already-sorted list). Clickable headers reuse `sortBy`.
  const SortTh = ({ col, label, align }: { col?: 'name' | 'updated'; label: string; align?: string }) => (
    <th
      onClick={() => col && setSortBy(col)}
      className={`py-2 px-3 font-medium text-slate-500 ${align || 'text-left'} ${col ? 'cursor-pointer hover:text-slate-700 select-none' : ''}`}
    >
      {label}{col && sortBy === col ? ' ↓' : ''}
    </th>
  );
  const renderTable = (list: typeof projects) => (
    <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <SortTh col="name" label="Cliente" />
            <th className="text-left py-2 px-3 font-medium text-slate-500">Pasta</th>
            <th className="text-left py-2 px-3 font-medium text-slate-500">Distribuidora</th>
            <th className="text-right py-2 px-3 font-medium text-slate-500">UCs</th>
            <th className="text-right py-2 px-3 font-medium text-slate-500">Prazo</th>
            <th className="text-left py-2 px-3 font-medium text-slate-500">Status</th>
            <SortTh col="updated" label="Atualizado" />
            <th className="py-2 px-3"></th>
          </tr>
        </thead>
        <tbody>
          {list.map(p => {
            const folder = folders.find(f => f.id === p.folderId);
            const shared = isShared(p.id);
            return (
              <tr
                key={p.id}
                onClick={() => { setCurrentProject(p.id); navigate(`/project/${p.id}`); }}
                className="border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer"
              >
                <td className="py-2 px-3 font-medium text-slate-800 max-w-[220px] truncate">
                  {shared && <span className="text-[10px] text-blue-600 mr-1" title="Compartilhado">🔗</span>}
                  {p.clientName || 'Sem nome'}
                </td>
                <td className="py-2 px-3 text-slate-500">
                  {folder ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: folder.color }} />{folder.name}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-2 px-3 text-slate-500">{p.distributor.name || '—'}</td>
                <td className="py-2 px-3 text-right text-slate-500">{p.ucs.length}</td>
                <td className="py-2 px-3 text-right text-slate-500">{p.plant.contractMonths || 24}m</td>
                <td className="py-2 px-3">
                  <select
                    value={statusOf(p.status)}
                    onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); updateProject(p.id, { status: e.target.value as ProjectStatus }); }}
                    className={`text-[10px] font-medium rounded-full px-2 py-0.5 border-none cursor-pointer focus:outline-none ${STATUS_META[statusOf(p.status)].chip}`}
                  >
                    {STATUS_ORDER.map(st => <option key={st} value={st}>{STATUS_META[st].label}</option>)}
                  </select>
                </td>
                <td className="py-2 px-3 text-slate-400 text-xs whitespace-nowrap">
                  {new Date(p.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
                <td className="py-2 px-3">
                  <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                    <button onClick={(e) => handleDuplicate(e, p.id)} className="p-1 text-slate-400 hover:text-teal-600" title="Duplicar">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </button>
                    <button onClick={(e) => handleExport(e, p.id)} className="p-1 text-slate-400 hover:text-teal-600" title="Exportar">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </button>
                    {cloudEnabled && !shared && (
                      <button onClick={(e) => { e.stopPropagation(); setShareTarget({ id: p.id, name: p.clientName || 'Sem nome' }); }} className="p-1 text-slate-400 hover:text-teal-600" title="Compartilhar">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                      </button>
                    )}
                    <button onClick={(e) => handleDelete(e, p.id, p.clientName || 'Sem nome')} className="p-1 text-slate-400 hover:text-red-600" title="Excluir">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">GD Analyzer</h1>
          <p className="text-sm text-slate-500 mt-1">Simulador de Geração Distribuída — Helexia Brasil</p>
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
          <Button variant="primary" onClick={() => navigate('/new')}>+ Novo Projeto</Button>
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
              Todos os Projetos ({active.length})
            </button>
            <button
              onClick={() => setSelectedFolder('none')}
              onDragOver={e => { e.preventDefault(); setDragOverFolder('none'); }}
              onDragLeave={() => setDragOverFolder(null)}
              onDrop={e => dropProject(e, null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedFolder === 'none' ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'} ${dragOverFolder === 'none' ? 'ring-2 ring-teal-400 bg-teal-50' : ''}`}
            >
              Sem pasta ({active.filter(p => !inMyFolder(p) && !isShared(p.id)).length})
            </button>
            {sharingActive && sharedCount > 0 && (
              <button
                onClick={() => setSelectedFolder('shared')}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedFolder === 'shared' ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`}
              >
                🔗 Compartilhados comigo ({sharedCount})
              </button>
            )}
            {trashedProjects.length > 0 && (
              <button
                onClick={() => setSelectedFolder('trash')}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedFolder === 'trash' ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`}
              >
                🗑️ Lixeira ({trashedProjects.length})
              </button>
            )}

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
          {/* Toolbar: search · sort · status filter */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por cliente, distribuidora…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <span className="absolute left-2.5 top-2.5 text-slate-400 text-sm">🔍</span>
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="text-sm border border-slate-300 rounded-lg px-2 py-2 bg-white text-slate-600"
              title="Ordenar"
            >
              <option value="updated">Mais recentes</option>
              <option value="name">Nome (A–Z)</option>
              <option value="created">Data de criação</option>
            </select>
            <div className="flex border border-slate-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setView('cards')}
                className={`px-2.5 py-2 text-sm ${view === 'cards' ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                title="Cartões"
              >▦</button>
              <button
                onClick={() => setView('table')}
                className={`px-2.5 py-2 text-sm border-l border-slate-300 ${view === 'table' ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                title="Lista"
              >☰</button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            <button
              onClick={() => setStatusFilter(null)}
              className={`px-2.5 py-1 text-xs rounded-full border ${statusFilter === null ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              Todos
            </button>
            {STATUS_ORDER.map(st => {
              const count = active.filter(p => statusOf(p.status) === st).length;
              if (count === 0 && statusFilter !== st) return null;
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(statusFilter === st ? null : st)}
                  className={`px-2.5 py-1 text-xs rounded-full border ${statusFilter === st ? 'ring-2 ring-offset-1 ring-slate-400 ' : ''}${STATUS_META[st].chip} border-transparent`}
                >
                  {STATUS_META[st].label} {count > 0 && <span className="opacity-60">({count})</span>}
                </button>
              );
            })}
          </div>
          {filteredProjects.length === 0 ? (
            <div className="text-center py-16 px-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
              {projects.length === 0 ? (
                <>
                  <div className="text-4xl mb-3">⚡</div>
                  <h3 className="text-base font-semibold text-slate-700">Nenhum projeto ainda</h3>
                  <p className="text-sm text-slate-500 mt-1 mb-5 max-w-sm mx-auto">
                    Crie um projeto do zero ou importe faturas (Energisa MS / COPEL) para preencher tudo automaticamente.
                  </p>
                  <Button variant="primary" onClick={() => navigate('/new')}>+ Criar primeiro projeto</Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-500">Nenhum projeto corresponde à busca/filtros.</p>
                  <button onClick={() => { setSearch(''); setStatusFilter(null); }} className="text-sm text-teal-600 mt-2 hover:underline">Limpar filtros</button>
                </>
              )}
            </div>
          ) : selectedFolder === 'trash' ? (
            <div className="space-y-2">
              {filteredProjects.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 border border-slate-200 rounded-xl bg-slate-50">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 truncate">{p.clientName || 'Sem nome'}</p>
                    <p className="text-[11px] text-slate-400">
                      Na lixeira{p.deletedAt ? ` desde ${new Date(p.deletedAt).toLocaleDateString('pt-BR')}` : ''} · {p.distributor.name || '—'}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={(e) => handleRestore(e, p.id)} className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 hover:bg-white">Restaurar</button>
                    <button onClick={(e) => handlePurge(e, p.id, p.clientName || 'Sem nome')} className="px-3 py-1.5 text-xs rounded-lg border border-red-300 text-red-600 hover:bg-red-50">Excluir definitivamente</button>
                  </div>
                </div>
              ))}
            </div>
          ) : view === 'table' ? (
            renderTable(filteredProjects)
          ) : selectedFolder === null ? (
            /* Grouped by client (folder) */
            <div className="space-y-8">
              {[...folders, null].map(f => {
                const fid = f ? f.id : null;
                const ps = f
                  ? filteredProjects.filter(p => p.folderId === fid)
                  : filteredProjects.filter(p => !inMyFolder(p)); // Sem pasta + shared/foreign
                if (ps.length === 0) return null;
                const key = fid ?? 'none';
                const collapsed = collapsedGroups.has(key);
                return (
                  <div key={key}>
                    <button
                      onClick={() => toggleGroup(key)}
                      className="flex items-center gap-2 mb-3 text-sm font-semibold text-slate-700 hover:text-slate-900"
                    >
                      <span className="text-slate-400 w-3 text-center">{collapsed ? '\u25b8' : '\u25be'}</span>
                      {f && <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: f.color }} />}
                      {f ? f.name : 'Sem pasta'}
                      <span className="text-xs font-normal text-slate-400">({ps.length})</span>
                    </button>
                    {!collapsed && (
                      <div className="grid grid-cols-2 gap-4">{ps.map(p => renderCard(p, false))}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">{filteredProjects.map(p => renderCard(p, true))}</div>
          )}
        </div>
      </div>

      {shareTarget && (
        <ShareDialog projectId={shareTarget.id} projectName={shareTarget.name} onClose={() => setShareTarget(null)} />
      )}
    </div>
  );
}
