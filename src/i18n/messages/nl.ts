import type { Messages } from './fr';

const nl: Messages = {
  app: {
    name: 'CRM terrain',
    tagline: 'Na je klantbezoek spreek je een minuut in en is alles bijgewerkt.',
  },
  nav: {
    today: 'Vandaag',
    actions: 'Acties',
    clients: 'Klanten',
    summary: 'Overzicht',
    agenda: 'Agenda',
    settings: 'Instellingen',
  },
  home: {
    title: 'Vandaag',
    comingSoon: 'De schermen komen eraan: de basis (accounts, klanten, pipelines) staat klaar.',
  },
  language: {
    label: 'Taal',
    fr: 'Français',
    nl: 'Nederlands',
  },
  actionStatus: {
    todo: 'Te doen',
    appointment_to_set: 'Afspraak in te plannen',
    appointment_set: 'Afspraak vastgelegd',
    in_progress: 'Bezig',
    waiting: 'In afwachting',
    follow_up: 'Opvolging',
    done: 'Afgerond',
    blocked: 'Geblokkeerd',
  },
  progress: {
    finished: 'Afgerond',
    late: 'Achterstand',
    in_progress: 'Bezig',
    not_started: 'Te starten',
  },
  actionBuckets: {
    late: 'Achterstallig',
    today: 'Vandaag',
    followUps: 'Opvolgingen',
    next7Days: 'Volgende 7 dagen',
    appointmentsToSet: 'Afspraken in te plannen',
    empty: 'Alles is bijgewerkt',
  },
};

export default nl;
