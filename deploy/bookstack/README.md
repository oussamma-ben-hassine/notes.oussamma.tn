# Remplacement de NoteVault par BookStack

Statut : préparation uniquement. Aucun déploiement, sauvegarde des données réelles,
enregistrement de client SSO ni test de connexion en production n'a été réalisé.
Ne pas basculer le domaine avant d'avoir terminé les vérifications ci-dessous.
L'application Node actuelle et son Dockerfile sont conservés pour le retour arrière.

## Déploiement Coolify

Créer une ressource Docker Compose à partir de la branche `deploy/bookstack-oidc`,
chemin `/deploy/bookstack/compose.yaml`. Ce fichier remplace le mode de construction
Dockerfile pour la nouvelle ressource ; il ne transforme pas automatiquement la
ressource existante. Conserver son identifiant, sa configuration et ses volumes.

Renseigner les variables de `environment.example` dans Coolify. Choisir des images
LinuxServer BookStack et MariaDB officiellement compatibles, tester leurs versions,
puis enregistrer leurs digests. Les champs vides sont volontaires : la configuration
refuse de démarrer sans ces valeurs et sans les secrets. Générer `APP_KEY` avec la
commande `appkey` de l'image LinuxServer retenue. Ne plus changer cette clé après
l'installation. Utiliser deux nouveaux mots de passe de base de données distincts.

Les volumes `bookstack-config` et `bookstack-database` sont nouveaux ; ne pas y
monter le volume NoteVault. La base ne publie aucun port hôte. Le proxy Coolify
doit cibler le service `bookstack`, port 80, avec HTTPS côté public. Ne pas recopier
le port 3000 ni le healthcheck `/health` de l'ancienne application.

Démarrer d'abord sur une URL de validation, restreinte à l'administrateur. Renseigner
`APP_URL` avec cette URL. La redirection OIDC doit correspondre à cette même URL.
Ne pas modifier DNS ou routage de production à ce stade.

## SSO exclusif

La configuration utilise exclusivement `AUTH_METHOD=oidc`, PKCE natif de BookStack,
identité `sub`, vérification TLS et découverte OIDC. Vérifier en ligne l'issuer exact,
les clés JWKS, RS256 et les claims `sub`, `email`, `name` ; le code du SSO les prévoit,
mais son déploiement actif n'a pas encore été vérifié.

Créer un client confidentiel dédié dans le SSO, avec Authorization Code, PKCE S256,
scopes `openid profile email` et redirection finale exacte :
`https://notes.oussamma.tn/oidc/callback`. Ajouter temporairement le callback de
l'URL de validation, puis le retirer après la bascule. Stocker son nouveau secret
uniquement dans Coolify ; ne pas réutiliser les valeurs du Dockerfile historique.

Avant de permettre l'accès général, lier le compte administrateur au `sub` SSO
vérifié via la commande BookStack documentée (dans le terminal du conteneur) :

```sh
php /app/www/artisan bookstack:create-admin --initial --email='ADMIN_EMAIL' --name='ADMIN_NAME' --external-auth-id='VERIFIED_SSO_SUB'
```

Ne pas attribuer automatiquement le rôle administrateur aux nouveaux comptes.
Définir un rôle par défaut minimal, désactiver l'accès public, puis tester avec deux
comptes que chacun ne voit que les livres autorisés. BookStack est un wiki avec des
permissions, pas un coffre privé automatiquement créé par utilisateur. Créer les
livres et rôles privés requis avant l'import. Ne pas supposer qu'un droit sur une
étagère protège automatiquement les livres qu'elle contient.

## Sauvegarde et contenu existant

NoteVault utilise `DATA_DIR/notes_store.json` (`/app/data` par défaut).
Localiser le montage réel dans Coolify avant toute action. Arrêter brièvement
NoteVault pour empêcher les écritures, copier l'intégralité du répertoire de données
et sauvegarder la configuration de déploiement et les secrets dans un emplacement
privé hors du dépôt. Vérifier le hash de la copie ; redémarrer NoteVault pendant
la préparation. Le script ci-dessous travaille sur cette copie et ne contacte aucun
service :

```sh
python3 deploy/bookstack/export-notevault.py /private/backup/notes_store.json /private/backup/export-bookstack
```

Il conserve le JSON complet octet pour octet (notes, dossiers, collaborateurs,
activités, historiques IA, métadonnées et jetons), plus des fichiers Markdown et
checklists séparés par propriétaire et un manifeste. Ces archives sont privées :
ne jamais les committer ni les publier. Les pièces jointes éventuelles doivent être
conservées avec le répertoire complet. Le script ne constitue pas un importeur
BookStack et ne convertit pas les liens, permissions, jetons de partage, historiques
ou Kanban en fonctionnalités BookStack. L'IA LiteLLM n'est pas intégrée par cette stack.

Importer les contenus après une correspondance explicite propriétaires SSO → comptes
BookStack → livres privés. Aucun import global dans un livre partagé. Vérifier les
comptages, checklists, liens et pièces jointes avec leurs propriétaires. Les anciens
liens de partage nécessitent une décision de migration ; ne pas les rendre publics
automatiquement. Si des utilisateurs continuent d'écrire dans NoteVault, refaire
l'export final pendant l'arrêt de bascule afin de récupérer les dernières notes.

## Bascule et retour arrière

1. Valider SSO, administrateur, création/édition/recherche, déconnexion, persistance
   après redémarrage et séparation des contenus entre deux utilisateurs.
2. Pendant l'arrêt final de NoteVault, réaliser et vérifier la sauvegarde finale,
   puis compléter l'import et les vérifications de contenu.
3. Passer BookStack à `APP_URL=https://notes.oussamma.tn`. Si le contenu a été créé
   sur l'URL de validation, exécuter la commande officielle `bookstack:update-url`
   avec l'ancienne et la nouvelle URL. Affecter le domaine au seul service BookStack
   dans le proxy Coolify. Conserver NoteVault arrêté et ses volumes intacts.
4. Valider HTTPS et un aller-retour SSO sur le domaine final, puis confirmer les
   permissions et les notes migrées. Retirer le callback de validation du SSO.
5. En cas d'échec : suspendre les écritures, sauvegarder les nouvelles données de
   BookStack, retirer son routage, remettre l'ancienne ressource et son domaine en
   service avec le stockage conservé. Réconcilier les éventuelles écritures nouvelles.

Ne jamais supprimer les volumes pour revenir en arrière (`down -v` interdit dans
cette procédure). Sauvegarder ensuite régulièrement la base MariaDB, `/config`,
`APP_KEY` et les secrets OIDC hors du serveur, et tester une restauration isolée.

## Références

- https://www.bookstackapp.com/docs/admin/oidc-auth/
- https://www.bookstackapp.com/docs/admin/commands/
- https://www.bookstackapp.com/docs/user/roles-and-permissions/
- https://docs.linuxserver.io/images/docker-bookstack/
