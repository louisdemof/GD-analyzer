import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useNavigate, useLocation } from 'react-router-dom';
import { NotificationBell } from '../NotificationBell';

export function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const duplicateProject = useProjectStore(s => s.duplicateProject);
  const updateProject = useProjectStore(s => s.updateProject);
  // Only treat a project as "open" on project/results routes — otherwise the dashboard
  // and new-project pages would keep showing the last opened project in the top bar.
  const onProjectRoute = /^\/(project|results)\//.test(location.pathname);
  const project = useProjectStore(s => {
    const id = s.currentProjectId;
    return id ? s.projects.find(p => p.id === id) : null;
  });
  const activeProject = onProjectRoute ? project : null;

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the draft in sync when switching projects / cancelling.
  useEffect(() => {
    if (!editing) setDraftName(project?.clientName ?? '');
  }, [project?.id, project?.clientName, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const handleDuplicate = () => {
    if (!project) return;
    const clone = duplicateProject(project.id);
    if (clone) navigate(`/project/${clone.id}`);
  };

  const startEdit = () => {
    if (!project) return;
    setDraftName(project.clientName);
    setEditing(true);
  };

  const commitEdit = () => {
    if (!project) return;
    const name = draftName.trim();
    if (name && name !== project.clientName) {
      updateProject(project.id, { clientName: name });
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setDraftName(project?.clientName ?? '');
    setEditing(false);
  };

  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6">
      <div className="flex items-center gap-3 min-w-0">
        {activeProject ? (
          <>
            {editing ? (
              <input
                ref={inputRef}
                autoFocus
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
                className="text-sm font-semibold text-slate-800 border border-teal-400 rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-teal-400 min-w-[12rem]"
                placeholder="Nome do projeto"
              />
            ) : (
              <button
                onClick={startEdit}
                className="group flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-teal-700 truncate"
                title="Clique para renomear o projeto"
              >
                <span className="truncate">{activeProject.clientName}</span>
                <svg className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
            )}
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500 truncate">{activeProject.plant.name || 'Planta não definida'}</span>
          </>
        ) : (
          <h2 className="text-sm font-semibold text-slate-800">GD Analyzer</h2>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
        <NotificationBell />
        {activeProject && (
          <button
            onClick={handleDuplicate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded-lg hover:opacity-90"
            style={{ backgroundColor: '#2F927B' }}
            title="Criar uma cópia desta simulação"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            Duplicar simulação
          </button>
        )}
        <span>v1.0 MVP</span>
      </div>
    </header>
  );
}
