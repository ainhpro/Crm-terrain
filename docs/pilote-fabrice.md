# Préparation du pilote de Fabrice

Ce document accompagne la réponse à la relecture V1 (`docs/revue/2026-10-10-relecture-v1-reponse.md`). Il ne décrit que ce qui est nécessaire au pilote. Aucun service n'a été souscrit, aucun message réel n'a été envoyé.

## 1. Parcours téléphone visé et intégrations indispensables (P01)

Le parcours visé : connexion vérifiée → client ou dossier → compte rendu réel → proposition corrigible → validation → données persistantes → PDF, et envoi quand la fonction est utilisée.

| Étape | Aujourd'hui (local) | Indispensable pour le pilote | Paramètres manquants |
|---|---|---|---|
| Connexion vérifiée | Email seul, développement uniquement (refusé en production) | Supabase Auth : lien de connexion par email | Projet Supabase Francfort : URL, clé publique (anon), clé `service_role` (serveur uniquement), modèle d'email de connexion |
| Données persistantes | Postgres local qui reproduit Supabase | Base Supabase, migrations appliquées dans l'ordre | Même projet ; mot de passe de la base pour les migrations |
| Photos, signatures, PDF | Disque local (refusé sur Vercel) | Supabase Storage, bucket privé, accès servi après contrôle RLS | Nom du bucket ; politique de conservation |
| Hébergement | `next dev` / `next start` local | Vercel, région Europe | Projet Vercel, domaine, variables d'environnement (`SESSION_SECRET` ne sert plus en production) |
| Compte rendu réel | Dictée du navigateur si disponible, sinon micro du clavier ; structuration par règles locales | Transcription FR/NL hébergée en Europe, puis structuration par l'API Claude. Même contrat : proposition, source, ambiguïté signalée, validation | Fournisseur de transcription (à choisir) ; clé API Anthropic (côté serveur) |
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

## 3. Traitement d'envoi (D03), à coder avec Brevo

Déjà en place : la validation et la mise en file se font en une transaction, avec une clé stable par opération (`report:<version>:<destinataire>`, `order:<besoin>:<déjà commandé>`). Une double validation ne crée ni deuxième version ni deuxième message.

À coder, dans un traitement serveur nommé (`withService`, qui vérifie l'organisation) :
1. **Prendre un message** avec `for update skip locked`, passer son état à `sending` et poser une échéance de verrou. Deux traitements simultanés ne prennent jamais le même message.
2. **Appeler Brevo** en transmettant la clé du message (en-tête de corrélation), puis enregistrer l'identifiant renvoyé par Brevo et l'état `sent`.
3. **Résultat incertain** (coupure après l'appel, échéance du verrou dépassée sans réponse) : ne pas renvoyer automatiquement. Passer à `uncertain`, vérifier auprès de Brevo (événements ou webhook) grâce à la clé de corrélation, et sinon demander à l'utilisateur.
4. **Échec certain** (refus explicite) : `failed`, avec le motif, et un nouvel essai possible sur décision.

Tests à écrire : arrêt juste après l'acceptation par Brevo, double clic, deux traitements simultanés.

Brevo ne garantit pas l'absence de doublon. L'objectif est « au plus un envoi par opération, sauf cas incertain signalé ». Il ne faut pas promettre plus.

## 4. Données personnelles du pilote (R01)

| Point | Ce que fait le code | À décider (Fabrice / AINHPRO) |
|---|---|---|
| Responsabilités | — | Fabrice (ou sa société) est responsable de traitement pour ses clients ; AINHPRO, éditeur, est sous-traitant. À écrire dans un accord de sous-traitance. |
| Finalités | Suivi commercial, interventions, rapports | Liste à valider ; pas de prospection automatique |
| Données | Clients professionnels et particuliers : nom, adresse, téléphone, email ; photos de chantier ; signature ; textes dictés | Éviter les données sensibles dans les remarques (consigne d'usage) |
| Accès | Isolation par compte (RLS), rôles propriétaire / membre, fichiers servis après contrôle | Liste des personnes ayant accès au compte |
| Sous-traitants | Supabase (Francfort), Vercel (Europe), à venir : Anthropic (structuration), transcription, Brevo | Accords de sous-traitance et choix de régions ; ce qui est envoyé à chacun (texte seulement, jamais de photos à l'IA sans besoin) |
| Conservation | Rien n'est purgé automatiquement | Durées : dossiers SAV, photos, audios (supprimables après transcription, règle 10) |
| Suppression et export | Prévus par la règle 10, pas encore codés | Avant les testeurs payants |
| Journaux | Pas de contenu métier dans les journaux serveur | Durée de conservation des journaux Vercel et Supabase |

Corrections techniques déjà faites : les remarques internes ne partent plus au client final, et le tarif négocié n'est plus visible du client (R02).
