import { withUser } from '@/server/db';
import { sessionUserId } from '@/server/session';
import { readStored } from '@/server/storage';

/** Sert une photo ou un document privé : seulement si l'utilisateur voit la ligne qui le référence (RLS). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUserId();
  if (!userId) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });
  const media = await withUser(userId, async (q) =>
    (await q<{ storage_path: string; content_type: string }>(`select storage_path, content_type from visit_media where id = $1`, [id])).rows[0],
  );
  if (!media) return new Response(null, { status: 404 });
  const bytes = await readStored(media.storage_path);
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': media.content_type, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' },
  });
}
