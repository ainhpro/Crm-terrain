import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { checkAiReport, isIsoDate } from '../../src/modules/crm/report/ai-check';
import { checkAiRequest } from '../../src/modules/interventions/ai-check';
import { AI_MODEL, type AiClient, AiUnavailable } from '../../src/server/ai/claude';
import { structureReportWithAi } from '../../src/server/ai/report';
import { parseRequestWithAi } from '../../src/server/ai/request';

const steps = [
  { id: 'd1:offre', code: 'offre', label: 'Offre envoyée (Cuisine)', stepLabel: 'Offre envoyée', group: 'd1' },
  { id: 'd1:cmd', code: 'commande', label: 'Commande (Cuisine)', stepLabel: 'Commande', group: 'd1' },
  { id: 'd2:offre', code: 'offre', label: 'Offre envoyée (Salle de bain)', stepLabel: 'Offre envoyée', group: 'd2' },
];
const TEXT = "J'ai envoyé l'offre de la cuisine ce matin. Il faut rappeler Mme Peeters dans deux semaines.";
const draft = (over: Partial<Parameters<typeof checkAiReport>[0]> = {}) => ({
  summary: 'Offre cuisine envoyée.',
  step: { id: 'd1:offre', quote: "J'ai envoyé l'offre de la cuisine ce matin.", candidates: [] },
  not_done: [],
  tasks: [{ text: 'Rappeler Mme Peeters', due_on: '2026-10-26', quote: 'Il faut rappeler Mme Peeters dans deux semaines.' }],
  ...over,
});

describe('contrôle d’une proposition de compte rendu de l’IA', () => {
  it('étape sourcée et existante : proposée avec sa source', () => {
    const r = checkAiReport(draft(), TEXT, steps);
    expect(r.stepDone?.id).toBe('d1:offre');
    expect(r.stepSource).toBe("J'ai envoyé l'offre de la cuisine ce matin.");
    expect(r.tasks[0]).toEqual({ text: 'Rappeler Mme Peeters', dueOn: '2026-10-26', source: 'Il faut rappeler Mme Peeters dans deux semaines.' });
  });
  it('citation absente du texte (inventée) : aucune étape', () => {
    expect(checkAiReport(draft({ step: { id: 'd1:cmd', quote: 'Le client a signé la commande.', candidates: [] } }), TEXT, steps).stepDone).toBeNull();
  });
  it('identifiant inconnu : aucune étape ; plusieurs affaires : rien de choisi, candidates montrées', () => {
    expect(checkAiReport(draft({ step: { id: 'x:y', quote: "J'ai envoyé l'offre de la cuisine ce matin.", candidates: [] } }), TEXT, steps).stepDone).toBeNull();
    const amb = checkAiReport(draft({ step: { id: 'd1:offre', quote: "J'ai envoyé l'offre de la cuisine ce matin.", candidates: ['d1:offre', 'd2:offre', 'zz'] } }), TEXT, steps);
    expect(amb.stepDone).toBeNull();
    expect(amb.candidates.map((c) => c.id)).toEqual(['d1:offre', 'd2:offre']);
  });
  it('dates : seules les vraies dates AAAA-MM-JJ passent', () => {
    expect([isIsoDate('2026-02-29'), isIsoDate('2028-02-29'), isIsoDate('26/10/2026'), isIsoDate(null)]).toEqual([false, true, false, false]);
    const r = checkAiReport(draft({ tasks: [{ text: 'Passer', due_on: '2026-13-01', quote: null }] }), TEXT, steps);
    expect(r.tasks[0]).toEqual({ text: 'Passer', dueOn: null, source: '' });
  });
  it('phrases « non retenues » : seulement celles du texte', () => {
    const r = checkAiReport(draft({ not_done: ['Il faut rappeler Mme Peeters dans deux semaines.', 'Phrase inventée.'] }), TEXT, steps);
    expect(r.notDone).toEqual(['Il faut rappeler Mme Peeters dans deux semaines.']);
  });
});

