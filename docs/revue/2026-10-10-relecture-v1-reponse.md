# Réponse à la relecture externe de la V1 — 10 octobre 2026

Branche : `claude/relecture-v1` (partie de `claude/neutre`). Migration ajoutée : `supabase/migrations/20261013000001_relecture_v1.sql`.

Statuts : **confirmé** (défaut réel, corrigé), **déjà couvert** (preuve citée), **non applicable** (la fonction n'existe pas encore), **non vérifiable** (dépend d'un service non branché).

## Tableau

| ID | Statut | Fichier et lignes | Correction réalisée ou justification | Test et résultat | Reste à faire |
|---|---|---|---|---|---|
| S01 | Confirmé | `20261013000001_relecture_v1.sql` l. 13-33 | La politique « tout pour les membres » des parcours et étapes est **remplacée** (pas complétée) : lecture pour les membres, création / modification / suppression pour les propriétaires. La fonction de réordonnancement s'exécute avec les droits de l'appelant, donc un membre n'y modifie rien. | `tests/db/relecture.test.ts` l. 68-104 : un membre lit ; création refusée (42501) ; modification et suppression sans effet en SQL direct ; réordonnancement refusé (22023) ; le propriétaire peut tout faire. **Réussi.** | — |
| S02 | Confirmé (renforcé) | `src/server/session.ts` l. 40 et 57 | La connexion par email n'est active qu'en développement : refusée en production, sur Vercel (y compris les prévisualisations) et sur tout environnement exposé. Hors développement, **aucun cookie n'est accepté, même correctement signé** : un cookie de développement ne vaut rien en production, même avec le même secret. | Exécuté sur un serveur de production local (`next start`, AUTH_MODE=dev) : avec un cookie signé valide, `GET /` → 307 vers /connexion et le PDF → 401 ; le même cookie est accepté par le serveur de développement. **Réussi.** | Brancher Supabase Auth (lien de connexion envoyé par email) avant tout accès distant. Bloquant pour le pilote. |
| S03 | Déjà couvert, renforcé | `src/server/db.ts` l. 31 et 48 ; `src/server/context.ts` | L'identité ne vient que du cookie de session vérifié côté serveur (`sessionUserId`), jamais d'un champ du formulaire. `withUser` : une transaction sur une seule connexion, avec un rôle et des claims posés en « set local », donc effacés à l'annulation. Ajouts : une connexion dont l'annulation échoue est détruite au lieu de revenir dans le groupe ; les requêtes lancées en parallèle sur une connexion sont mises en file. | `relecture.test.ts` l. 251 : groupe limité à une connexion, erreur pendant une transaction pour Alice puis division par zéro → la requête suivante pour Bob voit `auth.uid() = Bob` ; `withService` ne voit aucune identité. Accès directs aux fichiers et PDF : contrôle RLS existant (`/fichiers/[id]`, `/rapports/[id]/pdf`) et refus 401 vérifié ci-dessus. **Réussi.** | Refaire le test d'identité successive avec le client Supabase réel. |
| D01 | Confirmé | migration l. 41-70 ; `src/server/actions/settings.ts` l. 151 ; `reglages/page.tsx` | Tant qu'une affaire en cours suit un parcours, ses étapes peuvent être renommées et complétées, mais **pas déplacées, retirées ni supprimées** (refus en base, code 55006). Réglages l'annonce (« N affaire(s) en cours… ») et désactive les boutons. Une affaire ne peut donc plus passer pour terminée à cause d'une étape retirée. Protection ciblée, sans versionnage des parcours. | `relecture.test.ts` l. 108-136 : renommer et ajouter OK ; retirer, supprimer, réordonner → 55006 ; après clôture de l'affaire → autorisé. Navigateur : message affiché (`test:e2e:relecture`). **Réussi.** | Ajouter une étape en fin de parcours peut faire repasser une affaire terminée « en cours » : choix assumé, rien n'est finalisé en silence. |
| D02 | Confirmé | migration l. 76-100 ; `src/server/actions/interventions.ts` l. 424 ; `src/app/rapports/[id]/pdf/route.ts` l. 26 | Le PDF était produit à la demande à partir des données vivantes (logo, identité, heures, pièces). Il est désormais **produit dans la transaction de validation et stocké** (`pdf_path`, `client_pdf_path`). Le déclencheur de gel n'autorise qu'une seule écriture de ces deux chemins, sans aucune autre modification. Toute correction crée une nouvelle version. Les versions validées avant cette migration gardent l'ancien comportement (PDF produit à la demande). | DB : `relecture.test.ts` l. 141-163 (écriture unique ; deuxième écriture ou modification glissée → 55000). Navigateur : PDF identique octet pour octet après modification du nom de la société et des heures. **Réussi.** | Les photos ne figurent pas dans le PDF V1. Si elles y entrent, les figer de la même manière. |
| D03 | Partiellement applicable | `20261012000001_interventions.sql` l. 281 ; `validateReport` | Déjà en place : la validation et la mise en file sont dans la même transaction ; une clé stable par opération (`report:<version>:<destinataire>`) avec `on conflict do nothing`. Deux validations simultanées donnent une seule version et un seul envoi en file. **L'envoi réel n'existe pas encore** : son fonctionnement (verrou, identifiant du fournisseur, résultat incertain) est décrit dans `docs/pilote-fabrice.md` § 3, sans promesse de garantie absolue. | `relecture.test.ts` l. 219 : deux validations concurrentes → la seconde est refusée (55000), un seul message en file. **Réussi.** | À coder avec Brevo, ainsi que les tests « arrêt après acceptation » et « double clic ». |
| D04 | Confirmé (documenté et vérifié en local) | `src/server/storage.ts` l. 26 ; `docs/pilote-fabrice.md` § 2 | Le stockage local refuse désormais de fonctionner sur Vercel (disque non durable) au lieu de perdre des fichiers. Procédure de sauvegarde et de restauration conjointes, base et fichiers, documentée. | Exécuté : `pg_dump` + archive des fichiers → restauration dans une base neuve : tables identiques, 3 fichiers référencés sur 3 retrouvés ; une base restaurée sans ses fichiers est détectée (3 manquants). **Réussi.** | Supabase Storage (bucket privé) avant Vercel ; tester la restauration sur Supabase (PITR + Storage). |
| M01 | Confirmé | `src/server/actions/crm.ts` l. 235 et 294 ; `report-form.tsx` (`StepChoice`) | La validation d'une étape fermait **toutes** les actions ouvertes de cette étape. Désormais la proposition **montre** ces actions, chacune avec sa case : sont pré-cochées celles qui matérialisent l'étape (à faire, RDV à fixer, RDV fixé, en cours, bloqué) ; une relance ou une attente reste décochée. Seules les cases cochées sont fermées. Une étape déduite ne crée aucune action : seul le compte rendu lui-même compte comme visite (règle inchangée, `src/server/crm.ts` l. 123). | Navigateur (`test:e2e:relecture`) : une action « à faire » et une relance sur l'étape → la proposition coche l'action, pas la relance ; après validation, l'action est close et la relance reste ouverte. **Réussi.** | — |
| M02 | Confirmé | `src/modules/crm/report/structure.ts` l. 73 et 98 | Une phrase avec négation (« n'ai pas », « pas encore », « niet », « nog niet ») ou au futur (« sera », « va », « zal ») ne valide plus l'étape : elle est affichée comme « Non retenu ». Si plusieurs affaires correspondent, **rien n'est choisi** et les candidates sont listées. L'étape reste modifiable dans une liste. Les étapes ajoutées ou renommées sont reconnues par leur libellé ; un mot trop général (« premier ») ne suffit pas. | `crm-logic.test.ts`, bloc « relecture M02 » (4 tests) ; navigateur : « Je n'ai pas envoyé l'offre » → aucune étape, phrase montrée. **Réussi.** | Ce sont des règles locales ; l'IA reprendra le même contrat (source, ambiguïté, jamais de certitude implicite). |
| M03 | Confirmé | `src/server/actions/interventions.ts` l. 319 et 548 ; `inbound-form.tsx` ; dossier | « Confirmer la réception » depuis un email recevait **tout**. Désormais, ligne par ligne et avec la quantité, rien n'est coché d'office, et l'email dit que « disponible » n'est pas « reçue ». Le bouton « Pièce reçue » demande la quantité. On ne reçoit jamais plus que le reste attendu. Le dossier ne passe « à planifier » que si toutes les lignes actives sont entièrement reçues. | Navigateur : 1 reçu sur 3 → « Reçue en partie », dossier toujours en attente ; email « pièce disponible » rattaché sans cocher → aucune réception. **Réussi.** | — |
| M04 | Confirmé | `src/modules/interventions/pricing.ts` l. 65 ; `report-editor.tsx` | L'arrondi s'appliquait à chaque intervenant (7 + 7 min → 30 min). Désormais les temps travaillés s'additionnent puis le total est **arrondi une seule fois** (→ 15 min). L'écran détaille : présence, pauses déduites, temps réel, durée retenue avec l'arrondi, taux, total. Valeurs figées à la validation (et dans le PDF figé). | `interventions.test.ts` : deux fois 7 min → 15 min ; heures inversées et pause trop longue → 0 ; passage de minuit et changement d'heure (déjà couverts). Navigateur : détail affiché, 0 h 15 dans le PDF. **Réussi.** | **Décision à confirmer** par Fabrice : arrondi sur le total du passage (choix appliqué) ou par intervenant. |
| I01 | Confirmé | `src/modules/crm/import/columns.ts` l. 174 ; `import-flow.tsx` | La ressemblance compare le nom, la ville **et l'adresse quand les deux en ont une** : deux homonymes à des adresses différentes restent deux clients. Une ressemblance est une **proposition** : la case « Ce n'est pas le même : importer quand même » permet de garder les deux. Ni la TVA ni l'email ne servent de clé. | `columns.test.ts`, bloc « I01 / I03 ». **Réussi.** | — |
| I02 | Partiellement couvert | — | Un réimport ne crée ni doublon de client ni second contact : la ligne existante est signalée et ignorée. En revanche, **aucune mise à jour** n'est faite et les identifiants externes ne sont pas conservés. C'est annoncé à l'écran. | Couvert par les tests de doublons existants. | À faire avec la reprise des tâches et affaires : table de correspondance (organisation, source, type d'objet, identifiant externe en texte, identifiant local), prévisualisation créations / mises à jour / conflits, jamais d'écrasement par une cellule vide. Demande une migration. |
| I03 | Confirmé | `columns.ts` l. 224 | Une catégorie inconnue (« VIP ») n'invalide plus la ligne : client importé sans catégorie, avec un avertissement qui cite la valeur. Jamais transformée en C. Les messages du bilan sont maintenant traduits FR/NL (ils étaient en français en dur). | `columns.test.ts` ; parcours complet (la ligne « Z » est importée avec avertissement). **Réussi.** | — |
| U01 | Confirmé | `interventions.ts` (`validateReport`) ; `pdf.ts` ; `report-editor.tsx` | Option signature désactivée : le motif enregistré était « — ». Il devient le code `not_required`, imprimé « Signature non requise selon les réglages » (FR/NL), sans inventer de refus du client. **Correction du 12 octobre** : l'écran du rapport envoyait encore un motif caché « — » qui contournait la correction ; ce champ est supprimé, et le serveur impose maintenant ce motif quand l'option est désactivée. Les rapports déjà validés ne sont pas modifiés. | `relecture.test.ts` (la base accepte ce motif) ; navigateur : Tom, sans l'option signature, valide un rapport sans zone de signature, et le PDF porte « Signature non requise selon les réglages ». **Réussi** (le défaut a été trouvé par ce test). | — |
| P01 | Confirmé | `docs/pilote-fabrice.md` § 1 | Rien n'est présenté comme envoyé : les messages restent « En file », et la file n'est vidée par aucun traitement. La liste des intégrations indispensables au vrai parcours téléphone et des paramètres manquants est établie. | — | Auth, Storage, transcription, IA et Brevo restent à brancher (paramètres listés). |
| P02 | Confirmé, minimum fait | `src/app/drafts.tsx` l. 10 et 69 ; compte rendu, rapport, demande par email | Les textes du compte rendu, du rapport (fait, à faire, remarques) et de la demande par email sont **gardés sur l'appareil** à chaque frappe, restaurés à la réouverture (« Brouillon récupéré ») et effacés seulement après un envoi fait avec du réseau. Un bandeau signale l'absence de réseau. | Navigateur : brouillon retrouvé après rechargement ; bandeau affiché hors connexion. **Réussi.** | Photos et audio hors réseau, file d'envoi locale et reprise automatique : non faits. À traiter avant l'essai terrain si Fabrice travaille en zone blanche. |
| R01 | Documenté | `docs/pilote-fabrice.md` § 4 | Responsabilités, finalités, accès, conservation, suppression et sous-traitants sont décrits. Les décisions contractuelles (qui est responsable de traitement, accords de sous-traitance) sont séparées de ce que le code fait. | — | Décisions de Fabrice et d'AINHPRO, accords de sous-traitance avec les fournisseurs. |
| R02 | Confirmé | migration l. 106 ; `interventions.ts` l. 427 ; `pdf.ts` l. 17 et 151 | Les remarques du technicien partaient aussi au client final, et le PDF unique montrait le montant HTVA au client quand le donneur d'ordre payait. Désormais : deux PDF figés (donneur d'ordre / client final) ; le client n'a ni les remarques ni le tarif négocié (montant affiché seulement s'il paie, TVA comprise) ; chaque envoi enregistre son public. Bouton « PDF client final » pour relire avant l'envoi. | Navigateur : remarques présentes dans le PDF donneur d'ordre, absentes du PDF client ; envois `principal:true, principal:true, client:false`. **Réussi.** | Écran de relecture complet (contenu, pièces jointes) avant l'envoi réel, avec Brevo. |

