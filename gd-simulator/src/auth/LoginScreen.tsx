import { useState } from 'react';
import { useAuth } from './AuthContext';
import { Button } from '../components/ui/Button';

type Mode = 'signin' | 'signup' | 'reset';

export function LoginScreen() {
  const { signIn, signUp, resetPassword, updatePassword, recovery } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    if (recovery) {
      if (password.length < 6) { setError('A senha deve ter ao menos 6 caracteres'); setBusy(false); return; }
      const { error } = await updatePassword(password);
      if (error) setError(error); else setNotice('Senha alterada! Você já está conectado.');
    } else if (mode === 'signin') {
      const { error } = await signIn(email, password);
      if (error) setError(error);
    } else if (mode === 'signup') {
      const { error, needsConfirmation } = await signUp(email, password);
      if (error) setError(error);
      else if (needsConfirmation) setNotice('Conta criada! Verifique seu e-mail para confirmar antes de entrar.');
    } else if (mode === 'reset') {
      const { error } = await resetPassword(email);
      if (error) setError(error);
      else setNotice('Se este e-mail existir, enviamos um link para redefinir a senha.');
    }
    setBusy(false);
  }

  const title = recovery ? 'Definir nova senha'
    : mode === 'signin' ? 'Entre na sua conta'
    : mode === 'signup' ? 'Crie sua conta'
    : 'Redefinir senha';
  const cta = recovery ? 'Salvar nova senha'
    : mode === 'signin' ? 'Entrar'
    : mode === 'signup' ? 'Criar conta'
    : 'Enviar link de redefinição';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={`${import.meta.env.BASE_URL}Helexia_logo_WHT_M.png`} alt="Helexia"
               className="h-10 mx-auto mb-4 invert opacity-80" />
          <h1 className="text-xl font-bold text-slate-800">GD Analyzer</h1>
          <p className="text-sm text-slate-500 mt-1">{title}</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          {!recovery && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">E-mail</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          )}
          {(recovery || mode !== 'reset') && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{recovery ? 'Nova senha' : 'Senha'}</label>
              <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
              {!recovery && mode === 'signin' && (
                <button type="button" onClick={() => { setMode('reset'); setError(null); setNotice(null); }}
                  className="mt-1 text-xs text-teal-600 hover:text-teal-800">Esqueceu a senha?</button>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {notice && <p className="text-sm text-emerald-700">{notice}</p>}

          <Button type="submit" variant="navy" disabled={busy} className="w-full">
            {busy ? 'Aguarde…' : cta}
          </Button>

          {!recovery && (
            <p className="text-center text-xs text-slate-500">
              {mode === 'reset' ? (
                <button type="button" className="text-teal-600 font-medium"
                  onClick={() => { setMode('signin'); setError(null); setNotice(null); }}>← Voltar para o login</button>
              ) : (
                <>
                  {mode === 'signin' ? 'Não tem conta? ' : 'Já tem conta? '}
                  <button type="button" className="text-teal-600 font-medium"
                    onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setNotice(null); }}>
                    {mode === 'signin' ? 'Criar conta' : 'Entrar'}
                  </button>
                </>
              )}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
