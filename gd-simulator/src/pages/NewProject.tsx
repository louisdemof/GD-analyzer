import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { DISTRIBUTORS } from '../data/distributors';

export function NewProject() {
  const [clientName, setClientName] = useState('');
  const [distributorId, setDistributorId] = useState(DISTRIBUTORS[0].id);
  const { createProject } = useProjectStore();
  const navigate = useNavigate();

  const handleCreate = () => {
    if (!clientName.trim()) return;
    const project = createProject(clientName.trim(), distributorId);
    navigate(`/project/${project.id}`);
  };

  return (
    <div className="p-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-slate-800 mb-6">Novo Projeto</h1>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nome do Cliente</label>
          <input
            value={clientName}
            onChange={e => setClientName(e.target.value)}
            placeholder="Ex: Copasul"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Distribuidora</label>
          <select
            value={distributorId}
            onChange={e => setDistributorId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          >
            {DISTRIBUTORS.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.state})
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={!clientName.trim()}
            className="px-6 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-50"
            style={{ backgroundColor: '#2F927B' }}
          >
            Criar Projeto
          </button>
        </div>
      </div>
    </div>
  );
}
