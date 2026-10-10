# Cahier des charges — CRM commercial terrain

Version du 10 octobre 2026 · @Ainhpro

## Vision et cible

Une application qui fait gagner une journée par semaine au commercial terrain indépendant : il importe ses clients, l'outil planifie ses tournées, il dicte ses rapports, et les relances partent toutes seules.

- **Utilisateur cible** : commercial terrain seul ou en petite équipe (1 à 3 personnes). Agents multicartes, représentants de marques qui visitent des showrooms, distributeurs, installateurs ou magasins. Aujourd'hui, il travaille avec Excel, un carnet et sa mémoire.
- **Marché** : Belgique (francophone et néerlandophone), Luxembourg, puis France.
- **Promesse en une phrase** : « Tu sors de chez le client, tu parles une minute, et tout est à jour. »

**Différence avec les CRM existants** :

- Pensé pour la route, pas pour le bureau : mobile d'abord, vocal d'abord.
- Pipelines adaptés au métier du commercial, configurés par l'IA à l'inscription.
- Modules reliés au même fichier clients : tournées, rapports, offres, notes de frais, prospection.
- Prix et simplicité adaptés à un indépendant, pas à une PME de 50 personnes.

**Premier utilisateur** : Fabrice, avec ses données INDA (FACQ, STG, SAMO). Le prototype actuel sert de référence fonctionnelle.

## Périmètre par phases

La V1 doit suffire à faire payer trois commerciaux testeurs ; le reste vient seulement après leurs retours.

