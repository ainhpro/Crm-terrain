import { describe, expect, it } from 'vitest';
import { buildImport, detectSource, parseCsv, proposeMapping } from './columns';
import { pipelineCodeFromName, STANDARD_PIPELINE, stepCodeFromLabel } from '../templates/standard';

describe('import depuis un autre CRM', () => {
  it('Pipedrive (personnes) : organisation = client, personne = contact', () => {
    const h = ['Person - Name', 'Person - Organization', 'Person - Email - Work', 'Person - Phone - Work', 'Person - Owner', 'Person - Label'];
    expect(proposeMapping(h)).toEqual(['contact', 'name', 'email', 'phone', null, null]);
    expect(detectSource(h)).toBe('pipedrive');
  });

  it('Pipedrive (organisations) : sous-champs d’adresse', () => {
    const h = ['Organization - Name', 'Organization - Address', 'Organization - Address - ZIP/Postal code of Address', 'Organization - Address - City/town/village/locality of Address', 'Organization - Owner'];
    expect(proposeMapping(h)).toEqual(['name', 'address', 'postalCode', 'city', null]);
  });

  it('HubSpot : le propriétaire et le domaine ne deviennent pas le client', () => {
    const h = ['Record ID', 'Company name', 'Company Domain Name', 'Phone Number', 'Street Address', 'City', 'Postal Code', 'Country/Region', 'Company owner'];
    expect(proposeMapping(h)).toEqual([null, 'name', null, 'phone', 'address', 'city', 'postalCode', null, null]);
    expect(detectSource(h)).toBe('hubspot');
  });

  it('Salesforce', () => {
    const h = ['Account Name', 'Billing Street', 'Billing City', 'Billing Zip/Postal Code', 'Billing Country', 'Phone', 'Account Owner'];
    expect(proposeMapping(h)).toEqual(['name', 'address', 'city', 'postalCode', null, 'phone', null]);
    expect(detectSource(h)).toBe('salesforce');
  });

  it('Odoo en français', () => {
    const h = ["Nom d'affichage", 'Rue', 'Code postal', 'Ville', 'Téléphone', 'Courriel', 'Est une société'];
    expect(proposeMapping(h)).toEqual(['name', 'address', 'postalCode', 'city', 'phone', 'email', null]);
    expect(detectSource(h)).toBe('odoo');
  });

  it('Teamleader en néerlandais : le numéro d’entreprise n’est pas un numéro de rue, le numéro rejoint l’adresse', () => {
    const h = ['Naam', 'Ondernemingsnummer', 'Straat', 'Huisnummer', 'Postcode', 'Gemeente', 'Land', 'Telefoon', 'E-mail'];
    const m = proposeMapping(h);
    expect(m).toEqual(['name', null, 'address', 'streetNumber', 'postalCode', 'city', null, 'phone', 'email']);
    expect(detectSource(h)).toBe('teamleader');
    const r = buildImport([['Bakkerij Peeters', 'BE0123456789', 'Kerkstraat', '12', '2000', 'Antwerpen', 'BE', '03 123 45 67', 'info@peeters.example']], m);
    expect(r.rows[0]!.values).toMatchObject({ name: 'Bakkerij Peeters', address: 'Kerkstraat 12', city: 'Antwerpen' });
    expect(r.valid).toBe(1);
  });

  it('prénom et nom séparés : « First Name » ne devient pas le nom du client', () => {
    const h = ['Company', 'First Name', 'Last Name', 'Email'];
    const m = proposeMapping(h);
    expect(m).toEqual(['name', 'firstName', 'lastName', 'email']);
    const r = buildImport([['Garage Lambert', 'Julie', 'Lambert', 'julie@lambert.example']], m);
    expect(r.rows[0]!.values).toEqual({ name: 'Garage Lambert', contact: 'Julie Lambert', email: 'julie@lambert.example' });
  });

  it('fichier maison : rien n’est reconnu comme un CRM', () => {
    expect(detectSource(['Client', 'Ville', 'Tel'])).toBeNull();
  });
});

