# Faire tourner l'application sur son PC et la tester comme commercial terrain

Ce guide est pour le propriétaire du projet, sur un PC Windows ou un Mac, avec VS Code et Claude Code. Comptez environ 45 minutes la première fois. La base de données, la connexion et les fichiers sont ceux de votre projet Supabase (Francfort). L'IA utilise votre clé Anthropic.

> **Les clés et mots de passe ne se collent jamais dans une conversation**, ni avec Claude Code ni ailleurs. Ils vont dans le fichier `.env.local` de votre PC. Ce fichier n'est jamais envoyé sur GitHub.

## 1. Installer les outils (une fois)

| Outil | Où | Remarque |
|---|---|---|
| Node.js 22 (version « LTS ») | nodejs.org | Garder les options par défaut |
| Git | git-scm.com | Garder les options par défaut |
| VS Code | code.visualstudio.com | |
| Claude Code | Extension « Claude Code » dans VS Code | Se connecter avec votre compte Claude |

## 2. Récupérer le code

Dans VS Code : menu **Terminal › Nouveau terminal**, puis :

```
git clone https://github.com/ainhpro/Crm-terrain.git
cd Crm-terrain
git checkout claude/demarrage-pc
npm install
```

Ouvrez ensuite le dossier `Crm-terrain` dans VS Code (**Fichier › Ouvrir le dossier**).

La branche `claude/demarrage-pc` contient tout le travail déjà fait : V1, relecture, Supabase, RGPD, envois et IA.

## 3. Créer le projet Supabase (une fois)

Sur supabase.com :
1. **New project** : nom `crm-terrain`, région **Central EU (Frankfurt)**. Choisissez un mot de passe de base solide et notez-le dans votre gestionnaire de mots de passe.
2. **Project Settings › API** : notez
   - l'**URL** du projet (`https://xxxx.supabase.co`) ;
   - la clé **anon** (ou « publishable ») ;
   - la clé **service_role** (ou « secret ») : elle ne doit jamais être partagée.
3. Bouton **Connect** en haut de la page › onglet **Session pooler** : copiez l'adresse qui commence par `postgresql://postgres.` et remplacez `[YOUR-PASSWORD]` par votre mot de passe de base.
4. **Account › Access Tokens** (votre profil, en haut à droite) : créez un jeton `crm-terrain`. Il ne sert qu'une fois, à configurer les emails de connexion.

## 4. Créer la clé Anthropic (l'IA)

Sur console.anthropic.com :
1. **Settings › Billing** : ajoutez du crédit, par exemple 10 $. C'est un paiement séparé de votre abonnement Claude.
2. **API Keys › Create Key** : nommez-la `crm-terrain` et copiez-la tout de suite (elle commence par `sk-ant-`).

Coût indicatif : quelques centimes par compte rendu ou par email lu. Sans clé, l'application fonctionne quand même : les propositions sont alors préparées par des règles simples.

## 5. Remplir `.env.local`

1. Dans VS Code, faites une copie du fichier `.env.example` et nommez la copie `.env.local`.
2. Dans le terminal, lancez `npm run config:secret` et copiez la longue valeur affichée.
3. Remplacez tout le contenu de `.env.local` par ceci, avec vos valeurs :

```
SESSION_SECRET=la-valeur-de-npm-run-config-secret
APP_URL=http://localhost:3000

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=votre-cle-anon
SUPABASE_SERVICE_ROLE_KEY=votre-cle-service-role
DATABASE_URL=postgresql://postgres.xxxx:VOTRE-MOT-DE-PASSE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
SUPABASE_ACCESS_TOKEN=sbp_votre-jeton

ANTHROPIC_API_KEY=sk-ant-votre-cle
```

Enregistrez le fichier.

## 6. Préparer Supabase (une fois)

Dans le terminal, dans cet ordre :

```
npm run supabase:migrate -- --apply
npm run supabase:setup -- --apply
npm run supabase:check -- --isolation
npm run config:check
```

- `supabase:migrate` crée les tables et les règles de sécurité.
- `supabase:setup` configure les emails de connexion (lien + code, en français et en néerlandais) et l'espace privé des fichiers.
- `supabase:check -- --isolation` vérifie la sécurité. Il crée deux comptes de test, contrôle que chacun ne voit que ses données, puis efface tout.
- `config:check` relit toute votre configuration et dit précisément quoi corriger s'il manque quelque chose.

Tout doit finir par « OK » ou « Tout est prêt ». Sinon, la ligne « À FAIRE » dit quoi corriger.

