# Mettre l'application en ligne sur Netlify et l'utiliser sur le téléphone

Ce guide suit `docs/demarrage-pc.md` : le projet Supabase (Francfort) est créé, les migrations sont appliquées et `npm run config:check` dit « Tout est prêt » sur le Mac. Comptez 30 minutes.

Résultat : une adresse `https://<nom>.netlify.app` qui marche sur l'iPhone (installée comme une application sur l'écran d'accueil) et sur le Mac (navigateur), avec les mêmes données.

> Les clés ne se collent jamais dans une conversation. Sur Netlify, elles vont dans **Project configuration › Environment variables**.

## 1. Créer le site (une fois)

Sur app.netlify.com :
1. **Add new project › Import an existing project › GitHub** › dépôt `ainhpro/Crm-terrain`.
2. **Branch to deploy** : la branche de travail du moment (aujourd'hui `claude/netlify-reprise`), puis `main` une fois fusionnée.
3. Ne rien changer aux réglages de build : ils sont lus dans `netlify.toml` (`npm run build`, Node 22, module Next.js de Netlify).
4. Avant le premier déploiement, remplir les variables du § 2. Si le premier déploiement est déjà parti, ce n'est pas grave : **Deploys › Trigger deploy** après avoir rempli les variables.
5. **Project configuration › General › Project name** : choisissez un nom, par exemple `crm-ainhpro`. L'adresse devient `https://crm-ainhpro.netlify.app`.

## 2. Variables d'environnement

**Project configuration › Environment variables › Add a variable**. Cochez « Contains secret values » pour les clés.

| Variable | Valeur | Obligatoire |
|---|---|---|
| `SESSION_SECRET` | Une **nouvelle** valeur de `npm run config:secret` (pas celle du Mac) | Oui |
| `APP_URL` | `https://crm-ainhpro.netlify.app` (votre adresse, sans `/` final) | Oui |
| `SUPABASE_URL` | Comme dans `.env.local` | Oui |
| `SUPABASE_ANON_KEY` | Comme dans `.env.local` | Oui |
| `SUPABASE_SERVICE_ROLE_KEY` | Comme dans `.env.local` (secret) | Oui : photos, signatures, PDF |
| `DATABASE_URL` | Adresse **Transaction pooler** (port **6543**) de Supabase › Connect, avec le mot de passe de base | Oui |
| `DATABASE_SSL_CA` | Contenu du certificat de Supabase › Project Settings › Database › SSL Configuration (tout le texte, lignes `BEGIN` et `END` comprises) | Oui : refusé sans lui en production |
| `DB_POOL_MAX` | `3` | Conseillé |
| `ANTHROPIC_API_KEY` | Comme dans `.env.local` (secret) | Non : sans elle, règles simples |
| `CRON_SECRET` | Une autre valeur de `npm run config:secret` | Conseillé : passage de rattrapage des envois |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Plus tard, quand Brevo sera branché | Non : sans eux, les messages restent « En file » |

Ne mettez jamais `AUTH_MODE` ni `STORAGE_DIR` sur Netlify : la connexion par email seul et le disque local y sont refusés d'office (`src/server/config.ts`, `src/server/storage.ts`).

## 3. Région des fonctions : Francfort

Par défaut, Netlify exécute le serveur aux États-Unis : chaque écran ferait l'aller-retour jusqu'à la base à Francfort (lent), et les données passeraient hors d'Europe (règle 10).

**Project configuration › Build & deploy › Continuous deployment › Functions region** › **EU Central 1 (Frankfurt)**, puis **Deploys › Trigger deploy**. Le changement ne vaut que pour les déploiements suivants.

Si ce réglage n'apparaît pas sur votre offre, demandez-le au support Netlify (cela s'est fait sur demande pour certaines offres) ; en attendant, l'application marche, mais plus lentement.

Pour vérifier : **Logs › Functions** › `___netlify-server-handler` : la région affichée doit être `eu-central-1`.

## 4. Supabase : les emails de connexion pointent vers Netlify

Le lien des emails de connexion mène à l'adresse du site déclarée chez Supabase. Sur le Mac, dans le terminal VS Code (remplacez par votre adresse) :

