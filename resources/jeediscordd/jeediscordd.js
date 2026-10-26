/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

'use strict';

/**
 * Démon du plugin JeeDiscord
 *
 * Arguments : --loglevel <niveau> --socketport <port> --callback <url> --pid <fichier> --config <fichier>
 * Le fichier --config (droits 0600, supprimé dès sa lecture) contient le token, l'apikey et l'activité.
 */

const { Client, GatewayIntentBits, Partials, Options, ActivityType, ChannelType, PermissionFlagsBits, RESTEvents, Events, version: djsVersion } = require('discord.js');
const log = require('./lib/logger');
const jeedom = require('./lib/jeedom');
const { KeyedQueue } = require('./lib/queue');
const sender = require('./lib/sender');
const interactions = require('./lib/interactions');
const cleaner = require('./lib/cleaner');
const slash = require('./lib/slash');

const args = jeedom.getArgs();
log.setLevel(args.loglevel || 'error');

/* ****************************** Constantes ****************************** */

const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice];
const ACTIVITY_TYPES = {
  custom: ActivityType.Custom,
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};
const CHANNELS_DEBOUNCE = 3000;
const SHUTDOWN_TIMEOUT = 5000;
const CHANNEL_NAME_MAX = 100;
const CHANNEL_TOPIC_MAX = 1024;
const LOGIN_RETRY_BASE = 15; // secondes
const LOGIN_RETRY_MAX = 300; // secondes

/* ****************************** État ****************************** */

let config;
let callback;
let server;
let client;
let channelsTimer = null;
let shuttingDown = false;
const startedAt = Date.now();
const queue = new KeyedQueue({ maxSize: 100 });
const lastSent = new Map(); // salon -> identifiants des messages du dernier envoi (modification, suppression)
let watchedChannels = new Set(); // salons associés à un équipement actif : seuls leurs événements sont transmis

/* ****************************** Discord ****************************** */

/**
 * Construit la présence du bot à partir du type et du texte d'activité
 * @param {string} _type
 * @param {string} _text
 */
function buildPresence(_type, _text) {
  const text = String(_text || '').trim().substring(0, 128);
  if (text === '') {
    return { activities: [], status: 'online' };
  }
  const type = ACTIVITY_TYPES[_type] ?? ActivityType.Custom;
  if (type === ActivityType.Custom) {
    return { activities: [{ name: 'Custom Status', state: text, type }], status: 'online' };
  }
  return { activities: [{ name: text, type }], status: 'online' };
}

/**
 * Liste des serveurs et des salons utilisables par le plugin (texte, annonces, vocal)
 * @returns {Array<object>}
 */
function listChannels() {
  const result = [];
  for (const guild of client.guilds.cache.values()) {
    const me = guild.members.me;
    const channels = [];
    for (const channel of guild.channels.cache.values()) {
      if (!CHANNEL_TYPES.includes(channel.type)) {
        continue;
      }
      const permissions = me ? channel.permissionsFor(me) : null;
      channels.push({
        id: channel.id,
        name: channel.name,
        type: channel.type === ChannelType.GuildVoice ? 'voice' : 'text',
        parent: channel.parent ? channel.parent.name : '',
        position: channel.rawPosition,
        parentPosition: channel.parent ? channel.parent.rawPosition : -1,
        canView: permissions ? permissions.has(PermissionFlagsBits.ViewChannel) : false,
        canSend: permissions ? permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]) : false,
        canManage: permissions ? permissions.has(PermissionFlagsBits.ManageChannels) : false,
      });
    }
    channels.sort((a, b) => a.parentPosition - b.parentPosition || a.position - b.position);
    result.push({ id: guild.id, name: guild.name, channels });
  }
  return result;
}

/**
 * Envoie la liste des salons à Jeedom, regroupée si plusieurs changements arrivent en rafale
 */
function scheduleChannelsUpdate() {
  if (channelsTimer) {
    clearTimeout(channelsTimer);
  }
  channelsTimer = setTimeout(() => {
    channelsTimer = null;
    if (client.isReady()) {
      callback.send('channels', { guilds: listChannels() });
    }
  }, CHANNELS_DEBOUNCE);
}