### Tests complémentaires demandés

| Test | Résultat |
|---|---|
| Deux propriétaires partent en même temps : il en reste au moins un | `relecture.test.ts` l. 176, deux connexions réelles : le second départ attend le verrou puis est refusé (P0001). **Réussi.** |
| Deux acceptations simultanées d'une invitation | l. 197 : la seconde est refusée, un seul effet. **Réussi.** |
| Deux validations simultanées du même rapport | l. 219 : une seule version validée, un seul envoi en file. **Réussi.** |
| Connexion réutilisée après exception | l. 251 : aucune identité résiduelle. **Réussi.** |
| Heures, tarif, logo modifiés après validation | PDF identique octet pour octet (navigateur). **Réussi.** |
| Import, correction d'un contact, réimport | Pas de doublon (ligne signalée et ignorée) ; pas de mise à jour (I02). **Partiel.** |
| Réception partielle et email « pièce disponible » | Navigateur. **Réussi.** |
| Coupure réseau, fermeture, réouverture | Brouillon de texte retrouvé (rechargement). Photos : non couvertes. **Partiel.** |

## Résultats des commandes (exécutées le 10 octobre 2026)

| Commande | Résultat |
|---|---|
| `npm run typecheck` | Exécuté, **réussi** |
| `npm test` | Exécuté, **103 tests réussis** (7 fichiers) |
| `npm run test:db` | Exécuté, **101 tests réussis** (6 fichiers, dont 14 nouveaux dans `relecture.test.ts`) |
| `npm run build` | Exécuté, **réussi** |
| `npm run test:e2e` | Exécuté, **13 étapes sur 13**, aucune erreur navigateur |
| `npm run test:e2e:relecture` (nouveau) | Exécuté, **13 contrôles sur 13**, aucune erreur navigateur |
| Production locale (S02) et sauvegarde / restauration (D04) | Exécutés à la main, **réussis** (détail dans le tableau) |
| Supabase, Brevo, IA, transcription | **Non exécutés** : services non branchés |

