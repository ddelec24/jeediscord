/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

'use strict';

/**
 * Commandes slash : /jeedom (interaction, scenario, cmd) et /clean.
 *
 * Elles sont enregistrées sur chaque serveur du bot (disponibles aussitôt, contrairement aux commandes globales).
 * Le démon ne décide de rien : il transmet la demande à Jeedom (événement slashCommand), qui vérifie le salon,
 * les rôles et exécute l'action. L'autocomplétion passe aussi par Jeedom (événement slashAutocomplete).
 */

const { ApplicationCommandOptionType: Type, PermissionFlagsBits, MessageFlags } = require('discord.js');
const log = require('./logger');
const { truncate } = require('./sender');

const AUTOCOMPLETE_TIMEOUT = 2500;

// Langues des descriptions : clé Discord -> traduction
const T = {
  jeedomDesc: { 'en-US': 'Control Jeedom', fr: 'Piloter Jeedom', 'es-ES': 'Controlar Jeedom', de: 'Jeedom steuern', it: 'Controllare Jeedom', 'pt-BR': 'Controlar o Jeedom', ru: 'Управление Jeedom' },
  interactionDesc: { 'en-US': 'Send a sentence to the Jeedom interactions', fr: 'Envoyer une phrase aux interactions Jeedom', 'es-ES': 'Enviar una frase a las interacciones de Jeedom', de: 'Einen Satz an die Jeedom-Interaktionen senden', it: 'Inviare una frase alle interazioni di Jeedom', 'pt-BR': 'Enviar uma frase às interações do Jeedom', ru: 'Отправить фразу в интеракции Jeedom' },
  textDesc: { 'en-US': 'Sentence to interpret', fr: 'Phrase à interpréter', 'es-ES': 'Frase a interpretar', de: 'Zu interpretierender Satz', it: 'Frase da interpretare', 'pt-BR': 'Frase a interpretar', ru: 'Фраза для обработки' },
  scenarioDesc: { 'en-US': 'Run or control a scenario', fr: 'Lancer ou contrôler un scénario', 'es-ES': 'Ejecutar o controlar un escenario', de: 'Ein Szenario starten oder steuern', it: 'Avviare o controllare uno scenario', 'pt-BR': 'Executar ou controlar um cenário', ru: 'Запустить сценарий или управлять им' },
  nameDesc: { 'en-US': 'Scenario', fr: 'Scénario', 'es-ES': 'Escenario', de: 'Szenario', it: 'Scenario', 'pt-BR': 'Cenário', ru: 'Сценарий' },
  actionDesc: { 'en-US': 'Action (default: start)', fr: 'Action (par défaut : lancer)', 'es-ES': 'Acción (por defecto: iniciar)', de: 'Aktion (Standard: starten)', it: 'Azione (predefinita: avvia)', 'pt-BR': 'Ação (padrão: iniciar)', ru: 'Действие (по умолчанию: запуск)' },
  start: { 'en-US': 'Start', fr: 'Lancer', 'es-ES': 'Iniciar', de: 'Starten', it: 'Avvia', 'pt-BR': 'Iniciar', ru: 'Запустить' },
  stop: { 'en-US': 'Stop', fr: 'Arrêter', 'es-ES': 'Detener', de: 'Stoppen', it: 'Ferma', 'pt-BR': 'Parar', ru: 'Остановить' },
  enable: { 'en-US': 'Enable', fr: 'Activer', 'es-ES': 'Activar', de: 'Aktivieren', it: 'Attiva', 'pt-BR': 'Ativar', ru: 'Включить' },
  disable: { 'en-US': 'Disable', fr: 'Désactiver', 'es-ES': 'Desactivar', de: 'Deaktivieren', it: 'Disattiva', 'pt-BR': 'Desativar', ru: 'Отключить' },
  cmdDesc: { 'en-US': 'Run an action command', fr: 'Exécuter une commande action', 'es-ES': 'Ejecutar un comando de acción', de: 'Einen Aktionsbefehl ausführen', it: 'Eseguire un comando azione', 'pt-BR': 'Executar um comando de ação', ru: 'Выполнить команду действия' },
  commandDesc: { 'en-US': 'Command', fr: 'Commande', 'es-ES': 'Comando', de: 'Befehl', it: 'Comando', 'pt-BR': 'Comando', ru: 'Команда' },
  valueDesc: { 'en-US': 'Value (slider, color, list or message)', fr: 'Valeur (curseur, couleur, liste ou message)', 'es-ES': 'Valor (control deslizante, color, lista o mensaje)', de: 'Wert (Schieberegler, Farbe, Liste oder Nachricht)', it: 'Valore (cursore, colore, elenco o messaggio)', 'pt-BR': 'Valor (controle deslizante, cor, lista ou mensagem)', ru: 'Значение (ползунок, цвет, список или сообщение)' },
  cleanDesc: { 'en-US': 'Delete old messages from this channel', fr: 'Supprimer les anciens messages de ce salon', 'es-ES': 'Eliminar los mensajes antiguos de este canal', de: 'Alte Nachrichten dieses Kanals löschen', it: 'Eliminare i vecchi messaggi di questo canale', 'pt-BR': 'Excluir as mensagens antigas deste canal', ru: 'Удалить старые сообщения этого канала' },
  daysDesc: { 'en-US': 'Only messages older than this many days (0 = all)', fr: 'Uniquement les messages de plus de ce nombre de jours (0 = tous)', 'es-ES': 'Solo mensajes de más de este número de días (0 = todos)', de: 'Nur Nachrichten, die älter als diese Anzahl Tage sind (0 = alle)', it: 'Solo i messaggi più vecchi di questo numero di giorni (0 = tutti)', 'pt-BR': 'Apenas mensagens com mais deste número de dias (0 = todas)', ru: 'Только сообщения старше этого числа дней (0 = все)' },
  allDesc: { 'en-US': "Delete everyone's messages, not only the bot's", fr: 'Supprimer les messages de tout le monde, pas seulement ceux du bot', 'es-ES': 'Eliminar los mensajes de todos, no solo los del bot', de: 'Nachrichten aller löschen, nicht nur die des Bots', it: 'Eliminare i messaggi di tutti, non solo quelli del bot', 'pt-BR': 'Excluir as mensagens de todos, não apenas as do bot', ru: 'Удалить сообщения всех, а не только бота' },
};
const desc = (key) => ({ description: T[key]['en-US'], descriptionLocalizations: omitDefault(T[key]) });
const omitDefault = (_map) => Object.fromEntries(Object.entries(_map).filter(([locale]) => locale !== 'en-US'));
const choice = (key, value) => ({ name: T[key]['en-US'], nameLocalizations: omitDefault(T[key]), value });

