import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useProjectStore } from './store/projectStore';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Dashboard } from './pages/Dashboard';
import { NewProject } from './pages/NewProject';
import { ProjectEditor } from './pages/ProjectEditor';
import { Results } from './pages/Results';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginScreen } from './auth/LoginScreen';

// Gate the app behind login only when cloud is configured. Without Supabase env
// vars the app runs exactly as before (local-only), so nothing breaks offline.
function Gate({ children }: { children: React.ReactNode }) {
  const { cloudEnabled, loading, session, recovery } = useAuth();
  const syncFromCloud = useProjectStore(s => s.syncFromCloud);
  // On login, pull the user's cloud projects and merge with local (skip during recovery).
  useEffect(() => { if (session && !recovery) syncFromCloud(); }, [session, recovery, syncFromCloud]);
  if (!cloudEnabled) return <>{children}</>;
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Carregando…</div>;
  if (recovery) return <LoginScreen />;   // arrived via reset link → set a new password
  if (!session) return <LoginScreen />;
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary fallbackTitle="Erro na aplicação">
      <AuthProvider>
       <Gate>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
        <div className="flex min-h-screen bg-slate-50">
          <Sidebar />
          <div className="flex-1 flex flex-col">
            <TopBar />
            <main className="flex-1 overflow-auto">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/new" element={<NewProject />} />
                <Route path="/project/:id" element={
                  <ErrorBoundary fallbackTitle="Erro no editor de projeto">
                    <ProjectEditor />
                  </ErrorBoundary>
                } />
                <Route path="/results/:id" element={
                  <ErrorBoundary fallbackTitle="Erro nos resultados">
                    <Results />
                  </ErrorBoundary>
                } />
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>
       </Gate>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
