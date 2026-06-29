import { useEffect, useState } from 'react';
import {
  cloudListShares, cloudShareProject, cloudUnshareProject, cloudSetShareRole, cloudSearchUsers,
  cloudProjectOwnerEmail, cloudMyRole, type UserSuggestion, type ProjectShare, type ShareRole, type MyRole,
} from '../storage/cloudSync';
import { Button } from './ui/Button';

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function ShareDialog({ projectId, projectName, onClose }: Props) {
  const [shares, setShares] = useState<ProjectShare[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<MyRole>(null);
  const canManage = myRole === 'owner' || myRole === 'admin';
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('editor');
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
      if (alive) setSuggestions(res.filter(s => !shares.some(x => x.email === s.email.toLowerCase())));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [email, shares]);

  async function reload() {
    const [s, o, r] = await Promise.all([cloudListShares(projectId), cloudProjectOwnerEmail(projectId), cloudMyRole(projectId)]);
    setShares(s); setOwner(o); setMyRole(r); setLoading(false);
  }
  const friendly = (e: string) => /row-level security|violates/i.test(e)
    ? 'Sem permissão — apenas o proprietário ou um admin pode alterar acessos.' : e;
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [projectId]);

  async function shareEmail(addr: string, r: ShareRole) {
    const v = addr.trim().toLowerCase();
    if (!v) return;
    setBusy(true); setError(null);
    const { error } = await cloudShareProject(projectId, v, r);
    if (error) setError(friendly(error));
    else { setEmail(''); setSuggestions([]); setShowSug(false); await reload(); }
    setBusy(false);
  }
  async function add(e: React.FormEvent) { e.preventDefault(); await shareEmail(email, role); }

  async function changeRole(addr: string, r: ShareRole) {
    setBusy(true); setError(null);
    const { error } = await cloudSetShareRole(projectId, addr, r);
    if (error) setError(friendly(error)); else await reload();
    setBusy(false);
  }

  async function remove(addr: string) {
    setBusy(true); setError(null);
    const { error } = await cloudUnshareProject(projectId, addr);
    if (error) setError(friendly(error)); else await reload();
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

        {!loading && !canManage && (
          <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
            Você não é proprietário/admin deste projeto — pode ver quem tem acesso, mas só o proprietário ou um admin altera permissões.
          </div>
        )}

        <form onSubmit={add} className="flex gap-2 mb-3" hidden={!loading && !canManage}>
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
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => shareEmail(s.email, role)}
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
          <select value={role} onChange={e => setRole(e.target.value as ShareRole)}
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm bg-white text-slate-600" title="Permissão">
            <option value="editor">Editor</option>
            <option value="viewer">Leitor</option>
            <option value="admin">Admin</option>
          </select>
          <Button type="submit" variant="navy" disabled={busy}>Adicionar</Button>
        </form>

        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

        <div className="space-y-1">
          {owner && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-blue-50 text-sm">
              <span className="text-blue-800 truncate">👑 {owner}</span>
              <span className="text-[11px] text-blue-600 ml-2 shrink-0">Proprietário</span>
            </div>
          )}
          {loading ? (
            <p className="text-sm text-slate-400">Carregando…</p>
          ) : shares.length === 0 ? (
            <p className="text-sm text-slate-400">Ainda não compartilhado com mais ninguém.</p>
          ) : (
            shares.map(s => (
              <div key={s.email} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 text-sm">
                <span className="text-slate-700 truncate flex-1">{s.email}</span>
                <select value={s.role} onChange={e => changeRole(s.email, e.target.value as ShareRole)} disabled={busy || !canManage}
                  className="text-xs bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-600 disabled:opacity-60" title="Permissão">
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Leitor</option>
                </select>
                {canManage && (
                  <button onClick={() => remove(s.email)} disabled={busy}
                    className="text-slate-400 hover:text-red-600 text-xs shrink-0">Remover</button>
                )}
              </div>
            ))
          )}
        </div>

        <div className="text-[11px] text-slate-400 mt-4 space-y-1">
          <p>A pessoa precisa ter (ou criar) uma conta com este e-mail para ver o projeto.</p>
          <p>
            <strong>Admin</strong> = co-proprietário (edita + gerencia acessos) · <strong>Editor</strong> = pode modificar ·
            {' '}<strong>Leitor</strong> = somente leitura. Excluir o projeto: só proprietário/admins.
          </p>
        </div>
      </div>
    </div>
  );
}
