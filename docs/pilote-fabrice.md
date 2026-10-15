# Préparation du pilote de Fabrice

Mise en service technique : `docs/supabase.md`. Ce document accompagne la réponse à la relecture V1 (`docs/revue/2026-10-10-relecture-v1-reponse.md`). Il ne décrit que ce qui est nécessaire au pilote. Aucun service n'a été souscrit, aucun message réel n'a été envoyé.

## 1. Parcours téléphone visé et intégrations indispensables (P01)

Le parcours visé : connexion vérifiée → client ou dossier → compte rendu réel → proposition corrigible → validation → données persistantes → PDF, et envoi quand la fonction est utilisée.

| Étape | Aujourd'hui (local) | Indispensable pour le pilote | Paramètres manquants |
|---|---|---|---|
| Connexion vérifiée | **Code prêt** (lien + code par email, testé contre un faux Supabase) ; email seul en développement uniquement | Supabase Auth branché, SMTP Brevo pour écrire à Fabrice | Projet Supabase Irlande : URL, clé publique (anon), clé `service_role` (serveur uniquement), modèle d'email de connexion |
| Données persistantes | Postgres local qui reproduit Supabase | Base Supabase, migrations appliquées dans l'ordre | Même projet ; mot de passe de la base pour les migrations |
| Photos, signatures, PDF | **Code prêt** (Supabase Storage, bucket privé, testé contre un faux Supabase) ; disque local en développement | Bucket créé par `npm run supabase:setup` | Nom du bucket ; politique de conservation |
| Hébergement | `next dev` / `next start` local | Vercel, région Europe | Projet Vercel, domaine, variables d'environnement (dont `SESSION_SECRET`, qui signe la session de l'application) |
| Compte rendu réel | Dictée du navigateur si disponible, sinon micro du clavier. **Structuration par l'IA prête** (Claude, côté serveur, testée contre un faux service) : proposition sourcée, revérifiée par le code, puis validée par l'utilisateur ; règles locales si l'IA est absente ou indisponible. Même chose pour la lecture des emails de demande | Transcription FR/NL hébergée en Europe (enregistrement audio long, hors réseau) | Fournisseur de transcription (à choisir) ; `ANTHROPIC_API_KEY` (côté serveur) |
| Envoi des rapports | Mise en file seulement (« En file ») | Brevo avec un domaine authentifié (SPF, DKIM), plus le traitement d'envoi du § 3 | Compte Brevo, domaine d'envoi, adresse de réponse |

Tant qu'une ligne n'est pas branchée, l'interface ne la présente pas comme faite : les messages restent « En file », et la dictée locale n'est qu'une recette d'interface.

## 2. Sauvegarde et restauration (D04)

**Règle** : la base et les fichiers se sauvegardent et se restaurent ensemble. La base ne contient que le chemin des fichiers (photos, signatures, PDF, logo).

**Vérifié en local le 10 octobre 2026** : `pg_dump` de la base, archive du dossier de stockage, restauration dans une base neuve. Résultat : tables identiques, et chaque chemin référencé retrouvé (3 sur 3). Une base restaurée sans ses fichiers est détectée : 3 fichiers manquants.

Contrôle à refaire après toute restauration (liste des fichiers référencés, à comparer au stockage restauré) :

```sql
select storage_path from visit_media
union all select signature_path from report_versions where signature_path is not null
union all select pdf_path from report_versions where pdf_path is not null
union all select client_pdf_path from report_versions where client_pdf_path is not null
union all select logo_path from organizations where logo_path is not null;
```

**Sur Supabase**, avant les données réelles :
- activer la restauration à un instant donné de la base ;
- prévoir une copie régulière du bucket privé, car Supabase ne sauvegarde pas Storage avec la base ;
- faire une fois une restauration complète d'un dossier (base + fichiers) dans un projet de test, puis passer le contrôle ci-dessus.

Les copies OneDrive / Google Drive des PDF sont une commodité. Ce ne sont pas des sauvegardes, et elles ne sont pas branchées en V1.

## 3. Traitement d'envoi (D03) — fait, testé contre un faux Brevo

