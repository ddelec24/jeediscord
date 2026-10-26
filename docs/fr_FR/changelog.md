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
- Réception des messages (contenu, auteur, pièces jointes) et des réactions (emoji, auteur, ajout ou retrait)
