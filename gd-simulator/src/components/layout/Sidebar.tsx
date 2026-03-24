import { useProjectStore } from '../../store/projectStore';
import { useNavigate, useLocation } from 'react-router-dom';

export function Sidebar() {
  const { projects, currentProjectId, setCurrentProject, deleteProject, loadDemoProject } = useProjectStore();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside className="w-64 bg-navy-900 text-white min-h-screen flex flex-col" style={{ backgroundColor: '#004B70' }}>
      <div className="p-4 border-b border-white/10">
        <img src="/GD-analyzer/Helexia_logo_WHT_web.svg" alt="Helexia" className="h-8 mb-2" />
        <h1 className="text-lg font-bold tracking-tight">GD Simulator</h1>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        <button
          onClick={() => navigate('/')}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            location.pathname === '/' ? 'bg-white/20' : 'hover:bg-white/10'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => navigate('/new')}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            location.pathname === '/new' ? 'bg-white/20' : 'hover:bg-white/10'
          }`}
        >
          + Novo Projeto
        </button>

        <div className="pt-3 pb-1">
          <p className="text-xs text-white/40 uppercase tracking-wider px-3">Projetos</p>
        </div>

        {projects.map(p => (
          <div
            key={p.id}
            className={`group flex items-center justify-between px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
              currentProjectId === p.id ? 'bg-white/20' : 'hover:bg-white/10'
            }`}
            onClick={() => {
              setCurrentProject(p.id);
              navigate(`/project/${p.id}`);
            }}
          >
            <span className="truncate">{p.clientName || 'Sem nome'}</span>
            <button
              onClick={e => {
                e.stopPropagation();
                if (confirm('Excluir projeto?')) deleteProject(p.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-white/50 hover:text-red-300 text-xs"
            >
              ✕
            </button>
          </div>
        ))}

        {projects.length === 0 && (
          <p className="text-xs text-white/30 px-3 py-2">Nenhum projeto criado</p>
        )}
      </nav>

      <div className="p-3 border-t border-white/10">
        <button
          onClick={() => {
            loadDemoProject();
            navigate('/project/copasul-cs3-demo');
          }}
          className="w-full px-3 py-2 text-xs rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          Carregar Demo (Copasul CS3)
        </button>
      </div>
    </aside>
  );
}