Ce qui existait déjà : la validation et la mise en file se font en une transaction, avec une clé stable par opération (`report:<version>:<destinataire>`, `order:<besoin>:<déjà commandé>`). Une double validation ne crée ni deuxième version ni deuxième message.

Traitement serveur nommé « envois » (`src/server/outbox.ts`, `src/server/brevo.ts`, migration `20261015000001_envois.sql`) :
1. **Prise en charge** avec `for update skip locked` et un verrou daté : deux traitements simultanés ne prennent jamais le même message.
2. **Envoi Brevo** au nom de l'entreprise (adresse d'expédition authentifiée, réponse vers l'email de l'entreprise), avec le PDF figé du bon public et la clé de l'opération en en-tête (`X-Mailin-custom`). L'identifiant renvoyé par Brevo est conservé.
3. **Résultat classé** :
   - Brevo a accepté → « Envoyé ».
   - Refus certain (adresse, clé) → « Échec », avec le motif.
   - Rien n'est parti (serveur injoignable, trop de demandes) → remis en file, 5 tentatives au plus.
   - Coupure, délai dépassé, erreur Brevo, ou traitement interrompu → **« À vérifier »**, jamais renvoyé d'office : l'utilisateur choisit « Renvoyer » ou « Il est bien parti ».
4. **Déclenchement** : juste après la validation ou la commande, sans faire attendre l'utilisateur. Un passage de rattrapage quotidien (`/api/envois`, protégé par `CRON_SECRET`) traite ce qui reste en file et les traitements interrompus.
5. **Les utilisateurs** ne peuvent que mettre en file des messages neufs : ni faux « envoyé », ni changement d'état.
6. **Commande sans adresse fournisseur** : elle est seulement notée, aucun email ne part.

Paramètres à fournir : `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (adresse d'un domaine authentifié dans Brevo : SPF, DKIM), `BREVO_SENDER_NAME` (facultatif), `CRON_SECRET`. Sans eux, rien ne part et les messages restent « En file ».

Brevo ne garantit pas l'absence de doublon. Ce qui est garanti : au plus un envoi par opération, sauf cas « À vérifier », qui est signalé et laissé à la décision de l'utilisateur.

Sur Vercel Hobby, les tâches planifiées sont limitées à une par jour (passage de rattrapage à 5 h UTC). Les envois normaux partent tout de suite, sans dépendre de ce passage.

## 4. Données personnelles du pilote (R01)

| Point | Ce que fait le code | À décider (Fabrice / AINHPRO) |
|---|---|---|
| Responsabilités | — | Fabrice (ou sa société) est responsable de traitement pour ses clients ; AINHPRO, éditeur, est sous-traitant. À écrire dans un accord de sous-traitance. |
| Finalités | Suivi commercial, interventions, rapports | Liste à valider ; pas de prospection automatique |
| Données | Clients professionnels et particuliers : nom, adresse, téléphone, email ; photos de chantier ; signature ; textes dictés | Éviter les données sensibles dans les remarques (consigne d'usage) |
| Accès | Isolation par compte (RLS), rôles propriétaire / membre, fichiers servis après contrôle | Liste des personnes ayant accès au compte |
| Sous-traitants | Supabase (Irlande), Vercel (Europe), Anthropic (structuration : seulement le texte dicté, les noms des étapes et des affaires du client, ou l'objet et le texte d'un email de demande ; jamais de photo, de prix ni de fichier), Brevo ; à venir : transcription | Accords de sous-traitance et choix de régions ; ce qui est envoyé à chacun (texte seulement, jamais de photos à l'IA sans besoin) |
| Conservation | Rien n'est purgé automatiquement | Durées : dossiers SAV, photos, audios (supprimables après transcription, règle 10) |
| Suppression et export | **Fait** (Réglages › Vos données) : export complet en archive .tar (tables + fichiers, propriétaire) ; suppression de l'entreprise (propriétaire, confirmation par le nom) ; suppression de son compte (les heures gardent le nom, les rapports restent justes) | Délai de réponse aux demandes, et qui les traite |
| Journaux | Pas de contenu métier dans les journaux serveur | Durée de conservation des journaux Vercel et Supabase |

Corrections techniques déjà faites : les remarques internes ne partent plus au client final, et le tarif négocié n'est plus visible du client (R02).
