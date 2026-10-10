# CLAUDE.md — CRM commercial terrain

Application modulaire, mobile-first et vocal-first, pour commerciaux terrain et techniciens SAV indépendants (1 à 3 personnes) en Belgique (FR/NL), Luxembourg, puis France. Une seule application, deux profils : commercial, technicien, ou les deux. Choisi une seule fois à l'inscription, modifiable ensuite seulement dans Réglages › Profil.
Promesse : « Tu sors de chez le client, tu parles une minute, et tout est à jour. »

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

Ne rien construire des modules prévus sans demande explicite. Chaque module s'active par compte (`organizations.modules actifs`).

**Hors périmètre définitif** : facturation, comptabilité, gestion de stock. L'outil s'arrête à l'offre et au bon d'intervention ; la facture se fait dans l'outil de facturation existant, auquel on envoie le bon d'intervention.

## Pile technique

| Brique | Choix |
|---|---|
| Application | Next.js + TypeScript, PWA installable |
| Hébergement | Vercel, région Europe |
| Base, auth, fichiers | Supabase, région Francfort (Postgres + RLS + Storage) |
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
2. **Le serveur est le seul intermédiaire** : le téléphone ne contacte jamais directement l'IA ni les fournisseurs. Clés d'API uniquement côté serveur (jamais de secret en `NEXT_PUBLIC_`).
3. **Prix, totaux et durées calculés par le code, jamais par l'IA.**
4. **L'IA ne modifie jamais rien sans validation** de l'utilisateur (rapport vocal, import, catalogue : on propose, l'utilisateur valide).
5. **Statut de pipeline jamais stocké** : recalculé à partir des actions par `src/modules/crm/pipeline/engine.ts`. Une étape avancée terminée valide les étapes précédentes.
6. **Étapes identifiées par leur `code`**, jamais par le texte du libellé.
7. **Aucun texte utilisateur injecté tel quel dans la page** (pas de `dangerouslySetInnerHTML` sur des données utilisateur — faille du prototype).
8. **FR et NL dès la V1** : aucun texte d'interface en dur, tout passe par les fichiers de langue.
9. **Dates** : jours au format ISO `AAAA-MM-JJ` ; « aujourd'hui » est passé en paramètre aux fonctions métier (testable, pas de décalage de fuseau).
10. **RGPD** : données en UE autant que possible ; export complet et suppression de compte possibles ; audios supprimables après transcription.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Application en local (http://localhost:3000) |
| `npm test` | Tests unitaires (logique métier, traductions) |
| `npm run test:db` | Tests d'isolation sur un Postgres jetable (`initdb` local, ou `DATABASE_URL`) |
| `npm run typecheck` / `npm run build` | Vérification TypeScript / build de production |

## Structure

```
src/app/                 écrans Next.js (App Router)
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

1. Dépôt GitHub, projet Supabase (Francfort), projet Vercel. *(dépôt fait ; Supabase et Vercel en attente)*
2. Socle : comptes, organisations, clients, groupes, contacts, isolation testée. *(schéma, RLS et tests faits en local ; reste le branchement Supabase et les écrans de connexion)*
3. Pipelines configurables et calcul des étapes déduites ; pipelines INDA comme premier modèle. *(moteur de calcul et modèle INDA faits, reste la base et les écrans)*
4. Import Excel avec reconnaissance des colonnes par l'IA ; import des clients INDA (+ reprise de la sauvegarde du prototype, convertisseur fait).
5. Écrans selon la maquette : Bienvenue (importer ou ajouter), Aujourd'hui, Clients, Fiche client, Compte rendu vocal.
6. Rapport vocal : enregistrement, transcription, structuration, validation.
7. Tâches, relances automatiques (A : 6 semaines, B : 2 mois, C : 3 mois, réglables), email du matin.
7 bis. Profil technicien : choix du profil à l'inscription, interventions (demande depuis un email, heures, photos, vocal, signature, pièces à commander par photo de notice ou dictée, suivi jusqu'à réception et retour chez le client), bon d'intervention PDF et envoi vers l'outil de facturation.
8. Traduction néerlandaise complète.
9. Fabrice utilise la V1 seul pendant 3 à 4 semaines.
10. Audit sécurité, puis ouverture à 3 testeurs payants.

## Questions ouvertes

Nom du produit et domaine · outils de facturation à connecter en premier · SMS ou email pour prévenir le client · structure juridique (AINHPRO SRL ou nouvelle société) · trois premiers testeurs · fournisseur de transcription · contenu exact du module « faisabilité d'offres ».