function createClient() {
  const discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    // Permet de recevoir les réactions sur des messages absents du cache (anciens messages)
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
    presence: buildPresence(config.activityType, config.activity),
    // Caches réduits au strict nécessaire pour limiter la mémoire
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 25,
      PresenceManager: 0,
      VoiceStateManager: 0,
      StageInstanceManager: 0,
      GuildScheduledEventManager: 0,
      GuildStickerManager: 0,
      GuildInviteManager: 0,
      GuildBanManager: 0,
      AutoModerationRuleManager: 0,
      ThreadManager: 0,
      ThreadMemberManager: 0,
      GuildMemberManager: {
        maxSize: 50,
        keepOverLimit: (member) => member.id === member.client.user.id,
      },
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: { interval: 900, lifetime: 1800 },
      users: { interval: 3600, filter: () => (user) => user.id !== user.client.user.id },
    },
    rest: {
      // Avertit tous les 50 appels invalides (401/403/429) : Discord bannit temporairement
      // l'adresse IP au-delà de 10 000 appels invalides en 10 minutes
      invalidRequestWarningInterval: 50,
    },
    allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
  });

  /* ---------- Journalisation ---------- */
  discordClient.on(Events.Debug, (message) => log.debug('[DISCORD] ' + message));
  discordClient.on(Events.Warn, (message) => log.warning('[DISCORD] ' + message));
  discordClient.on(Events.Error, (error) => log.error('[DISCORD] ' + error.message));

  discordClient.rest.on(RESTEvents.Response, (request, response) => {
    if (!log.isDebug()) {
      return;
    }
    const remaining = response.headers.get('x-ratelimit-remaining');
    const limit = response.headers.get('x-ratelimit-limit');
    const bucket = remaining !== null ? ' [quota ' + remaining + '/' + limit + ']' : '';
    log.debug('[REST] ' + request.method + ' ' + request.path + ' -> ' + response.status + bucket);
  });
  discordClient.rest.on(RESTEvents.RateLimited, (info) => {
    log.info('[REST] Limite de débit atteinte (' + (info.global ? 'globale' : info.scope) + ') sur ' + info.method + ' ' + info.route + ', reprise dans ' + info.retryAfter + ' ms');
  });
  discordClient.rest.on(RESTEvents.InvalidRequestWarning, (info) => {
    log.warning('[REST] ' + info.count + ' requêtes invalides sur la période en cours (réinitialisation dans ' + Math.round(info.remainingTime / 1000) + ' s)');
  });

  /* ---------- Connexion ---------- */
  discordClient.once(Events.ClientReady, (readyClient) => {
    log.info('[DISCORD] Connecté en tant que ' + readyClient.user.tag + ' (' + readyClient.guilds.cache.size + ' serveur(s))');
    callback.send('ready', {
      bot: {
        id: readyClient.user.id,
        username: readyClient.user.username,
        tag: readyClient.user.tag,
        avatar: readyClient.user.displayAvatarURL({ size: 64 }),
      },
      guilds: listChannels(),
      versions: { node: process.version, discordjs: djsVersion },
    });
    slash.syncAll(readyClient, config.slashEnabled !== false);
  });
  discordClient.on(Events.ShardDisconnect, (event) => {
    log.warning('[DISCORD] Déconnecté de la passerelle (code ' + event.code + ')');
    callback.send('status', { connected: false, code: event.code });
  });
  discordClient.on(Events.ShardReconnecting, () => log.info('[DISCORD] Reconnexion en cours...'));
  discordClient.on(Events.ShardResume, (id, replayed) => {
    log.info('[DISCORD] Session reprise (' + replayed + ' événement(s) rejoué(s))');
    callback.send('status', { connected: true });
  });

  /* ---------- Salons ---------- */
  for (const event of [Events.ChannelCreate, Events.ChannelDelete, Events.ChannelUpdate, Events.GuildCreate, Events.GuildDelete, Events.GuildUpdate, Events.GuildRoleUpdate]) {
    discordClient.on(event, scheduleChannelsUpdate);
  }

  /* ---------- Messages et réactions reçus ---------- */
  discordClient.on(Events.MessageCreate, onMessage);
  discordClient.on(Events.InteractionCreate, (interaction) => {
    const context = { callback, name: (i) => displayName(i.user, i.member), purge: (params) => actions.purge(params) };
    interactions.onInteraction(interaction, context);
    slash.onInteraction(interaction, context);
  });
  discordClient.on(Events.GuildCreate, (guild) => slash.syncGuild(guild, config.slashEnabled !== false));
  const reactionError = (error) => log.error('[RECEIVE] Réaction non traitée : ' + error.message);
  discordClient.on(Events.MessageReactionAdd, (reaction, user) => onReaction(reaction, user, true).catch(reactionError));
  discordClient.on(Events.MessageReactionRemove, (reaction, user) => onReaction(reaction, user, false).catch(reactionError));

  return discordClient;
}

