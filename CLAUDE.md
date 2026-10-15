# CLAUDE.md — CRM commercial terrain

Application modulaire, mobile-first et vocal-first, pour commerciaux terrain et techniciens SAV indépendants (1 à 3 personnes) en Belgique (FR/NL), Luxembourg, puis France. Une seule application, deux profils : commercial, technicien, ou les deux. Choisi une seule fois à l'inscription, modifiable ensuite seulement dans Réglages › Profil.
Promesse : « Tu sors de chez le client, tu parles une minute, et tout est à jour. »

**Produit neutre** : aucun nom de client, de marque ou de secteur dans le code ni dans les fichiers de langue. Un nouveau compte reçoit le modèle neutre (`src/modules/crm/templates/standard.ts`, `src/modules/interventions/standard.ts`) et l'adapte dans Réglages. INDA (Fabrice) n'est qu'un modèle et un jeu de démonstration.

- **Sur un PC (Windows ou Mac)** : installation, configuration Supabase et Anthropic, lancement et test comme commercial dans [`docs/demarrage-pc.md`](docs/demarrage-pc.md) ; `npm run config:check` dit ce qui manque. Ne jamais lire ni afficher `.env.local`.
- Cahier des charges complet : [`docs/cahier-des-charges.md`](docs/cahier-des-charges.md). Le lire avant toute nouvelle fonctionnalité.
- Prototype de référence et analyse de sa logique : [`docs/prototype/`](docs/prototype/). On reprend sa logique métier, pas sa présentation.
- Démo des parcours (référence visuelle) : https://claude.ai/artifact/DcLwrC7uZNzpPL84Rpw4WF — sobre, professionnelle, utilisable d'une main. Ancienne maquette en tableau : https://claude.ai/artifact/3Toq3BYmhz39pY6EpjJz6U

## Modules

Tous les modules partagent le même fichier clients (organisations, clients, groupes, contacts). Un module n'accède jamais aux tables d'un autre module directement : il passe par les fonctions exposées dans `src/modules/<module>/`.

