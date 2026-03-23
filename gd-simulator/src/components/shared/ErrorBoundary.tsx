import React from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 max-w-lg mx-auto mt-12">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <div className="text-3xl mb-3">!</div>
            <h2 className="text-lg font-bold text-red-800 mb-2">
              {this.props.fallbackTitle || 'Algo deu errado'}
            </h2>
            <p className="text-sm text-red-600 mb-4 font-mono break-all">
              {this.state.error?.message || 'Erro desconhecido'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg"
                style={{ backgroundColor: '#004B70' }}
              >
                Tentar novamente
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Recarregar pagina
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
