/**
 * Supabase Storage, bucket privé. Traitement serveur nommé « fichiers » (règle 2) : seule la clé
 * service_role y accède, et uniquement APRÈS que la route a vérifié, sous RLS et avec l'identité de
 * l'utilisateur, qu'il voit la ligne qui référence le fichier. Le bucket n'a aucune politique pour
 * anon ou authenticated : rien n'est lisible directement depuis un navigateur.
 */
import { keyHeaders } from './keys';

export interface StorageClientConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
  fetch?: typeof fetch;
}

const SAFE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i;

function target(cfg: StorageClientConfig, path: string): string {
  if (!SAFE_PATH.test(path)) throw new Error('invalid_path');
  return `${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${path}`;
}

function auth(cfg: StorageClientConfig): Record<string, string> {
  return keyHeaders(cfg.serviceRoleKey);
}

/** Dépose un fichier ; refuse d'écraser un fichier existant (chemins uniques, rien ne se remplace). */
export async function uploadObject(cfg: StorageClientConfig, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const res = await (cfg.fetch ?? fetch)(target(cfg, path), {
    method: 'POST',
    headers: { ...auth(cfg), 'content-type': contentType, 'x-upsert': 'false', 'cache-control': 'private, max-age=0' },
    body: Buffer.from(bytes),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`storage_upload_${res.status}`);
}

export async function downloadObject(cfg: StorageClientConfig, path: string): Promise<Buffer> {
  const res = await (cfg.fetch ?? fetch)(target(cfg, path), { headers: auth(cfg), cache: 'no-store' });
  if (!res.ok) throw new Error(`storage_download_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Supprime tous les fichiers d'un compte (dossier <organisation>/), par lots ; renvoie le nombre supprimé. */
export async function removeFolder(cfg: StorageClientConfig, orgId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error('invalid_path');
  const f = cfg.fetch ?? fetch;
  const base = `${cfg.url}/storage/v1/object`;
  let removed = 0;
  for (let round = 0; round < 1000; round++) {
    const list = await f(`${base}/list/${encodeURIComponent(cfg.bucket)}`, {
      method: 'POST',
      headers: { ...auth(cfg), 'content-type': 'application/json' },
      body: JSON.stringify({ prefix: orgId, limit: 100, offset: 0 }),
      cache: 'no-store',
    });
    if (!list.ok) throw new Error(`storage_list_${list.status}`);
    const names = ((await list.json()) as { name: string }[]).map((o) => o.name).filter((n) => /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(n));
    if (!names.length) return removed;
    const del = await f(`${base}/${encodeURIComponent(cfg.bucket)}`, {
      method: 'DELETE',
      headers: { ...auth(cfg), 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: names.map((n) => `${orgId}/${n}`) }),
      cache: 'no-store',
    });
    if (!del.ok) throw new Error(`storage_delete_${del.status}`);
    removed += names.length;
  }
  throw new Error('storage_delete_too_many');
}
