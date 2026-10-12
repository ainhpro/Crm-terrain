/**
 * En-têtes d'une clé Supabase. Les anciennes clés (anon, service_role) sont des JWT et vont aussi
 * dans « Authorization: Bearer ». Les nouvelles (sb_publishable_…, sb_secret_…) ne sont pas des JWT :
 * Supabase les refuse en Bearer, elles ne vont que dans « apikey ». Un jeton d'utilisateur, lui,
 * va toujours en Bearer.
 */
export function keyHeaders(key: string, userToken?: string): Record<string, string> {
  const bearer = userToken ?? (isLegacyJwtKey(key) ? key : null);
  return bearer ? { apikey: key, authorization: `Bearer ${bearer}` } : { apikey: key };
}

export function isLegacyJwtKey(key: string): boolean {
  return key.startsWith('eyJ');
}
