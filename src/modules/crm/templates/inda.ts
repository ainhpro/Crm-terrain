/**
 * Modèle INDA (premier utilisateur : Fabrice), repris du prototype.
 * Sert de premier modèle de pipelines et de jeu de données de démarrage.
 */

export interface StepTemplate {
  code: string;
  label: { fr: string; nl: string };
  /** Libellé court affiché sous le point du pipeline. */
  short: string;
}

export interface PipelineTemplate {
  code: string;
  groupCode: string;
  label: { fr: string; nl: string };
  steps: StepTemplate[];
  impliedByDefault?: string[];
}

export interface GroupTemplate {
  code: string;
  name: string;
  color: string;
  sites: string[];
}

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
      { code: 'rdv', short: 'RDV', label: { fr: 'RDV mise à jour showroom', nl: 'Afspraak update showroom' } },
      { code: 'offre', short: 'OFFRE', label: { fr: 'Offre showroom envoyée', nl: 'Offerte showroom verstuurd' } },
      { code: 'commande', short: 'CMD', label: { fr: 'Commande passée', nl: 'Bestelling geplaatst' } },
      { code: 'placement', short: 'PLACE', label: { fr: 'Placement / installation', nl: 'Plaatsing / installatie' } },
    ],
  },
  {
    code: 'FACQ_TAR',
    groupCode: 'FACQ',
    label: { fr: 'Tarifs & formations', nl: 'Tarieven & opleidingen' },
    steps: [
      { code: 'formation_meubles', short: 'FORM.M', label: { fr: 'Formation meubles', nl: 'Opleiding meubelen' } },
      { code: 'formation_parois', short: 'FORM.P', label: { fr: 'Formation parois', nl: 'Opleiding douchewanden' } },
    ],
  },
  {
    code: 'STG_PLACE',
    groupCode: 'STG',
    label: { fr: 'Placement', nl: 'Plaatsing' },
    steps: [
      { code: 'rdv', short: 'RDV', label: { fr: 'RDV responsable showroom', nl: 'Afspraak showroomverantwoordelijke' } },
      { code: 'proposition', short: 'PROP', label: { fr: 'Proposition showroom', nl: 'Voorstel showroom' } },
      { code: 'commande', short: 'CMD', label: { fr: 'Commande passée', nl: 'Bestelling geplaatst' } },
      { code: 'placement', short: 'PLACE', label: { fr: 'Placement / installation', nl: 'Plaatsing / installatie' } },
    ],
  },
  {
    code: 'STG_FORM',
    groupCode: 'STG',
    label: { fr: 'Formation', nl: 'Opleiding' },
    steps: [{ code: 'formation', short: 'FORM', label: { fr: 'Formation meubles', nl: 'Opleiding meubelen' } }],
  },
  {
    code: 'SAMO',
    groupCode: 'SAMO',
    label: { fr: 'Tarifs & formation', nl: 'Tarieven & opleiding' },
    steps: [
      { code: 'tarif', short: 'TARIF', label: { fr: 'Tarif SAMO livré', nl: 'SAMO-tarief geleverd' } },
      { code: 'formation', short: 'FORM', label: { fr: 'Formation nouveautés produits', nl: 'Opleiding productnieuwigheden' } },
    ],
    // Décision métier du prototype : le tarif est considéré livré pour tous.
    impliedByDefault: ['tarif'],
  },
];