| Phase | Contenu | Objectif de sortie |
|---|---|---|
| V1 — Socle | Comptes, clients, import Excel, pipelines configurables, rapport vocal, tâches, email du matin, relances, FR + NL | Fabrice utilise l'outil chaque jour à la place du prototype ; 3 testeurs payants |
| V2 — Route | Planning de tournées, synchro Google Agenda et Outlook, notes de frais (tickets + kilomètres) | Planning hebdomadaire proposé et validé en moins de 10 minutes |
| V3 — Vente | Module offres (catalogue importé, modèle d'offre, PDF), suivi des offres | Une offre envoyée depuis le téléphone en moins de 5 minutes |
| V4 — Croissance | Module prospection (listes, emailing, séquences), connexions API (Teamleader, Odoo…), italien | Ouverture France et premières équipes de 2–3 commerciaux |

**Hors périmètre** : facturation, comptabilité, gestion de stock. L'outil s'arrête à l'offre ; la facture reste chez le comptable ou dans un outil dédié.

## Fonctionnalités détaillées

Chaque fonction est reliée au même fichier clients : un rapport vocal met à jour le pipeline, crée les tâches et nourrit le planning.

### 1. Socle (V1)

- Compte utilisateur (email + mot de passe ou lien magique), données de chaque compte strictement isolées.
- Fiche client : nom, groupe ou enseigne (ex. FACQ, STG), adresse, contacts, catégorie A/B/C, fréquence de visite, notes, historique.
- Actions : type, statut, date, note, client lié. Reprend la logique du prototype (À faire, RDV fixé, Terminé, Relance…).
- Vues reprises du prototype : Résumé, Actions (retard, aujourd'hui, relances, 7 jours), fiche client, Agenda, export Excel.
- Interface en français et néerlandais dès la V1.

### 2. Import Excel (V1)

1. L'utilisateur dépose un fichier Excel ou CSV.
2. L'IA reconnaît les colonnes (nom, adresse, groupe, contact, téléphone) et propose une correspondance.
3. Aperçu des 10 premières lignes, l'utilisateur corrige si besoin.
4. Import, détection des doublons, géolocalisation des adresses en arrière-plan.

### 3. Pipelines configurables (V1)

- Ce qui est codé en dur dans le prototype (showrooms, types d'action, pipelines) devient un réglage par compte.
- À l'inscription, le commercial décrit son métier en 2–3 phrases ; l'IA propose un ou plusieurs pipelines (ex. « RDV → Offre → Commande → Placement » et « Formation meubles → Formation parois »).
- Modèles prêts à l'emploi par métier (représentant sanitaire, cuisine, matériaux…).
- Conservé du prototype : une étape avancée terminée valide automatiquement les étapes précédentes.
- Les étapes sont reconnues par un identifiant, jamais par le texte du libellé.

### 4. Rapport de visite vocal (V1)

1. Bouton micro sur la fiche client ou sur l'écran d'accueil.
2. Enregistrement de 30 secondes à 3 minutes, en FR, NL ou IT.
3. Transcription, puis structuration par l'IA : résumé, décisions, tâches avec échéance, opportunités, étape de pipeline atteinte.
4. L'utilisateur relit et valide en un geste ; l'IA ne modifie jamais rien sans validation.
5. L'audio et le texte restent attachés à la visite.

### 5. Tâches et email du matin (V1)

- Les tâches viennent du rapport vocal ou sont créées à la main.
- Chaque matin (heure réglable), un email récapitulatif : tournée du jour, et pour chaque client les tâches ouvertes et le dernier rapport.
- Notification sur le téléphone pour les tâches du jour.

### 6. Relances automatiques (V1)

- Règles par catégorie de client : A toutes les 6 semaines, B tous les 2 mois, C tous les 3 mois (valeurs réglables).
- Règles par événement : offre envoyée → relance à J+7, J+14.
- Les relances arrivent dans les Actions et l'email du matin.

### 7. Planning de tournées (V2)

- Réglages : jours de route par semaine, point de départ, heures de travail, durée moyenne d'une visite.
- L'outil regroupe les clients à visiter par zone et par jour, selon leur fréquence et leurs échéances.
- Il **propose** la semaine ; le commercial déplace, ajoute, retire, puis valide.
- Envoi dans Google Agenda ou Outlook ; une visite déplacée dans l'agenda est mise à jour dans l'outil.
- Contraintes prises en compte : horaires d'ouverture, rendez-vous déjà fixés, jours fermés.

### 8. Notes de frais (V2)

- Photo du ticket → l'IA lit date, fournisseur, montant, TVA, catégorie.
- Kilomètres calculés automatiquement à partir des tournées réalisées.
- Export mensuel (Excel + PDF des tickets) pour le comptable ou l'employeur.

### 9. Module offres (V3)

1. L'utilisateur importe ses tarifs (PDF ou Excel) et une offre exemple.
2. L'IA extrait le catalogue (référence, désignation, prix, unité, remise) ; l'utilisateur vérifie avant activation.
3. L'IA reproduit la mise en page de l'offre exemple comme modèle.
4. Création d'offre : choix du client, ajout de lignes, PDF généré, envoi par email, relance automatique.
5. **Les prix et totaux sont calculés par le code, jamais par l'IA.**

### 10. Prospection (V4)

- Listes de prospects importées ou créées, séparées des clients.
- Séquences d'emails personnalisées par l'IA, envoyées depuis le domaine de l'utilisateur via un service d'envoi.
- Respect du RGPD : base légale, désinscription, journal des envois.
- Un prospect qui répond ou signe devient client en un geste.

## Écrans de l'application

L'application est pensée pour le téléphone d'abord ; chaque écran clé s'utilise d'une main, entre deux visites.

| Écran | Contenu principal | Phase |
|---|---|---|
| Inscription et configuration | Compte, langue, description du métier, pipelines proposés par l'IA, import Excel | V1 |
| Aujourd'hui (accueil) | Tournée du jour, actions en retard, relances, gros bouton micro | V1 |
| Clients | Liste filtrable par groupe, catégorie, zone, statut de pipeline | V1 |
| Fiche client | Pipelines visuels, historique, rapports, tâches, contacts, bouton micro | V1 |
| Rapport vocal | Enregistrement, puis résumé et tâches proposés à valider | V1 |
| Résumé | Avancement par groupe et par pipeline (repris du prototype) | V1 |
| Agenda | Visites et actions datées, synchronisées en V2 | V1 |
| Planning de la semaine | Carte et liste des visites proposées par jour, glisser-déposer, valider | V2 |
| Notes de frais | Photo de ticket, liste du mois, kilomètres, export | V2 |
| Catalogue et offres | Import des tarifs, catalogue, création d'offre, PDF, suivi | V3 |
| Prospection | Listes, séquences d'emails, résultats | V4 |
| Réglages | Pipelines, règles de relance, heure de l'email du matin, modules, abonnement | V1 |

## Modèle de données

Toutes les tables portent un `organization_id` ; la base refuse qu'un compte lise les données d'un autre (Row Level Security de Supabase).

| Table | Champs principaux | Rôle |
|---|---|---|
| organizations | nom, langue, plan, modules actifs | Le compte client (1 à 3 utilisateurs) |
| users | email, nom, organization_id, rôle | Les personnes qui se connectent |
| client_groups | nom, couleur | Enseignes ou groupes (ex. FACQ, STG, SAMO) |
| clients | nom, group_id, adresse, lat/lng, catégorie, fréquence, horaires, notes | Les clients et points de vente |
| contacts | client_id, nom, fonction, email, téléphone | Les personnes chez le client |
| pipelines | nom, ordre, group_id facultatif | Un pipeline configurable (ex. MAJ showroom) |
| pipeline_steps | pipeline_id, code, libellé, ordre | Les étapes, reconnues par leur code |
| actions | client_id, step_id facultatif, type, statut, date, note | Ce qui est fait ou à faire chez un client |
| visits | client_id, date, heure, statut, source agenda | Les visites planifiées ou réalisées |
| visit_reports | visit_id, audio_url, transcription, résumé, validé | Les rapports vocaux |
| tasks | client_id, report_id facultatif, texte, échéance, statut | Les choses à faire |
| follow_up_rules | cible (catégorie ou événement), délai en jours | Les règles de relance |
| expenses | date, fournisseur, montant, TVA, catégorie, photo_url | Notes de frais (V2) |
| catalog_items | référence, désignation, prix, unité, remise | Catalogue importé (V3) |
| quotes, quote_lines | client_id, statut, total ; lignes liées au catalogue | Offres (V3) |
| prospects, campaigns | coordonnées, statut ; séquences et envois | Prospection (V4) |

Le statut de pipeline d'un client n'est jamais stocké : il est recalculé à partir des actions, comme dans le prototype (une étape avancée terminée valide les précédentes).

## Pile technique et intégrations

Le code vit sur GitHub, Claude Code le développe, et tout est hébergé en Europe ; coût de départ estimé à 50–150 € par mois jusqu'à quelques centaines d'utilisateurs.

```
          Téléphone ou ordinateur
   (app web installable : micro, photo)
                    │
     Application web (Vercel, Europe)
  écrans, règles métier, calcul des prix
       ┌────────────┼─────────────┐
 Supabase (EU)   IA (Claude,     Services externes
 base, comptes,  transcription)  Google Maps, Agenda, Outlook,
 audio, photos                   Brevo, Stripe
```

L'application est le seul point qui parle à la base, à l'IA et aux services : le téléphone ne contacte jamais directement l'IA ni les fournisseurs.

| Brique | Choix | Pourquoi |
|---|---|---|
| Code et versions | GitHub (dépôt privé) | Historique complet, Claude Code travaille dessus |
| Application | Next.js + TypeScript, app web installable (PWA) | Un seul code pour téléphone et ordinateur ; app native possible plus tard |
| Hébergement | Vercel, région Europe | Mise en ligne automatique à chaque modification validée |
| Base, comptes, fichiers | Supabase, région Francfort | Postgres, isolation des données par compte, stockage audio et photos |
| IA | API Claude | Structuration des rapports, lecture des imports Excel et PDF, tickets |
| Transcription | Service de reconnaissance vocale (hébergé en Europe de préférence) | Voix → texte en FR, NL, IT |
| Cartes et tournées | Google Maps Platform | Géolocalisation des adresses, temps de trajet, optimisation |
| Agendas | API Google Calendar et Microsoft Graph (Outlook) | Synchro des visites dans les deux sens |
| Emails | Brevo | Email du matin, relances, prospection ; entreprise française |
| Paiement | Stripe Billing | Abonnements, carte, Bancontact, SEPA |
| Traductions | Fichiers de langue FR / NL dès la V1 | Ajout de l'italien sans toucher au code |

## Sécurité, RGPD et conformité

Les données des clients de nos utilisateurs sont l'actif le plus sensible : une fuite ou une perte détruirait la confiance dans tout le réseau.

**Sécurité technique**

- Isolation par compte au niveau de la base (Row Level Security), testée automatiquement.
- Clés d'API (Claude, Google, Brevo, Stripe) uniquement côté serveur, jamais dans l'application.
- Aucun texte saisi par un utilisateur n'est injecté tel quel dans la page (faille du prototype à ne pas reproduire).
- Sauvegardes quotidiennes automatiques, restauration testée une fois par trimestre.
- Trois environnements séparés : développement, test, production.

**RGPD**

- Hébergement et traitement en Union européenne autant que possible.
- Contrat de traitement des données (DPA) signé avec chaque fournisseur.
- Politique de confidentialité et conditions générales en FR et NL.
- Export complet et suppression du compte à la demande de l'utilisateur.
- Prospection : base légale documentée, lien de désinscription dans chaque email, journal des envois.
- Les audios peuvent être supprimés automatiquement après transcription (réglage).

**Conformité métier**

- Pas de facturation dans l'outil : on évite Peppol en Belgique et la facturation électronique obligatoire en France.
- Nos propres factures d'abonnement passent par Stripe et un outil de facturation conforme.

**Audit** : avant le premier client payant hors Fabrice, revue du code et de la sécurité par un développeur indépendant, puis quelques jours par mois.

## Abonnements et prix

Proposition de départ : un socle à 29 € par mois et des modules à ajouter, à valider avec les trois premiers testeurs.

| Formule | Contenu | Prix indicatif HTVA |
|---|---|---|
| Socle | Clients, import Excel, pipelines, rapport vocal, tâches, email du matin, relances | 29 € / mois / utilisateur |
| + Route | Planning de tournées, synchro agenda, notes de frais | + 15 € / mois |
| + Offres | Catalogue importé, modèles, PDF, suivi | + 15 € / mois |
| + Prospection | Listes, séquences d'emails | + 20 € / mois (envois inclus jusqu'à un plafond) |
| Pack complet | Tous les modules | 69 € / mois / utilisateur |

- Essai gratuit de 14 jours, sans carte bancaire.
- Remise de 2 mois pour un paiement annuel.
- Mise en place accompagnée (import et pipelines configurés avec le client) : forfait unique, par exemple 150 €.
- Pas de développement sur mesure inclus dans l'abonnement ; une demande utile à tous entre dans la feuille de route.

**Repères économiques** : coût IA et services estimé à quelques euros par utilisateur et par mois. À 49 € de revenu moyen, 200 utilisateurs ≈ 9 800 € par mois.

## Méthode de développement et démarrage

On construit par petites étapes testables, chacune utilisée par Fabrice avant de passer à la suivante.

**Règles de travail avec Claude Code**

- Un fichier `CLAUDE.md` à la racine du dépôt reprend ce cahier des charges, les choix techniques et les règles (prix calculés par le code, isolation par compte, FR/NL).
- Une fonctionnalité = une branche GitHub = une demande de fusion relue avant mise en production.
- Tests automatiques sur les points critiques : isolation des comptes, calcul du pipeline, calcul des prix.
- Le prototype HTML actuel sert de référence : ses écrans et sa logique de pipeline sont reproduits, pas son code.

**Démarrage de la V1, étape par étape**

1. Créer le dépôt GitHub, le projet Supabase (Francfort) et le projet Vercel.
2. Socle : comptes, organisations, clients, groupes, contacts, isolation testée.
3. Pipelines configurables et calcul des étapes déduites ; reprise des pipelines INDA comme premier modèle.
4. Import Excel avec reconnaissance des colonnes par l'IA ; import des clients INDA de Fabrice.
5. Écrans Aujourd'hui, Actions, Fiche client, Résumé, Agenda.
6. Rapport vocal : enregistrement, transcription, structuration, validation.
7. Tâches, relances automatiques, email du matin.
8. Traduction néerlandaise complète.
9. Fabrice utilise la V1 seul pendant 3 à 4 semaines.
10. Audit sécurité, puis ouverture à 3 commerciaux testeurs payants.

## Questions ouvertes

- Nom du produit et nom de domaine.
- Structure juridique : via AINHPRO SRL ou une nouvelle société.
- Les trois premiers testeurs : quels commerciaux du réseau FACQ / STG ?
- Fournisseur de transcription vocale à retenir.
