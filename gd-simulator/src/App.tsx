import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { TopBar } from './components/layout/TopBar';
import { Dashboard } from './pages/Dashboard';
import { NewProject } from './pages/NewProject';
import { ProjectEditor } from './pages/ProjectEditor';
import { Results } from './pages/Results';
import { ErrorBoundary } from './components/shared/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary fallbackTitle="Erro na aplicacao">
      <BrowserRouter basename="/GD-analyzer">
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
    </ErrorBoundary>
  );
}

export default App;
