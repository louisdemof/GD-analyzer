import { openDB, type IDBPDatabase } from 'idb';
import type { Project } from '../engine/types';

const DB_NAME = 'gd-analyzer';
const DB_VERSION = 2;
const PROJECTS_STORE = 'projects';
const FOLDERS_STORE = 'folders';

export interface ClientFolder {
  id: string;
  name: string;
  description?: string;
  color: string;
  createdAt: string;
  projectIds: string[];
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(FOLDERS_STORE)) {
          db.createObjectStore(FOLDERS_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ─── Projects ─────────────────────────────────────────────

export async function saveProjectToDB(project: Project): Promise<void> {
  const db = await getDB();
  await db.put(PROJECTS_STORE, { ...project, savedAt: new Date().toISOString() });
}

export async function loadAllProjectsFromDB(): Promise<Project[]> {
  const db = await getDB();
  return db.getAll(PROJECTS_STORE);
}

export async function deleteProjectFromDB(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(PROJECTS_STORE, id);
}

// ─── Folders ──────────────────────────────────────────────

export async function saveFolderToDB(folder: ClientFolder): Promise<void> {
  const db = await getDB();
  await db.put(FOLDERS_STORE, folder);
}

export async function loadAllFoldersFromDB(): Promise<ClientFolder[]> {
  const db = await getDB();
  return db.getAll(FOLDERS_STORE);
}

export async function deleteFolderFromDB(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(FOLDERS_STORE, id);
}

// ─── Migration from localStorage ──────────────────────────

export async function migrateFromLocalStorage(): Promise<Project[]> {
  const keys = ['gd-simulator-projects'];
  let migrated: Project[] = [];

  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const projects = parsed?.state?.projects || parsed?.projects || [];
      if (Array.isArray(projects) && projects.length > 0) {
        for (const p of projects) {
          if (p && p.id) {
            await saveProjectToDB(p);
            migrated.push(p);
          }
        }
        localStorage.removeItem(key);
      }
    } catch { /* ignore corrupt data */ }
  }
  return migrated;
}

// ─── Share URL ────────────────────────────────────────────

export function projectToShareURL(project: Project): string {
  const LZString = require('lz-string') as typeof import('lz-string');
  const json = JSON.stringify(project);
  const compressed = LZString.compressToEncodedURIComponent(json);
  return `${window.location.origin}/GD-analyzer/#/share/${compressed}`;
}

export function projectFromShareURL(hash: string): Project | null {
  try {
    const LZString = require('lz-string') as typeof import('lz-string');
    const compressed = hash.replace('#/share/', '').replace('/share/', '');
    const json = LZString.decompressFromEncodedURIComponent(compressed);
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}
