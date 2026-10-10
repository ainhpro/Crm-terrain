import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Stockage privé des fichiers (photos, signatures, logos). En local : un dossier hors du site public.
 * En production : Supabase Storage (bucket privé). Les fichiers ne sont servis que par une route
 * qui vérifie d'abord, sous RLS, que l'utilisateur voit la ligne qui les référence (E08).
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

export async function saveFile(orgId: string, file: File): Promise<{ path: string; contentType: string }> {
  assertDurable();
  const ext = ALLOWED.get(file.type);
  if (!ext) throw new Error('unsupported_type');
  if (file.size > MAX_FILE_BYTES) throw new Error('too_large');
  const path = `${orgId}/${randomUUID()}.${ext}`;
  const full = join(ROOT, path);
  await mkdir(/*turbopackIgnore: true*/ dirname(full), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ full, Buffer.from(await file.arrayBuffer()));
  return { path, contentType: file.type };
}

export async function saveBytes(orgId: string, bytes: Uint8Array, contentType: string): Promise<string> {
  assertDurable();
  const ext = ALLOWED.get(contentType) ?? 'bin';
  const path = `${orgId}/${randomUUID()}.${ext}`;
  const full = join(ROOT, path);
  await mkdir(/*turbopackIgnore: true*/ dirname(full), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ full, bytes);
  return path;
}

export async function readStored(path: string): Promise<Buffer> {
  const full = resolve(ROOT, path);
  if (!full.startsWith(ROOT + '/')) throw new Error('invalid_path');
  return readFile(/*turbopackIgnore: true*/ full);
}
