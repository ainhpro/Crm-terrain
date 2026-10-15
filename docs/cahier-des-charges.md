# Cahier des charges — CRM commercial terrain

Version du 10 octobre 2026 · @Ainhpro · mise à jour : deux profils (commercial et technicien), parcours d'accueil, maquette validée en cours

## Vision et cible

Une application qui fait gagner une journée par semaine au commercial terrain indépendant : il importe ses clients, l'outil planifie ses tournées, il dicte ses rapports, et les relances partent toutes seules.

- **Utilisateurs cibles** : une seule application, deux profils. Le profil est choisi une seule fois, à l'inscription (premier écran pour tout le monde) ; il n'est plus proposé ensuite et ne se change que dans Réglages › Profil :
  - **Commercial terrain** seul ou en petite équipe (1 à 3 personnes) : agents multicartes, représentants de marques qui visitent des showrooms, distributeurs, installateurs ou magasins. Clients réguliers, visites récurrentes, relances.
  - **Technicien / SAV** : intervient chez des clients, souvent des particuliers, sur demande (email, rapport, appel). Photos, heures d'arrivée et de départ, rapport vocal, bon d'intervention.
  - **Les deux** : l'artisan qui vend et intervient lui-même.
  - Aujourd'hui, tous travaillent avec Excel, un carnet et leur mémoire.
- **Marché** : Belgique (francophone et néerlandophone), Luxembourg, puis France.
- **Promesse en une phrase** : « Tu sors de chez le client, tu parles une minute, et tout est à jour. »

**Différence avec les CRM existants** :

- Pensé pour la route, pas pour le bureau : mobile d'abord, vocal d'abord.
- Pipelines adaptés au métier du commercial, configurés par l'IA à l'inscription.
- Modules reliés au même fichier clients : tournées, rapports, offres, notes de frais, prospection.
- Prix et simplicité adaptés à un indépendant, pas à une PME de 50 personnes.

**Principe de conception** : simple, utile, très professionnel. On ne reprend pas la présentation du prototype, seulement sa logique métier. Maquette de référence : https://claude.ai/artifact/3Toq3BYmhz39pY6EpjJz6U

**Premier utilisateur** : Fabrice, avec ses données INDA (FACQ, STG, SAMO). Le prototype actuel sert de référence fonctionnelle.

**Produit neutre** (décision du 10 octobre 2026) : l'application est vendue à tout commercial ou technicien indépendant, quel que soit son secteur. Aucun nom de client, de marque ou de secteur dans le code ni dans l'interface. Un nouveau compte démarre avec :
- un parcours de vente générique « Vente » : Premier contact › Rendez-vous › Offre envoyée › Commande, que le propriétaire renomme, complète, réordonne ou réduit dans Réglages › Étapes de vente (une étape renommée garde son code et son historique ; une étape utilisée est retirée, jamais effacée) ; il peut ajouter d'autres parcours (ex. Location, Entretien annuel) ;
- pour un technicien, des types d'intervention génériques : SAV / dépannage, Installation, Entretien, Prise de mesure.

INDA n'est qu'un modèle de démarrage parmi d'autres (`src/modules/crm/templates/inda.ts`), utilisé pour le compte de Fabrice.

**Reprise depuis un autre CRM** : l'import reconnaît les exports courants (Teamleader, Pipedrive, HubSpot, Odoo, Salesforce, Zoho) et l'annonce ; prénom et nom séparés sont réunis en personne de contact, le numéro de rue rejoint l'adresse ; un export « une ligne par personne » crée le client une fois et lui ajoute chaque personne. La correspondance reste vérifiable avant import. À venir : reprise des affaires et de l'historique (à spécifier selon les CRM demandés par les testeurs).

## Périmètre par phases

La V1 doit suffire à faire payer trois commerciaux testeurs ; le reste vient seulement après leurs retours.