```
APP_URL=https://crm-ainhpro.netlify.app npm run supabase:setup -- --apply
npm run supabase:check -- --isolation
```

`.env.local` reste inchangé. Pour travailler en local ensuite, le **code à 6 chiffres** de l'email marche toujours (le lien, lui, ouvre la version en ligne).

`supabase:check -- --isolation` vérifie aussi que l'isolation des comptes marche à travers le pooler de Supabase.

## 5. Sur l'iPhone

1. Ouvrez l'adresse dans **Safari**.
2. Connectez-vous : votre email, puis le code à 6 chiffres reçu (ou le lien de l'email, puis « Se connecter »).
3. Bouton **Partager › Sur l'écran d'accueil**. L'application s'ouvre ensuite en plein écran, avec son icône.
4. Le micro : Safari demande l'autorisation à la première dictée. Sinon, le micro du clavier marche toujours dans le champ de texte.

## 6. Sur le Mac

Même adresse dans Safari ou Chrome. Mêmes données que sur le téléphone. Dans Chrome : menu **⋮ › Caster, enregistrer et partager › Installer la page en tant qu'application** pour l'avoir dans le Dock.

## 7. Reprendre les données de l'ancienne application (Koder)

Les données de l'ancien CRM sont stockées dans le téléphone. Le bouton **BACKUP** de l'ancienne application copie toutes les actions (texte qui commence par `{"entries":[`).

1. Dans l'ancienne application : **BACKUP**, puis collez dans une note (Notes) pour garder une copie.
2. Dans la nouvelle application, connecté comme **propriétaire** : **Clients › Importer › Reprendre l'ancien CRM** (adresse `/clients/reprise`).
3. Collez le texte (ou choisissez le fichier si vous l'avez enregistré).
4. **Lire la sauvegarde** : le bilan montre le nombre d'actions, de clients, d'affaires et de parcours, et la liste des anomalies. **Rien n'est enregistré à ce stade.**
5. **Reprendre N actions** : groupes, clients, affaires et actions sont créés.

Une reprise faite deux fois ne crée pas de doublon : les actions déjà reprises sont ignorées (le nombre est affiché). On peut donc refaire une reprise plus tard avec une sauvegarde plus récente.

## 8. Mises à jour

Chaque push sur la branche choisie au § 1 redéploie automatiquement. Une demande de fusion reçoit sa propre adresse de prévisualisation (« Deploy Preview ») avec les mêmes variables : attention, elle travaille sur **la même base**.

Une nouvelle migration (`supabase/migrations/`) s'applique depuis le Mac **avant** de déployer le code qui en a besoin :

```
npm run supabase:migrate -- --apply
```

## 9. Passage de rattrapage des envois

`netlify/functions/envois.mts` est une fonction planifiée (tous les jours à 5 h UTC) qui appelle `/api/envois` avec `CRON_SECRET`. Elle traite les messages restés en file. Les envois normaux partent tout de suite après la validation, sans l'attendre.

## Ce qui a été vérifié

Le 12 octobre 2026, sans compte Netlify : `netlify build` puis `netlify serve` (environnement Netlify reproduit en local, `NETLIFY=true`), base locale, faux Supabase (connexion par code, Storage privé). Le parcours navigateur complet (`npm run test:e2e`, 13 étapes : connexion, clients, compte rendu, import, interventions, photos, rapport et PDF, recherche, réglages, néerlandais, isolation) passe. Restent à vérifier sur le vrai site : la région des fonctions et le temps de réponse depuis le téléphone.

## Problèmes fréquents

| Symptôme | Solution |
|---|---|
| Page d'erreur dès l'ouverture | Variable manquante (§ 2 : souvent `SESSION_SECRET` ou `DATABASE_SSL_CA`), puis **Trigger deploy**. Le détail est dans **Logs › Functions** |
| Le lien de l'email ouvre `localhost` | Refaire le § 4 avec l'adresse Netlify |
| Écrans lents (plusieurs secondes) | Région des fonctions restée aux États-Unis (§ 3) |
| `too many connections` / `MaxClientsInSessionMode` | `DATABASE_URL` doit être le **Transaction pooler**, port 6543 |
| Photo envoyée mais introuvable | `SUPABASE_SERVICE_ROLE_KEY` manquante sur Netlify |
