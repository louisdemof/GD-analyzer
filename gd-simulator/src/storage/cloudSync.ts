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

// ─── Per-project sharing (with roles) ──────────────────────
export type ShareRole = 'admin' | 'editor' | 'viewer';
export type MyRole = 'owner' | ShareRole | null;
export interface ProjectShare { email: string; role: ShareRole }

export async function cloudShareProject(projectId: string, email: string, role: ShareRole = 'editor'): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Cloud não configurado' };
  const { error } = await supabase.from('project_shares')
    .upsert({ project_id: projectId, email: email.trim().toLowerCase(), role }, { onConflict: 'project_id,email' });
  return { error: error?.message ?? null };
}

export async function cloudSetShareRole(projectId: string, email: string, role: ShareRole): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Cloud não configurado' };
  const { error } = await supabase.from('project_shares')
    .update({ role }).eq('project_id', projectId).eq('email', email.trim().toLowerCase());
  return { error: error?.message ?? null };
}

export async function cloudUnshareProject(projectId: string, email: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Cloud não configurado' };
  const { error } = await supabase.from('project_shares')
    .delete().eq('project_id', projectId).eq('email', email.trim().toLowerCase());
  return { error: error?.message ?? null };
}

export async function cloudListShares(projectId: string): Promise<ProjectShare[]> {
  if (!(await authed()) || !supabase) return [];
  const { data, error } = await supabase.from('project_shares').select('email, role').eq('project_id', projectId);
  if (error || !data) return [];
  return data.map(r => ({ email: r.email as string, role: (r.role as ShareRole) ?? 'editor' }));
}

// My effective role on a project ('owner' | 'admin' | 'editor' | 'viewer' | null).
export async function cloudMyRole(projectId: string): Promise<MyRole> {
  if (!(await authed()) || !supabase) return null;
  const { data, error } = await supabase.rpc('my_role_on', { pid: projectId });
  if (error) return null;
  return (data as MyRole) ?? null;
}

// ─── Audit trail ──────────────────────────────────────────
export type AuditAction = 'create' | 'trash' | 'restore' | 'delete' | 'share' | 'role_change' | 'unshare';
export interface AuditEntry { id: number; actorEmail: string; action: AuditAction; detail: string | null; createdAt: string }

export async function cloudLogEvent(projectId: string, action: AuditAction, detail?: string): Promise<void> {
  if (!(await authed()) || !supabase) return;
  const { data: u } = await supabase.auth.getUser();
  const email = u.user?.email;
  if (!email) return;
  await supabase.from('audit_log').insert({ project_id: projectId, actor_email: email, action, detail: detail ?? null });
}

export interface ActivityEntry extends AuditEntry { projectId: string }
// Recent activity across ALL projects the caller can see (super-admins see everything).
export async function cloudRecentActivity(limit = 100): Promise<ActivityEntry[]> {
  if (!(await authed()) || !supabase) return [];
  const { data, error } = await supabase.from('audit_log')
    .select('id, project_id, actor_email, action, detail, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map(r => ({ id: r.id as number, projectId: r.project_id as string, actorEmail: r.actor_email as string, action: r.action as AuditAction, detail: r.detail as string | null, createdAt: r.created_at as string }));
}

export async function cloudIsSuperAdmin(): Promise<boolean> {
  if (!(await authed()) || !supabase) return false;
  const { data, error } = await supabase.rpc('is_super_admin');
  return !error && data === true;
}

export interface DirectoryUser { id: string; email: string; full_name: string | null }
export async function cloudListUsers(): Promise<DirectoryUser[]> {
  if (!(await authed()) || !supabase) return [];
  const { data, error } = await supabase.from('profiles').select('id, email, full_name').order('email');
  if (error || !data) return [];
  return data.map(r => ({ id: r.id as string, email: r.email as string, full_name: (r.full_name as string) ?? null }));
}

export async function cloudListAudit(projectId: string, limit = 50): Promise<AuditEntry[]> {
  if (!(await authed()) || !supabase) return [];
  const { data, error } = await supabase.from('audit_log')
    .select('id, actor_email, action, detail, created_at')
    .eq('project_id', projectId).order('created_at', { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map(r => ({ id: r.id as number, actorEmail: r.actor_email as string, action: r.action as AuditAction, detail: r.detail as string | null, createdAt: r.created_at as string }));
}

// Email of the project's creator (owner), for "creator" display.
export async function cloudProjectOwnerEmail(projectId: string): Promise<string | null> {
  if (!(await authed()) || !supabase) return null;
  const { data, error } = await supabase.rpc('project_owner_email', { pid: projectId });
  if (error) return null;
  return (data as string) ?? null;
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

// Projects that others have shared WITH me (for the notifications bell).
export interface IncomingShare { projectId: string; projectName: string; sharedBy: string; createdAt: string }
export async function cloudIncomingShares(): Promise<IncomingShare[]> {
  if (!(await authed()) || !supabase) return [];
  const { data: u } = await supabase.auth.getUser();
  const myEmail = u.user?.email?.toLowerCase();
  const myId = u.user?.id;
  if (!myEmail) return [];
  const { data: shares } = await supabase.from('project_shares')
    .select('project_id, created_at').eq('email', myEmail);
  if (!shares || shares.length === 0) return [];
  const ids = shares.map(s => s.project_id);
  const { data: projs } = await supabase.from('projects').select('id, data, created_by').in('id', ids);
  const projMap = new Map((projs ?? []).map(p => [p.id, p]));
  const ownerIds = [...new Set((projs ?? []).map(p => p.created_by).filter(Boolean))] as string[];
  const { data: owners } = ownerIds.length
    ? await supabase.from('profiles').select('id, email').in('id', ownerIds)
    : { data: [] as { id: string; email: string }[] };
  const ownerMap = new Map((owners ?? []).map(o => [o.id, o.email]));
  return shares
    .filter(s => projMap.has(s.project_id) && projMap.get(s.project_id)!.created_by !== myId)
    .map(s => {
      const p = projMap.get(s.project_id)!;
      return {
        projectId: s.project_id,
        projectName: (p.data as { clientName?: string })?.clientName || 'Projeto',
        sharedBy: ownerMap.get(p.created_by) || 'um colega',
        createdAt: s.created_at as string,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
