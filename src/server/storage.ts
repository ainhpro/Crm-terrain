import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { storageMode, supabaseConfig } from './config';
import { downloadObject, removeFolder, type StorageClientConfig, uploadObject } from './supabase/storage';

/**
 * Stockage privé des fichiers (photos, signatures, logos, PDF). En local : un dossier hors du site
 * public. En production : Supabase Storage, bucket privé (supabase/storage.ts). Les fichiers ne sont
 * servis que par une route qui vérifie d'abord, sous RLS, que l'utilisateur voit la ligne qui les
 * référence (E08). Chemin : <organisation>/<identifiant>.<extension>, jamais réutilisé.
 */

const ROOT = resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR ?? '.local/storage');
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/heic', 'heic'],
  ['application/pdf', 'pdf'],
]);
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Le disque des fonctions Vercel n'est pas durable : y écrire perdrait photos, signatures et PDF
 * (relecture D04). Tant que Supabase Storage n'est pas branché, on refuse au lieu de perdre.
 */
function assertDurable(): void {
  if (process.env.VERCEL) throw new Error('durable_storage_required');
}

function remote(): StorageClientConfig | null {
  if (storageMode() !== 'supabase') return null;
  const s = supabaseConfig()!;
  return { url: s.url, serviceRoleKey: s.serviceRoleKey!, bucket: s.bucket };
}

async function put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const r = remote();
  if (r) return uploadObject(r, path, bytes, contentType);
  assertDurable();
  const full = join(ROOT, path);
  await mkdir(/*turbopackIgnore: true*/ dirname(full), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ full, bytes);
}

export async function saveFile(orgId: string, file: File): Promise<{ path: string; contentType: string }> {
  const ext = ALLOWED.get(file.type);
  if (!ext) throw new Error('unsupported_type');
  if (file.size > MAX_FILE_BYTES) throw new Error('too_large');
  const path = `${orgId}/${randomUUID()}.${ext}`;
  await put(path, new Uint8Array(await file.arrayBuffer()), file.type);
  return { path, contentType: file.type };
}

export async function saveBytes(orgId: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const ext = ALLOWED.get(contentType) ?? 'bin';
  const path = `${orgId}/${randomUUID()}.${ext}`;
  await put(path, bytes, contentType);
  return path;
}

export async function readStored(path: string): Promise<Buffer> {
  const r = remote();
  if (r) return downloadObject(r, path);
  const full = resolve(ROOT, path);
  if (!full.startsWith(ROOT + '/')) throw new Error('invalid_path');
  return readFile(/*turbopackIgnore: true*/ full);
}

/** Supprime tous les fichiers d'une entreprise (après la suppression de ses données, règle 10). */
export async function deleteOrgFiles(orgId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error('invalid_path');
  const r = remote();
  if (r) {
    await removeFolder(r, orgId);
    return;
  }
  const dir = resolve(ROOT, orgId);
  if (!dir.startsWith(ROOT + '/')) throw new Error('invalid_path');
  await rm(/*turbopackIgnore: true*/ dir, { recursive: true, force: true });
}