## 7. Lancer l'application

```
npm run dev
```

Ouvrez **http://localhost:3000** dans Chrome ou Edge. Pour arrêter l'application : `Ctrl + C` dans le terminal.

**Connexion** : utilisez **l'adresse email de votre compte Supabase**. Tant que Brevo n'est pas branché, le service d'email de Supabase n'écrit qu'aux membres du projet, et en petite quantité (quelques emails par heure). Vous recevez un email avec un lien et un code à 6 chiffres : tapez le code, ou ouvrez le lien puis appuyez sur « Se connecter ».

À la première connexion :
- **Nom de votre entreprise** : par exemple le vôtre ;
- **Métier** : **Commercial terrain**.

## 8. Tester comme commercial terrain

Gardez ce tableau sous la main et notez ce qui coince : un mot pas clair, un bouton mal placé, un calcul faux, quelque chose de trop lent.

| # | À essayer | Ce qui doit se passer |
|---|---|---|
| 1 | **Démarrer › Importer un fichier** : votre fichier clients (Excel ou CSV), ou un export de votre ancien CRM | Les colonnes sont reconnues. Le bilan montre les lignes prêtes, les anomalies et les doublons, avant tout enregistrement |
| 2 | **Clients › +** : ajouter un client à la main | Moins d'une minute |
| 3 | **Fiche client › Nouvelle affaire** | L'affaire suit les étapes « Premier contact › Rendez-vous › Offre envoyée › Commande » |
| 4 | **Réglages › Étapes de vente** : renommer, ajouter ou réordonner une étape selon votre métier | Changement immédiat. Bloqué tant qu'une affaire en cours suit le parcours, et c'est expliqué |
| 5 | **Fiche client › Dicter le compte rendu** : parler ou écrire, par exemple « Rendez-vous fait, offre envoyée ce matin, rappeler le responsable lundi » | La proposition est préparée par l'IA, avec l'étape terminée, la phrase d'où elle vient et une tâche datée. Rien n'est enregistré avant « Valider » |
| 6 | Même chose avec une phrase négative : « je n'ai pas encore envoyé l'offre » | Aucune étape cochée, la phrase est montrée comme « non retenue » |
| 7 | **Aujourd'hui** | Tâches du jour, retards en rouge, clients A, B, C à revoir |
| 8 | Importance A, B ou C sur quelques clients | Un client remonte dans « À revoir » 6 semaines (A), 2 mois (B) ou 3 mois (C) après son dernier compte rendu, ou après sa création s'il n'en a pas encore. Cela ne se voit donc pas le premier jour |
| 9 | **NL** en haut à droite | Toute l'interface passe en néerlandais |
| 10 | **Réglages › Vos données › Exporter** | Une archive avec toutes vos données |

Sur PC, la dictée marche dans Chrome ou Edge avec le micro. Pour le téléphone, mettez l'application en ligne sur Netlify : `docs/mise-en-ligne-netlify.md`. Vos données de l'ancienne application se reprennent dans **Clients › Importer › Reprendre l'ancien CRM** (même guide, § 7).

## 9. Travailler avec Claude Code sur ce PC

Dans VS Code, ouvrez Claude Code et commencez par exemple ainsi :

> Lis CLAUDE.md et docs/demarrage-pc.md. Lance npm run config:check et explique-moi ce qui reste à faire. Ne lis pas le fichier .env.local.

Puis, au fil du test :

> En testant comme commercial, voici ce qui coince : … Propose une correction, avec ses tests, sur une nouvelle branche.

Claude Code suit les règles du projet écrites dans `CLAUDE.md` : une branche par sujet, les tests avant chaque push, et aucune clé dans le code.

## Problèmes fréquents

| Message | Solution |
|---|---|
| `password authentication failed` | Mot de passe de base faux dans `DATABASE_URL`. Recopiez l'adresse « Session pooler » et remplacez `[YOUR-PASSWORD]` |
| « Trop de demandes » à la connexion | Le service d'email intégré de Supabase est limité à quelques emails par heure : attendez, ou branchez Brevo (voir `docs/supabase.md`) |
| Aucun email de connexion reçu | Utilisez l'adresse de votre compte Supabase, et regardez dans les indésirables |
| « Proposition préparée par des règles simples » alors que la clé est remplie | `npm run config:check` vérifie la clé Anthropic et le crédit du compte |
| `npm` n'est pas reconnu | Fermez puis rouvrez VS Code après avoir installé Node.js |