describe('modèle neutre', () => {
  it('ne contient aucun nom de client ou de marque', () => {
    const text = JSON.stringify(STANDARD_PIPELINE).toLowerCase();
    for (const w of ['inda', 'facq', 'stg', 'samo', 'culligan', 'showroom']) expect(text).not.toContain(w);
  });

  it('codes d’étapes stables, uniques, sans accents', () => {
    expect(stepCodeFromLabel('Visite technique', [])).toBe('visite_technique');
    expect(stepCodeFromLabel('Étude & devis', [])).toBe('etude_devis');
    expect(stepCodeFromLabel('Rendez-vous', ['rendez_vous'])).toBe('rendez_vous_2');
    expect(stepCodeFromLabel('!!!', [])).toBe('etape');
    expect(pipelineCodeFromName('Location', ['VENTE', 'LOCATION'])).toBe('LOCATION_2');
  });
});

describe('export « une ligne par personne »', () => {
  it('ajoute les autres personnes au client de la première ligne, sans recréer le client', () => {
    const m = proposeMapping(['Person - Name', 'Person - Organization', 'Person - Email - Work']);
    const r = buildImport(
      [
        ['Julie Lambert', 'Garage Lambert', 'julie@lambert.example'],
        ['Marc Lambert', 'Garage Lambert', 'marc@lambert.example'],
        ['Marc Lambert', 'Garage Lambert', 'marc@lambert.example'],
      ],
      m,
    );
    expect(r.valid).toBe(1);
    expect(r.rows.map((x) => x.extraContact)).toEqual([false, true, false]);
    expect(r.extraContacts).toBe(1);
    expect(r.duplicates).toBe(1); // la ligne identique reste un doublon
  });
});

describe('relecture I01 / I03 : ressemblances et catégories', () => {
  const m = ['name', 'address', 'city', 'category'] as const;

  it('deux homonymes d’une même ville à des adresses différentes restent deux clients', () => {
    const r = buildImport(
      [
        ['Boulangerie Martin', 'Rue Haute 5', 'Namur', 'A'],
        ['Boulangerie Martin', 'Place Verte 2', 'Namur', 'B'],
      ],
      [...m],
      [{ name: 'Boulangerie Martin', city: 'Namur', address: 'Chaussée de Liège 40' }],
    );
    expect(r.rows.map((x) => x.duplicateOf)).toEqual([null, null]);
    expect(r.valid).toBe(2);
  });

  it('sans adresse pour trancher : ressemblance signalée, et l’utilisateur peut importer quand même', () => {
    const rows = [['Boulangerie Martin', '', 'Namur', 'A']];
    const existing = [{ name: 'Boulangerie Martin', city: 'Namur', address: 'Rue Haute 5' }];
    expect(buildImport(rows, [...m], existing).rows[0]!.duplicateOf).toBe('existing');
    const forced = buildImport(rows, [...m], existing, new Set([2]));
    expect(forced.rows[0]!.duplicateOf).toBeNull();
    expect(forced.rows[0]!.warnings).toEqual(['forced']);
    expect(forced.valid).toBe(1);
  });

  it('« VIP » n’empêche pas l’import et ne devient pas C', () => {
    const r = buildImport([['Garage Lambert', '', 'Liège', 'VIP']], [...m]);
    expect(r.valid).toBe(1);
    expect(r.rows[0]!.values.category).toBeUndefined();
    expect(r.rows[0]!.droppedCategory).toBe('VIP');
  });

  it('une cellule démesurée est refusée, accents et zéros initiaux des CSV préservés', () => {
    const csv = '﻿Nom;Ville;Code postal;Téléphone\n"Société ""Élan"" ; fils";Liège;0400;0470 12 34 56\n';
    const [h, ...rows] = parseCsv(csv) as [string[], ...string[][]];
    const r = buildImport(rows, proposeMapping(h));
    expect(r.rows[0]!.values).toEqual({ name: 'Société "Élan" ; fils', city: 'Liège', postalCode: '0400', phone: '0470 12 34 56' });
    expect(buildImport([['x'.repeat(5000)]], ['name']).rows[0]!.issues).toEqual(['tooLong']);
  });
});
