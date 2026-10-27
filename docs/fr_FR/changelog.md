# Changelog plugin JeeDiscord

>**IMPORTANT**
>
>S'il n'y a pas d'information sur la mise à jour, c'est que celle-ci concerne uniquement de la mise à jour de documentation, de traduction ou de texte.

# 26/10/2026

- Création du plugin : structure, configuration du bot, équipement « salon Discord »
- Démon Node.js (discord.js 14) : connexion à Discord, activité du bot, files d'attente par salon, logs debug avec masquage des informations sensibles
- Statut du bot dans la configuration, liste des salons dans les équipements
- Commandes « Envoyer un message », « Envoyer un embed » et « Envoyer un fichier », avec formulaires dédiés dans les scénarios
- Mentions de membres, de rôles et de salons par leur nom
- Découpage automatique des longs messages, respect des limites de Discord (embeds, fichiers)
- Action « Demander » des scénarios : réponses en boutons (menu déroulant au-delà de 10) ou message libre (la question indique comment répondre), boutons désactivés et message complété après la réponse ou le délai
- Commande « Envoyer des actions rapides » : boutons persistants lançant une commande, un scénario (nom `[Groupe][Objet][Nom]`, `[Groupe][Nom]` accepté) ou une interaction, avec rôles autorisés, sélecteur de scénario et de commande dans le formulaire
- Correction : les formulaires de scénario « Envoyer un embed » et « Envoyer un fichier » n'enregistraient pas leurs champs
- Les erreurs inattendues d'une action rapide sont journalisées et signalées à l'utilisateur au lieu de bloquer la réponse
- Documentation : captures d'écran de la configuration, de l'équipement, des commandes et des formulaires de scénario
- Commandes « Modifier le dernier message envoyé » et « Supprimer le dernier message envoyé »
- Commande « Nettoyer le salon » (âge, messages du bot ou tous) et nettoyage automatique horaire selon la durée de conservation de l'équipement ; suppression en masse sous 14 jours, une par une au-delà
- Commandes « Renommer le salon » et « Modifier le sujet du salon » (salon vocal utilisable comme afficheur), avec fusion des demandes et prise en compte de la limite de Discord (2 changements toutes les 10 minutes)
- Commandes slash `/jeedom interaction`, `/jeedom scenario`, `/jeedom cmd` et `/clean`, avec autocomplétion, réservées aux administrateurs du serveur et aux rôles autorisés, dans les salons associés à un équipement actif ; descriptions traduites
- Commandes « Envoyer le résumé de la maison », « Envoyer le résumé d'un objet » et « Envoyer l'état des batteries », emojis personnalisables
- Surveillance des démons et des dépendances des plugins (toutes les 5 minutes) : alerte dans les salons qui l'ont demandée, puis message de retour à la normale
- Documentation de l'envoi des captures du plugin Caméra
- Commande « Envoyer le résumé d'un objet » : formulaire avec sélection de l'objet dans la liste des objets de Jeedom
- Correction : le nom de l'objet (résumé d'un objet) et l'âge (nettoyage du salon) s'effaçaient à la réouverture d'un scénario
- Documentation : procédure détaillée d'envoi des captures du plugin Caméra
- Envoi de fichiers : une adresse web (http, https) peut remplacer le chemin d'un fichier ; elle est téléchargée dans le dossier temporaire avant l'envoi (sous le nom `sendDiscord.<extension>`), puis supprimée
- Formulaire « Envoyer un embed » des scénarios redessiné : un champ par ligne, libellés alignés, listes Oui / Non à la place des cases à cocher, bouton de sélection d'une commande sur tous les champs de texte
- Documentation : présentation des fonctionnalités, section de dépannage, noms réels des paramètres des commandes slash
- Correction : les valeurs par défaut de la configuration (port du démon, commandes slash...) n'étaient pas enregistrées à l'installation
- Correction : les formulaires du plugin dans les scénarios (embed, fichier, actions rapides, nettoyage, résumé d'objet) sont désormais traduits dans la langue de Jeedom
- Documentation traduite dans les six langues du plugin, captures d'écran dans chaque langue, aperçu plus large
- Réception des messages (contenu, auteur, pièces jointes) et des réactions (emoji, auteur, ajout ou retrait)
