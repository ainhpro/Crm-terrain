import { describe, expect, it } from 'vitest';
import { cleanSubject, emailAddress, forwardedOriginal, htmlToText, inboundAddress, inboundTokens, MAX_ITEMS, MAX_TEXT, originOf, parseBrevoInbound } from './inbound';

const TOKEN = '0123456789abcdef0123';
const DOMAIN = 'reception.exemple.be';

describe('appel de la réception Brevo', () => {
  it('lit un email complet (format de la documentation Brevo)', () => {
    const [e] = parseBrevoInbound({
      items: [{
        Uuid: ['x'],
        MessageId: '<abc@mail.gmail.com>',
        From: { Name: 'Bureau SAV', Address: 'Bureau@Fabricant.example' },
        To: [{ Name: null, Address: `${TOKEN}@${DOMAIN}` }],
        Recipients: [`${TOKEN}@${DOMAIN}`],
        Cc: [],
        Subject: 'Ticket 45812 - fuite',
        RawTextBody: 'Bonjour,\r\nmerci d’intervenir.',
        RawHtmlBody: '<p>ignoré</p>',
        Attachments: [{ Name: 'photo.jpg', ContentType: 'image/jpeg', ContentLength: 2048, DownloadToken: 'secret' }],
      }],
    });
    expect(e).toEqual({
      messageId: '<abc@mail.gmail.com>',
      from: 'bureau@fabricant.example',
      recipients: [`${TOKEN}@${DOMAIN}`],
      subject: 'Ticket 45812 - fuite',
      text: 'Bonjour,\nmerci d’intervenir.',
      attachments: [{ name: 'photo.jpg', type: 'image/jpeg', size: 2048 }],
    });
  });

  it('accepte les destinataires en texte ou en objets, et garde l’enveloppe en premier', () => {
    const [e] = parseBrevoInbound({
      items: [{ Recipients: [`Réception <${TOKEN}@${DOMAIN}>`], To: [{ Address: 'technicien@exemple.be' }], Cc: 'autre@exemple.be', Subject: 'x' }],
    });
    expect(e!.recipients).toEqual([`${TOKEN}@${DOMAIN}`, 'technicien@exemple.be', 'autre@exemple.be']);
  });

  it('prend le HTML nettoyé quand il n’y a pas de texte', () => {
    const [e] = parseBrevoInbound({ items: [{ RawHtmlBody: '<style>p{}</style><p>Rue des Prés&nbsp;4<br>Wavre &amp; Ottignies</p><script>alert(1)</script>' }] });
    expect(e!.text).toBe('Rue des Prés 4\nWavre & Ottignies');
  });

  it('ignore ce qui n’est pas un appel valide, et limite la taille', () => {
    expect(parseBrevoInbound(null)).toEqual([]);
    expect(parseBrevoInbound({ items: 'non' })).toEqual([]);
    expect(parseBrevoInbound({ items: [null, 3, 'x'] })).toEqual([]);
    expect(parseBrevoInbound({ items: Array.from({ length: 50 }, () => ({ Subject: 's' })) })).toHaveLength(MAX_ITEMS);
    expect(parseBrevoInbound({ items: [{ RawTextBody: 'a'.repeat(MAX_TEXT + 10) }] })[0]!.text).toHaveLength(MAX_TEXT);
  });
});

describe('adresse de réception', () => {
  it('ne reconnaît que les jetons du domaine de réception', () => {
    expect(inboundAddress(TOKEN, ' Reception.Exemple.BE ')).toBe(`${TOKEN}@${DOMAIN}`);
    expect(inboundTokens([`${TOKEN}@${DOMAIN}`, `${TOKEN}@autre.be`, `demandes@${DOMAIN}`, `${TOKEN}0@${DOMAIN}`, `${TOKEN}@${DOMAIN}`], DOMAIN)).toEqual([TOKEN]);
    expect(inboundTokens(['technicien@exemple.be'], DOMAIN)).toEqual([]);
  });

  it('lit une adresse dans ses formes habituelles', () => {
    expect(emailAddress('Jean Dupont <Jean.Dupont@Exemple.be>')).toBe('jean.dupont@exemple.be');
    expect(emailAddress('mailto:a@b.be')).toBe('a@b.be');
    expect(emailAddress({ Address: 'a@b.be', Name: 'A' })).toBe('a@b.be');
    expect(emailAddress('pas une adresse')).toBeNull();
    expect(emailAddress(42)).toBeNull();
  });
});

describe('email transféré à la main', () => {
  it('Gmail en français', () => {
    const text = 'Peux-tu regarder ?\n\n---------- Message transféré ---------\nDe : Bureau SAV <sav@fabricant.example>\nDate : lun. 12 oct. 2026 à 09:14\nObjet : Ticket 45812 - adoucisseur\nÀ : <tech@exemple.be>\n\nBonjour...';
    expect(forwardedOriginal(text)).toEqual({ from: 'sav@fabricant.example', subject: 'Ticket 45812 - adoucisseur' });
  });

  it('Apple Mail, Outlook et néerlandais', () => {
    expect(forwardedOriginal('Début du message réexpédié :\n\nDe: Client <c@exemple.be>\nObjet: Panne\nDate: 12 octobre')).toEqual({ from: 'c@exemple.be', subject: 'Panne' });
    expect(forwardedOriginal('________________________________\nDe : Fournisseur <f@exemple.be>\nEnvoyé : lundi\nÀ : moi\nObjet : Pièce disponible')).toEqual({ from: 'f@exemple.be', subject: 'Pièce disponible' });
    expect(forwardedOriginal('-----Oorspronkelijk bericht-----\nVan: Klant <k@voorbeeld.be>\nOnderwerp: Storing ketel')).toEqual({ from: 'k@voorbeeld.be', subject: 'Storing ketel' });
    expect(forwardedOriginal('---------- Forwarded message ---------\nFrom: *Office* <o@x.com>\nSubject: *Job 778*')).toEqual({ from: 'o@x.com', subject: 'Job 778' });
  });

  it('un email ordinaire n’est pas un transfert', () => {
    expect(forwardedOriginal('Bonjour, de : notre part, merci.')).toBeNull();
  });

  it('expéditeur et objet d’origine, sinon ceux de l’email reçu', () => {
    expect(originOf({ from: 'tech@exemple.be', subject: 'TR: Panne', text: 'Début du message réexpédié :\nDe: Client <c@exemple.be>\nObjet: Panne chaudière' }))
      .toEqual({ from: 'c@exemple.be', subject: 'Panne chaudière' });
    // Règle de transfert automatique : l'en-tête From est déjà celui du donneur d'ordre.
    expect(originOf({ from: 'sav@fabricant.example', subject: 'Fwd: Fw: Ticket 9', text: 'Bonjour' })).toEqual({ from: 'sav@fabricant.example', subject: 'Ticket 9' });
  });

  it('objet sans préfixes de transfert, réponses gardées', () => {
    expect(cleanSubject('TR : Doorst: WG: Fwd: Ticket 12')).toBe('Ticket 12');
    expect(cleanSubject('RE: Ticket 12')).toBe('RE: Ticket 12');
    expect(cleanSubject('Transport : retard')).toBe('Transport : retard');
  });
});

describe('HTML en texte', () => {
  it('décode une seule fois les entités', () => {
    expect(htmlToText('<b>a &amp;lt; b</b> &#233;t&#xE9;')).toBe('a &lt; b été');
  });
});
