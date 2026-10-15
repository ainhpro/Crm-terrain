# CRM terrain

Application mobile pour commerciaux terrain et techniciens SAV indépendants : clients, affaires, comptes rendus dictés, relances, interventions avec photos, heures, pièces à commander, rapport signé en PDF et envoi au donneur d'ordre.

- Cahier des charges : [docs/cahier-des-charges.md](docs/cahier-des-charges.md)
- Règles de développement : [CLAUDE.md](CLAUDE.md)
- Relecture externe et suites : [docs/revue/](docs/revue/)

## Lancer l'application en local

Prérequis : Node 22, PostgreSQL 16 installé (pas besoin de Docker ni de Supabase pour développer).

```bash
npm install
cp .env.example .env.local        # puis remplacer SESSION_SECRET par une longue chaîne aléatoire
npm run db:start                  # crée la base locale et la remplit avec les données de démonstration
npm run dev                       # http://localhost:3000
```

Connexion de démonstration (mode développement, email seul) :

- `fabrice@demo.local` : propriétaire, commercial et technicien (données INDA, deux interventions du jour)
- `tom@demo.local` : technicien « placement showroom » seulement (options pièces et garantie désactivées)
- toute autre adresse : nouveau compte, parcours d'accueil

`npm run db:reset` remet les données de démonstration à zéro.

## Vérifications

```bash
npm run typecheck
npm test            # logique métier (prix, pipeline, import, tickets…)
npm run test:db     # isolation des comptes et règles de la base, sur un Postgres jetable
npm run build
npm run test:e2e    # parcours complet dans un navigateur (app lancée sur le port 3200, Playwright requis)
```

## Ce qui attend les services externes

| Fonction | Aujourd'hui | Quand le service sera branché |
|---|---|---|
| Connexion | email seul (développement uniquement, désactivée en production) | Supabase Auth, lien par email |
| Base de données | Postgres local avec émulation Supabase | Supabase Irlande (mêmes migrations) |
| Lecture des emails, notices, comptes rendus | règles locales, chaque champ montré avec sa source | API Claude, même format de sortie |
| Dictée | dictée du navigateur ou du clavier | service de transcription européen |
| Envoi des emails et commandes | file d'envoi (rien ne part réellement) | Brevo |
| Photos et PDF | dossier privé local | Supabase Storage (bucket privé) |
| Copies OneDrive / Google Drive | — | Microsoft Graph, Google Drive |

## Structure

```
src/app/            écrans (Next.js) ; (app)/ = écrans connectés
src/server/         accès à la base sous l'identité de l'utilisateur, actions, PDF, stockage
src/modules/        logique métier pure et testée (crm, interventions)
src/i18n/           français et néerlandais
supabase/           migrations et politiques de sécurité
scripts/            base de développement et données de démonstration
tests/db/           tests de la base ; tests/e2e/ parcours navigateur
```
