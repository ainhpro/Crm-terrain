/**
 * Modèle INDA (premier utilisateur : Fabrice), repris du prototype.
 * Un modèle parmi d'autres : un nouveau compte démarre avec le modèle neutre (standard.ts).
 */

import type { GroupTemplate, PipelineTemplate } from './types';

export type { GroupTemplate, PipelineTemplate, StepTemplate } from './types';

export const INDA_GROUPS: GroupTemplate[] = [
  {
    code: 'FACQ',
    name: 'FACQ',
    color: '#0050A0',
    sites: ['Merelbeke', 'Zaventem', 'Diest', 'Wilrijk', 'Geel', 'Brugge', 'Oostende', 'Hasselt', 'Roeselare', 'Kuurne'],
  },
  {
    code: 'STG',
    name: 'STG',
    color: '#DC2626',
    sites: [
      'Hasselt', 'Bissegem', 'Herentals', 'Brasschaat', 'Brugge', 'Gentbrugge', 'Izegem',
      'Oudenaarde', 'Turnhout', 'Veurne', 'Wilrijk', 'Zandhoven', 'Zele', 'Ninove',
    ],
  },
  {
    code: 'SAMO',
    name: 'SAMO',
    color: '#1A1A1A',
    sites: [
      'Dupont Courtrai', 'Dupont Roulers', 'Dupont Ypres', 'Dupont Ruiselede',
      'Badkamer Vermeersch', 'Willems Diels', 'Demeyer NV',
    ],
  },
];

export const INDA_PIPELINES: PipelineTemplate[] = [
  {
    code: 'FACQ_MAJ',
    groupCode: 'FACQ',
    label: { fr: 'MAJ showroom', nl: 'Update showroom' },
    steps: [
      { code: 'rdv', short: { fr: 'RDV', nl: 'AFSPR' }, label: { fr: 'RDV mise à jour showroom', nl: 'Afspraak update showroom' } },
      { code: 'offre', short: { fr: 'OFFRE', nl: 'OFFERTE' }, label: { fr: 'Offre showroom envoyée', nl: 'Offerte showroom verstuurd' } },
      { code: 'commande', short: { fr: 'CMD', nl: 'BEST' }, label: { fr: 'Commande passée', nl: 'Bestelling geplaatst' } },
      { code: 'placement', short: { fr: 'PLACE', nl: 'PLAATS' }, label: { fr: 'Placement / installation', nl: 'Plaatsing / installatie' } },
    ],
  },
  {
    code: 'FACQ_TAR',
    groupCode: 'FACQ',
    label: { fr: 'Tarifs & formations', nl: 'Tarieven & opleidingen' },
    steps: [
      { code: 'tarif', short: { fr: 'TARIF', nl: 'PRIJS' }, label: { fr: 'Tarifs livrés', nl: 'Prijslijsten bezorgd' } },
      { code: 'formation_meubles', short: { fr: 'FORM.M', nl: 'OPL.M' }, label: { fr: 'Formation meubles', nl: 'Opleiding meubelen' } },
      { code: 'formation_parois', short: { fr: 'FORM.P', nl: 'OPL.D' }, label: { fr: 'Formation parois', nl: 'Opleiding douchewanden' } },
    ],
  },
  {
    code: 'STG_PLACE',
    groupCode: 'STG',
    label: { fr: 'Placement', nl: 'Plaatsing' },
    steps: [
      { code: 'rdv', short: { fr: 'RDV', nl: 'AFSPR' }, label: { fr: 'RDV responsable showroom', nl: 'Afspraak showroomverantwoordelijke' } },
      { code: 'proposition', short: { fr: 'PROP', nl: 'VOORST' }, label: { fr: 'Proposition showroom', nl: 'Voorstel showroom' } },
      { code: 'commande', short: { fr: 'CMD', nl: 'BEST' }, label: { fr: 'Commande passée', nl: 'Bestelling geplaatst' } },
      { code: 'placement', short: { fr: 'PLACE', nl: 'PLAATS' }, label: { fr: 'Placement / installation', nl: 'Plaatsing / installatie' } },
    ],
  },
  {
    code: 'STG_FORM',
    groupCode: 'STG',
    label: { fr: 'Formation', nl: 'Opleiding' },
    steps: [{ code: 'formation', short: { fr: 'FORM', nl: 'OPL' }, label: { fr: 'Formation meubles', nl: 'Opleiding meubelen' } }],
  },
  {
    code: 'SAMO',
    groupCode: 'SAMO',
    label: { fr: 'Tarifs & formation', nl: 'Tarieven & opleiding' },
    steps: [
      { code: 'tarif', short: { fr: 'TARIF', nl: 'PRIJS' }, label: { fr: 'Tarif SAMO livré', nl: 'SAMO-prijslijst bezorgd' } },
      { code: 'formation', short: { fr: 'FORM', nl: 'OPL' }, label: { fr: 'Formation nouveautés produits', nl: 'Opleiding productnieuwigheden' } },
    ],
    // Décision métier du prototype : le tarif est considéré livré pour tous.
    impliedByDefault: ['tarif'],
  },
];
