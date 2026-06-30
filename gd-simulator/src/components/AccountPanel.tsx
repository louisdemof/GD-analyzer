import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Button } from './ui/Button';
import { PasswordInput } from './ui/PasswordInput';

// Personal account panel: who you are, change password, sign out.
export function AccountPanel({ onClose }: { onClose: () => void }) {
  const { user, updatePassword, updateName, signOut } = useAuth();
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const initialName = (meta.full_name as string) || (meta.name as string) || '';

  const [name, setName] = useState(initialName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const initials = (name || user?.email || '?').slice(0, 2).toUpperCase();

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setNameMsg(null);
    if (!name.trim()) return;
    setNameBusy(true);
    const { error } = await updateName(name);
    setNameBusy(false);
    setNameMsg(error ? error : 'Nome atualizado.');
  }

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (pw.length < 8) { setErr('A senha deve ter ao menos 8 caracteres.'); return; }
    if (pw !== pw2) { setErr('As senhas não coincidem.'); return; }
    setBusy(true);
    const { error } = await updatePassword(pw);
    setBusy(false);
    if (error) setErr(error);
    else { setMsg('Senha atualizada com sucesso.'); setPw(''); setPw2(''); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-800">Minha conta</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-full bg-brand-navy text-white flex items-center justify-center text-sm font-semibold">{initials}</div>
          <div className="min-w-0">
            {name && <p className="font-medium text-slate-800 truncate">{name}</p>}
            <p className="text-sm text-slate-500 truncate">{user?.email}</p>
          </div>
        </div>

        <form onSubmit={saveName} className="space-y-2 border-t border-slate-100 pt-4">
          <label className="text-xs font-medium text-slate-600">Nome de exibição</label>
          <div className="flex gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <Button type="submit" variant="secondary" disabled={nameBusy || name.trim() === initialName.trim()}>{nameBusy ? '…' : 'Salvar'}</Button>
          </div>
          {nameMsg && <p className="text-xs text-emerald-700">{nameMsg}</p>}
          <p className="text-[11px] text-slate-400">É assim que seu nome aparece para colegas (compartilhamentos, histórico).</p>
        </form>

        <form onSubmit={changePw} className="space-y-2 border-t border-slate-100 pt-4 mt-4">
          <p className="text-xs font-medium text-slate-600">Alterar senha</p>
          <PasswordInput value={pw} onChange={setPw} placeholder="Nova senha"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <PasswordInput value={pw2} onChange={setPw2} placeholder="Confirmar nova senha"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          {err && <p className="text-xs text-red-600">{err}</p>}
          {msg && <p className="text-xs text-emerald-700">{msg}</p>}
          <Button type="submit" variant="navy" disabled={busy} className="w-full">{busy ? 'Salvando…' : 'Atualizar senha'}</Button>
        </form>

        <div className="border-t border-slate-100 mt-4 pt-4">
          <button onClick={() => signOut()} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            Sair da conta
          </button>
        </div>
      </div>
    </div>
  );
}
