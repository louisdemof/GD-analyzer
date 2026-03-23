import { useProjectStore } from '../../store/projectStore';

export function TopBar() {
  const project = useProjectStore(s => {
    const id = s.currentProjectId;
    return id ? s.projects.find(p => p.id === id) : null;
  });

  return (
    <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        {project ? (
          <>
            <h2 className="text-sm font-semibold text-slate-800">{project.clientName}</h2>
            <span className="text-xs text-slate-400">|</span>
            <span className="text-xs text-slate-500">{project.plant.name || 'Planta não definida'}</span>
          </>
        ) : (
          <h2 className="text-sm font-semibold text-slate-800">GD Simulator</h2>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span>v1.0 MVP</span>
      </div>
    </header>
  );
}