/**
 * Définition des commandes slash
 * @returns {Array<object>}
 */
function buildDefinitions() {
  return [
    {
      name: 'jeedom',
      ...desc('jeedomDesc'),
      options: [
        { type: Type.Subcommand, name: 'interaction', ...desc('interactionDesc'), options: [{ type: Type.String, name: 'text', ...desc('textDesc'), required: true, maxLength: 500 }] },
        {
          type: Type.Subcommand,
          name: 'scenario',
          ...desc('scenarioDesc'),
          options: [
            { type: Type.String, name: 'name', ...desc('nameDesc'), required: true, autocomplete: true },
            { type: Type.String, name: 'action', ...desc('actionDesc'), choices: [choice('start', 'start'), choice('stop', 'stop'), choice('enable', 'enable'), choice('disable', 'disable')] },
          ],
        },
        {
          type: Type.Subcommand,
          name: 'cmd',
          ...desc('cmdDesc'),
          options: [
            { type: Type.String, name: 'command', ...desc('commandDesc'), required: true, autocomplete: true },
            { type: Type.String, name: 'value', ...desc('valueDesc'), maxLength: 500 },
          ],
        },
      ],
    },
    {
      name: 'clean',
      ...desc('cleanDesc'),
      options: [
        { type: Type.Integer, name: 'days', ...desc('daysDesc'), minValue: 0, maxValue: 3650 },
        { type: Type.Boolean, name: 'all', ...desc('allDesc') },
      ],
    },
  ];
}

/* ****************************** Enregistrement ****************************** */

/**
 * Enregistre (ou retire) les commandes sur un serveur. Aucun appel d'écriture si elles sont déjà à jour.
 * @param {import('discord.js').Guild} _guild
 * @param {boolean} _enabled
 */
