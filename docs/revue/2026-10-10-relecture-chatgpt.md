# Relecture du 10 octobre 2026 : tri et suites

Relecture externe « CRM terrain — Relecture et consignes pour Claude Code » (14 pages), examinée sur la branche `claude/socle-v1`, commit de départ `209b81b`.

Statuts : **corrigé** (corrigé et testé dans ce lot) · **confirmé** (reproduit ou vérifié dans le code, correction dans un lot suivant) · **arbitrage** (décision métier à prendre) · **spécification** (le module n'est pas codé : changement à porter au cahier des charges après décision).

Vérifications faites en local uniquement : PostgreSQL 16 jetable avec l'émulation Supabase (`supabase/tests/supabase-shim.sql`). **Rien n'a été vérifié sur un vrai projet Supabase** (pas encore créé) ni en CI (pas encore de demande de fusion).

## Lot 1 — socle sûr (fait)

| Id | Statut | Ce qui a été fait | Preuve |
|---|---|---|---|
| S01 Ajout forcé d'un membre, fuite de profil | **corrigé** | Plus d'insertion directe dans `organization_members`. Nouvelle table `invitations` (empreinte SHA-256 du jeton seulement, expiration 7 jours, usage unique) ; `invite_member()` réservé aux propriétaires ; `accept_invitation()` exige que l'email Auth **confirmé** de la personne connectée soit celui de l'invitation. Le profil n'est visible qu'après acceptation. | Reproduit avant correction (Bob ajoutait Alice et lisait son email). Tests `membership.test.ts` : insertion directe refusée, profil invisible sur simple invitation, bonne identité acceptée, autre identité / email non confirmé / expirée / réutilisée refusées, membre et non-membre ne peuvent pas inviter, empreinte du jeton illisible. |
| S02 Droits hérités non retirés | **corrigé** | `revoke all` sur toutes les tables et fonctions pour `public`, `anon`, `authenticated`, puis droits rendus un par un (aucun TRUNCATE, TRIGGER, REFERENCES ; anon n'a rien ; seules 5 fonctions exécutables). | Reproduit avant (TRUNCATE possible). Tests `privileges.test.ts` : `has_table_privilege` sur toutes les tables, `has_function_privilege` sur toutes les fonctions, TRUNCATE refusé à un membre. |
| S03 Abonnement modifiable par le bénéficiaire | **corrigé** | `update` limité aux colonnes `name` et `language` de `organizations`. `plan` et `modules` ne changent que par un traitement serveur (abonnement). | Reproduit avant. Test : renommer OK, `plan` et `modules` refusés (42501). |
| S04 Auteur d'action falsifiable | **corrigé** | Déclencheur : `created_by` = utilisateur connecté à la création, figé ensuite. Sans utilisateur (traitement serveur, reprise), la valeur fournie est gardée. | Reproduit avant. Test : insertion avec l'identifiant de Bob → Alice enregistrée ; modification ignorée. |
| S05 Organisation privée de son dernier propriétaire | **corrigé** | Déclencheur avant suppression ou changement de rôle : refuse le départ du dernier propriétaire, avec verrou sur l'organisation (deux départs simultanés ne contournent pas la règle). Suppression du compte Auth du dernier propriétaire refusée ; suppression de l'organisation toujours possible. Un membre peut quitter l'organisation. | Reproduit avant. Tests : dernier propriétaire bloqué, second propriétaire peut partir puis le restant est bloqué, compte Auth bloqué, organisation supprimable, membre retiré perd l'accès immédiatement. *Concurrence réelle non testée* (verrou en place, test à deux connexions à ajouter). |
| S06 Email de profil non fiable | **corrigé** | `profiles.email` non modifiable par l'utilisateur (colonnes `full_name`, `language` seulement) ; recopié depuis `auth.users` à chaque changement d'email. Les invitations se fondent sur l'email Auth confirmé, jamais sur le profil. | Reproduit avant. Tests : modification refusée, synchronisation depuis Auth. |
| S07 Serveur privilégié contournant la RLS | **corrigé (règle)** | Règle ajoutée au CLAUDE.md : le serveur agit avec l'identité de l'utilisateur ; `service_role` réservé à des traitements nommés qui vérifient l'organisation. À tester quand les routes existeront. | — |
| T01 Isolation incomplètement explorée | **corrigé** | Données dans A **et** B ; utilisateur membre de deux organisations ; utilisateur sans organisation ; visiteur. Lecture exacte par table, modification et suppression croisées par table, création croisée refusée, chaque clé étrangère composite testée en création **et** en modification avec SQLSTATE 23503. | `isolation.test.ts` (32 tests). |
| T02 Adhésion et colonnes sensibles | **corrigé** | Non-régressions S01 à S06, perte d'accès après retrait, codes 42501 / 23503 / P0001 distingués. | `membership.test.ts`, `privileges.test.ts`. |
| T03 Le shim ne vaut pas Supabase | **confirmé** | Limite assumée : la suite locale reste rapide ; il faudra la rejouer sur Supabase (local ou projet de test) avec accès via l'API (PostgREST, Auth, Storage). Pour anon, la réponse attendue est maintenant un refus de droit, plus une liste vide. | À faire quand le projet Supabase existera. |
| T04 Le lanceur peut détruire une base | **corrigé** | Variable dédiée `TEST_DATABASE_URL` (jamais `DATABASE_URL`) ; base au nom unique par exécution, créée puis supprimée ; une base existante n'est jamais supprimée ; serveur non local refusé sauf `TEST_DB_ALLOW_REMOTE=1`. | Vérifié : cible distante refusée. |
| I01 Statuts inconnus transformés en silence | **corrigé** | `Map` au lieu d'un objet (`constructor`, `__proto__` ne renvoient plus rien) ; espaces tolérés ; statut d'origine conservé ; statut inconnu signalé dans `issues`. | Tests unitaires. |
| I03 JSON non validé (partie) | **corrigé en partie** | Forme de la sauvegarde vérifiée ; dates impossibles (2026-02-30) refusées et signalées ; identifiants en double signalés ; étape non reconnue signalée. Reste : import transactionnel et clé d'import contre les doublons à la réexécution (lot 2, avec l'écran d'import). | Tests unitaires. |
| Néerlandais : `index.ts` q=0 | **corrigé** | Une langue avec `q=0` ou une pondération hors 0–1 n'est plus choisie. | Test unitaire. |

## Confirmés, pour le lot 2 (commercial utilisable)

| Id | Constat | Correction prévue |
|---|---|---|
| P01 Retard affiché après disparition de l'urgence | Confirmé par lecture : `pipelineProgress` compte en retard une action dont l'étape est déduite, alors que l'écran Actions l'écarte. | Une seule définition d'« action réellement ouverte » pour les listes et les statuts. |
| P03 Ordre d'étapes ambigu | Confirmé : pas d'unicité de `position` par pipeline. | Contrainte unique (différable) + réordonnancement transactionnel + tri stable dans le moteur. |
| P04 Étape d'un groupe inapplicable au client | Confirmé : la clé composite garantit l'organisation, pas le groupe. | Vérifier que le pipeline de l'étape est commun ou celui du groupe du client. |
| P05 Suppression d'un groupe déclasse l'historique | Confirmé : cascade sur pipelines et étapes, `step_id` mis à NULL. | Archiver au lieu de supprimer une structure utilisée. |
| I02 Correspondances fragiles | Confirmé (casse, « Commande annulée » → commande). | Construire la table d'alias à partir de **la vraie sauvegarde de Fabrice** et faire revoir les cas ambigus. |
| I03 (reste) | Import non transactionnel, pas de clé d'import. | Avec l'écran d'import. |
| E04 Import universel | Aperçu de 10 lignes insuffisant. | Bilan complet des anomalies, formats et limites définis, commencer par les formats des premiers testeurs. |
| Néerlandais (libellés) | Propositions de formulation (« Afspraak in te plannen », « Afgerond », « SAMO-prijslijst bezorgd », libellés courts traduits). | À appliquer après relecture par un néerlandophone. |

## Arbitrages métier à prendre

| Id | Question |
|---|---|
| P02 | Faut-il une « affaire » (instance de pipeline) par projet chez un même client, pour qu'un placement de 2026 ne termine pas une nouvelle affaire ? (Recommandé : oui.) |
| P06 | Le tarif SAMO « livré par défaut » reste-t-il vrai si une action ouverte est ajoutée ? Une ancienne tâche ouverte sur une étape déjà terminée doit-elle rester dans les urgences ? |
| Comportements conservés | « RDV à fixer » et « Bloqué » ne démarrent pas une étape ; le retard se mesure sur toutes les actions du client. À confirmer. |
| Relances | Point de départ (dernière visite ? dernière action ?), mois calendaires ou jours, rappel interne ou email au client. |
| Temps et prix (M07) | Pauses, arrondi, plusieurs intervenants, qui paie. |
| Coûts | Mesurer audio, pages lues par l'IA, stockage, envois avant de confirmer « quelques euros par utilisateur ». |
| V01 Périmètre | Les deux profils au lancement sont maintenus (décision prise). Il faut définir pour chacun un parcours complet **limité**, le prix du profil technicien, et les intégrations vraiment nécessaires aux premiers testeurs. |

## Spécification du module technicien (à porter au cahier des charges après accord)

Toutes ces remarques sont jugées justes ; elles changent le modèle avant tout code.

| Id | Proposition |
|---|---|
| M01 | Séparer **dossier** (demande, client, tickets, suivi) et **passages** (chaque visite : planification, intervenants, heures, photos, rapport). Un retour conserve le premier passage intact. |
| M02 | Intervenants et temps **par passage et par personne** ; le profil commercial/technicien devient une préférence par utilisateur, distincte des modules du compte et du rôle. |
| M03 | Identifiant interne permanent ; numéros de tickets stockés avec leur émetteur (donneur d'ordre), unicité par émetteur ; rattachement ambigu toujours proposé, jamais silencieux. |
| M04 | Distinguer donneur d'ordre, client final, lieu d'intervention, payeur ; contact sur place ; matériel (modèle, numéro de série). |
| M05 | Issues de terrain : annulation, client absent, accès impossible, réouverture, refus de signature ; rapport sans signature avec justification ; sans email client. |
| M06 | Pièces : besoin, commande envoyée, réception (partielle), annulation, substitution ; chaque envoi de commande identifié. |
| M07 | Horodatages réels, fuseau du compte ; présence ≠ durée facturable ; tarif, règle d'arrondi et montant figés dans la version validée ; calcul décimal. |
| M08 | Récapitulatif (contenu, destinataires, pièces jointes) puis « Valider et envoyer » ; brouillon possible ; version validée figée, toute correction = nouvelle version. |
| E01 | Hors réseau : brouillons et photos gardés sur le téléphone, file de synchronisation visible, reprise, conflits téléphone/PC. |
| E02 | Champs lus par l'IA affichés à côté de leur source, valeurs incertaines à confirmer ; un email reçu ne peut jamais déclencher un envoi ou un achat. |
| E03 | Le compte destinataire d'un email entrant est déterminé par le canal de réception (adresse propre au compte), jamais par le ticket ou l'expéditeur ; webhooks authentifiés et dédupliqués ; HTML reçu isolé. |
| E05 | Domaine d'envoi authentifié de l'application (SPF/DKIM), Reply-To vers le technicien ; ou connexion autorisée à sa boîte. |
| E06 | File d'envoi persistante avec identifiant d'opération : pas de double envoi en cas de coupure ou de double clic. |
| E07 | Copies OneDrive / Google Drive : compte et dossier choisis, échecs visibles, reprise, identifiant interne du dossier dans le chemin. |
| E08 | Fichiers (photos, PDF, audio) en stockage privé, liens temporaires ; sauvegarde et restauration des fichiers testées à part de la base. |
| R01 | Le rapport n'est pas une facture ; montrer ce qui a été transmis, à qui, et ce qui reste à facturer. |
| R02 | Adapter le document au destinataire : tarif négocié avec le fournisseur jamais montré au particulier ; montant TVA comprise pour un particulier. |
| R03 | Rôles RGPD (responsable / sous-traitant), information des personnes, durées de conservation par type de donnée, copies diffusées. |
| R04 | Cartographier les flux hors Supabase (IA, emails, clouds) et adapter la promesse « tout en Europe » aux garanties réelles. |
| U01 | Langue du destinataire (client NL, technicien FR) distincte de celle de l'interface. |
| U02 | Accueil technicien : après le choix du métier, créer ou intégrer tout de suite une première demande ; compléter types et donneurs d'ordre au fil de l'eau. |

## Restes à vérifier hors local

- Rejouer migrations et tests sur Supabase (Auth réel, PostgREST, Storage, droits par défaut 2026).
- Concurrence réelle du dernier propriétaire (deux connexions simultanées).
- CI GitHub : non exécutée tant qu'aucune demande de fusion n'est ouverte.
