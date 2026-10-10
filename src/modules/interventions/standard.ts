/** Types d'intervention proposés à un technicien qui démarre (neutres) ; il en ajoute ou en retire dans Réglages. */
import type { TypeKind } from './options';

export const STANDARD_INTERVENTION_TYPES: { kind: TypeKind; label: { fr: string; nl: string } }[] = [
  { kind: 'sav', label: { fr: 'SAV / dépannage', nl: 'Herstelling' } },
  { kind: 'custom', label: { fr: 'Installation', nl: 'Installatie' } },
  { kind: 'custom', label: { fr: 'Entretien', nl: 'Onderhoud' } },
  { kind: 'measure', label: { fr: 'Prise de mesure', nl: 'Opmeting' } },
];
