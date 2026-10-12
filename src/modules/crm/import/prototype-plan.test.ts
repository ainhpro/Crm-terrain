import { describe, expect, it } from 'vitest';
import { migratePrototypeBackup } from './prototype-backup';
import { legacyClientName, planPrototypeImport } from './prototype-plan';

const backup = {
  entries: [
    { id: 1, client: 'FACQ', showroom: 'Geel', type: 'MAJ — RDV Mise à jour Showroom', statut: 'Terminé', date: '2026-09-01' },
    { id: 2, client: 'FACQ', showroom: 'Geel', type: 'MAJ — Offre Showroom', statut: 'En cours', date: '2026-10-02', note: 'Attente prix' },
    { id: 3, client: 'SAMO', showroom: 'Dupont Ypres', type: 'Livraison Tarifs SAMO', statut: 'Terminé' },
    { id: 4, client: 'STG', showroom: 'Zele', type: 'Suivi visite', statut: 'Relance', date: '2026-10-20' },
    { id: 5, client: 'FACQ', showroom: 'Geel', type: 'Commande', statut: 'Inconnu' },
    { id: 6, client: 'CUIS', showroom: 'X', type: 'Ancien', statut: 'Terminé' },
  ],
};

describe('plan de reprise de l’ancien CRM', () => {
  it('noms des clients comme dans l’ancien CRM', () => {
    expect(legacyClientName('FACQ', 'Geel')).toEqual({ name: 'FACQ Geel', city: 'Geel' });
    expect(legacyClientName('SAMO', 'Dupont Ypres')).toEqual({ name: 'Dupont Ypres', city: null });
  });

  it('un client par magasin, une affaire par parcours, les anomalies comptées', () => {
    const plan = planPrototypeImport(migratePrototypeBackup(backup));
    expect(plan.clients.map((c) => c.name)).toEqual(['FACQ Geel', 'Dupont Ypres', 'STG Zele']);
    expect(plan.deals).toEqual([
      { clientKey: 'FACQ|facq geel', pipelineCode: 'FACQ_MAJ' },
      { clientKey: 'SAMO|dupont ypres', pipelineCode: 'SAMO' },
    ]);
    expect(plan.pipelines.map((p) => p.code)).toEqual(['FACQ_MAJ', 'SAMO']);
    expect(plan.groups.map((g) => g.code)).toEqual(['FACQ', 'SAMO', 'STG']);
    expect(plan.actions).toHaveLength(5); // CUIS écarté comme dans l'ancien CRM
    expect(plan.withIssues).toBe(1); // statut inconnu
    expect(plan.byGroup).toEqual({ FACQ: 3, SAMO: 1, STG: 1 });
  });
});
