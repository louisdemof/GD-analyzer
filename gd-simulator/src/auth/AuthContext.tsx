import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isCloudEnabled } from '../lib/supabase';
import { cloudLogLogin } from '../storage/cloudSync';

interface AuthState {
  cloudEnabled: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  recovery: boolean; // arrived via a password-reset link → must set a new password
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  updateName: (fullName: string) => Promise<{ error: string | null }>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [recovery, setRecovery] = useState(false);
  // When cloud is off, there's nothing to load — the app runs local-only.
  const [loading, setLoading] = useState(isCloudEnabled);

  useEffect(() => {
    if (!supabase) return;
    // Invited users land with ?invite=1 (and a session from the invite token) → send them
    // to the set-password screen, same as a password recovery.
    const invited = typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).get('invite') === '1' || /[?&]invite=1\b/.test(window.location.hash));
    if (invited) setRecovery(true);
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn: AuthState['signIn'] = async (email, password) => {
    if (!supabase) return { error: 'Cloud não configurado' };
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) cloudLogLogin().catch(() => {});
    return { error: error?.message ?? null };
  };

  const signUp: AuthState['signUp'] = async (email, password, fullName) => {
    if (!supabase) return { error: 'Cloud não configurado', needsConfirmation: false };
    const name = fullName?.trim();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: name ? { data: { full_name: name } } : undefined,
    });
    // With "Confirm email" ON, signUp returns a user with no session until confirmed.
    const needsConfirmation = !error && !data.session;
    return { error: error?.message ?? null, needsConfirmation };
  };

  const signOut = async () => { await supabase?.auth.signOut(); };

  const resetPassword: AuthState['resetPassword'] = async (email) => {
    if (!supabase) return { error: 'Cloud não configurado' };
    const redirectTo = window.location.origin + import.meta.env.BASE_URL;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    return { error: error?.message ?? null };
  };

  const updatePassword: AuthState['updatePassword'] = async (password) => {
    if (!supabase) return { error: 'Cloud não configurado' };
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) setRecovery(false);
    return { error: error?.message ?? null };
  };

  // Update display name in auth metadata + mirror to profiles so others see the name.
  const updateName: AuthState['updateName'] = async (fullName) => {
    if (!supabase) return { error: 'Cloud não configurado' };
    const name = fullName.trim();
    const { data, error } = await supabase.auth.updateUser({ data: { full_name: name } });
    if (error) return { error: error.message };
    const u = data.user;
    if (u) await supabase.from('profiles').upsert({ id: u.id, email: u.email, full_name: name }, { onConflict: 'id' }).then(() => {}, () => {});
    return { error: null };
  };

  return (
    <AuthCtx.Provider value={{
      cloudEnabled: isCloudEnabled, loading, session, user: session?.user ?? null, recovery,
      signIn, signUp, signOut, resetPassword, updatePassword, updateName,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
