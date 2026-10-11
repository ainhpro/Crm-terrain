# Mise en service sur Supabase (Francfort) et Vercel

État au 11 octobre 2026 : le code de branchement est écrit et testé contre une copie locale qui imite Supabase. Il n'a encore jamais tourné contre le vrai projet : les clés ne sont pas encore disponibles.

## Ce qui est en place dans le code

| Brique | Fonctionnement | Fichiers |
|---|---|---|
| Connexion | Supabase Auth sans mot de passe : l'utilisateur reçoit **un lien et un code à 6 chiffres**. Le serveur vérifie auprès de Supabase, pose la session signée de l'application, puis ferme la session Supabase. Ouvrir le lien ne connecte pas : il faut appuyer sur un bouton, sinon les antivirus de messagerie consommeraient les liens. Dès que Supabase est configuré, la connexion par email seul est impossible, et un cookie de développement, même correctement signé, est refusé. | `src/server/supabase/auth.ts`, `src/server/actions/auth.ts`, `src/app/connexion/`, `src/app/auth/confirmer/`, `src/server/session.ts`, `src/server/session-token.ts` |
| Base | Même code qu'en local. `withUser` ouvre une transaction, passe au rôle `authenticated` et pose l'identité de l'utilisateur dans les claims, exactement comme l'API Supabase : la RLS s'applique. TLS vérifié avec le certificat de Supabase (`DATABASE_SSL_CA`, obligatoire en production). | `src/server/db.ts` |
| Fichiers | Supabase Storage, bucket privé `fichiers`. Traitement serveur nommé : seule la clé `service_role` y accède, et seulement après le contrôle RLS de la route qui sert le fichier. Chemins uniques, jamais écrasés. Le disque local reste refusé sur Vercel. | `src/server/supabase/storage.ts`, `src/server/storage.ts` |
| Hébergement | Fonctions Vercel en région Francfort (`fra1`). | `vercel.json` |

## Scripts

| Commande | Rôle | Écrit quelque chose ? |
|---|---|---|
| `npm run supabase:migrate` | Liste les migrations à appliquer | Non |
| `npm run supabase:migrate -- --apply` | Applique `supabase/migrations/*.sql` dans l'ordre, une transaction par fichier. Le suivi est tenu dans `supabase_migrations.schema_migrations`, la même table que la CLI Supabase. N'applique jamais l'émulation de test ni les données de démonstration. | Oui |
| `npm run supabase:setup` | Montre la configuration prévue | Non |
| `npm run supabase:setup -- --apply` | Auth : adresse du site, liens autorisés, emails FR/NL (lien vers `/auth/confirmer` + code, valables 1 h), SMTP Brevo si fourni. Storage : bucket privé, 10 Mo maximum, images et PDF. | Oui |
| `npm run supabase:check` | Vérifie : migrations appliquées, RLS sur toutes les tables, aucun droit pour `anon`, fonctions appelables = liste attendue, déclencheur de profil, bucket privé, aucun accès public aux fichiers, connexion par email active | Non |
| `npm run supabase:check -- --isolation` | En plus : crée deux comptes de test, vérifie qu'aucun ne voit ni ne modifie les données de l'autre, puis supprime tout ce qu'il a créé | Temporairement |
| `npm run test:e2e:connexion` | Parcours de connexion dans un navigateur (lien, code, mauvais code, refus du cookie de développement) | Non |

**Essais déjà faits sans le vrai projet** (11 octobre) :
- **Migrations** : les 4 migrations s'appliquent sur une base neuve qui imite Supabase ; une deuxième passe n'a plus rien à faire.
- **Script de vérification** : 14 contrôles sur 14, isolation comprise, contre un faux service Supabase ; le nettoyage est complet.
- **Connexion dans le navigateur** : 7 contrôles sur 7.
- **Parcours complet en mode Supabase** : 13 étapes sur 13, avec photos, signature et PDF envoyés dans le stockage simulé, et aucun fichier sur le disque local.

## Ce qu'il reste à faire, dans l'ordre

### À faire par le propriétaire du compte Supabase (une fois)

1. Créer le projet `crm-terrain`, région **Central EU (Frankfurt)**, avec un mot de passe de base solide.
2. Ajouter dans les réglages de l'environnement Claude Code (Network secrets) : `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (pooler, mode session), `SUPABASE_ACCESS_TOKEN`, `DATABASE_SSL_CA` (contenu du certificat de Project Settings › Database › SSL Configuration), et `APP_URL`, l'adresse finale. Pour un premier essai, l'adresse Vercel suffit.
3. Dans Network access : autoriser `*.supabase.co` et `*.pooler.supabase.com`.
4. Intégration GitHub de Supabase : ne pas activer le déploiement automatique des migrations sur `main`. Les migrations passent par les scripts ci-dessus, après relecture.

### Ensuite, sans intervention

1. `npm run supabase:migrate -- --apply`
2. `npm run supabase:setup -- --apply`
3. `npm run supabase:check -- --isolation`
4. Restaurer une copie dans un projet de test et refaire le contrôle des fichiers référencés (`docs/pilote-fabrice.md` § 2).

### Avant que Fabrice se connecte

- **SMTP Brevo** : le service d'email intégré de Supabase n'écrit qu'aux membres de l'équipe du projet, avec une limite très basse. Il suffit pour un essai par le propriétaire, pas pour Fabrice. Il faut fournir `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_USER`, `SMTP_PASS` et `SMTP_SENDER_EMAIL` (adresse d'un domaine authentifié), puis relancer `supabase:setup`.
- **Vercel** : créer le projet relié au dépôt, avec les variables de production listées dans `.env.example` (`DATABASE_URL` = pooler en **mode transaction**, port 6543 ; `DB_POOL_MAX=3`).

## Points connus

- **Suppression d'un compte** : la suppression d'un utilisateur Supabase est bloquée s'il a enregistré des heures d'intervention (`visit_workers`, `on delete restrict`). C'est voulu pour garder les rapports intacts. La suppression de compte (RGPD, règle 10) devra prévoir l'anonymisation : à traiter avec l'export et la suppression du compte.
- **Session** : la session de l'application dure 30 jours. Un utilisateur supprimé dans Supabase perd l'accès tout de suite : son profil disparaît, donc plus rien n'est chargé.
