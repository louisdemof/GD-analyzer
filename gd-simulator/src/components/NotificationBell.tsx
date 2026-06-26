import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { cloudIncomingShares, type IncomingShare } from '../storage/cloudSync';

// Bell that shows projects others shared with you. "New" = shared since the last
// time you opened the panel (tracked per-user in localStorage).
export function NotificationBell() {
  const { cloudEnabled, user } = useAuth();
  const navigate = useNavigate();
  const [shares, setShares] = useState<IncomingShare[]>([]);
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState<string>('');
  const ref = useRef<HTMLDivElement>(null);

  const seenKey = user ? `gd_notif_seen_${user.id}` : '';

  useEffect(() => {
    if (!cloudEnabled || !user) return;
    setSeenAt(localStorage.getItem(seenKey) || '');
    let alive = true;
    const load = async () => { const s = await cloudIncomingShares(); if (alive) setShares(s); };
    load();
    const t = setInterval(load, 60_000); // refresh every minute
    return () => { alive = false; clearInterval(t); };
  }, [cloudEnabled, user, seenKey]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!cloudEnabled || !user) return null;

  const newCount = shares.filter(s => s.createdAt > seenAt).length;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) { // opening → mark all as seen
      const now = new Date().toISOString();
      localStorage.setItem(seenKey, now);
      setSeenAt(now);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative p-1.5 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100" title="Notificações">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
        {newCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">{newCount}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-semibold text-slate-600">Compartilhados com você</div>
          <div className="max-h-80 overflow-auto">
            {shares.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400 text-center">Nenhum projeto compartilhado com você ainda.</p>
            ) : (
              shares.map(s => {
                const isNew = s.createdAt > seenAt;
                return (
                  <button key={s.projectId}
                    onClick={() => { setOpen(false); navigate(`/project/${s.projectId}`); }}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-50 last:border-0 flex gap-2">
                    {isNew && <span className="mt-1.5 w-2 h-2 rounded-full bg-teal-500 shrink-0" />}
                    <div className={isNew ? '' : 'pl-4'}>
                      <p className="text-sm font-medium text-slate-800 truncate">{s.projectName}</p>
                      <p className="text-xs text-slate-500">por {s.sharedBy} · {new Date(s.createdAt).toLocaleDateString('pt-BR')}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
