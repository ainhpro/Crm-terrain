import { describe, expect, it } from 'vitest';
import { dueFollowUps } from './followups';
import { buildImport, parseCsv, proposeMapping } from './import/columns';
import { findDate, structureReport } from './report/structure';

const TODAY = '2026-10-12';

describe('import : colonnes', () => {
  it('reconnaît les en-têtes FR et NL', () => {
    expect(proposeMapping(['Magasin', 'Enseigne', 'Adres', 'Tel', 'Opm.', 'Code postal', 'Gemeente', 'Catégorie'])).toEqual([
      'name', 'group', 'address', 'phone', null, 'postalCode', 'city', 'category',
    ]);
  });

  it('bilan complet : toutes les lignes, anomalies, doublons dans le fichier et avec l’existant', () => {
    const rows = [
      ['Geel', 'FACQ', 'A'],
      ['', 'FACQ', 'B'],
      ['Geel', 'FACQ', 'A'],
      ['Zele', 'STG', 'D'],
      ['', '', ''],
      ...Array.from({ length: 20 }, (_, i) => [`Client ${i}`, 'X', 'C']),
      ['Hasselt', 'FACQ', 'b'],
    ];
    const r = buildImport(rows, ['name', 'group', 'category'], new Set(['hasselt|']));
    expect(r.rows).toHaveLength(25);
    expect(r.empty).toBe(1);
    expect(r.rows.find((x) => x.line === 3)!.issues).toEqual(['missingName']);
    expect(r.rows.find((x) => x.line === 4)!.duplicateOf).toBe(2);
    // Catégorie inconnue : importée sans catégorie, avec avertissement (relecture I03).
    expect(r.rows.find((x) => x.line === 5)!.issues).toEqual([]);
    expect(r.rows.find((x) => x.line === 5)!.warnings).toEqual(['unknownCategory']);
    expect(r.rows.find((x) => x.line === 5)!.values.category).toBeUndefined();
    const last = r.rows[r.rows.length - 1]!;
    expect(last.line).toBe(27); // erreur après la dixième ligne : bien vue
    expect(last.duplicateOf).toBe('existing');
    expect(last.values.category).toBe('B');
    expect(r.duplicates).toBe(2);
  });

  it('refuse un fichier sans colonne de nom ou trop volumineux', () => {
    expect(() => buildImport([['x']], ['city'])).toThrow(/nom/);
    expect(() => buildImport(Array.from({ length: 5001 }, () => ['x']), ['name'])).toThrow(/volumineux/);
  });

  it('lit un CSV avec point-virgule, guillemets et retour à la ligne', () => {
    expect(parseCsv('﻿Nom;Ville\r\n"Dupont; fils";"Courtrai"\n"Dit ""ok""";Gent\n')).toEqual([
      ['Nom', 'Ville'],
      ['Dupont; fils', 'Courtrai'],
      ['Dit "ok"', 'Gent'],
    ]);
  });
});

describe('relances', () => {
  it('A tous les 42 jours depuis la dernière visite, sinon depuis l’ajout ; les plus en retard d’abord', () => {
    const due = dueFollowUps(
      [
        { id: 'a', category: 'A', lastVisit: '2026-08-20', createdOn: '2026-01-01' },
        { id: 'b', category: 'B', lastVisit: '2026-09-01', createdOn: '2026-01-01' },
        { id: 'c', category: 'C', lastVisit: null, createdOn: '2026-07-10' },
        { id: 'd', category: null, lastVisit: null, createdOn: '2020-01-01' },
      ],
      TODAY,
    );
    expect(due.map((d) => d.clientId)).toEqual(['a', 'c']);
    expect(due[0]).toEqual({ clientId: 'a', dueOn: '2026-10-01', daysLate: 11 });
    expect(due[1]!.dueOn).toBe('2026-10-08');
  });
});

