import { describe, expect, it } from 'vitest';
import { INDA_GROUPS, INDA_PIPELINES } from '../templates/inda';
import { matchLegacyType, migratePrototypeBackup } from './prototype-backup';

describe('matchLegacyType', () => {
  it.each([
    ['FACQ', 'RDV Mise à jour showroom', 'FACQ_MAJ', 'rdv'],
    ['FACQ', 'Mise à jour Showroom', 'FACQ_MAJ', 'rdv'],
    ['FACQ', 'MAU — RDV', 'FACQ_MAJ', 'rdv'],
    ['FACQ', 'Offre Showroom envoyée', 'FACQ_MAJ', 'offre'],
    ['FACQ', 'MAJ — Commande', 'FACQ_MAJ', 'commande'],
    ['FACQ', 'Placement / Installation', 'FACQ_MAJ', 'placement'],
    ['FACQ', 'Livraison Tarifs', 'FACQ_TAR', 'tarif'],
    ['FACQ', 'Formation Meubles', 'FACQ_TAR', 'formation_meubles'],
    ['FACQ', 'Formation Parois', 'FACQ_TAR', 'formation_parois'],
    ['STG', 'RDV Responsable showroom', 'STG_PLACE', 'rdv'],
    ['STG', 'Étude Projet', 'STG_PLACE', 'proposition'],
    ['STG', 'Offre showroom', 'STG_PLACE', 'proposition'],
    ['STG', 'PLACEMENT — Commande', 'STG_PLACE', 'commande'],
    ['STG', 'Placement / Installation', 'STG_PLACE', 'placement'],
    ['STG', 'Formation Parois', 'STG_FORM', 'formation'],
    ['SAMO', 'Formation nouveautés produits', 'SAMO', 'formation'],
    ['SAMO', 'Livraison Tarifs SAMO', 'SAMO', 'tarif'],
  ])('%s « %s » → %s.%s', (client, type, pipelineCode, stepCode) => {
    expect(matchLegacyType(client, type)).toEqual({ pipelineCode, stepCode });
  });

  it('laisse non classés les suivis et les types inconnus', () => {
    expect(matchLegacyType('FACQ', 'Suivi / Note')).toBeNull();
    expect(matchLegacyType('INCONNU', 'Commande passée')).toBeNull();
  });
});

describe('migratePrototypeBackup', () => {
  it('convertit statuts, dates vides et écarte CUIS', () => {
    const result = migratePrototypeBackup({
      entries: [
        { id: 1, client: 'FACQ', showroom: 'Geel', type: 'Commande passée', statut: 'Terminé', date: '', note: 'ok' },
        { id: 2, client: 'STG', showroom: 'Zele', type: 'Suivi / Note', statut: 'RDV fixé', date: '2026-10-12' },
        { id: 3, client: 'CUIS', showroom: 'X', type: 'Commande', statut: 'Terminé' },
      ],
    });
    expect(result).toEqual([
      {
        legacyId: 1, groupCode: 'FACQ', siteName: 'Geel', pipelineCode: 'FACQ_MAJ', stepCode: 'commande',
        status: 'done', date: null, note: 'ok', legacyType: 'Commande passée', legacyStatus: 'Terminé', issues: [],
      },
      {
        legacyId: 2, groupCode: 'STG', siteName: 'Zele', pipelineCode: null, stepCode: null,
        status: 'appointment_set', date: '2026-10-12', note: '', legacyType: 'Suivi / Note', legacyStatus: 'RDV fixé', issues: [],
      },
    ]);
  });

  it('signale statuts inconnus, dates impossibles et doublons au lieu de les masquer', () => {
    const [a, b, c] = migratePrototypeBackup({
      entries: [
        { id: 7, client: 'FACQ', showroom: 'Geel', type: 'Commande', statut: 'Terminé ', date: '2026-02-30' },
        { id: 7, client: 'FACQ', showroom: 'Geel', type: 'Commande', statut: 'constructor' },
        { id: 8, client: 'FACQ', showroom: 'Geel', type: 'Commande', statut: '__proto__' },
      ],
    });
    expect(a!.status).toBe('done'); // espace final toléré
    expect(a!.date).toBeNull();
    expect(a!.issues).toEqual(['date invalide : « 2026-02-30 »']);
    expect(b!.issues).toEqual(['statut inconnu : « constructor »', 'identifiant en double : 7']);
    expect(c!.issues).toEqual(['statut inconnu : « __proto__ »']);
    expect(c!.legacyStatus).toBe('__proto__');
  });

  it('refuse une sauvegarde mal formée', () => {
    expect(() => migratePrototypeBackup({ entries: 'oops' })).toThrow(/liste/);
  });

  it('accepte une sauvegarde vide', () => {
    expect(migratePrototypeBackup({})).toEqual([]);
  });
});

describe('modèle INDA', () => {
  it('chaque règle de reprise pointe vers une étape existante du modèle', () => {
    const known = new Set(INDA_PIPELINES.flatMap((p) => p.steps.map((s) => `${p.code}.${s.code}`)));
    const samples: [string, string][] = [
      ['FACQ', 'RDV Mise à jour'], ['FACQ', 'Offre Showroom'], ['FACQ', 'Commande'], ['FACQ', 'Placement'],
      ['FACQ', 'Formation Meubles'], ['FACQ', 'Formation Parois'], ['STG', 'RDV Responsable'],
      ['STG', 'Proposition'], ['STG', 'Commande'], ['STG', 'Placement'], ['STG', 'Formation Meubles'],
      ['SAMO', 'Livraison Tarifs'], ['SAMO', 'Formation'],
    ];
    for (const [client, type] of samples) {
      const m = matchLegacyType(client, type);
      expect(m && known.has(`${m.pipelineCode}.${m.stepCode}`)).toBe(true);
    }
  });

  it('codes d’étapes uniques par pipeline et groupes existants', () => {
    const groups = new Set(INDA_GROUPS.map((g) => g.code));
    for (const p of INDA_PIPELINES) {
      expect(groups.has(p.groupCode ?? '')).toBe(true);
      const codes = p.steps.map((s) => s.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});
