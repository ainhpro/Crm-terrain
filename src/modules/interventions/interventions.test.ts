import { describe, expect, it } from 'vitest';
import { defaultOptions, readOptions } from './options';
import { looksLikeArrival, needStatus, readyForReturn } from './parts';
import { formatMinutes, parseEuroToCents, priceForRecipient, priceVisit, roundUp, withVat } from './pricing';
import { extractTicketNumbers } from './references';
import { parseRequestEmail } from './request';

const at = (hhmm: string, day = '2026-10-14') => new Date(`${day}T${hhmm}:00+02:00`);

describe('prix et durées (M07)', () => {
  it("exemple de la démo : 50 €/h, 10:04 → 11:21, arrondi au quart d'heure", () => {
    const r = priceVisit([{ arrivedAt: at('10:04'), leftAt: at('11:21'), breakMinutes: 0 }], {
      mode: 'hourly', hourlyRateCents: 5000, vatRateBp: 2100, roundingMinutes: 15,
    });
    expect(r.presenceMinutes).toBe(77);
    expect(r.billableMinutes).toBe(90);
    expect(r.amountExclCents).toBe(7500);
    expect(r.amountInclCents).toBe(9075);
  });

  it('sans arrondi (1 minute) : 77 min à 50 €/h = 64,17 €', () => {
    const r = priceVisit([{ arrivedAt: at('10:04'), leftAt: at('11:21'), breakMinutes: 0 }], {
      mode: 'hourly', hourlyRateCents: 5000, vatRateBp: 2100, roundingMinutes: 1,
    });
    expect(r.amountExclCents).toBe(6417);
  });

  it('pauses déduites, deux intervenants additionnés, passage de minuit', () => {
    const r = priceVisit(
      [
        { arrivedAt: at('09:00'), leftAt: at('12:00'), breakMinutes: 30 },
        { arrivedAt: new Date('2026-10-14T23:30:00+02:00'), leftAt: new Date('2026-10-15T00:40:00+02:00'), breakMinutes: 0 },
      ],
      { mode: 'hourly', hourlyRateCents: 6000, vatRateBp: 2100, roundingMinutes: 15 },
    );
    expect(r.presenceMinutes).toBe(180 + 70);
    expect(r.billableMinutes).toBe(150 + 75);
    expect(r.amountExclCents).toBe(22500);
  });

  it('changement d’heure (25 octobre 2026) : durée réelle, pas l’écart des horloges', () => {
    const r = priceVisit([{ arrivedAt: new Date('2026-10-25T01:30:00+02:00'), leftAt: new Date('2026-10-25T02:30:00+01:00'), breakMinutes: 0 }], {
      mode: 'none', vatRateBp: 2100, roundingMinutes: 1,
    });
    expect(r.presenceMinutes).toBe(120);
  });

  it('forfait, sans prix, heures incomplètes', () => {
    expect(priceVisit([], { mode: 'flat', flatCents: 8000, vatRateBp: 600, roundingMinutes: 15 }).amountInclCents).toBe(8480);
    expect(priceVisit([], { mode: 'none', vatRateBp: 2100, roundingMinutes: 15 }).amountExclCents).toBeNull();
    expect(priceVisit([{ arrivedAt: at('10:00'), leftAt: null, breakMinutes: 0 }], { mode: 'hourly', hourlyRateCents: 5000, vatRateBp: 2100, roundingMinutes: 15 }).amountExclCents).toBe(0);
  });

  it('arrondis aux limites', () => {
    expect(roundUp(0, 15)).toBe(0);
    expect(roundUp(15, 15)).toBe(15);
    expect(roundUp(16, 15)).toBe(30);
    expect(withVat(1, 2100)).toBe(1);
    expect(withVat(5, 2100)).toBe(6);
    expect(formatMinutes(77)).toBe('1 h 17');
  });

  it('ce que voit chaque destinataire (R02)', () => {
    const r = { presenceMinutes: 0, billableMinutes: 0, amountExclCents: 7500, amountInclCents: 9075 };
    expect(priceForRecipient(r, 'principal', 'principal')).toEqual({ label: 'excl', cents: 7500 });
    expect(priceForRecipient(r, 'client', 'principal')).toBeNull(); // le particulier ne voit pas le tarif négocié
    expect(priceForRecipient(r, 'client', 'client')).toEqual({ label: 'incl', cents: 9075 });
  });

  it('lit les montants saisis', () => {
    expect(parseEuroToCents('50')).toBe(5000);
    expect(parseEuroToCents('50,5')).toBe(5050);
    expect(parseEuroToCents('1.234,56 €')).toBe(123456);
    expect(parseEuroToCents('12.5')).toBe(1250);
    expect(parseEuroToCents('abc')).toBeNull();
  });
});

