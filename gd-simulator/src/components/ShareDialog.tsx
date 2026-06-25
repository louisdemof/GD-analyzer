import { useEffect, useState } from 'react';
import { cloudListShares, cloudShareProject, cloudUnshareProject } from '../storage/cloudSync';

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function ShareDialog({ projectId, projectName, onClose }: Props) {
  const [shares, setShares] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setShares(await cloudListShares(projectId));
    setLoading(false);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [projectId]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!v) return;
    setBusy(true); setError(null);
    const { error } = await cloudShareProject(projectId, v);
    if (error) setError(error);
    else { setEmail(''); await reload(); }
    setBusy(false);
  }

  async function remove(addr: string) {
    setBusy(true); setError(null);
    const { error } = await cloudUnshareProject(projectId, addr);
    if (error) setError(error);
    else await reload();
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-base font-semibold text-slate-800">Compartilhar projeto</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-slate-500 mb-4 truncate">{projectName}</p>

        <form onSubmit={add} className="flex gap-2 mb-4">
          <input
            type="email" required placeholder="email@helexia.eu" value={email}
            onChange={e => setEmail(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <button type="submit" disabled={busy}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: '#004B70' }}>Adicionar</button>
        </form>

        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

        <div className="space-y-1">
          {loading ? (
            <p className="text-sm text-slate-400">Carregando…</p>
          ) : shares.length === 0 ? (
            <p className="text-sm text-slate-400">Ainda não compartilhado. Apenas você tem acesso.</p>
          ) : (
            shares.map(addr => (
              <div key={addr} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 text-sm">
                <span className="text-slate-700 truncate">{addr}</span>
                <button onClick={() => remove(addr)} disabled={busy}
                  className="text-slate-400 hover:text-red-600 text-xs ml-2">Remover</button>
              </div>
            ))
          )}
        </div>

        <p className="text-[11px] text-slate-400 mt-4">
          A pessoa precisa ter (ou criar) uma conta com este e-mail para ver o projeto. Quem recebe pode visualizar e editar, mas não excluir.
        </p>
      </div>
    </div>
  );
}