const SUBJECT = 'Ticket 2026-0512 — SAV meuble';
const BODY = 'Bonjour,\nM. Dupuis signale une porte mal alignée.\nAdresse : Rue Haute 5, 1000 Bruxelles\nTél. 0475 99 88 77 — dupuis@client.example\nSous garantie.';
const req = (over: Record<string, unknown> = {}) => ({
  tickets: { value: ['2026-0512'], quote: 'Ticket 2026-0512' },
  phone: { value: '+32 475 99 88 77', quote: 'Tél. 0475 99 88 77' },
  email: { value: 'dupuis@client.example', quote: 'dupuis@client.example' },
  postal_address: { value: 'Rue Haute 5, 1000 Bruxelles', quote: 'Rue Haute 5, 1000 Bruxelles' },
  warranty: { value: 'yes' as const, quote: 'Sous garantie.' },
  problem: { value: 'Porte de meuble mal alignée.', quote: 'M. Dupuis signale une porte mal alignée.' },
  language: 'fr' as const,
  ...over,
});

describe('contrôle d’une lecture d’email par l’IA', () => {
  it('champs lus dans l’email : gardés avec leur source', () => {
    const r = checkAiRequest(req(), SUBJECT, BODY);
    expect(r.tickets).toEqual({ value: ['2026-0512'], source: 'Ticket 2026-0512', confident: true });
    expect(r.email.value).toBe('dupuis@client.example');
    expect(r.warranty.value).toBe('yes');
  });
  it('rien d’inventé : ticket, email ou téléphone absents de l’email sont écartés', () => {
    const r = checkAiRequest(req({
      tickets: { value: ['2026-0512', 'INC-99'], quote: 'Ticket 2026-0512' },
      email: { value: 'autre@exemple.be', quote: null },
      phone: { value: '0499 00 00 00', quote: null },
    }), SUBJECT, BODY);
    expect(r.tickets.value).toEqual(['2026-0512']);
    expect([r.email.value, r.phone.value]).toEqual([null, null]);
  });
  it('adresse sans citation retrouvée : écartée', () => {
    expect(checkAiRequest(req({ postal_address: { value: 'Rue Basse 9, 1000 Bruxelles', quote: 'Rue Basse 9' } }), SUBJECT, BODY).postalAddress.value).toBeNull();
  });
});

function fake(answer: (params: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return answer(params);
        },
      },
    },
  } as unknown as AiClient;
  return { client, calls };
}

describe('appel à Claude', () => {
  it('modèle, effort bas, sortie structurée, repli en cas de refus ; jamais de prix demandé', async () => {
    const { client, calls } = fake(() => ({ stop_reason: 'end_turn', parsed_output: draft() }));
    const r = await structureReportWithAi(TEXT, steps, '2026-10-12', client);
    expect(r?.stepDone?.id).toBe('d1:offre');
    const p = calls[0]!;
    expect(p.model).toBe(AI_MODEL);
    expect(p.model).toBe('claude-opus-5-5');
    expect((p.output_config as { effort: string }).effort).toBe('low');
    expect((p.output_config as { format: unknown }).format).toBeTruthy();
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(p).not.toHaveProperty('thinking');
    const input = JSON.parse(String((p.messages as { content: string }[])[0]!.content));
    expect(input).toMatchObject({ date_du_jour: '2026-10-12', compte_rendu: TEXT });
    expect(String(p.system)).not.toMatch(/prix|montant|tarif/i);
  });
  it('refus ou réponse tronquée : null (les règles locales prennent le relais)', async () => {
    expect(await structureReportWithAi(TEXT, steps, '2026-10-12', fake(() => ({ stop_reason: 'refusal', parsed_output: null })).client)).toBeNull();
    expect(await parseRequestWithAi(SUBJECT, BODY, fake(() => ({ stop_reason: 'max_tokens', parsed_output: req() })).client)).toBeNull();
  });
  it('erreur de l’API : AiUnavailable', async () => {
    const down = fake(() => { throw new Anthropic.APIConnectionError({ message: 'réseau' }); });
    await expect(parseRequestWithAi(SUBJECT, BODY, down.client)).rejects.toBeInstanceOf(AiUnavailable);
  });
  it('lecture d’email : résultat contrôlé avant d’être montré', async () => {
    const r = await parseRequestWithAi(SUBJECT, BODY, fake(() => ({ stop_reason: 'end_turn', parsed_output: req({ email: { value: 'invente@x.be', quote: null } }) })).client);
    expect(r?.email.value).toBeNull();
    expect(r?.tickets.value).toEqual(['2026-0512']);
  });
});
