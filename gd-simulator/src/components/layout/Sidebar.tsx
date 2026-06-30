import { useState, useEffect } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { AccountPanel } from '../AccountPanel';
import { cloudIsSuperAdmin } from '../../storage/cloudSync';

export function Sidebar() {
  const { projects, currentProjectId, setCurrentProject } = useProjectStore();
  const { cloudEnabled, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showAccount, setShowAccount] = useState(false);
  const [isSuper, setIsSuper] = useState(false);
  useEffect(() => { if (cloudEnabled) cloudIsSuperAdmin().then(setIsSuper).catch(() => {}); }, [cloudEnabled, user?.id]);

  // Compact quick-switch: 5 most recently updated projects (full list lives on the Dashboard).
  const recents = [...projects]
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .slice(0, 5);

  return (
    <aside className="w-64 bg-navy-900 text-white min-h-screen flex flex-col" style={{ backgroundColor: '#004B70' }}>
      <div className="p-4 border-b border-white/10">
        <img src={`${import.meta.env.BASE_URL}Helexia_logo_WHT_web.svg`} alt="Helexia" className="h-12 mb-2" />
        <h1 className="text-lg font-bold tracking-tight">GD Analyzer</h1>
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
        {isSuper && (
          <button
            onClick={() => navigate('/admin')}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              location.pathname === '/admin' ? 'bg-white/20' : 'hover:bg-white/10'
            }`}
          >
            🛡️ Admin
          </button>
        )}

        <button
          onClick={() => navigate('/ajuda')}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
            location.pathname === '/ajuda' ? 'bg-white/20' : 'hover:bg-white/10'
          }`}
        >
          ❔ Como funciona
        </button>

        {recents.length > 0 && (
          <>
            <div className="pt-3 pb-1">
              <p className="text-xs text-white/40 uppercase tracking-wider px-3">Recentes</p>
            </div>
            {recents.map(p => (
              <div
                key={p.id}
                className={`px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors truncate ${
                  currentProjectId === p.id ? 'bg-white/20' : 'hover:bg-white/10'
                }`}
                onClick={() => {
                  setCurrentProject(p.id);
                  navigate(`/project/${p.id}`);
                }}
                title={p.clientName || 'Sem nome'}
              >
                {p.clientName || 'Sem nome'}
              </div>
            ))}
            <button
              onClick={() => navigate('/')}
              className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-white/50 hover:bg-white/10 transition-colors"
            >
              Ver todos →
            </button>
          </>
        )}
      </nav>

      {cloudEnabled && user && (
        <div className="p-3 border-t border-white/10">
          <button
            onClick={() => setShowAccount(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-left"
            title="Minha conta"
          >
            <span className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-semibold shrink-0">
              {(user.email ?? '?').slice(0, 2).toUpperCase()}
            </span>
            <span className="truncate flex-1">{user.email}</span>
            <span className="text-white/50">⚙️</span>
          </button>
        </div>
      )}
      {showAccount && <AccountPanel onClose={() => setShowAccount(false)} />}
    </aside>
  );
}
