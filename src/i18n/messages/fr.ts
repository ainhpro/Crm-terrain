// Dictionnaire de référence : toute clé ajoutée ici doit l'être aussi en nl.ts (vérifié par TypeScript).
const fr = {
  app: {
    name: 'CRM terrain',
    tagline: 'Tu sors de chez le client, tu parles une minute, et tout est à jour.',
  },
  nav: {
    today: "Aujourd'hui",
    actions: 'Actions',
    clients: 'Clients',
    summary: 'Résumé',
    agenda: 'Agenda',
    settings: 'Réglages',
  },
  home: {
    title: "Aujourd'hui",
    comingSoon: 'Les écrans arrivent : le socle (comptes, clients, pipelines) est en place.',
  },
  language: {
    label: 'Langue',
    fr: 'Français',
    nl: 'Nederlands',
  },
  actionStatus: {
    todo: 'À faire',
    appointment_to_set: 'RDV à fixer',
    appointment_set: 'RDV fixé',
    in_progress: 'En cours',
    waiting: 'En attente',
    follow_up: 'Relance',
    done: 'Terminé',
    blocked: 'Bloqué',
  },
  progress: {
    finished: 'Finalisé',
    late: 'Retard',
    in_progress: 'En cours',
    not_started: 'À démarrer',
  },
  actionBuckets: {
    late: 'En retard',
    today: "Aujourd'hui",
    followUps: 'Relances',
    next7Days: '7 prochains jours',
    appointmentsToSet: 'RDV à fixer',
    empty: 'Tout est à jour',
  },
};

export default fr;
export type Messages = typeof fr;
