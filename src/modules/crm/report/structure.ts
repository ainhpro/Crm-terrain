import { addDays } from '../actions/buckets';
import type { IsoDate } from '../pipeline/types';

/**
 * Structuration d'un compte rendu dicté (version locale, sans IA) : résumé, tâches datées,
 * étape atteinte. Ne fait que proposer ; l'utilisateur coche, corrige et valide.
 */

export interface StepOption {
  id: string;
  code: string;
  label: string;
  /** Affaire de l'étape : deux affaires différentes qui correspondent = ambiguïté, on demande. */
  group?: string;
  /** Libellé de l'étape seul (sans le nom de l'affaire), pour la reconnaissance. */
  stepLabel?: string;
}

export interface ProposedTask {
  text: string;
  dueOn: IsoDate | null;
  source: string;
}

export interface ProposedReport {
  summary: string;
  tasks: ProposedTask[];
  /** Étape proposée comme terminée : seulement si une seule affaire correspond. */
  stepDone: StepOption | null;
  stepSource: string | null;
  /** Plusieurs affaires correspondent : l'utilisateur choisit (rien n'est pré-coché). */
  candidates: StepOption[];
  /** Phrases qui citent une étape sans la dire faite (négation, futur) : non retenues, montrées. */
  notDone: string[];
}

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, oktober: 10, december: 12,
};

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Date mentionnée dans une phrase (« le 26 octobre », « dans deux semaines », « demain », « over 3 dagen »). */
export function findDate(sentence: string, today: IsoDate): IsoDate | null {
  const s = plain(sentence);
  const words: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, een: 1, twee: 2, drie: 3, vier: 4 };
  const num = (w: string) => (/^\d+$/.test(w) ? Number(w) : words[w]);
  let m = s.match(/\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|januari|februari|maart|april|mei|juni|juli|augustus|oktober|december)\b/);
  if (m) {
    const [y] = today.split('-').map(Number) as [number];
    const month = MONTHS[m[2]!]!;
    let date = `${y}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
    if (date < today) date = `${y + 1}${date.slice(4)}`;
    return date;
  }
  m = s.match(/\b(?:dans|over|binnen)\s+(\d+|un|une|deux|trois|quatre|een|twee|drie|vier)\s+(jours?|semaines?|mois|dagen?|weken?|week|maanden?|maand)\b/);
  if (m && num(m[1]!)) {
    const n = num(m[1]!)!;
    const unit = m[2]!;
    const days = /^(semaine|week|weken)/.test(unit) ? 7 : /^(mois|maand)/.test(unit) ? 30 : 1;
    return addDays(today, n * days);
  }
  if (/\b(apres-demain|overmorgen)\b/.test(s)) return addDays(today, 2);
  if (/\b(demain|morgen)\b/.test(s)) return addDays(today, 1);
  return null;
}

const TASK_CUES = /\b(il faut|je dois|on doit|a faire|rappeler|relancer|envoyer|planifier|prevoir|passer|commander|preparer|moet|moeten|bellen|sturen|plannen|opvolgen|langsgaan)\b/;
const DONE_CUES = /\b(confirme|confirmee|valide|validee|signe|signee|fait|faite|termine|terminee|envoye|envoyee|passe|passee|recu|recue|bevestigd|getekend|gedaan|verstuurd|geplaatst|afgerond)\b/;

// « Je n'ai pas envoyé l'offre », « l'offre sera envoyée », « de offerte is nog niet verstuurd » : pas fait.
const NEGATION = /(\bn['’]|\bne\b|\bpas\b|\bjamais\b|\bniet\b|\bgeen\b|\bnooit\b|\bnog niet\b)/;
const FUTURE = /\b(va|vais|vas|vont|allons|allez|sera|seront|serait|devrait|devra|doit|doivent|pourrait|bientot|zal|zullen|gaat|gaan|moet|moeten|binnenkort)\b/;
// Mots trop généraux pour reconnaître une étape à eux seuls.
const GENERIC = new Set(['premier', 'premiere', 'eerste', 'mise', 'jour', 'etape', 'stap', 'avec', 'pour', 'voor']);

function keywordOf(label: string): string {
  const words = plain(label).split(/[\s/()]+/).filter((w) => w.length > 3 && !GENERIC.has(w));
  return words[0] ?? plain(label);
}

/** Découpe le texte en phrases, propose tâches et étape terminée (sans jamais trancher une ambiguïté). */
export function structureReport(text: string, steps: StepOption[], today: IsoDate): ProposedReport {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|\s*\n\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

  const tasks: ProposedTask[] = [];
  for (const sentence of sentences) {
    if (TASK_CUES.test(plain(sentence))) {
      tasks.push({ text: sentence.replace(/[.!]+$/, ''), dueOn: findDate(sentence, today), source: sentence });
    }
  }

  // Par affaire : l'étape la plus avancée dite faite.
  const best = new Map<string, { step: StepOption; source: string }>();
  const notDone: string[] = [];
  for (const sentence of sentences) {
    const p = plain(sentence);
    if (!DONE_CUES.test(p)) continue;
    const matching = steps.filter((step) => {
      const code = plain(step.code).replace(/_/g, ' ');
      return (code.length > 2 && new RegExp(`\\b${code}\\b`).test(p)) || p.includes(keywordOf(step.stepLabel ?? step.label));
    });
    if (!matching.length) continue;
    if (NEGATION.test(p) || FUTURE.test(p)) {
      notDone.push(sentence);
      continue;
    }
    for (const step of matching) {
      const g = step.group ?? '';
      const current = best.get(g);
      if (!current || steps.indexOf(step) > steps.indexOf(current.step)) best.set(g, { step, source: sentence });
    }
  }
  const found = [...best.values()];
  const single = found.length === 1 ? found[0]! : null;

  const summary = sentences.filter((s) => !tasks.some((t) => t.source === s)).slice(0, 3).join(' ') || sentences.slice(0, 2).join(' ');
  return {
    summary,
    tasks,
    stepDone: single?.step ?? null,
    stepSource: single?.source ?? (found.length > 1 ? found[0]!.source : null),
    candidates: found.length > 1 ? found.map((f) => f.step) : [],
    notDone,
  };
}
