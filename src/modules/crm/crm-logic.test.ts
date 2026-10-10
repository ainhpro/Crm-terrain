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
    expect(r.rows.find((x) => x.line === 3)!.issues).toEqual(['nom manquant']);
    expect(r.rows.find((x) => x.line === 4)!.duplicateOf).toBe(2);
    expect(r.rows.find((x) => x.line === 5)!.issues).toEqual(['catégorie différente de A, B ou C']);
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