| Module | Dossier | Statut |
|---|---|---|
| CRM terrain (socle) | `src/modules/crm` | **En cours — V1** |
| Interventions (technicien SAV) | `src/modules/interventions` | **V1** (types d'intervention et donneurs d'ordre configurables, demande depuis un email, photos, heures, pièces à commander et suivi, rapport « fait / à commander / à faire » avec prix à l'heure ou au forfait, email préparé automatiquement au donneur d'ordre après validation, dossiers synchronisés téléphone et PC, recherche par numéro de ticket) |
| Prospection | `src/modules/prospection` | Prévu (listes, séquences d'emails, RGPD) |
| Faisabilité d'offres | `src/modules/offres` | Prévu (à spécifier : catalogue importé, offre PDF, prix calculés par le code) |
| Route (tournées, notes de frais) | `src/modules/route` | Prévu (V2) |

Avant de coder le module interventions, lire le § 6 ter du cahier des charges (dossier et passages, versions figées, envois sans doublon, hors réseau). États des dossiers SAV : ils peuvent être stockés (la règle « jamais stocké » ne concerne que le pipeline commercial).

Ne rien construire des modules prévus sans demande explicite. Chaque module s'active par compte (`organizations.modules actifs`), fixé à la création par la **formule de l'installation** (`FORMULE` dans `.env.local`, enregistrée en base par `npm run supabase:setup -- --apply`) : `complete` (CRM et interventions, profil au choix) ou `technicien` (interventions seulement : offre vendue aux techniciens SAV, rien du CRM visible ni utilisable). Pages et actions d'un module passent par `requireModule()` (`src/server/context.ts`).

**Hors périmètre définitif** : facturation, comptabilité, gestion de stock. L'outil s'arrête à l'offre et au bon d'intervention ; la facture se fait dans l'outil de facturation existant, auquel on envoie le bon d'intervention.

## Pile technique

| Brique | Choix |
|---|---|
| Application | Next.js + TypeScript, PWA installable |
| Hébergement | Vercel, région Europe |
| Base, auth, fichiers | Supabase, région Irlande — West EU (Postgres + RLS + Storage) |
| IA | API Claude (structuration des rapports, lecture des imports) |
| Transcription | Service vocal FR/NL/IT, hébergé en Europe de préférence (à choisir) |
| Cartes | Google Maps Platform |
| Agendas (V2) | Google Calendar API, Microsoft Graph |
| Stockage des rapports | Copie automatique des PDF dans OneDrive (Microsoft Graph) et Google Drive (API Drive) |
| Emails | Brevo |
| Paiement | Stripe Billing (carte, Bancontact, SEPA) |
| Traductions | Fichiers de langue FR / NL (IT ajouté sans toucher au code) |
| Tests | Vitest |

## Règles non négociables

1. **Isolation par compte** : toute table porte `organization_id`, protégée par Row Level Security Supabase. Chaque nouvelle table reçoit sa politique RLS et un test d'isolation.
2. **Le serveur est le seul intermédiaire** (accès base : `withUser` dans `src/server/db.ts`, qui reproduit l'identité Supabase ; `withService` seulement pour la connexion et les traitements nommés) : le téléphone ne contacte jamais directement l'IA ni les fournisseurs. Clés d'API uniquement côté serveur (jamais de secret en `NEXT_PUBLIC_`). Les opérations ordinaires du serveur s'exécutent **avec l'identité de l'utilisateur** (client Supabase avec son jeton) pour que la RLS s'applique ; la clé `service_role` (qui contourne la RLS) est réservée à quelques traitements nommés (abonnement, envois, réception d'emails) qui vérifient eux-mêmes l'organisation.
3. **Prix, totaux et durées calculés par le code, jamais par l'IA.**
4. **L'IA ne modifie jamais rien sans validation** de l'utilisateur (rapport vocal, import, catalogue : on propose, l'utilisateur valide).
5. **Statut de pipeline jamais stocké** : recalculé **par affaire** à partir de ses actions par `src/modules/crm/pipeline/engine.ts`. Une étape avancée terminée valide les étapes précédentes. Une seule définition d'« action réellement ouverte » pour urgences, retards et statuts.
6. **Étapes identifiées par leur `code`**, jamais par le texte du libellé.
7. **Aucun texte utilisateur injecté tel quel dans la page** (pas de `dangerouslySetInnerHTML` sur des données utilisateur — faille du prototype).
8. **FR et NL dès la V1** : aucun texte d'interface en dur, tout passe par les fichiers de langue.
9. **Dates** : jours au format ISO `AAAA-MM-JJ` ; « aujourd'hui » est passé en paramètre aux fonctions métier (testable, pas de décalage de fuseau).
10. **RGPD** : données en UE autant que possible ; export complet et suppression de compte possibles ; audios supprimables après transcription.
11. **Droits minimaux en base** : chaque migration retire puis accorde explicitement les droits (jamais de confiance dans les droits par défaut de Supabase) ; on n'entre dans une organisation que par invitation acceptée ; plan et modules ne sont modifiables que par le traitement d'abonnement.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run db:start` / `db:reset` / `db:migrate` | Base locale persistante (émulation Supabase, port 54322) et données de démonstration |
| `npm run dev` | Application en local (http://localhost:3000) ; connexion de développement par email (`AUTH_MODE=dev`) |
| `npm test` | Tests unitaires (logique métier, traductions) |
| `npm run test:db` | Tests d'isolation sur un Postgres jetable (`initdb` local, ou `TEST_DATABASE_URL` : base au nom unique créée puis supprimée, serveur local exigé ; `DATABASE_URL` n'est jamais utilisé) |
| `npm run typecheck` / `npm run build` | Vérification TypeScript / build de production |
| `npm run test:e2e` | Parcours complet dans un navigateur (app sur le port 3200) |
| `npm run config:check` / `config:secret` | Vérifie la configuration du poste (`.env.local`) sans rien afficher de secret / génère un `SESSION_SECRET` |
| `npm run supabase:migrate` / `supabase:setup` / `supabase:check` | Projet Supabase réel : migrations, configuration Auth et Storage, vérifications (sans `-- --apply`, rien n'est écrit) ; voir `docs/supabase.md` |
| `npm run test:e2e:connexion` | Connexion Supabase (lien + code) dans un navigateur |
| `npm run test:e2e:ia` | Compte rendu et lecture d'email par l'IA contre un faux service (voir l'en-tête du script) |
| `npm run test:e2e:envois` | Envoi des emails contre un faux Brevo : envoi, coupure « à vérifier », refus et renvoi (voir l'en-tête du script) |
| `npm run test:e2e:rgpd` | Export complet, suppression d'un compte et d'une entreprise dans un navigateur (après `db:reset` ; supprime des données de démonstration) |
| `npm run test:e2e:relecture` | Contrôles navigateur de la relecture V1 (après `db:reset` ; modifie la base de démonstration) |

## Structure

```
src/app/                 écrans Next.js (App Router) ; (app)/ = écrans connectés
src/server/              accès base via withUser (RLS), actions serveur, PDF, stockage privé
src/i18n/                langue : messages/fr.ts (référence) et messages/nl.ts (mêmes clés, vérifié par TypeScript)
src/modules/<module>/    logique métier par module, sans dépendance à Next.js ni à Supabase
supabase/migrations/     schéma de la base et politiques RLS
supabase/tests/          émulation locale de Supabase (rôles, auth.uid) — tests uniquement
tests/db/                tests d'isolation des comptes
docs/                    cahier des charges, prototype, analyses
```

## Méthode de travail

- Une fonctionnalité = une branche = une demande de fusion relue avant production.
- Avant chaque push : `npm run typecheck`, `npm test` et `npm run test:db` doivent passer (la CI GitHub les relance avec `npm run build`).
- Toute modification de la base passe par une nouvelle migration dans `supabase/migrations/` (jamais de modification d'une migration déjà fusionnée), avec ses politiques RLS et ses tests dans `tests/db/`.
- Tests obligatoires sur les points critiques : isolation des comptes, calcul du pipeline, calcul des prix.
- Trois environnements : développement, test, production.
- Interface pensée pour le téléphone, utilisable d'une main.

## Feuille de route V1 (module CRM)

**État au 10 octobre 2026** : application V1 fonctionnelle en local (commercial et technicien), vérifiée par un parcours navigateur complet. Reste à brancher : Supabase (Auth, base, Storage), Vercel, API Claude, transcription, Brevo, OneDrive / Google Drive. Relecture externe de la V1 traitée : `docs/revue/2026-10-10-relecture-v1-reponse.md` ; conditions du pilote : `docs/pilote-fabrice.md`. Branchement Supabase écrit et testé contre un faux Supabase (connexion par lien + code, Storage privé, scripts de migration et de vérification) : `docs/supabase.md`. RGPD (règle 10) : export complet et suppression de l'entreprise ou du compte dans Réglages › Vos données. Envoi des emails (Brevo) : traitement sans doublon, résultats incertains laissés à l'utilisateur (`docs/pilote-fabrice.md` § 3) ; reste la clé Brevo. IA (Claude, `src/server/ai/`) : compte rendu et lecture d'email, propositions revérifiées par le code (`ai-check.ts`) ; reste la clé Anthropic et le choix de la transcription.

1. Dépôt GitHub, projet Supabase (Irlande), projet Vercel. *(dépôt fait ; compte Supabase créé, projet et clés en attente ; code de branchement prêt ; Vercel en attente)*
2. Socle : comptes, organisations, clients, groupes, contacts, isolation testée. *(schéma, RLS et tests faits en local ; écrans de connexion Supabase faits ; reste le projet réel)*
3. Pipelines configurables et calcul des étapes déduites. *(moteur, modèle neutre à l'inscription, éditeur Réglages › Étapes de vente et modèle INDA faits)*
4. Import Excel avec reconnaissance des colonnes par l'IA ; exports d'autres CRM reconnus (Teamleader, Pipedrive, HubSpot, Odoo, Salesforce, Zoho) ; import des clients INDA (+ reprise de la sauvegarde du prototype, convertisseur fait).
5. Écrans selon la maquette : Bienvenue (importer ou ajouter), Aujourd'hui, Clients, Fiche client, Compte rendu vocal.
6. Rapport vocal : enregistrement, transcription, structuration, validation.
7. Tâches, relances automatiques (A : 6 semaines, B : 2 mois, C : 3 mois, réglables), email du matin.
7 bis. Profil technicien : choix du profil à l'inscription, interventions (demande depuis un email, heures, photos, vocal, signature, pièces à commander par photo de notice ou dictée, suivi jusqu'à réception et retour chez le client), bon d'intervention PDF et envoi vers l'outil de facturation.
8. Traduction néerlandaise complète.
9. Fabrice utilise la V1 seul pendant 3 à 4 semaines.
10. Audit sécurité, puis ouverture à 3 testeurs payants.

## Questions ouvertes

Nom du produit et domaine · outils de facturation à connecter en premier · SMS ou email pour prévenir le client · structure juridique (AINHPRO SRL ou nouvelle société) · trois premiers testeurs · fournisseur de transcription · contenu exact du module « faisabilité d'offres ».