/**
 * Nom affiché d'un auteur : surnom sur le serveur, sinon nom d'affichage, sinon nom d'utilisateur
 * @param {import('discord.js').User} _user
 * @param {import('discord.js').GuildMember|null} _member
 */
function displayName(_user, _member) {
  return (_member && _member.displayName) || _user.globalName || _user.username || '';
}

/**
 * Message reçu dans un salon surveillé (les messages du bot lui-même et les messages système sont ignorés)
 * @param {import('discord.js').Message} _message
 */
function onMessage(_message) {
  if (!watchedChannels.has(_message.channelId) || _message.system || _message.author.id === client.user.id) {
    return;
  }
  const data = {
    channelId: _message.channelId,
    messageId: _message.id,
    content: _message.content,
    author: {
      id: _message.author.id,
      name: displayName(_message.author, _message.member),
      username: _message.author.username,
      bot: Boolean(_message.author.bot || _message.webhookId),
    },
    attachments: _message.attachments.map((a) => ({ name: a.name, url: a.url, contentType: a.contentType, size: a.size })),
    replyTo: _message.reference ? _message.reference.messageId : null,
  };
  interactions.handleTextAnswer(_message, (event, payload) => callback.send(event, payload), (m) => displayName(m.author, m.member));
  log.info('[RECEIVE] Message de ' + data.author.name + ' dans #' + (_message.channel.name || _message.channelId) + ' (' + data.content.length + ' caractères, ' + data.attachments.length + ' pièce(s) jointe(s))');
  callback.send('message', data);
}

/**
 * Réaction ajoutée ou retirée sur un message d'un salon surveillé
 * @param {import('discord.js').MessageReaction} _reaction
 * @param {import('discord.js').User} _user
 * @param {boolean} _added
 */
async function onReaction(_reaction, _user, _added) {
  const channelId = _reaction.message.channelId;
  if (!watchedChannels.has(channelId) || _user.id === client.user.id) {
    return;
  }
  let user = _user;
  if (user.partial) {
    try {
      user = await user.fetch();
    } catch (error) {
      log.debug('[RECEIVE] Utilisateur ' + user.id + ' non récupéré : ' + error.message);
    }
  }
  const member = _reaction.message.guild ? _reaction.message.guild.members.cache.get(user.id) : null;
  const emoji = _reaction.emoji;
  const data = {
    channelId,
    messageId: _reaction.message.id,
    added: _added,
    // Emoji unicode tel quel, emoji personnalisé sous la forme :nom:
    emoji: emoji.id ? ':' + emoji.name + ':' : emoji.name,
    emojiId: emoji.id || null,
    user: { id: user.id, name: displayName(user, member), bot: Boolean(user.bot) },
  };
  log.info('[RECEIVE] Réaction ' + data.emoji + (_added ? ' ajoutée' : ' retirée') + ' par ' + data.user.name);
  callback.send('reaction', data);
}

/**
 * Met à jour la liste des salons surveillés
 * @param {Array<string>} _channels
 */
