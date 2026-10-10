# CRM commercial terrain

Application modulaire pour commerciaux terrain indépendants : clients, pipelines, rapports vocaux, relances — puis prospection et faisabilité d'offres.

- Cahier des charges : [docs/cahier-des-charges.md](docs/cahier-des-charges.md)
- Prototype de référence : [docs/prototype/](docs/prototype/)
- Règles de développement : [CLAUDE.md](CLAUDE.md)

## Démarrer

```bash
npm install
npm test          # tests automatiques
npm run typecheck # vérification TypeScript
```

## Structure

```
src/modules/
  crm/          socle CRM (V1) : pipelines, actions, modèle INDA, reprise du prototype
  prospection/  à venir
  offres/       à venir (faisabilité d'offres)
docs/           cahier des charges, prototype, analyses
```
