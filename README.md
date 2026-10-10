# CRM commercial terrain

Application modulaire pour commerciaux terrain indépendants : clients, pipelines, rapports vocaux, relances — puis prospection et faisabilité d'offres.

- Cahier des charges : [docs/cahier-des-charges.md](docs/cahier-des-charges.md)
- Prototype de référence : [docs/prototype/](docs/prototype/)
- Règles de développement : [CLAUDE.md](CLAUDE.md)

## Démarrer

```bash
npm install
npm run dev       # application sur http://localhost:3000
npm test          # tests automatiques
npm run test:db   # isolation des comptes (nécessite PostgreSQL installé localement)
npm run typecheck # vérification TypeScript
```

## Structure

```
src/app/        écrans (Next.js)
src/i18n/       français / néerlandais
supabase/       migrations de la base et règles d'isolation
src/modules/
  crm/          socle CRM (V1) : pipelines, actions, modèle INDA, reprise du prototype
  prospection/  à venir
  offres/       à venir (faisabilité d'offres)
docs/           cahier des charges, prototype, analyses
```