function setWatchedChannels(_channels) {
  watchedChannels = new Set((Array.isArray(_channels) ? _channels : []).filter((id) => /^[0-9]{17,20}$/.test(String(id))).map(String));
  log.info('[RECEIVE] ' + watchedChannels.size + ' salon(s) surveillé(s)');
  log.debug('[RECEIVE] Salons surveillés : ' + [...watchedChannels].join(', '));
}

/**
 * Traduit les erreurs de connexion fatales en message compréhensible
 * @param {Error} _error
 * @returns {{code: string, message: string}}
 */
function describeLoginError(_error) {
  const text = String(_error && _error.message);
  if (_error && (_error.code === 'TokenInvalid' || /invalid token/i.test(text))) {
    return { code: 'TokenInvalid', fatal: true, message: 'Token du bot invalide' };
  }
  if (/disallowed intents/i.test(text) || (_error && _error.code === 4014)) {
    return { code: 'DisallowedIntents', fatal: true, message: 'Intent « Message Content » non activé sur le portail développeur Discord' };
  }
  // Erreur réseau ou passagère : Jeedom relancera le démon
  return { code: 'LoginError', fatal: false, message: log.redact(text) };
}

/* ****************************** Actions Jeedom ****************************** */

/**
 * Erreur métier renvoyée à Jeedom avec un code HTTP
 */
class ActionError extends Error {
  constructor(_message, _statusCode = 400) {
    super(_message);
    this.statusCode = _statusCode;
  }
}

function requireReady() {
  if (!client || !client.isReady()) {
    throw new ActionError('Bot not connected to Discord', 503);
  }
}

