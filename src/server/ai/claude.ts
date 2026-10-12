import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

/**
 * Appel à Claude, côté serveur uniquement (règle 2 : le téléphone ne parle jamais à l'IA, la clé ne
 * quitte pas le serveur). Sortie structurée validée par schéma ; l'IA ne fait que proposer (règle 4) :
 * chaque proposition est ensuite revérifiée par le code (ai-check.ts) et validée par l'utilisateur.
 * Jamais de prix, de total ni de durée demandés à l'IA (règle 3).
 * Sans clé, rien n'est appelé : la lecture par règles locales reste utilisée.
 */

export const AI_MODEL = 'claude-opus-5-5';

/** Le strict nécessaire de l'API utilisé ici, pour pouvoir le remplacer dans les tests. */
export interface AiClient {
  beta: { messages: { parse: Anthropic['beta']['messages']['parse'] } };
}

let shared: AiClient | null = null;

/** Service de test local (tests de bout en bout uniquement), jamais un autre hôte. */
function testBaseUrl(): string | null {
  const u = process.env.AI_TEST_BASE_URL?.trim();
  if (!u) return null;
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(u) || process.env.NODE_ENV === 'production') throw new Error('AI_TEST_BASE_URL refusé');
  return u;
}

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function client(): AiClient {
  if (!shared) {
    shared = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Adresse officielle explicite (jamais héritée de l'environnement) ; un service de test local en essai.
      baseURL: testBaseUrl() ?? 'https://api.anthropic.com',
      timeout: 30_000,
      maxRetries: 1,
    });
  }
  return shared;
}

export class AiUnavailable extends Error {}

/** Une demande, une réponse structurée ; null si l'IA a refusé ou n'a pas produit de résultat valide. */
export async function askStructured<S extends z.ZodType>(
  schema: S,
  system: string,
  input: string,
  injected?: AiClient,
): Promise<z.infer<S> | null> {
  const c = injected ?? client();
  let response;
  try {
    response = await c.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: input }],
      // Extraction courte : effort bas suffit ; la réflexion adaptative reste active (non désactivable).
      output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
      // Si le modèle refuse (filtre de sécurité), Anthropic relance sur le modèle de repli recommandé.
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new AiUnavailable(`HTTP ${e.status ?? '?'}`);
    throw new AiUnavailable((e as Error).message);
  }
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  return (response.parsed_output as z.infer<S> | null) ?? null;
}
