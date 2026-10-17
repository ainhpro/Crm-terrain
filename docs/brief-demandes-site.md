# Consigne : les demandes du site arrivent toutes seules dans le CRM

À lancer **seulement quand le CRM est en ligne** (Supabase branché, connexion qui marche sur le téléphone) et après le « go » de Fabrice.
Une seule fonctionnalité, en trois lots, chacun relu avant le suivant.

## Pourquoi

Aujourd'hui, une demande de visite ou de devis remplie sur le site (formulaires WordPress « demande de visite » FR, NL et accueil)
n'existe que dans l'email de notification WPForms reçu sur la boîte de l'entreprise : WPForms Lite n'enregistre pas les entrées,
et ces formulaires ne vont pas dans Brevo (seuls les formulaires « guide » y vont). Une demande peut donc se perdre ou attendre.

But : chaque demande devient, dans le CRM, un client (ou est rattachée au client existant), une affaire ouverte et une tâche
« Rappeler » datée du jour, visible dans **Aujourd'hui**. Rien d'autre ne change dans le parcours du visiteur.

Les inscriptions au **guide** restent dans Brevo (séquence d'emails) et n'entrent pas dans le CRM : ce sont des curieux, pas
encore des demandes.

## Règles à respecter (CLAUDE.md)

- Produit neutre : aucun nom d'entreprise, de produit ou de formulaire dans le code du CRM. Les numéros de formulaires restent
  côté WordPress. Côté CRM, la fonction s'appelle « Demandes du site web ».
- Règle 2 : la réception est un **traitement nommé** (« réception des demandes ») qui utilise `withService` et vérifie
  lui-même l'organisation à partir du jeton. Tout le reste passe par `withUser`.
- Règle 1 et 11 : nouvelle table avec `organization_id`, RLS, droits retirés puis accordés, test d'isolation dans `tests/db/`.
- Règle 4 : rien n'est envoyé au visiteur par le CRM. On crée seulement des données internes.
- Règle 8 : textes FR et NL dans les fichiers de langue.
- Règle 9 : « aujourd'hui » passé en paramètre aux fonctions métier.
- Avant chaque push : `npm run typecheck`, `npm test`, `npm run test:db`.

## Lot A — CRM : recevoir une demande

1. **Réglages › Site web** (propriétaire seulement) :
   - bouton « Créer une clé de réception » : la clé est affichée **une seule fois**, seule son empreinte (SHA-256) est gardée ;
     « Remplacer la clé » rend l'ancienne inutilisable ;
   - choix du parcours de vente où ouvrir les affaires (par défaut le premier) ;
   - adresse à donner au site : `https://<site>/api/demandes`.
2. **Route `POST /api/demandes`** :
   - en-tête `Authorization: Bearer <clé>` ; comparaison en temps constant ; 401 sans détail sinon ;
   - corps JSON limité à 20 Ko : `id` (identifiant unique de l'envoi, fourni par le site), `nom`, `prenom`, `email`,
     `telephone`, `commune`, `code_postal`, `message`, `langue` (`fr`|`nl`), `source`, `utm_campaign`, `utm_content`,
     `formulaire` (texte libre, affiché tel quel), `recu_le` (ISO) ;
   - validation stricte (zod) : longueurs bornées, email valide si présent, au moins un moyen de contact (email ou téléphone) ;
   - **sans doublon** : même `id` reçu deux fois → 200 avec le même résultat, rien de créé en plus
     (`unique (organization_id, external_id)`).
3. **Ce qui est créé**, en une transaction :
   - une ligne dans une nouvelle table `web_requests` (ou extension de `inbound_messages` si plus simple : décider en lisant
     la migration 20261012000001, et le justifier) : données reçues, statut `new` / `handled` / `ignored` ;
   - client : rattaché au client existant de l'organisation qui a le même email ou le même téléphone (normalisé) ; sinon un
     nouveau client « particulier » (nom, commune, langue), avec un contact ;
   - affaire ouverte sur le parcours choisi, si le client n'en a pas déjà une ouverte sur ce parcours ;
   - une action « Rappeler — demande du site » à faire **le jour de réception**, avec le message du visiteur en note ;
   - jamais de texte injecté tel quel dans la page (règle 7).
4. **Écrans** :
   - **Aujourd'hui** : bloc « Nouvelles demandes du site » en haut, avec nom, commune, message court, boutons « Appeler » et
     « Ouvrir la fiche » ; la demande passe à « traitée » quand l'action « Rappeler » est faite ;
   - fiche client : la demande d'origine (date, source, message) dans l'historique ;
   - « Ignorer » (spam) : la demande disparaît, le client créé est supprimé s'il n'a rien d'autre.
5. **Tests** : unitaires (validation, rattachement email/téléphone, doublon), isolation (`tests/db/`), un parcours navigateur
   `tests/e2e/demandes.mjs` : clé créée → envoi simulé avec `curl` → la demande apparaît dans Aujourd'hui → rappel fait.
6. **RGPD** : les demandes sont dans l'export complet et supprimées avec l'entreprise (vérifier `buildExport` et `delete_organization`).

## Lot B — Site WordPress : envoyer les demandes au CRM

Pour le webmaster (Claude Code dans VS Code, dépôt Marketing-Ainhpro, branche du plan commercial, dossier `site/`).
Même méthode que `site/brevo/ainhpro-brevo-guide.php` v1.5 :

- nouveau mu-plugin `ainhpro-crm-demandes.php`, sur `wpforms_process_complete`, pour les formulaires de demande de visite
  (FR, NL, accueil) ; identifiant unique par envoi (UUID) ;
- adresse et clé dans un fichier séparé `ainhpro-crm-cle.php` (constantes `AINHPRO_CRM_URL`, `AINHPRO_CRM_KEY`), saisi par
  Fabrice, jamais dans le dépôt ;
- le visiteur ne voit jamais d'erreur : si le CRM ne répond pas, l'envoi attend et repart (15 min, 2 h, 12 h) par Action
  Scheduler, même `id` donc sans doublon ;
- utm repris comme pour Brevo (adresse de la page, sinon cookie `ainhpro_utm` avec accord) ;
- politique de confidentialité : ajouter le CRM comme destinataire des demandes (hébergement Supabase, Francfort) ;
- essais : PHP avec un faux CRM, puis un vrai envoi de test, supprimé ensuite.

## Lot C — Relances de devis (après usage réel des lots A et B)

Quand l'étape « Offre envoyée » est cochée sur une affaire, le CRM **propose** trois actions « Relancer le devis » à J+3, J+10
et J+21 (cases pré-cochées, l'utilisateur valide). Délais réglables dans Réglages. Les textes de relance existent déjà côté
marketing (`contenus/emails/relances-devis.md`) : en V1, l'utilisateur relance lui-même (appel ou email) ; l'envoi automatique
par Brevo viendra plus tard, sur décision.

## Hors périmètre

- Identifier des visiteurs anonymes du site, enregistrement de sessions (Hotjar…) : non conforme, et ne donne pas d'email.
- Envoi d'emails automatiques au visiteur par le CRM.
- Inscriptions au guide dans le CRM.
- Tout le module Prospection (listes, séquences).