const actions = {
  async ping() {
    return {
      ready: Boolean(client && client.isReady()),
      bot: client && client.user ? { id: client.user.id, tag: client.user.tag } : null,
      guilds: client && client.isReady() ? client.guilds.cache.size : 0,
      wsPing: client && client.ws.ping !== null ? client.ws.ping : -1,
      uptime: Math.round((Date.now() - startedAt) / 1000),
      queue: queue.size(),
      memory: Math.round(process.memoryUsage().rss / 1048576),
      versions: { node: process.version, discordjs: djsVersion },
    };
  },

  async setActivity(_params) {
    // Mémorisée dans tous les cas : appliquée à la prochaine connexion si le bot n'est pas encore connecté
    config.activityType = _params.type;
    config.activity = _params.text;
    if (client && client.isReady()) {
      client.user.setPresence(buildPresence(config.activityType, config.activity));
      log.info('[DISCORD] Activité mise à jour');
    }
    return true;
  },

  /**
   * Active ou désactive les commandes slash (enregistrées sur chaque serveur)
   * @param {object} _params enabled
   */
  async setSlash(_params) {
    config.slashEnabled = Boolean(_params.enabled);
    if (client && client.isReady()) {
      slash.syncAll(client, config.slashEnabled);
    }
    return true;
  },

  async getChannels() {
    requireReady();
    return listChannels();
  },

  async setChannels(_params) {
    setWatchedChannels(_params.channels);
    return { count: watchedChannels.size };
  },

  /**
   * Envoi d'un message (texte, embed, fichiers) dans un salon.
   * Les fichiers sont lus immédiatement, puis l'envoi est placé dans la file du salon :
   * Jeedom n'attend pas la fin de l'envoi. Le résultat est transmis par l'événement messageSent.
   * @param {object} _params channelId, content, embed, files, defaultColor, eqLogicId
   */
  async send(_params) {
    requireReady();
    const channel = await getTextChannel(_params.channelId);
    let embedParams = _params.embed && typeof _params.embed === 'object' ? _params.embed : null;
    const embedHasData = (_embed) => ['title', 'description', 'image', 'thumbnail'].some((key) => String(_embed[key] ?? '').trim() !== '') || (Array.isArray(_embed.fields) && _embed.fields.length > 0);
    if (embedParams && !embedHasData(embedParams)) {
      embedParams = null;
    }
    const paths = Array.isArray(_params.files) ? _params.files.filter((f) => typeof f === 'string' && f !== '') : [];
    // Image d'embed désignée par un chemin local : envoyée comme pièce jointe
    if (embedParams && embedParams.image && !/^https?:\/\//i.test(embedParams.image)) {
      paths.unshift(embedParams.image);
      delete embedParams.image;
    }
    // Question de scénario (boutons, menu) ou actions rapides : composants joints au dernier message
    let components = [];
    let ask = null;
    let askAnswers = [];
    if (_params.ask && typeof _params.ask === 'object') {
      ask = _params.ask;
      const prepared = interactions.prepareAsk(ask);
      askAnswers = prepared.answers;
      components = prepared.components;
    } else if (Array.isArray(_params.buttons) && _params.buttons.length > 0) {
      components = interactions.buildQuickComponents(_params.buttons);
    }
    checkPermissions(channel, { embed: Boolean(embedParams), files: paths.length > 0 });
    const { files, errors } = sender.loadFiles(paths, sender.getUploadLimit(channel.guild));
    const hasContent = String(_params.content ?? '').trim() !== '';
    if (!hasContent && !embedParams && files.length === 0 && components.length === 0) {
      throw new ActionError(errors.length > 0 ? 'No valid file: ' + errors.join(', ') : 'Nothing to send');
    }
    queue.push(channel.id, async () => {
      let text = _params.content;
      // Question libre : on indique comment répondre
      if (ask && askAnswers.length === 0 && ask.labels && ask.labels.hint) {
        text = String(text ?? '') + '\n\n' + ask.labels.hint;
      }
      const content = await sender.resolveMentions(text, channel.guild);
      let embed = null;
      if (embedParams) {
        for (const key of ['title', 'description', 'footer']) {
          embedParams[key] = await sender.resolveMentions(embedParams[key], channel.guild);
        }
        embed = sender.buildEmbed(embedParams, files, sender.parseColor(_params.defaultColor));
      }
      const payloads = sender.buildPayloads({ content, embed, files });
      if (components.length > 0) {
        payloads[payloads.length - 1].components = components;
      }
      const ids = [];
      let lastMessage = null;
      for (const payload of payloads) {
        lastMessage = await channel.send(payload);
        ids.push(lastMessage.id);
      }
      lastSent.set(channel.id, ids);
      if (lastMessage && lastSent.size > 200) {
        lastSent.delete(lastSent.keys().next().value);
      }
      if (ask && lastMessage) {
        interactions.registerAsk(lastMessage, ask, askAnswers, client);
      }
      return ids;
    }, { label: 'send' }).then((ids) => {
      log.info('[SEND] ' + ids.length + ' message(s) envoyé(s) dans #' + channel.name);
      callback.send('messageSent', { eqLogicId: _params.eqLogicId, channelId: channel.id, messageIds: ids });
    }).catch((error) => {
      log.error('[SEND] Échec de l\'envoi dans #' + channel.name + ' : ' + error.message);
      callback.send('error', { fatal: false, code: 'SendError', eqLogicId: _params.eqLogicId, message: log.redact(error.message) });
    });
    return { queued: true, files: files.length, ignoredFiles: errors };
  },

  /**
   * Modifie le texte du dernier message envoyé dans le salon (placé dans la file du salon : après les envois en attente)
   * @param {object} _params channelId, content, eqLogicId
   */
  async editLast(_params) {
    requireReady();
    const channel = await getTextChannel(_params.channelId);
    if (String(_params.content ?? '').trim() === '') {
      throw new ActionError('Empty content');
    }
    queue.push(channel.id, async () => {
      const ids = lastSent.get(channel.id);
      if (!ids || ids.length === 0) {
        throw new Error('No message sent by the bot in this channel since the daemon started');
      }
      const content = sender.truncate(await sender.resolveMentions(_params.content, channel.guild), sender.LIMITS.content);
      const message = await channel.messages.fetch(ids[ids.length - 1]);
      await message.edit({ content });
    }, { label: 'editLast' }).then(() => {
      log.info('[EDIT] Dernier message modifié dans #' + channel.name);
    }).catch((error) => reportError('EditError', 'Modification impossible dans #' + channel.name, error, _params.eqLogicId));
    return { queued: true };
  },

  /**
   * Supprime le dernier message envoyé dans le salon (toutes ses parties s'il a été découpé)
   * @param {object} _params channelId, eqLogicId
   */
  async deleteLast(_params) {
    requireReady();
    const channel = await getTextChannel(_params.channelId);
    queue.push(channel.id, async () => {
      const ids = lastSent.get(channel.id);
      if (!ids || ids.length === 0) {
        throw new Error('No message sent by the bot in this channel since the daemon started');
      }
      lastSent.delete(channel.id);
      for (const id of ids) {
        try {
          await channel.messages.delete(id);
        } catch (error) {
          // Message déjà supprimé : sans conséquence
          if (error.code !== 10008) {
            throw error;
          }
        }
      }
      return ids.length;
    }, { label: 'deleteLast' }).then((count) => {
      log.info('[DELETE] ' + count + ' message(s) supprimé(s) dans #' + channel.name);
    }).catch((error) => reportError('DeleteError', 'Suppression impossible dans #' + channel.name, error, _params.eqLogicId));
    return { queued: true };
  },

  /**
   * Nettoie un salon : supprime les messages plus anciens que maxAge (en secondes, 0 = tous)
   * @param {object} _params channelId, maxAge, scope ('bot' ou 'all'), eqLogicId
   */
  async purge(_params) {
    requireReady();
    const channel = await getTextChannel(_params.channelId);
    const scope = _params.scope === 'all' ? 'all' : 'bot';
    const maxAge = Math.max(0, Number(_params.maxAge) || 0) * 1000;
    const permissions = channel.permissionsFor(channel.guild.members.me);
    const required = [[PermissionFlagsBits.ViewChannel, 'View Channel'], [PermissionFlagsBits.ReadMessageHistory, 'Read Message History']];
    if (scope === 'all') {
      required.push([PermissionFlagsBits.ManageMessages, 'Manage Messages']);
    }
    const missing = required.filter(([flag]) => !permissions || !permissions.has(flag)).map(([, name]) => name);
    if (missing.length > 0) {
      throw new ActionError('Missing permissions in #' + channel.name + ': ' + missing.join(', '), 403);
    }
    // File distincte de celle des envois : un long nettoyage ne retarde pas les messages
    queue.push('purge:' + channel.id, () => cleaner.purgeChannel(channel, { maxAge, scope, botId: client.user.id }), { label: 'purge' })
      .then((result) => callback.send('purged', { eqLogicId: _params.eqLogicId, channelId: channel.id, ...result }))
      .catch((error) => reportError('PurgeError', 'Nettoyage impossible dans #' + channel.name, error, _params.eqLogicId));
    return { queued: true };
  },

  /**
   * Renomme un salon (texte, annonces ou vocal). Discord limite le renommage à 2 changements toutes les 10 minutes
   * par salon : les demandes en attente sont fusionnées (seule la dernière valeur est envoyée) et rien n'est envoyé
   * si le nom est déjà celui du salon.
   * @param {object} _params channelId, name, eqLogicId
   */
  async setChannelName(_params) {
    requireReady();
    const channel = await getGuildChannel(_params.channelId);
    const voice = channel.type === ChannelType.GuildVoice;
    let name = String(_params.name ?? '').replace(/[\r\n]+/g, ' ').trim();
    // Les salons textuels sont en minuscules, sans espaces ; les salons vocaux acceptent espaces et majuscules
    if (!voice) {
      name = name.toLowerCase().replace(/\s+/g, '-');
    }
    if (name === '') {
      throw new ActionError('Empty channel name');
    }
    name = sender.truncate(name, CHANNEL_NAME_MAX);
    checkManageChannel(channel);
    queue.push('settings:' + channel.id, async () => {
      if (channel.name === name) {
        log.debug('[CHANNEL] #' + channel.name + ' : nom identique, aucune requête');
        return;
      }
      await channel.setName(name, 'JeeDiscord');
      log.info('[CHANNEL] Salon renommé en « ' + name + ' »');
    }, { label: 'setName', coalesce: 'name' })
      .catch((error) => reportError('RenameError', 'Renommage impossible de #' + channel.name, error, _params.eqLogicId));
    return { queued: true, name };
  },

  /**
   * Modifie le sujet d'un salon textuel (même limite de débit que le nom, mêmes fusions)
   * @param {object} _params channelId, topic, eqLogicId
   */
  async setChannelTopic(_params) {
    requireReady();
    const channel = await getGuildChannel(_params.channelId);
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
      throw new ActionError('Only text channels have a topic');
    }
    const topic = sender.truncate(String(_params.topic ?? '').trim(), CHANNEL_TOPIC_MAX);
    if (topic === '') {
      throw new ActionError('Empty channel topic');
    }
    checkManageChannel(channel);
    queue.push('settings:' + channel.id, async () => {
      if (channel.topic === topic) {
        log.debug('[CHANNEL] #' + channel.name + ' : sujet identique, aucune requête');
        return;
      }
      await channel.setTopic(topic, 'JeeDiscord');
      log.info('[CHANNEL] Sujet de #' + channel.name + ' modifié');
    }, { label: 'setTopic', coalesce: 'topic' })
      .catch((error) => reportError('TopicError', 'Modification du sujet impossible de #' + channel.name, error, _params.eqLogicId));
    return { queued: true };
  },
};

