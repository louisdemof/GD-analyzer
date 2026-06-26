// Cloud sync layer (Supabase). Local-first: IndexedDB stays the working store;
// these functions mirror writes to the cloud and pull the shared/owned set on login.
// Every function no-ops gracefully when cloud is unconfigured or no user is signed in,
// so the app keeps working purely locally.
import type { Project } from '../engine/types';
import { supabase } from '../lib/supabase';
import type { ClientFolder } from './projectDB';

async function authed(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession(); // in-memory, no network
  return Boolean(data.session);
}

// ─── Projects ─────────────────────────────────────────────
export async function cloudUpsertProject(project: Project): Promise<void> {
  if (!(await authed()) || !supabase) return;
  await supabase.from('projects').upsert({ id: project.id, data: project }, { onConflict: 'id' });
}

export async function cloudDeleteProject(id: string): Promise<void> {
  if (!(await authed()) || !supabase) return;
  await supabase.from('projects').delete().eq('id', id);
}

export async function cloudPullProjects(): Promise<Project[]> {
  if (!(await authed()) || !supabase) return [];
  const { data, error } = await supabase.from('projects').select('data');
  if (error || !data) return [];
  return data.map(r => r.data as Project);
}

// ─── Folders ──────────────────────────────────────────────
export async function cloudUpsertFolder(folder: ClientFolder): Promise<void> {
  if (!(await authed()) || !supabase) return;
  await supabase.from('folders').upsert({ id: folder.id, data: folder }, { onConflict: 'id' });
}

export async function cloudDeleteFolder(id: string): Promise<void> {
  if (!(await authed()) || !supabase) return;
  await supabase.from('folders').delete().eq('id', id);
}

export async function cloudPullFolders(): Promise<ClientFolder[]> {
  if (!(await authed()) || !supabase) return [];
  const { data, error } = await supabase.from('folders').select('data');
  if (error || !data) return [];
  return data.map(r => r.data as ClientFolder);
}

// ─── Per-project sharing ──────────────────────────────────
export interface ProjectShare { project_id: string; email: string }

export async function cloudShareProject(projectId: string, email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Cloud não configurado' };
  const { error } = await supabase.from('project_shares')
    .upsert({ project_id: projectId, email: email.trim().toLowerCase() }, { onConflict: 'project_id,email' });
  return { error: error?.message ?? null };
}

export async function cloudUnshareProject(projectId: string, email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Cloud não configurado' };
  const { error } = await supabase.from('project_shares')
    .delete().eq('project_id', projectId).eq('email', email.trim().toLowerCase());
  return { error: error?.message ?? null };
}

export async function cloudListShares(projectId: string): Promise<string[]> {
  if (!(await authed()) || !supabase) return [];
  const { data, error } = await supabase.from('project_shares').select('email').eq('project_id', projectId);
  if (error || !data) return [];
  return data.map(r => r.email as string);
}

// User search for the Share dialog autocomplete. Queries the public `profiles` table
// (mirror of auth.users via trigger). Matches email or name; safe-sanitised input.
// Returns [] gracefully if the profiles table isn't set up yet.
export interface UserSuggestion { email: string; full_name?: string }
export async function cloudSearchUsers(query: string): Promise<UserSuggestion[]> {
  if (!(await authed()) || !supabase) return [];
  const q = query.trim().replace(/[%,()*\\]/g, '');
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('email, full_name')
    .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
    .order('email')
    .limit(8);
  if (error || !data) return [];
  return data as UserSuggestion[];
}

// Which of my visible projects are owned by me vs shared-in? (for "shared with me" UI)
export async function cloudOwnedProjectIds(): Promise<Set<string>> {
  if (!(await authed()) || !supabase) return new Set();
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return new Set();
  const { data } = await supabase.from('projects').select('id').eq('created_by', uid);
  return new Set((data ?? []).map(r => r.id as string));
}
