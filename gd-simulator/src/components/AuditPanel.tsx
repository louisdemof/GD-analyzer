import { useEffect, useState } from 'react';
import { cloudListAudit, type AuditEntry, type AuditAction } from '../storage/cloudSync';

const ACTION: Record<AuditAction, { label: string; icon: string }> = {
  create:      { label: 'criou o projeto', icon: '✨' },
  trash:       { label: 'moveu para a lixeira', icon: '🗑️' },
  restore:     { label: 'restaurou da lixeira', icon: '♻️' },
  delete:      { label: 'excluiu definitivamente', icon: '❌' },
  share:       { label: 'compartilhou', icon: '🔗' },
  role_change: { label: 'alterou permissão', icon: '🛡️' },
  unshare:     { label: 'removeu acesso', icon: '🚫' },
};

export function AuditPanel({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => { cloudListAudit(projectId).then(setEntries).catch(() => setEntries([])); }, [projectId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-xl shadow-xl p-6 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-base font-semibold text-slate-800">Histórico</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <p className="text-xs text-slate-500 mb-4 truncate">{projectName}</p>

        <div className="overflow-auto -mx-1 px-1">
          {entries === null ? (
            <p className="text-sm text-slate-400">Carregando…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhum evento registrado ainda. Ações como compartilhar, alterar permissões e excluir aparecerão aqui.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map(e => {
                const a = ACTION[e.action] ?? { label: e.action, icon: '•' };
                const when = new Date(e.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                return (
                  <li key={e.id} className="flex gap-2.5 text-sm">
                    <span className="shrink-0">{a.icon}</span>
                    <div className="min-w-0">
                      <p className="text-slate-700">
                        <strong className="font-medium">{e.actorEmail}</strong> {a.label}
                        {e.detail ? <span className="text-slate-500"> · {e.detail}</span> : null}
                      </p>
                      <p className="text-[11px] text-slate-400">{when}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