/**
 * Journalise une erreur d'une action asynchrone et la transmet à Jeedom
 */
function reportError(_code, _text, _error, _eqLogicId) {
  log.error('[' + _code + '] ' + _text + ' : ' + _error.message);
  callback.send('error', { fatal: false, code: _code, eqLogicId: _eqLogicId, message: log.redact(_text + ' : ' + _error.message) });
}

/**
 * Salon textuel (texte, annonces ou discussion d'un salon vocal) à partir de son identifiant
 * @param {string} _channelId
 * @returns {Promise<import('discord.js').GuildTextBasedChannel>}
 */
async function getTextChannel(_channelId) {
  if (!/^[0-9]{17,20}$/.test(String(_channelId ?? ''))) {
    throw new ActionError('Invalid channel ID');
  }
  let channel;
  try {
    channel = await client.channels.fetch(_channelId);
  } catch (error) {
    throw new ActionError('Channel not found or not visible by the bot: ' + _channelId, 404);
  }
  if (!channel || !channel.guild || !channel.isTextBased()) {
    throw new ActionError('Channel is not a text channel: ' + _channelId);
  }
  return channel;
}

/**
 * Salon du serveur (texte, annonces ou vocal) à partir de son identifiant
 * @param {string} _channelId
 */
async function getGuildChannel(_channelId) {
  if (!/^[0-9]{17,20}$/.test(String(_channelId ?? ''))) {
    throw new ActionError('Invalid channel ID');
  }
  let channel;
  try {
    channel = await client.channels.fetch(_channelId);
  } catch (error) {
    throw new ActionError('Channel not found or not visible by the bot: ' + _channelId, 404);
  }
  if (!channel || !channel.guild || !CHANNEL_TYPES.includes(channel.type)) {
    throw new ActionError('Unsupported channel: ' + _channelId);
  }
  return channel;
}