describe('compte rendu dicté', () => {
  const steps = [
    { id: 's1', code: 'rdv', label: 'RDV mise à jour showroom' },
    { id: 's2', code: 'offre', label: 'Offre showroom envoyée' },
    { id: 's3', code: 'commande', label: 'Commande passée' },
    { id: 's4', code: 'placement', label: 'Placement / installation' },
  ];

  it('dates relatives et absolues', () => {
    expect(findDate('rappeler le 26 octobre', TODAY)).toBe('2026-10-26');
    expect(findDate('passer le 3 janvier', TODAY)).toBe('2027-01-03');
    expect(findDate('relancer dans deux semaines', TODAY)).toBe('2026-10-26');
    expect(findDate('bellen over 3 dagen', TODAY)).toBe('2026-10-15');
    expect(findDate('demain', TODAY)).toBe('2026-10-13');
    expect(findDate('sans date', TODAY)).toBeNull();
  });

  it('propose étape, tâches et résumé à partir du texte', () => {
    const r = structureReport(
      "Je sors de chez FACQ Geel. Le responsable a confirmé la commande. Livraison souhaitée début novembre. Il faut planifier le placement le 3 novembre. Prévoir la formation parois dans deux semaines.",
      steps,
      TODAY,
    );
    expect(r.stepDone?.code).toBe('commande');
    expect(r.tasks.map((t) => [t.text, t.dueOn])).toEqual([
      ['Il faut planifier le placement le 3 novembre', '2026-11-03'],
      ['Prévoir la formation parois dans deux semaines', '2026-10-26'],
    ]);
    expect(r.summary).toContain('confirmé la commande');
  });
});

describe('compte rendu dicté : relecture M02', () => {
  const TODAY2 = '2026-10-12';
  const deal = (group: string, name: string) => [
    { id: `${group}:1`, code: 'contact', label: `Premier contact (${name})`, stepLabel: 'Premier contact', group },
    { id: `${group}:2`, code: 'offre', label: `Offre envoyée (${name})`, stepLabel: 'Offre envoyée', group },
    { id: `${group}:3`, code: 'commande', label: `Commande (${name})`, stepLabel: 'Commande', group },
  ];

  it('une négation ou un futur ne valident pas l’étape, et la phrase est montrée', () => {
    for (const text of ["Je n'ai pas envoyé l'offre.", "L'offre sera envoyée lundi.", "Offre pas encore envoyée.", 'De offerte is nog niet verstuurd.']) {
      const r = structureReport(text, deal('d1', 'Vente 2026'), TODAY2);
      expect(r.stepDone, text).toBeNull();
    }
    expect(structureReport("Je n'ai pas envoyé l'offre.", deal('d1', 'Vente 2026'), TODAY2).notDone).toEqual(["Je n'ai pas envoyé l'offre."]);
  });

  it('une affirmation simple est proposée', () => {
    const r = structureReport("J'ai envoyé l'offre ce matin.", deal('d1', 'Vente 2026'), TODAY2);
    expect(r.stepDone?.id).toBe('d1:2');
    expect(r.stepSource).toBe("J'ai envoyé l'offre ce matin.");
  });

  it('deux affaires possibles : rien n’est choisi, les deux sont proposées', () => {
    const r = structureReport("Offre envoyée.", [...deal('d1', 'Cuisine'), ...deal('d2', 'Salle de bain')], TODAY2);
    expect(r.stepDone).toBeNull();
    expect(r.candidates.map((c) => c.id)).toEqual(['d1:2', 'd2:2']);
  });

  it('une étape ajoutée ou renommée par l’utilisateur est reconnue par son libellé', () => {
    const steps = [{ id: 'd1:9', code: 'visite_technique', label: 'Visite technique (Rénovation)', stepLabel: 'Visite technique', group: 'd1' }];
    expect(structureReport('Visite technique faite avec le chef de chantier.', steps, TODAY2).stepDone?.id).toBe('d1:9');
    // « Premier » seul ne suffit pas à reconnaître « Premier contact ».
    expect(structureReport('Premier passage terminé.', deal('d1', 'X'), TODAY2).stepDone).toBeNull();
  });
});
