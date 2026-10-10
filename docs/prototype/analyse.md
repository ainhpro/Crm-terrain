# Analyse du prototype INDA 2026

Le fichier [`inda-2026.html`](inda-2026.html) est le prototype utilisé par Fabrice. Il sert de **référence fonctionnelle** : on reproduit ses écrans et sa logique de pipeline, pas son code.

## Ce qu'il fait

| Écran | Contenu |
|---|---|
| Résumé | Alertes (retards, actions du jour), barres d'avancement par groupe et par étape, compteurs Finalisés / En cours / Retard / À démarrer, sites sans aucune action |
| ⚡ Actions | En retard, Aujourd'hui, Relances, 7 prochains jours, RDV à fixer — sans les actions déjà validées par déduction |
| FACQ / STG / SAMO | Une carte par site avec ses pipelines visuels, badge de statut, bouton Détails |
| Fiche site | Pipelines, étapes validées par déduction, actions non classées, historique (terminer, modifier, supprimer) |
| Agenda | Toutes les actions datées, triées |
| Export | Tableau par groupe à copier dans Excel |

Une action = client, site, type (libellé), statut, date, note. Statuts : À faire, RDV à fixer, RDV fixé, En cours, En attente, Relance, Terminé, Bloqué.

## Pipelines INDA

| Groupe | Pipeline | Étapes |
|---|---|---|
| FACQ (10 showrooms) | MAJ showroom | RDV → Offre → Commande → Placement |
| | Tarifs & formations | Formation meubles → Formation parois |
| STG (14 showrooms) | Placement | RDV responsable → Proposition → Commande → Placement |
| | Formation | Formation meubles |
| SAMO (7 distributeurs) | — | Tarif (toujours considéré livré) → Formation nouveautés |

Repris dans `src/modules/crm/templates/inda.ts`.

## Règles métier reprises

1. **Déduction** : une étape terminée valide les étapes précédentes du même pipeline.
2. **Statut d'un site sur un pipeline** : *Finalisé* si la dernière étape est faite ou déduite ; sinon *Retard* si une action du site est en retard ; sinon *En cours* si une étape a démarré ; sinon *À démarrer*.
3. **Pipelines indépendants** : un site FACQ ou STG est finalisé quand **tous** ses pipelines le sont ; en retard si l'un l'est.
4. **Actions** : une action dont l'étape est validée par déduction n'apparaît plus dans les urgences.
5. **Actions non classées** : ne jamais les cacher, les signaler sur la fiche.

Implémenté dans `src/modules/crm/pipeline/engine.ts` et `src/modules/crm/actions/buckets.ts`, avec tests.

## Différences volontaires avec le prototype

| Prototype | Nouvelle version | Pourquoi |
|---|---|---|
| Étapes reconnues en cherchant du texte dans le libellé (`type.includes('Commande')`) | Chaque action pointe vers une étape par son identifiant | Règle du cahier des charges ; un libellé renommé ou traduit cassait le pipeline |
| Seule la première action trouvée compte pour une étape | L'action la plus avancée de l'étape l'emporte (Terminé > RDV fixé > ouverte) | Une ancienne action « À faire » masquait une action « Terminé » plus récente |
| La déduction ne remplit que les étapes vides ; une étape précédente « À faire » restait ouverte et en retard | Toutes les étapes précédentes non terminées deviennent « déduites » | Le cahier des charges : « une étape avancée terminée valide automatiquement les étapes précédentes » |
| « Livraison Tarifs SAMO » n'était rattachée à aucune étape | Rattachée à l'étape Tarif | Le libellé existait mais tombait en « non classé » |
| Dates comparées avec `new Date('2026-10-10')` (minuit UTC) | Dates ISO comparées comme du texte, « aujourd'hui » passé en paramètre | Décalage d'un jour possible selon le fuseau ; logique testable |
| Pipelines, groupes, showrooms et types codés en dur | Réglages par compte (tables `pipelines`, `pipeline_steps`, `client_groups`) | Multi-utilisateurs, pipelines proposés par l'IA |

**À valider avec Fabrice** : « RDV à fixer » et « Bloqué » ne font pas démarrer une étape (comportement du prototype conservé). Faut-il les compter comme « en cours » ?

## Défauts à ne pas reproduire

- **Injection de texte dans la page** : notes, noms et types sont insérés via `innerHTML` sans échappement. Une note contenant du HTML s'exécute. → En React, jamais de `dangerouslySetInnerHTML` sur des données utilisateur.
- **Données uniquement dans le navigateur** (`localStorage`) : perte totale si le cache est vidé ; sauvegarde manuelle par copier-coller. → Base Supabase + sauvegardes quotidiennes.
- **Identifiants `Date.now()`** : collisions possibles. → UUID générés par la base.
- **Export par `document.execCommand('copy')`** (obsolète). → Vrai fichier Excel généré côté serveur.

## Reprise des données de Fabrice

Le bouton BACKUP du prototype copie un JSON `{"entries": [...]}`. `src/modules/crm/import/prototype-backup.ts` convertit chaque entrée : libellé → code d'étape, statut → code de statut, date vide → null. Les entrées non reconnues gardent leur libellé d'origine et restent visibles comme « non classées ».
