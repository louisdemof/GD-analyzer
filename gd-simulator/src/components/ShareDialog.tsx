import { useEffect, useState } from 'react';
import { cloudListShares, cloudShareProject, cloudUnshareProject, cloudSearchUsers, type UserSuggestion } from '../storage/cloudSync';
import { Button } from './ui/Button';

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
  const [suggestions, setSuggestions] = useState<UserSuggestion[]>([]);
  const [showSug, setShowSug] = useState(false);

  // Debounced user search for the autocomplete
  useEffect(() => {
    const q = email.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const res = await cloudSearchUsers(q);
      if (alive) setSuggestions(res.filter(s => !shares.includes(s.email.toLowerCase())));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [email, shares]);

  async function reload() {
    setShares(await cloudListShares(projectId));
    setLoading(false);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [projectId]);

  async function shareEmail(addr: string) {
    const v = addr.trim().toLowerCase();
    if (!v) return;
    setBusy(true); setError(null);
    const { error } = await cloudShareProject(projectId, v);
    if (error) setError(error);
    else { setEmail(''); setSuggestions([]); setShowSug(false); await reload(); }
    setBusy(false);
  }
  async function add(e: React.FormEvent) { e.preventDefault(); await shareEmail(email); }

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
          <div className="relative flex-1">
            <input
              type="text" required placeholder="Nome ou email (ex.: lucas)" value={email}
              onChange={e => { setEmail(e.target.value); setShowSug(true); }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 150)}
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            {showSug && suggestions.length > 0 && (
              <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-auto">
                {suggestions.map(s => (
                  <li key={s.email}>
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => shareEmail(s.email)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                      {s.full_name
                        ? <><span className="text-slate-700">{s.full_name}</span> <span className="text-slate-400 text-xs">{s.email}</span></>
                        : <span className="text-slate-700">{s.email}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button type="submit" variant="navy" disabled={busy}>Adicionar</Button>
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
