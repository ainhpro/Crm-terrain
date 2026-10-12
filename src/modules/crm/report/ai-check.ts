import type { IsoDate } from '../pipeline/types';
import type { ProposedReport, StepOption } from './structure';

/**
 * Contrôle, par le code, d'une proposition de compte rendu faite par l'IA (règle 4 : l'IA propose,
 * l'utilisateur valide ; ici on écarte en plus tout ce qui n'est pas prouvé par le texte dicté).
 * - une étape n'est proposée que si elle existe et si la phrase citée figure vraiment dans le texte ;
 * - plusieurs affaires possibles → aucune étape choisie, les candidates sont montrées ;
 * - une date doit être une vraie date AAAA-MM-JJ, sinon elle est laissée vide.
 */

export interface AiReportDraft {
  summary: string;
  step: { id: string | null; quote: string | null; candidates: string[] };
  not_done: string[];
  tasks: { text: string; due_on: string | null; quote: string | null }[];
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** La citation figure-t-elle dans le texte (à la casse et aux espaces près) ? */
export function quoted(text: string, quote: string | null | undefined): quote is string {
  if (!quote || quote.trim().length < 3) return false;
  return norm(text).includes(norm(quote));
}

export function isIsoDate(s: string | null | undefined): s is IsoDate {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function checkAiReport(draft: AiReportDraft, text: string, steps: StepOption[]): ProposedReport {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const stepQuoted = quoted(text, draft.step.quote);
  const candidates = draft.step.candidates.map((id) => byId.get(id)).filter((s): s is StepOption => !!s);
  const chosen = draft.step.id ? byId.get(draft.step.id) ?? null : null;
  // Une seule étape, sourcée : proposée. Plusieurs candidates : l'utilisateur choisit.
  const stepDone = chosen && stepQuoted && candidates.length <= 1 ? chosen : null;
  return {
    summary: draft.summary.trim().slice(0, 600),
    stepDone,
    stepSource: stepDone || candidates.length > 1 ? (stepQuoted ? draft.step.quote!.trim() : null) : null,
    candidates: candidates.length > 1 ? candidates : [],
    notDone: draft.not_done.filter((s) => quoted(text, s)).map((s) => s.trim()),
    tasks: draft.tasks
      .filter((t) => t.text.trim())
      .slice(0, 10)
      .map((t) => ({
        text: t.text.trim().slice(0, 200),
        dueOn: isIsoDate(t.due_on) ? t.due_on : null,
        source: quoted(text, t.quote) ? t.quote.trim() : '',
      })),
  };
}
