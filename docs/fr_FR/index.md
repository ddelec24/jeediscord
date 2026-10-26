# Plugin JeeDiscord

Le plugin **JeeDiscord** relie Jeedom à un serveur Discord grâce à un bot : envoi de messages depuis les scénarios, réception des messages et des réactions, questions (ask) avec boutons, etc.

Il s'appuie sur la bibliothèque [discord.js](https://discord.js.org/) v14 et sur l'API Discord v10.

> **Important**
>
> Le plugin est en cours de développement. Cette documentation sera complétée au fur et à mesure de l'ajout des fonctionnalités.

# Prérequis

- Jeedom 4.4 minimum
- Debian 12 minimum
- Node.js : installé automatiquement par Jeedom lors de l'installation des dépendances

# Créer le bot Discord

1. Rendez-vous sur le [portail développeur Discord](https://discord.com/developers/applications) et cliquez sur **New Application**.
2. Dans l'onglet **Bot**, cliquez sur **Reset Token** puis copiez le token. Il ne sera plus affiché ensuite : conservez-le en lieu sûr et ne le partagez jamais.
3. Toujours dans l'onglet **Bot**, section **Privileged Gateway Intents**, activez **Message Content Intent**. Les intents **Presence** et **Server Members** ne sont pas nécessaires.
4. Dans l'onglet **OAuth2 > URL Generator**, cochez les scopes `bot` et `applications.commands`, puis les permissions nécessaires (voir ci-dessous). Ouvrez l'URL générée pour inviter le bot sur votre serveur.

Permissions recommandées pour le bot :

| Permission | Utilisation |
|---|---|
| View Channels | Voir les salons surveillés |
| Send Messages | Envoyer des messages |
| Embed Links | Envoyer des messages enrichis (embeds) |
| Attach Files | Envoyer des fichiers et des captures |
| Read Message History | Retrouver les messages pour les modifier ou les supprimer |
| Add Reactions | Réagir aux messages |
| Manage Messages | Supprimer les messages (nettoyage) |
| Manage Channels | Renommer un salon ou modifier son sujet |

# Configuration du plugin

Après l'activation du plugin, installez les dépendances puis renseignez :

- **Token du bot** : le token copié à l'étape 2. Il est chiffré dans la base Jeedom et masqué dans les logs.
- **Type d'activité** et **Texte d'activité** : texte affiché sous le nom du bot dans Discord (par exemple « Personnalisé » + « Surveille la maison »). Laissez le texte vide pour ne rien afficher.
- **Port interne du démon** (avancé) : port local utilisé entre Jeedom et le démon. Ne le modifiez qu'en cas de conflit avec un autre plugin.

Le **statut du bot** indique si le démon est démarré et connecté à Discord, avec le nom du bot, le nombre de serveurs et la latence. La modification de l'activité est appliquée immédiatement, sans redémarrer le démon. La modification du token redémarre le démon.

# Le démon

Le démon est un programme Node.js unique qui maintient la connexion avec Discord. Il est conçu pour rester léger :

- il est lancé avec une priorité basse (`nice`) ;
- il ne demande à Discord que les événements utiles au plugin (serveurs, messages, réactions) ;
- ses caches sont limités (messages récents, membres) et purgés régulièrement.

**Respect des limites de Discord** : les limites de débit de l'API (par route et globale) sont gérées par discord.js, qui met les requêtes en attente au lieu de les perdre. Le plugin ajoute une file par salon, qui conserve l'ordre des actions et fusionne les mises à jour répétitives (par exemple un renommage de salon : seule la dernière valeur est envoyée).

**Connexion** : en cas de coupure réseau au démarrage, le démon retente la connexion avec un délai croissant (de 15 secondes à 5 minutes). Une fois connecté, les reconnexions sont automatiques. Si Discord refuse la connexion (token invalide, intent « Message Content » non activé), le démon s'arrête et n'est plus relancé automatiquement, afin de ne pas épuiser le quota de connexions journalier de Discord. Un message s'affiche dans le centre de messages : corrigez le problème puis sauvegardez la configuration du plugin.

# Logs

Le plugin utilise trois logs :

- `jeediscord` : actions côté Jeedom (démarrage du démon, événements reçus, erreurs) ;
- `jeediscord_daemon` : activité du démon et échanges avec Discord ;
- `jeediscord_packages` : installation des dépendances.

En niveau **Debug**, le log du démon détaille chaque requête envoyée à Discord (méthode, route, code de retour, quota restant), les limites de débit atteintes et les échanges avec Jeedom. Les informations sensibles sont systématiquement masquées (`***`) : token du bot, clé API Jeedom, jetons d'interaction et de webhook. Le token n'apparaît ni dans les logs ni dans la liste des processus du système.

# Configuration des équipements

Un équipement correspond à **un salon Discord**.

- **Salon** : liste des salons visibles par le bot, groupés par serveur. Elle est disponible quand le démon est connecté à Discord et se met à jour automatiquement quand un salon est créé, renommé ou supprimé. Le bouton d'actualisation force la mise à jour. La mention « droits insuffisants » signale un salon où le bot ne peut pas envoyer de messages.
- **Identifiant du salon** : renseigné automatiquement par la liste ci-dessus. Vous pouvez aussi le saisir à la main : dans Discord, activez le mode développeur (**Paramètres utilisateur > Avancés > Mode développeur**), puis faites un clic droit sur le salon et choisissez **Copier l'identifiant du salon**.