/**
 * Vérifie le droit « Gérer les salons » avant de modifier un salon
 */
function checkManageChannel(_channel) {
  const permissions = _channel.permissionsFor(_channel.guild.members.me);
  if (!permissions || !permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new ActionError('Missing permissions in #' + _channel.name + ': Manage Channels', 403);
  }
}

/**
 * Vérifie les droits du bot avant d'envoyer, pour une erreur claire et sans appel invalide à l'API
 * (les appels refusés comptent dans la limite d'appels invalides de Discord)
 */
function checkPermissions(_channel, _needs) {
  const permissions = _channel.permissionsFor(_channel.guild.members.me);
  const required = [[PermissionFlagsBits.ViewChannel, 'View Channel'], [PermissionFlagsBits.SendMessages, 'Send Messages']];
  if (_needs.embed) {
    required.push([PermissionFlagsBits.EmbedLinks, 'Embed Links']);
  }
  if (_needs.files) {
    required.push([PermissionFlagsBits.AttachFiles, 'Attach Files']);
  }
  const missing = required.filter(([flag]) => !permissions || !permissions.has(flag)).map(([, name]) => name);
  if (missing.length > 0) {
    throw new ActionError('Missing permissions in #' + _channel.name + ': ' + missing.join(', '), 403);
  }
}