Deux anciens tests ont été adaptés à la nouvelle règle D01 (ils réordonnaient ou retiraient des étapes d'un parcours suivi par des affaires ouvertes ; ils ferment maintenant ces affaires d'abord). Le parcours complet attend désormais 2 lignes importées au lieu d'1 (I03).

## Migration ajoutée et effet sur les données existantes

`20261013000001_relecture_v1.sql` :
- remplace les politiques des parcours et des étapes. Un membre garde la lecture ; aucune donnée n'est modifiée ;
- ajoute le déclencheur `protect_pipeline_in_use` ;
- ajoute `report_versions.pdf_path` et `client_pdf_path` (vides pour les versions existantes, qui gardent le PDF produit à la demande) et remplace la fonction de gel ;
- ajoute `outbound_messages.audience`, avec la valeur `principal` par défaut pour les lignes existantes. Aucune ligne existante n'était destinée au client avec des remarques dans les données de démonstration.

## Décisions métier encore nécessaires

1. **Arrondi des durées** : sur le total du passage (appliqué) ou par intervenant ?
2. **Responsable de traitement et sous-traitants** pour le pilote (R01).

## Conclusions

**Prêt pour le pilote de Fabrice : non, pas encore.** Le code local est prêt pour ce pilote : droits, intégrité des affaires et des rapports, import, réceptions et brouillons sont corrigés et testés. Conditions restantes :
1. Supabase (Francfort) branché : Auth par lien email (S02), base, Storage privé (D04) ;
2. déploiement Vercel Europe ;
3. vraie transcription et lecture IA pour tenir la promesse vocale : aujourd'hui, ce sont des règles locales, ce qui n'est qu'une recette d'interface ;
4. si Fabrice envoie des rapports depuis l'outil : Brevo avec le traitement d'envoi décrit (D03) ; sinon, il utilise les PDF ;
5. une restauration testée sur Supabase ;
6. réponses aux deux décisions ci-dessus.

**Prêt pour trois testeurs payants : non.** En plus des conditions du pilote :
1. isolation retestée avec Auth et Storage réels, avec propriétaires et membres ;
2. envois réels avec reprise et résultats incertains testés ;
3. reprise depuis un autre CRM avec identifiants externes et mises à jour (I02) ;
4. hors réseau étendu aux photos, avec une file locale ;
5. cadre RGPD signé (R01) ;
6. un parcours autonome d'un utilisateur d'un autre secteur, en moins de dix minutes, observé sans aide.
