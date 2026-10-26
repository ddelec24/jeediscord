/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

'use strict';

/**
 * Composants interactifs : questions des scénarios (ask) et actions rapides.
 *
 * - Ask : boutons (jusqu'à 10 réponses) ou menu déroulant (jusqu'à 25) sous le message. Sans réponse proposée,
 *   le prochain message écrit dans le salon fait office de réponse. La réponse est transmise à Jeedom
 *   (événement askAnswer) ; après réponse ou délai, les composants sont désactivés.
 * - Actions rapides : boutons persistants dont l'identifiant (jdq:<id>) renvoie à une définition conservée par Jeedom.
 *   Jeedom vérifie les droits et exécute l'action, le démon affiche son résultat à l'utilisateur seul.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, ComponentType } = require('discord.js');
const log = require('./logger');
const { truncate } = require('./sender');

const ASK_PREFIX = 'jda:';
const QUICK_PREFIX = 'jdq:';
const MAX_BUTTON_ASK = 10;
const MAX_CHOICES = 25;
const MAX_ASKS = 100;
const MAX_TIMEOUT = 7 * 86400; // secondes
const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

const asks = new Map(); // identifiant du message -> question à boutons ou menu en attente
const textAsks = new Map(); // identifiant du salon -> question attendant le prochain message

/* ****************************** Construction ****************************** */

/**
 * Lignes de boutons (5 par ligne)
 * @param {Array<ButtonBuilder>} _buttons
 * @returns {Array<ActionRowBuilder>}
 */
function toRows(_buttons) {
  const rows = [];
  for (let i = 0; i < _buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(_buttons.slice(i, i + 5)));
  }
  return rows;
}

/**
 * Composants d'une question : boutons, ou menu déroulant au-delà de 10 réponses
 * @param {Array<string>} _answers
 * @param {string} _placeholder
 * @returns {Array<ActionRowBuilder>}
 */
function buildAskComponents(_answers, _placeholder) {
  if (_answers.length > MAX_CHOICES) {
    log.warning('[ASK] ' + _answers.length + ' réponses proposées, seules les ' + MAX_CHOICES + ' premières sont affichées');
  }
  const answers = _answers.slice(0, MAX_CHOICES);
  if (answers.length <= MAX_BUTTON_ASK) {
    return toRows(answers.map((answer, index) => new ButtonBuilder()
      .setCustomId(ASK_PREFIX + index)
      .setLabel(truncate(answer, 80))
      .setStyle(ButtonStyle.Primary)));
  }
  return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(ASK_PREFIX + 'menu')
    .setPlaceholder(truncate(_placeholder || '…', 150))
    .addOptions(answers.map((answer, index) => ({ label: truncate(answer, 100), value: String(index) }))))];
}

/**
 * Boutons des actions rapides (25 au maximum)
 * @param {Array<{id: string, label: string, style: string}>} _buttons
 * @returns {Array<ActionRowBuilder>}
 */
function buildQuickComponents(_buttons) {
  return toRows(_buttons.slice(0, 25).map((button) => new ButtonBuilder()
    .setCustomId(QUICK_PREFIX + button.id)
    .setLabel(truncate(button.label, 80))
    .setStyle(BUTTON_STYLES[button.style] ?? ButtonStyle.Secondary)));
}

/**
 * Copie des lignes d'un message avec tous les composants désactivés
 * @param {Array} _rows composants du message (lecture)
 * @param {string|null} _chosen identifiant du bouton choisi (mis en vert) ou valeur choisie du menu
 * @returns {Array<ActionRowBuilder>}
 */
function disableRows(_rows, _chosen = null) {
  const rows = [];
  for (const row of _rows || []) {
    if (row.type !== ComponentType.ActionRow) {
      continue;
    }
    const builder = new ActionRowBuilder();
    for (const component of row.components) {
      if (component.type === ComponentType.Button) {
        const button = ButtonBuilder.from(component).setDisabled(true);
        if (_chosen !== null && component.customId === _chosen) {
          button.setStyle(ButtonStyle.Success);
        }
        builder.addComponents(button);
      } else if (component.type === ComponentType.StringSelect) {
        builder.addComponents(StringSelectMenuBuilder.from(component).setDisabled(true));
      }
    }
    rows.push(builder);
  }
  return rows;
}

