/** Options activables par technicien (types attribués et 4 options en V1). */

export interface MemberOptions {
  parts: boolean;
  pricing: boolean;
  signature: boolean;
  warranty: boolean;
}

export type TypeKind = 'sav' | 'measure' | 'showroom' | 'custom';

/** Valeurs par défaut selon les types attribués : un technicien « showroom » seul n'a ni garantie ni pièces. */
export function defaultOptions(kinds: TypeKind[]): MemberOptions {
  const onlyShowroomOrMeasure = kinds.length > 0 && kinds.every((k) => k === 'showroom' || k === 'measure');
  return {
    parts: !onlyShowroomOrMeasure,
    pricing: true,
    signature: true,
    warranty: kinds.includes('sav') || kinds.includes('custom'),
  };
}

export function readOptions(raw: unknown): MemberOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (k: string) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : true);
  return { parts: b('parts'), pricing: b('pricing'), signature: b('signature'), warranty: b('warranty') };
}