describe('tickets dans les emails', () => {
  it('lit les formats courants, sans doublon', () => {
    expect(extractTicketNumbers('Ticket 2026-0457 — SAV paroi de douche')).toEqual(['2026-0457']);
    expect(extractTicketNumbers('SAV n° 2026-0457', 'Rappel ticket 2026-0457')).toEqual(['2026-0457']);
    expect(extractTicketNumbers('Dossier : AB-1234 et réf. 8812')).toEqual(['AB-1234', '8812']);
    expect(extractTicketNumbers('Bon nr 77801')).toEqual(['77801']);
    expect(extractTicketNumbers('Problème de douche, merci')).toEqual([]);
  });
});

describe('pièces (M06)', () => {
  it('statut par besoin et retour seulement quand tout est reçu', () => {
    const a = { quantity: 2, cancelled: false, orderedQuantity: 2, receivedQuantity: 1 };
    const b = { quantity: 1, cancelled: false, orderedQuantity: 1, receivedQuantity: 1 };
    expect(needStatus(a)).toBe('partially_received');
    expect(needStatus(b)).toBe('received');
    expect(needStatus({ ...a, orderedQuantity: 0, receivedQuantity: 0 })).toBe('needed');
    expect(readyForReturn([a, b])).toBe(false);
    expect(readyForReturn([{ ...a, receivedQuantity: 2 }, b])).toBe(true);
    expect(readyForReturn([{ ...a, cancelled: true }, b])).toBe(true);
    expect(readyForReturn([])).toBe(false);
  });

  it('reconnaît un email annonçant une réception', () => {
    expect(looksLikeArrival('Ticket 2026-0457 — pièce disponible')).toBe(true);
    expect(looksLikeArrival('De machine is geleverd')).toBe(true);
    expect(looksLikeArrival('Pouvez-vous rappeler le client ?')).toBe(false);
  });
});

describe('lecture d’une demande par email (E02)', () => {
  const body = `Bonjour,
Mme Exemple signale que le joint de sa paroi de douche fuit.
Adresse : Rue de la Station 12, 1000 Bruxelles
Tél. 0475 12 34 56 — exemple@mail.test
Installée il y a 8 mois, sous garantie.
Cordialement`;
  const r = parseRequestEmail('Ticket 2026-0457 — SAV paroi de douche', body);

  it('extrait chaque champ avec sa source', () => {
    expect(r.tickets.value).toEqual(['2026-0457']);
    expect(r.phone.value).toBe('0475 12 34 56');
    expect(r.email.value).toBe('exemple@mail.test');
    expect(r.postalAddress.value).toContain('1000 Bruxelles');
    expect(r.warranty.value).toBe('yes');
    expect(r.warranty.source).toContain('garantie');
    expect(r.language.value).toBe('fr');
    expect(r.problem.value).toContain('joint');
  });

  it('les champs incertains sont marqués à confirmer', () => {
    expect(r.postalAddress.confident).toBe(false);
    expect(r.warranty.confident).toBe(false);
  });

  it('hors garantie et néerlandais', () => {
    const nl = parseRequestEmail('Herstelling', 'De klant heeft een lek aan de douche. Niet meer onder garantie. Graag een afspraak.');
    expect(nl.warranty.value).toBe('no');
    expect(nl.language.value).toBe('nl');
  });
});

describe('options par technicien', () => {
  it('un technicien showroom seul : ni pièces ni garantie', () => {
    expect(defaultOptions(['showroom'])).toEqual({ parts: false, pricing: true, signature: true, warranty: false });
    expect(defaultOptions(['sav', 'showroom'])).toEqual({ parts: true, pricing: true, signature: true, warranty: true });
  });
  it('lit des options partielles ou invalides', () => {
    expect(readOptions({ parts: false })).toEqual({ parts: false, pricing: true, signature: true, warranty: true });
    expect(readOptions(null).parts).toBe(true);
  });
});
