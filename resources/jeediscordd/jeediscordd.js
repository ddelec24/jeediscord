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

  return discordClient;
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

  async getChannels() {
    requireReady();
    return listChannels();
  },
};

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