/* ****************************** Ask ****************************** */

/**
 * Prépare le suivi d'une question de scénario
 * @param {object} _ask cmdId, answers, timeout, labels
 * @returns {Array<ActionRowBuilder>} composants à joindre au dernier message (vide pour une réponse libre)
 */
function prepareAsk(_ask) {
  const answers = (Array.isArray(_ask.answers) ? _ask.answers : []).map((a) => String(a)).filter((a) => a !== '');
  return { answers, components: answers.length > 0 ? buildAskComponents(answers, _ask.labels && _ask.labels.choose) : [] };
}

/**
 * Enregistre la question une fois son message envoyé
 * @param {import('discord.js').Message} _message dernier message envoyé
 * @param {object} _ask
 * @param {Array<string>} _answers
 * @param {import('discord.js').Client} _client
 */
function registerAsk(_message, _ask, _answers, _client) {
  const timeout = Math.max(1, Math.min(MAX_TIMEOUT, Number(_ask.timeout) || 300));
  const labels = _ask.labels || {};
  const entry = { cmdId: _ask.cmdId, answers: _answers.slice(0, MAX_CHOICES), channelId: _message.channelId, labels };
  if (_answers.length === 0) {
    const previous = textAsks.get(_message.channelId);
    if (previous) {
      clearTimeout(previous.timer);
    }
    entry.message = _message;
    entry.timer = setTimeout(() => {
      textAsks.delete(_message.channelId);
      if (labels.timeout) {
        editNote(_message, labels.timeout);
      }
    }, timeout * 1000);
    textAsks.set(_message.channelId, entry);
    log.info('[ASK] Question libre en attente dans le salon ' + _message.channelId + ' (' + timeout + ' s)');
    return;
  }
  if (asks.size >= MAX_ASKS) {
    const oldest = asks.keys().next().value;
    clearTimeout(asks.get(oldest).timer);
    asks.delete(oldest);
  }
  entry.timer = setTimeout(() => expireAsk(_message.id, _client), timeout * 1000);
  asks.set(_message.id, entry);
  log.info('[ASK] Question à ' + entry.answers.length + ' réponse(s) en attente (' + timeout + ' s)');
}

/**
 * Ajoute une ligne à la fin du message de la question
 */
function editNote(_message, _note) {
  _message.edit({ content: truncate(_message.content + '\n\n' + _note, 2000), allowedMentions: { parse: [] } })
    .catch((error) => log.debug('[ASK] Message de la question non modifié : ' + error.message));
}

/**
 * Délai écoulé : désactive les composants et indique l'absence de réponse
 */
async function expireAsk(_messageId, _client) {
  const ask = asks.get(_messageId);
  if (!ask) {
    return;
  }
  asks.delete(_messageId);
  try {
    const channel = await _client.channels.fetch(ask.channelId);
    const message = await channel.messages.fetch(_messageId);
    const note = ask.labels.timeout ? '\n\n' + ask.labels.timeout : '';
    await message.edit({ content: truncate(message.content + note, 2000), components: disableRows(message.components) });
    log.info('[ASK] Délai écoulé sans réponse');
  } catch (error) {
    log.debug('[ASK] Message de la question non modifié : ' + error.message);
  }
}

/**
 * Message écrit dans un salon : réponse à une question libre en attente
 * @param {import('discord.js').Message} _message
 * @param {function(string, object): void} _send envoi d'un événement à Jeedom
 * @param {function(import('discord.js').Message): string} [_name] nom affiché de l'auteur
 * @returns {boolean} true si le message a servi de réponse
 */