| Phase | Contenu | Objectif de sortie |
|---|---|---|
| V1 — Socle | Comptes, choix du profil, clients (import de tout fichier ou ajout à la main), pipelines configurables, rapport vocal, tâches, email du matin, relances, interventions technicien (demande depuis un email, photos, heures, bon d'intervention), FR + NL | Fabrice utilise l'outil chaque jour à la place du prototype ; 3 testeurs payants |
| V2 — Route | Planning de tournées, synchro Google Agenda et Outlook, notes de frais (tickets + kilomètres) | Planning hebdomadaire proposé et validé en moins de 10 minutes |
| V3 — Vente | Module offres (catalogue importé, modèle d'offre, PDF), suivi des offres | Une offre envoyée depuis le téléphone en moins de 5 minutes |
| V4 — Croissance | Module prospection (listes, emailing, séquences), connexions API (Teamleader, Odoo…), italien | Ouverture France et premières équipes de 2–3 commerciaux |

**Hors périmètre** : facturation, comptabilité, gestion de stock. L'outil s'arrête à l'offre (commercial) et au bon d'intervention (technicien). La facture est faite dans l'outil de facturation existant (Teamleader, Odoo, comptable…) : l'application lui envoie le bon d'intervention en un geste. En Belgique, la facture électronique via Peppol est obligatoire entre entreprises depuis le 1er janvier 2026 ; ne pas facturer dans l'outil évite d'en porter la conformité.

## Fonctionnalités détaillées

Chaque fonction est reliée au même fichier clients : un rapport vocal met à jour le pipeline, crée les tâches et nourrit le planning.

### 1. Socle (V1)

- Compte utilisateur (email + mot de passe ou lien magique), données de chaque compte strictement isolées.
- Fiche client : nom, groupe ou enseigne (ex. FACQ, STG), adresse, contacts, catégorie A/B/C, fréquence de visite, notes, historique.
- Actions : type, statut, date, note, client lié. Reprend la logique du prototype (À faire, RDV fixé, Terminé, Relance…).
- Vues reprises du prototype : Résumé, Actions (retard, aujourd'hui, relances, 7 jours), fiche client, Agenda, export Excel.
- Interface en français et néerlandais dès la V1.

### 2. Accueil et import des clients (V1)

À la première connexion, l'écran d'accueil propose deux choix seulement : **importer un fichier** ou **ajouter à la main** (et « je le ferai plus tard »).

**Ajout à la main** : nom, groupe ou enseigne (facultatif), adresse, contact, téléphone, importance A/B/C ; bouton « Enregistrer et ajouter un autre ».

**Import** :

1. L'utilisateur choisit un fichier : Excel, CSV, PDF, Word, export d'un autre logiciel ou photo d'une liste ; depuis le téléphone, Google Drive, OneDrive ou une pièce jointe d'email.
2. L'IA reconnaît les colonnes (nom, adresse, groupe, contact, téléphone) et propose une correspondance.
3. Aperçu des 10 premières lignes, l'utilisateur corrige si besoin.
4. Import, détection des doublons, géolocalisation des adresses en arrière-plan.

### 3. Pipelines configurables (V1)

- Ce qui est codé en dur dans le prototype (showrooms, types d'action, pipelines) devient un réglage par compte.
- À l'inscription, le commercial décrit son métier en 2–3 phrases ; l'IA propose un ou plusieurs pipelines (ex. « RDV → Offre → Commande → Placement » et « Formation meubles → Formation parois »).
- Modèles prêts à l'emploi par métier (représentant sanitaire, cuisine, matériaux…).
- Conservé du prototype : une étape avancée terminée valide automatiquement les étapes précédentes.
- Les étapes sont reconnues par un identifiant, jamais par le texte du libellé.

**Affaires** (décision du 10 octobre) : un pipeline se suit **par affaire**, pas seulement par client. Une affaire = un projet chez un client (ex. « MAJ showroom 2026 ») qui parcourt un pipeline. Un même client peut avoir plusieurs affaires, passées ou en cours, sur le même pipeline ; terminer l'une ne termine pas les autres. L'avancement d'une affaire est recalculé à partir de ses actions (jamais stocké). Une affaire peut être close (gagnée, perdue, abandonnée) sans passer par toutes les étapes.

Règles de cohérence :
- une étape a une position unique dans son pipeline ; changer l'ordre se fait en une fois ;
- une affaire ne peut utiliser qu'un pipeline commun au compte ou propre au groupe du client ;
- un pipeline ou une étape déjà utilisés ne sont jamais supprimés mais archivés : l'historique reste lisible ;
- une action ouverte est « réellement ouverte » si elle n'est pas terminée et que son étape n'est pas déjà validée par une étape plus avancée ; cette même définition sert pour les urgences, les retards et le statut.

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
- *Proposition par défaut, à confirmer* : le délai part de la **dernière visite réalisée** (sinon de la date d'import) ; il se compte en jours (6 semaines = 42 jours, 2 mois = 60, 3 mois = 90) ; une relance est un **rappel au commercial** (Actions et email du matin), jamais un email envoyé automatiquement au client.
- Les relances arrivent dans les Actions et l'email du matin.

### 6 bis. Interventions technicien (V1)

**Réglages de départ (une fois, modifiables dans Réglages)** :

- **Votre entreprise** : logo (photo ou fichier), nom de la société, adresse, téléphone, email, numéro de TVA (format vérifié, contrôle VIES possible), IBAN, conditions de paiement. Ces informations figurent automatiquement en tête et en pied de chaque rapport PDF et de chaque email. Elles servent aussi aux documents commerciaux (offres) plus tard. Le rapport reste un rapport d'intervention, pas une facture : l'outil de facturation reprend ces données et le montant.

- **Types d'intervention** : liste par compte, avec des modèles proposés (SAV, prise de mesure, placement showroom) et des types libres (ex. « Intervention Culligan »). Chaque type peut avoir ses propres champs (garantie pour un SAV, mesures pour une prise de mesure, produits installés pour un placement).
- **Donneurs d'ordre** : beaucoup de techniciens sont indépendants et travaillent pour plusieurs fournisseurs ou marques. Pour chacun : nom, une ou plusieurs adresses email nommées par service ou gamme de produits (ex. INDA : « parois de douche », « meubles » ; Culligan : « bureau »), type d'intervention par défaut. « Client particulier » reste possible sans donneur d'ordre.
- **Numéros de tickets facultatifs** : une intervention peut porter un ou plusieurs numéros de tickets (ceux du donneur d'ordre). Jamais obligatoires ; lus dans l'objet du mail quand ils existent, sinon saisis ou laissés vides.

**Placement showroom** : le technicien photographie les produits installés et note les numéros de tickets (facultatifs) ; le rapport de placement part au donneur d'ordre et au showroom après validation.

**Lignes à commander** : chaque besoin est une ligne avec une photo, soit de la notice de pose (référence lue automatiquement), soit de l'article abîmé (meuble ou autre, sans référence si elle est inconnue), une quantité et une remarque dictée ou écrite.

**Rapport clair pour le destinataire** : trois parties séparées, « Fait », « À commander », « À faire ensuite », plus heures, photos, tickets et signature.

**Prix sur le rapport** (au choix par intervention, valeur par défaut par type ou par donneur d'ordre) :
- à l'heure : taux horaire × durée entre l'arrivée et le départ (arrondi réglable) ;
- au forfait : montant saisi pour l'intervention.
Montants HTVA, calculés par le code, jamais par l'IA. Ce n'est pas une facture : le montant est repris par l'outil de facturation.

**Email automatique** : à la validation du rapport, l'email est rédigé automatiquement (objet avec le numéro de ticket, résumé, lignes à commander, remarques du technicien, rapport PDF et photos en pièces jointes). Le technicien coche les destinataires : le bureau concerné du fournisseur (ex. INDA parois de douche ou INDA meubles, Culligan), le client final, ou plusieurs à la fois. Le bon bureau est proposé d'office selon le donneur d'ordre, le type d'intervention et le produit. Il peut relire et modifier l'email, puis l'envoie.

**Dossiers synchronisés et recherche** : tous les rapports et dossiers sont les mêmes sur le téléphone et dans le navigateur du PC (même compte, synchronisation automatique). Chaque rapport PDF (et ses photos) est aussi copié automatiquement dans OneDrive et/ou Google Drive, au choix du technicien, dans un dossier par donneur d'ordre et par ticket. Recherche par numéro de ticket, client, adresse, référence de pièce ou date ; chaque dossier garde son historique complet (demande, rapports, emails envoyés, commandes, photos).

**Envoi automatique** : une fois le bon d'intervention validé par le technicien (un geste), il part sans autre action au donneur d'ordre, au client s'il le faut et vers la facturation. Aucun envoi sans cette validation.

1. **Demande** : le technicien transfère l'email ou le rapport du client (ou crée l'intervention à la main). L'IA propose client (nouveau ou existant), adresse, téléphone, problème, garantie probable ; le technicien vérifie.
   - **Numéro de demande** : si l'objet du mail (ou le rapport) contient un numéro de demande d'intervention (ex. « SAV n° 2026-0457 », numéro donné par le fabricant, le magasin ou le donneur d'ordre), il est lu et enregistré avec l'intervention. Le technicien peut aussi le saisir ou le corriger. Ce numéro apparaît dans la liste des interventions, sur le bon d'intervention et dans l'envoi vers la facturation ; on peut rechercher une intervention par ce numéro.
   - Un deuxième email portant le même numéro (relance, complément) est rattaché à l'intervention existante au lieu d'en créer une nouvelle (proposé, validé par le technicien). L'outil propose des créneaux ; « Planifier et prévenir le client ».
2. **Interventions du jour** : liste avec heure, problème, temps de trajet, garantie ou payant.
3. **Sur place** : heure d'arrivée notée en un geste (modifiable), durée qui tourne, photos (avant, pièce, après), demande du client rappelée.
4. **Fin** : heure de départ, rapport vocal structuré par l'IA (travaux réalisés, pièces utilisées, pièces à commander, remarques), photos jointes, signature du client sur l'écran.
5. **Pièces à commander** : sur place, le technicien peut demander une pièce qu'il n'a pas :
   - en photographiant la notice de pose (ou l'étiquette du produit) : l'IA lit la référence et la désignation ;
   - ou en la dictant (« j'ai besoin de la référence 4512-08 »), dans le rapport vocal ou à part ;
   - il vérifie référence, désignation, quantité et fournisseur (usine, fabricant), puis envoie la commande par email au fournisseur, avec le numéro de demande et les photos utiles. Rien ne part sans sa validation.
6. **Suivi du dossier** : tant qu'une pièce manque, l'intervention reste ouverte « en attente de pièce ». Le dossier montre chaque étape avec sa date (demande reçue, intervention, pièce commandée, pièce reçue, retour chez le client, clôturé) et depuis combien de jours on attend. Les pièces en attente apparaissent sur l'écran du jour et dans l'email du matin ; relance proposée au fournisseur après un délai réglable. La réception se signale de deux façons, au choix :
   - le technicien appuie lui-même sur « Pièce reçue » ;
   - un email arrive (bureau du fournisseur, Culligan pour dire que la machine est livrée, ou toute autre personne) et le technicien l'intègre au dossier (transfert vers l'adresse de l'application ou bouton « Intégrer cet email »). L'application rattache l'email au bon dossier grâce au numéro de ticket (ou au client), comprend ce qu'il annonce (pièce disponible, matériel livré…) et propose la mise à jour ; le technicien confirme.
   Ensuite, l'application propose un créneau de retour ou d'installation au client ; le dossier est clôturé après ce passage.
   Plus généralement, tout email lié à un dossier (complément, relance, livraison) peut y être intégré et apparaît dans son historique.
7. **Bon d'intervention** (PDF) : validé par le technicien, envoyé au client, et transmis en un geste à l'outil de facturation. Les durées sont calculées par le code, jamais par l'IA ; l'IA ne fixe aucun prix.

### 6 ter. Interventions : règles issues de la relecture du 10 octobre

Ces règles complètent et, en cas de conflit, remplacent le 6 bis. Le module n'est pas encore codé.

**Dossier et passages**
- Un **dossier** porte la demande, le donneur d'ordre, le client final, le lieu, les tickets et le suivi global. Il contient un ou plusieurs **passages** (diagnostic, pose, retour…). Chaque passage a sa planification, ses intervenants, ses heures, ses photos et son rapport. Un retour ne modifie jamais un passage précédent.
- Les heures se comptent **par passage et par intervenant** (travail à deux, remplacement).
- Le profil commercial / technicien est une **préférence de chaque utilisateur** (écrans), distincte des modules achetés par le compte et du rôle (propriétaire, membre).

**Personnes et lieux**
- On distingue **donneur d'ordre** (qui commande l'intervention), **client final** (chez qui), **lieu d'intervention** (une adresse parmi plusieurs possibles), **payeur** (donneur d'ordre, client final ou autre) et **contact sur place**. Le matériel concerné peut être noté (modèle, numéro de série).

**Tickets**
- Chaque dossier a un identifiant interne permanent. Les numéros de tickets sont enregistrés **avec leur émetteur** (donneur d'ordre) ; un même numéro chez deux donneurs d'ordre désigne deux dossiers différents. Un dossier peut n'avoir aucun ticket ou en avoir plusieurs. Quand un email semble concerner un dossier, le rattachement est **proposé**, jamais fait en silence.

**Imprévus du terrain**
- État du dossier et état du rendez-vous sont distincts. Issues prévues, avec motif : annulé, client absent, accès impossible, reporté, refus de signature. Un dossier clôturé peut être rouvert. Un rapport peut être validé sans signature (motif obligatoire) et sans email client (aucun destinataire inventé).

**Pièces**
- On distingue **besoin** (ligne « à commander »), **commande envoyée** (chaque envoi a son identifiant, son fournisseur et sa date) et **réception** (éventuellement partielle). Quantités suivies ; annulation et pièce de remplacement possibles. Le retour chez le client n'est proposé que quand toutes les pièces nécessaires sont reçues.

**Temps et prix** (*propositions par défaut, à confirmer*)
- Arrivée, départ et pauses sont des horodatages réels, dans le fuseau du compte (Europe/Brussels), corrigeables avec trace. On distingue **présence** et **durée facturable** (présence moins pauses, arrondie au quart d'heure supérieur par défaut, réglable).
- Le taux, la règle d'arrondi, la TVA et le montant sont **figés** dans la version validée du rapport ; un changement de tarif ne modifie jamais un ancien rapport. Calcul en centimes, par le code.
- Le document s'adapte au destinataire : le tarif négocié avec un donneur d'ordre n'est **jamais** montré au client final ; pour un particulier qui paie, le montant est affiché **TVA comprise**. Une garantie « probable » proposée par l'IA ne décide jamais qui paie.

**Validation et versions**
- Avant l'envoi, un récapitulatif montre le contenu, les destinataires et les pièces jointes ; un seul geste « Valider et envoyer ». Un brouillon peut être gardé. La version validée est **figée** (PDF, montant, signature) ; toute correction crée une nouvelle version, l'ancienne reste consultable. La signature du client porte sur une version précise.

**Terrain sans réseau**
- Dossiers du jour, brouillons, heures, photos et dictées sont gardés sur le téléphone et envoyés quand le réseau revient ; la file d'envoi est visible ; une modification faite en même temps sur le PC est signalée (conflit) au lieu d'être écrasée.

**IA et emails entrants**
- Tout champ lu par l'IA (référence, quantité, adresse, garantie…) est affiché à côté de sa source (extrait du mail, photo) ; une valeur incertaine est marquée à confirmer ; la saisie à la main reste possible.
- Un email reçu ne peut jamais, à lui seul, déclencher un envoi, une commande ou un changement de destinataire.
- Le compte qui reçoit un email est déterminé par **l'adresse de réception propre à ce compte**, jamais par le ticket ou l'expéditeur. Les réceptions sont authentifiées et dédupliquées ; le contenu HTML reçu est affiché isolé et nettoyé.

**Envois**
- Les emails partent d'un **domaine d'envoi authentifié** de l'application (SPF, DKIM), au nom du technicien, avec réponse vers sa propre adresse (Reply-To) ; plus tard, possibilité de connecter sa boîte.
- Chaque envoi passe par une **file persistante** avec un identifiant d'opération : une coupure ou un double clic ne provoque jamais de double envoi. Email, commande, facturation et copie cloud sont des envois séparés, chacun avec son état.
- Copies OneDrive / Google Drive : compte et dossier choisis par le technicien, échecs visibles et reprise possible, chemin fondé sur l'identifiant interne du dossier (pas seulement le ticket).

**Fichiers**
- Photos, PDF, signatures et audios sont en stockage **privé**, servis par liens temporaires après contrôle d'accès. Leur sauvegarde et leur restauration sont testées à part de la base de données.

**Langue**
- La langue du rapport et de l'email suit celle du **destinataire** (client NL, donneur d'ordre FR…), indépendamment de la langue de l'interface du technicien. Le document final est montré avant validation.

**Options activables par technicien**
- Chaque technicien n'utilise que ce dont il a besoin. Exemple : l'un fait SAV et showrooms, l'autre seulement des showrooms ; le second ne voit ni la garantie ni les pièces à commander.
- Deux niveaux, réglables à l'accueil puis dans Réglages :
  - **types d'intervention** attribués à chaque technicien (SAV, prise de mesure, placement showroom, types libres) ;
  - **options** : pièces à commander, prix sur le rapport, signature du client, garantie, numéros de tickets, emails entrants, copies OneDrive / Google Drive.
- Valeurs par défaut déduites des types choisis (showroom seul → pas de garantie ni de pièces) ; le technicien peut décocher lui-même ; le propriétaire du compte peut régler chaque technicien de son équipe.
- Désactiver une option masque ses écrans et ses champs, sans effacer les données déjà saisies ; la réactiver les fait réapparaître.
- *Proposition* : en V1, seuls les types d'intervention et 4 options (pièces, prix, signature, garantie) ; le reste dans un deuxième temps.

**Accueil technicien**
- Après le choix du métier, le technicien peut **créer ou intégrer tout de suite sa première demande**, sans importer de fichier clients ni tout régler. Types d'intervention, donneurs d'ordre et coordonnées de l'entreprise se complètent au fil de l'eau (proposés au moment où ils servent). L'import / ajout de clients reste le premier écran du commercial.

**Facturation et conformité**
- Le rapport n'est pas une facture. L'application montre ce qui a été transmis à l'outil de facturation, à qui, et ce qui reste à facturer.
- RGPD : rôles à documenter (le technicien est en principe responsable de traitement pour ses clients, l'application sous-traitant ; le donneur d'ordre selon le contrat), information des personnes photographiées ou citées, durées de conservation par type de donnée, effet d'une suppression sur les copies déjà diffusées (emails, clouds).
- Flux hors Supabase (IA, transcription, emails, clouds) à cartographier ; la promesse commerciale « hébergé en Europe » est adaptée aux garanties réellement obtenues.

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
| Inscription et configuration | Compte, langue, choix du profil une seule fois (commercial, technicien, les deux), description du métier, pipelines proposés par l'IA | V1 |
| Bienvenue / import | Importer un fichier ou ajouter à la main ; vérification des colonnes et des doublons avant import | V1 |
| Interventions (technicien) | Demande depuis un email, interventions du jour, sur place (heures, photos), bon d'intervention | V1 |
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
| Réglages | Profil (changer de métier), pipelines, règles de relance, heure de l'email du matin, modules, abonnement | V1 |

## Modèle de données

Toutes les tables portent un `organization_id` ; la base refuse qu'un compte lise les données d'un autre (Row Level Security de Supabase).

| Table | Champs principaux | Rôle |
|---|---|---|
| organizations | nom, langue, plan, modules actifs, profil (commercial, technicien, les deux), logo_url, adresse, téléphone, email, n° de TVA, IBAN, conditions de paiement | Le compte client (1 à 3 utilisateurs) |
| users | email, nom, organization_id, rôle | Les personnes qui se connectent |
| client_groups | nom, couleur | Enseignes ou groupes (ex. FACQ, STG, SAMO) |
| clients | nom, group_id, adresse, lat/lng, catégorie, fréquence, horaires, notes | Les clients et points de vente |
| contacts | client_id, nom, fonction, email, téléphone | Les personnes chez le client |
| pipelines | nom, ordre, group_id facultatif, archivé | Un pipeline configurable (ex. MAJ showroom) |
| deals | client_id, pipeline_id, nom, statut (ouverte, gagnée, perdue, abandonnée), dates | Les affaires : un projet chez un client qui parcourt un pipeline |
| pipeline_steps | pipeline_id, code, libellé, ordre | Les étapes, reconnues par leur code |
| actions | client_id, deal_id et step_id facultatifs, type, statut, date, note, auteur | Ce qui est fait ou à faire chez un client |
| visits | client_id, date, heure, statut, source agenda | Les visites planifiées ou réalisées |
| visit_reports | visit_id, audio_url, transcription, résumé, validé | Les rapports vocaux |
| tasks | client_id, report_id facultatif, texte, échéance, statut | Les choses à faire |
| intervention_types | nom, champs propres, ordre | Types d'intervention du compte (SAV, prise de mesure, placement showroom…) |
| principals, principal_addresses | nom ; adresses email nommées par service | Donneurs d'ordre et leurs bureaux |
| service_cases | identifiant interne, type, donneur d'ordre, client final, lieu, payeur, contact sur place, matériel, demande d'origine, garantie, état, langue du destinataire | Les dossiers d'intervention |
| case_references | case_id, émetteur (donneur d'ordre), numéro de ticket | Tickets, uniques par émetteur |
| visits_service | case_id, planification, état du rendez-vous, issue et motif | Les passages |
| visit_workers | passage, intervenant, arrivée, départ, pauses | Temps par intervenant |
| visit_media | passage, fichier privé, moment (avant, pièce, après, notice, article abîmé) | Photos et documents |
| part_needs, part_orders, part_receipts | besoin ; envoi identifié au fournisseur ; réception (quantité, date) | Pièces à commander et leur suivi |
| member_settings | organisation, utilisateur, profil (commercial, technicien), types d'intervention attribués, options activées | Préférences et options de chaque membre |
| report_versions | passage, numéro de version, contenu, taux, arrondi, TVA, montant figé, signature, statut (brouillon, validé, envoyé) | Rapports versionnés |
| outbound_messages | version, destinataire, canal, identifiant d'opération, état | File d'envois (emails, facturation, clouds) |
| inbound_messages | adresse de réception du compte, empreinte, dossier proposé, état de revue | Emails reçus et rattachements |
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
| Base, comptes, fichiers | Supabase, région Irlande (West EU) | Postgres, isolation des données par compte, stockage audio et photos |
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

1. Créer le dépôt GitHub, le projet Supabase (Irlande) et le projet Vercel.
2. Socle : comptes, organisations, clients, groupes, contacts, isolation testée.
3. Pipelines configurables et calcul des étapes déduites ; modèle neutre pour tout nouveau compte, pipelines INDA comme modèle pour Fabrice.
4. Import Excel avec reconnaissance des colonnes par l'IA (y compris exports d'autres CRM) ; import des clients INDA de Fabrice.
5. Écrans Aujourd'hui, Actions, Fiche client, Résumé, Agenda.
6. Rapport vocal : enregistrement, transcription, structuration, validation.
7. Tâches, relances automatiques, email du matin.
8. Traduction néerlandaise complète.
9. Fabrice utilise la V1 seul pendant 3 à 4 semaines.
10. Audit sécurité, puis ouverture à 3 commerciaux testeurs payants.

## Décisions prises

- Une seule application, deux profils (commercial, technicien) ; le client choisit une seule fois à l'inscription, « les deux » possible ; changement ensuite uniquement dans Réglages › Profil ; les deux profils sont disponibles dès le lancement.
- Pas de facture dans l'outil : bon d'intervention, puis envoi vers l'outil de facturation existant.
- Nouvelle présentation sobre et professionnelle (maquette), pas celle du prototype.
- PC : application dans le navigateur, plus copie automatique des rapports PDF dans OneDrive et Google Drive.
- Identité de l'entreprise (logo, coordonnées, TVA, IBAN, conditions) saisie une fois et imprimée sur tous les rapports et emails.
- Pipelines suivis par affaire (plusieurs affaires possibles chez un même client).
- Options activables par technicien (types d'intervention attribués, options pièces, prix, signature, garantie…), réglées à l'accueil puis dans Réglages, aussi par le propriétaire pour son équipe.
- Relecture du 10 octobre intégrée (§ 6 ter) : dossier et passages, temps par intervenant, tickets par émetteur, imprévus, versions figées, hors réseau, envois sans doublon, fichiers privés, langue du destinataire, accueil technicien rapide.
- Destinataires des rapports choisis à chaque envoi : bureau du fournisseur (adresse par service), client final, ou les deux.
- Réception d'une pièce ou d'un matériel : bouton « Pièce reçue » ou email intégré au dossier (reconnu par le numéro de ticket), toujours confirmé par le technicien.

## Questions ouvertes

- Nom du produit et nom de domaine.
- Structure juridique : via AINHPRO SRL ou une nouvelle société.
- Les trois premiers testeurs : quels commerciaux du réseau FACQ / STG ?
- Fournisseur de transcription vocale à retenir.
- Outils de facturation à connecter en premier (Teamleader, Odoo, autre ?) et format d'envoi du bon d'intervention.
- Prévenir le client du rendez-vous : email seulement, ou aussi SMS ?
- Temps et prix : arrondi au quart d'heure supérieur et pauses déduites par défaut ? (§ 6 ter, à confirmer)
- Relances : départ à la dernière visite, en jours, rappel interne seulement ? (§ 6, à confirmer)
- Arbitrages pipeline restants : tarif SAMO toujours livré même avec une action ouverte ; « RDV à fixer » et « Bloqué » ne démarrent pas une étape.
