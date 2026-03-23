import { useProjectStore } from '../store/projectStore';
import { useNavigate } from 'react-router-dom';

export function Dashboard() {
  const { projects, setCurrentProject, loadDemoProject } = useProjectStore();
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">GD Simulator</h1>
          <p className="text-sm text-slate-500 mt-1">Simulador de Geração Distribuída — Helexia Brasil</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              loadDemoProject();
              navigate('/project/copasul-cs3-demo');
            }}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Carregar Demo
          </button>
          <button
            onClick={() => navigate('/new')}
            className="px-4 py-2 text-sm text-white rounded-lg font-medium"
            style={{ backgroundColor: '#2F927B' }}
          >
            + Novo Projeto
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-xl">
          <p className="text-slate-500 text-sm">Nenhum projeto criado ainda.</p>
          <p className="text-slate-400 text-xs mt-2">
            Crie um novo projeto ou carregue os dados demo (Copasul CS3).
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => {
                setCurrentProject(p.id);
                navigate(`/project/${p.id}`);
              }}
              className="p-4 border border-slate-200 rounded-xl cursor-pointer hover:border-teal-300 hover:shadow-sm transition-all"
            >
              <h3 className="font-semibold text-slate-800">{p.clientName || 'Sem nome'}</h3>
              <p className="text-xs text-slate-500 mt-1">{p.plant.name || 'Planta não definida'}</p>
              <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
                <span>{p.ucs.length} UCs</span>
                <span>{p.distributor.name}</span>
              </div>
              <p className="text-xs text-slate-300 mt-2">
                Atualizado: {new Date(p.updatedAt).toLocaleDateString('pt-BR')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