function handleTextAnswer(_message, _send, _name = (m) => m.author.username) {
  const ask = textAsks.get(_message.channelId);
  const answer = _message.content.trim();
  if (!ask || answer === '') {
    return false;
  }
  clearTimeout(ask.timer);
  textAsks.delete(_message.channelId);
  log.info('[ASK] Réponse libre reçue');
  if (ask.labels.answered) {
    editNote(ask.message, ask.labels.answered.replace('%user%', _name(_message)).replace('%answer%', truncate(answer, 200)));
  }
  _send('askAnswer', { cmdId: ask.cmdId, answer, channelId: _message.channelId, messageId: _message.id, user: { id: _message.author.id } });
  return true;
}

async function onAskInteraction(_interaction, _send, _name) {
  const ask = asks.get(_interaction.message.id);
  if (!ask) {
    // Question expirée ou démon redémarré : on désactive simplement les composants
    await _interaction.update({ components: disableRows(_interaction.message.components) });
    return;
  }
  const index = _interaction.isStringSelectMenu() ? Number(_interaction.values[0]) : Number(_interaction.customId.substring(ASK_PREFIX.length));
  const answer = ask.answers[index];
  if (answer === undefined) {
    await _interaction.deferUpdate();
    return;
  }
  clearTimeout(ask.timer);
  asks.delete(_interaction.message.id);
  const name = _name(_interaction);
  const note = ask.labels.answered ? '\n\n' + ask.labels.answered.replace('%user%', name).replace('%answer%', answer) : '';
  await _interaction.update({
    content: truncate(_interaction.message.content + note, 2000),
    components: disableRows(_interaction.message.components, _interaction.isButton() ? _interaction.customId : null),
    allowedMentions: { parse: [] },
  });
  log.info('[ASK] Réponse « ' + truncate(answer, 40) + ' » de ' + name);
  _send('askAnswer', { cmdId: ask.cmdId, answer, channelId: _interaction.channelId, messageId: _interaction.message.id, user: { id: _interaction.user.id, name } });
}

/* ****************************** Actions rapides ****************************** */

async function onQuickInteraction(_interaction, _callback, _name) {
  await _interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const member = _interaction.member;
  let roles = [];
  if (member && member.roles && member.roles.cache) {
    roles = member.roles.cache.map((role) => ({ id: role.id, name: role.name }));
  }
  const name = _name(_interaction);
  let message;
  try {
    const result = await _callback.request('quickAction', {
      buttonId: _interaction.customId.substring(QUICK_PREFIX.length),
      channelId: _interaction.channelId,
      messageId: _interaction.message.id,
      user: { id: _interaction.user.id, name },
      roles,
    });
    message = result && result.message ? String(result.message) : 'OK';
    log.info('[QUICK] Bouton ' + _interaction.customId.substring(QUICK_PREFIX.length) + ' par ' + name + ' : ' + (result && result.ok ? 'exécuté' : 'refusé'));
  } catch (error) {
    log.error('[QUICK] Jeedom n\'a pas répondu : ' + error.message);
    message = 'Jeedom is unreachable.';
  }
  await _interaction.editReply({ content: truncate(message, 2000), allowedMentions: { parse: [] } });
}

/**
 * Point d'entrée des interactions Discord (boutons et menus)
 * @param {import('discord.js').Interaction} _interaction
 * @param {object} _context callback (Callback de lib/jeedom.js) et name (nom affiché d'un utilisateur)
 */
async function onInteraction(_interaction, _context) {
  if (!_interaction.isButton() && !_interaction.isStringSelectMenu()) {
    return;
  }
  try {
    if (_interaction.customId.startsWith(ASK_PREFIX)) {
      await onAskInteraction(_interaction, (event, data) => _context.callback.send(event, data), _context.name);
    } else if (_interaction.customId.startsWith(QUICK_PREFIX)) {
      await onQuickInteraction(_interaction, _context.callback, _context.name);
    }
  } catch (error) {
    log.error('[INTERACTION] ' + error.message);
    log.debug(error);
  }
}

/**
 * Arrête les délais en cours (arrêt du démon)
 */
function clearAll() {
  for (const ask of [...asks.values(), ...textAsks.values()]) {
    clearTimeout(ask.timer);
  }
  asks.clear();
  textAsks.clear();
}

module.exports = { prepareAsk, registerAsk, buildQuickComponents, handleTextAnswer, onInteraction, clearAll };