async function handleAction(_action, _params) {
  if (!Object.prototype.hasOwnProperty.call(actions, _action)) {
    throw new ActionError('Unknown action: ' + _action, 404);
  }
  return actions[_action](_params || {});
}

/* ****************************** Cycle de vie ****************************** */

async function shutdown(_code = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log.info('Arrêt du démon');
  const timer = setTimeout(() => process.exit(_code), SHUTDOWN_TIMEOUT);
  timer.unref();
  try {
    if (server) {
      server.close();
    }
    interactions.clearAll();
    if (client) {
      await client.destroy();
    }
    await callback?.flush();
  } catch (error) {
    log.error('Erreur à l\'arrêt : ' + error.message);
  }
  process.exit(_code);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
process.on('unhandledRejection', (reason) => {
  log.error('Promesse rejetée non gérée : ' + (reason && reason.message ? reason.message : reason));
  log.debug(reason);
});
process.on('uncaughtException', (error) => {
  log.error('Exception non gérée : ' + error.message);
  log.debug(error);
  shutdown(1);
});

async function main() {
  log.info('Démarrage du démon JeeDiscord (node ' + process.version + ', discord.js ' + djsVersion + ', niveau de log ' + (args.loglevel || 'error') + ')');
  for (const required of ['socketport', 'callback', 'pid', 'config']) {
    if (!args[required]) {
      log.error('Argument manquant : --' + required);
      process.exit(1);
    }
  }
  try {
    config = jeedom.readSecrets(args.config);
  } catch (error) {
    log.error('Lecture de la configuration impossible : ' + error.message);
    process.exit(1);
  }
  log.debug('Arguments : ' + JSON.stringify(args));
  setWatchedChannels(config.channels);
  log.debug('Activité : type=' + config.activityType + ', texte=' + JSON.stringify(config.activity || ''));

  jeedom.writePid(args.pid);
  callback = new jeedom.Callback(args.callback, config.apikey);
  if (!(await callback.test())) {
    process.exit(1);
  }

  try {
    server = await jeedom.startServer(Number(args.socketport), config.apikey, handleAction);
  } catch (error) {
    log.error('Impossible d\'ouvrir le port ' + args.socketport + ' : ' + error.message);
    process.exit(1);
  }

  await connect(0);
}

/**
 * Connexion à Discord. Les erreurs passagères (réseau, DNS, panne Discord) sont retentées
 * avec un délai croissant ; les erreurs bloquantes (token, intents) arrêtent le démon.
 * Une fois connecté, discord.js gère lui-même les reconnexions.
 * @param {number} _attempt numéro de la tentative
 */
async function connect(_attempt) {
  if (shuttingDown) {
    return;
  }
  client = createClient();
  try {
    await client.login(config.token);
  } catch (error) {
    const description = describeLoginError(error);
    log.debug(error);
    if (description.fatal) {
      log.error('[DISCORD] Connexion refusée : ' + description.message);
      callback.send('error', description);
      await callback.flush();
      await shutdown(1);
      return;
    }
    const delay = Math.min(LOGIN_RETRY_MAX, LOGIN_RETRY_BASE * 2 ** _attempt);
    log.error('[DISCORD] Connexion impossible (' + description.message + '), nouvelle tentative dans ' + delay + ' s');
    if (_attempt === 0) {
      callback.send('error', description);
    }
    try {
      await client.destroy();
    } catch (e) {
      // client déjà détruit par discord.js
    }
    setTimeout(() => connect(_attempt + 1), delay * 1000);
  }
}

main();
