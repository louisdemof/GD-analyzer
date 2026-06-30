import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../store/projectStore';
import { useAuth } from '../auth/AuthContext';
import {
  cloudIsSuperAdmin, cloudRecentActivity, cloudAdminUserStats, LOGIN_PROJECT_ID,
  cloudAdminCreateUser, cloudAdminUpdateUser, cloudAdminInviteUser,
  type ActivityEntry, type AdminUserStat, type AuditAction,
} from '../storage/cloudSync';
import { STATUS_META, STATUS_ORDER, statusOf } from '../lib/projectStatus';
import { PasswordInput } from '../components/ui/PasswordInput';

const ACTION: Record<AuditAction, string> = {
  create: 'criou', trash: 'moveu p/ lixeira', restore: 'restaurou',
  delete: 'excluiu definitivamente', share: 'compartilhou', role_change: 'alterou permissão',
  unshare: 'removeu acesso', login: 'entrou no sistema',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000), h = Math.floor(diff / 3600000), m = Math.floor(diff / 60000);
  if (d > 0) return `há ${d}d`;
  if (h > 0) return `há ${h}h`;
  if (m > 0) return `há ${m}min`;
  return 'agora';
}

function Tile({ label, value, sub, icon, accent = '#004B70' }: { label: string; value: string | number; sub?: string; icon?: string; accent?: string }) {
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white p-4 overflow-hidden shadow-sm">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: accent }} />
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{label}</p>
        {icon && <span className="text-base opacity-70">{icon}</span>}
      </div>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function avatarInitials(name: string | null, email: string): string {
  const base = (name || email.split('@')[0]).trim();
  const parts = base.split(/[\s.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || email.slice(0, 2).toUpperCase();
}

export function AdminPanel() {
  const navigate = useNavigate();
  const { cloudEnabled } = useAuth();
  const { projects } = useProjectStore();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [users, setUsers] = useState<AdminUserStat[]>([]);
  // User management
  const [nu, setNu] = useState({ email: '', full_name: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVals, setEditVals] = useState({ full_name: '', password: '' });

  const reloadUsers = () => cloudAdminUserStats().then(setUsers).catch(() => {});

  useEffect(() => {
    if (!cloudEnabled) { setAllowed(false); return; }
    cloudIsSuperAdmin().then(ok => {
      setAllowed(ok);
      if (ok) {
        cloudRecentActivity(150).then(setActivity).catch(() => {});
        reloadUsers();
      }
    }).catch(() => setAllowed(false));
  }, [cloudEnabled]);

  const flash = (ok: boolean, text: string) => { setMsg({ ok, text }); setTimeout(() => setMsg(null), 5000); };

  const handleCreate = async () => {
    setBusy(true);
    const r = await cloudAdminCreateUser(nu.email, nu.password, nu.full_name);
    setBusy(false);
    if (r.ok) { flash(true, `Usuário ${nu.email} criado.`); setNu({ email: '', full_name: '', password: '' }); reloadUsers(); }
    else flash(false, r.error || 'Falha ao criar usuário.');
  };

  const handleInvite = async () => {
    setBusy(true);
    const redirectTo = new URL('?invite=1', window.location.origin + import.meta.env.BASE_URL).href;
    const r = await cloudAdminInviteUser(nu.email, nu.full_name, redirectTo);
    setBusy(false);
    if (r.ok) { flash(true, `Convite enviado para ${nu.email}.`); setNu({ email: '', full_name: '', password: '' }); reloadUsers(); }
    else flash(false, r.error || 'Falha ao enviar convite.');
  };

  const handleSaveEdit = async (id: string) => {
    setBusy(true);
    const patch: { fullName?: string; password?: string } = { fullName: editVals.full_name };
    if (editVals.password) patch.password = editVals.password;
    const r = await cloudAdminUpdateUser(id, patch);
    setBusy(false);
    if (r.ok) { flash(true, 'Usuário atualizado.'); setEditId(null); reloadUsers(); }
    else flash(false, r.error || 'Falha ao atualizar.');
  };

  const nameByEmail = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) if (u.full_name) m.set(u.email.toLowerCase(), u.full_name);
    return m;
  }, [users]);
  const projNameById = useMemo(() => new Map(projects.map(p => [p.id, p.clientName || 'Sem nome'])), [projects]);
  const who = (email: string) => nameByEmail.get(email.toLowerCase()) || email;

  const active = projects.filter(p => !p.deletedAt);
  const trashed = projects.filter(p => !!p.deletedAt);

  if (allowed === null) return <div className="p-6 text-slate-400 text-sm">Carregando…</div>;
  if (!allowed) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center">
        <div className="text-4xl mb-3">🔒</div>
        <h1 className="text-lg font-semibold text-slate-700">Acesso restrito</h1>
        <p className="text-sm text-slate-500 mt-1 mb-4">Este painel é só para super-admins.</p>
        <button onClick={() => navigate('/')} className="text-sm text-teal-600 hover:underline">← Voltar ao Dashboard</button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-slate-800">🛡️ Painel de Administração</h1>
        <button onClick={() => navigate('/')} className="text-sm text-teal-600 hover:underline">← Dashboard</button>
      </div>
      <p className="text-sm text-slate-500 mb-6">Uso e atividade — todos os projetos e usuários.</p>

      {/* Usage tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Tile label="Usuários" value={users.length} icon="👥" accent="#004B70" />
        <Tile label="Projetos ativos" value={active.length} icon="📁" accent="#2F927B" />
        <Tile label="Na lixeira" value={trashed.length} icon="🗑️" accent="#b45309" />
        <Tile label="Eventos registrados" value={activity.length} sub="últimos 150" icon="📋" accent="#64748b" />
      </div>

      {/* Pipeline by status */}
      <div className="flex flex-wrap gap-2 mb-8">
        {STATUS_ORDER.map(st => {
          const n = active.filter(p => statusOf(p.status) === st).length;
          return (
            <span key={st} className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_META[st].chip}`}>
              {STATUS_META[st].label}: {n}
            </span>
          );
        })}
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Activity feed */}
        <div className="md:col-span-2">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Atividade recente</h2>
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[60vh] overflow-auto">
            {activity.length === 0 ? (
              <p className="text-sm text-slate-400 p-4">Nenhuma atividade ainda.</p>
            ) : activity.map(e => (
              <div key={e.id} className="flex gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-slate-700">
                    <strong className="font-medium">{who(e.actorEmail)}</strong> {ACTION[e.action] ?? e.action}
                    {e.projectId !== LOGIN_PROJECT_ID && (
                      <>{' '}<span className="text-slate-500">{projNameById.get(e.projectId) || '(projeto removido)'}</span></>
                    )}
                    {e.detail ? <span className="text-slate-400"> · {e.detail}</span> : null}
                  </p>
                </div>
                <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                  {new Date(e.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Users */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Usuários ({users.length})</h2>

          {/* Create user */}
          <div className="border border-slate-200 rounded-xl p-3 mb-3 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600 mb-2">Criar usuário</p>
            <div className="grid grid-cols-1 gap-2">
              <input value={nu.full_name} onChange={e => setNu(v => ({ ...v, full_name: e.target.value }))} placeholder="Nome completo" className="px-2 py-1.5 border border-slate-300 rounded text-sm" />
              <input value={nu.email} onChange={e => setNu(v => ({ ...v, email: e.target.value }))} placeholder="email@helexia.eu" className="px-2 py-1.5 border border-slate-300 rounded text-sm" />
              <PasswordInput value={nu.password} onChange={v => setNu(s => ({ ...s, password: v }))} placeholder="Senha (só p/ criar direto — vazio ao convidar)" className="px-2 py-1.5 border border-slate-300 rounded text-sm font-mono" />
              <div className="flex gap-2">
                <button onClick={handleCreate} disabled={busy || !nu.email || !nu.password} className="flex-1 px-3 py-1.5 text-sm text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: '#2F927B' }}>
                  {busy ? '…' : 'Criar com senha'}
                </button>
                <button onClick={handleInvite} disabled={busy || !nu.email} className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-teal-600 text-teal-700 disabled:opacity-50">
                  {busy ? '…' : '✉ Convidar por e-mail'}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">Criar com senha: conta pronta na hora (você passa a senha). Convidar: o usuário recebe um e-mail para definir a própria senha (requer SMTP configurado no Supabase).</p>
            </div>
          </div>
          {msg && <p className={`text-xs mb-2 ${msg.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{msg.text}</p>}

          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[55vh] overflow-auto">
            {users.map(u => (
              <div key={u.id} className="px-3 py-2 text-sm">
                {editId === u.id ? (
                  <div className="space-y-2">
                    <input value={editVals.full_name} onChange={e => setEditVals(v => ({ ...v, full_name: e.target.value }))} placeholder="Nome" className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                    <PasswordInput value={editVals.password} onChange={v => setEditVals(s => ({ ...s, password: v }))} placeholder="Nova senha (deixe vazio p/ manter)" className="px-2 py-1 border border-slate-300 rounded text-sm font-mono" />
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveEdit(u.id)} disabled={busy} className="px-2 py-1 text-xs text-white rounded disabled:opacity-50" style={{ backgroundColor: '#2F927B' }}>Salvar</button>
                      <button onClick={() => setEditId(null)} className="px-2 py-1 text-xs border border-slate-300 rounded">Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5">
                    <span className="w-8 h-8 rounded-full bg-brand-navy text-white flex items-center justify-center text-[11px] font-semibold shrink-0" style={{ backgroundColor: '#004B70' }}>
                      {avatarInitials(u.full_name, u.email)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-slate-700 truncate">{u.full_name || <span className="text-slate-400 italic">sem nome</span>}</p>
                      <p className="text-[11px] text-slate-400 truncate">{u.email}</p>
                      <p className="text-[11px] text-slate-400">
                        Último acesso: <span className="text-slate-500">{timeAgo(u.lastSignInAt)}</span> · {u.projectCount} projeto{u.projectCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <button onClick={() => { setEditId(u.id); setEditVals({ full_name: u.full_name || '', password: '' }); }} className="text-xs text-teal-600 hover:underline shrink-0">editar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