async function syncGuild(_guild, _enabled) {
  const definitions = _enabled ? buildDefinitions() : [];
  try {
    const existing = await _guild.commands.fetch();
    const upToDate = existing.size === definitions.length && definitions.every((definition) => {
      const current = existing.find((command) => command.name === definition.name);
      return current && current.equals(definition, true);
    });
    if (upToDate) {
      log.debug('[SLASH] ' + _guild.name + ' : commandes à jour');
      return;
    }
    await _guild.commands.set(definitions);
    log.info('[SLASH] ' + _guild.name + ' : ' + (_enabled ? definitions.length + ' commande(s) enregistrée(s)' : 'commandes retirées'));
  } catch (error) {
    if (error.code === 50001) {
      log.warning('[SLASH] ' + _guild.name + ' : accès refusé, réinvitez le bot avec le scope « applications.commands »');
    } else {
      log.error('[SLASH] ' + _guild.name + ' : enregistrement impossible : ' + error.message);
    }
  }
}

/**
 * @param {import('discord.js').Client} _client
 * @param {boolean} _enabled
 */
async function syncAll(_client, _enabled) {
  for (const guild of _client.guilds.cache.values()) {
    await syncGuild(guild, _enabled);
  }
}

/* ****************************** Interactions ****************************** */

function memberRoles(_interaction) {
  const member = _interaction.member;
  if (member && member.roles && member.roles.cache) {
    return member.roles.cache.map((role) => ({ id: role.id, name: role.name }));
  }
  return [];
}

function isAdmin(_interaction) {
  return Boolean(_interaction.memberPermissions && _interaction.memberPermissions.has(PermissionFlagsBits.Administrator));
}

async function onAutocomplete(_interaction, _context) {
  const focused = _interaction.options.getFocused(true);
  let choices = [];
  try {
    const request = _context.callback.request('slashAutocomplete', {
      kind: focused.name,
      query: String(focused.value).substring(0, 100),
      channelId: _interaction.channelId,
      roles: memberRoles(_interaction),
      admin: isAdmin(_interaction),
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), AUTOCOMPLETE_TIMEOUT));
    const result = await Promise.race([request, timeout]);
    if (result && Array.isArray(result.choices)) {
      choices = result.choices.slice(0, 25).map((c) => ({ name: truncate(String(c.name), 100), value: truncate(String(c.value), 100) }));
    }
  } catch (error) {
    log.debug('[SLASH] Autocomplétion en erreur : ' + error.message);
  }
  try {
    await _interaction.respond(choices);
  } catch (error) {
    // Délai de Discord dépassé : la saisie suivante relancera une demande
    log.debug('[SLASH] Autocomplétion non transmise : ' + error.message);
  }
}

async function onCommand(_interaction, _context) {
  await _interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const name = _context.name(_interaction);
  const options = _interaction.options;
  let message;
  try {
    const result = await _context.callback.request('slashCommand', {
      command: _interaction.commandName,
      sub: options.getSubcommand(false),
      options: {
        text: options.getString('text'),
        name: options.getString('name'),
        action: options.getString('action'),
        command: options.getString('command'),
        value: options.getString('value'),
        days: options.getInteger('days'),
        all: options.getBoolean('all'),
      },
      channelId: _interaction.channelId,
      user: { id: _interaction.user.id, name },
      roles: memberRoles(_interaction),
      admin: isAdmin(_interaction),
    });
    message = result && result.message ? String(result.message) : 'OK';
    if (result && result.ok && result.purge) {
      try {
        await _context.purge({ channelId: _interaction.channelId, ...result.purge });
      } catch (error) {
        message = '❌ ' + error.message;
      }
    }
    log.info('[SLASH] /' + _interaction.commandName + (options.getSubcommand(false) ? ' ' + options.getSubcommand(false) : '') + ' par ' + name + ' : ' + (result && result.ok ? 'exécuté' : 'refusé'));
  } catch (error) {
    log.error('[SLASH] Jeedom n\'a pas répondu : ' + error.message);
    message = 'Jeedom is unreachable.';
  }
  await _interaction.editReply({ content: truncate(message, 2000), allowedMentions: { parse: [] } });
}

/**
 * Point d'entrée des interactions : commandes slash et autocomplétion
 * @param {import('discord.js').Interaction} _interaction
 * @param {object} _context callback, name(interaction), purge(params)
 */
async function onInteraction(_interaction, _context) {
  try {
    if (_interaction.isAutocomplete()) {
      await onAutocomplete(_interaction, _context);
    } else if (_interaction.isChatInputCommand()) {
      await onCommand(_interaction, _context);
    }
  } catch (error) {
    log.error('[SLASH] ' + error.message);
    log.debug(error);
  }
}

module.exports = { buildDefinitions, syncGuild, syncAll, onInteraction };
