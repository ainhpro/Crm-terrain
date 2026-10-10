import { NextResponse, type NextRequest } from 'next/server';

// Transmet le chemin courant aux composants serveur (pour marquer l'onglet actif).
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-pathname', req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!_next|favicon|manifest).*)'] };
