/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

'use strict';

/**
 * Nettoyage d'un salon : suppression des messages plus anciens qu'un âge donné.
 *
 * Discord n'accepte la suppression en masse que pour les messages de moins de 14 jours (100 par appel).
 * Les messages plus anciens sont supprimés un par un, ce qui est limité par l'API (environ 5 requêtes
 * toutes les 5 secondes) : leur nombre par passage est donc plafonné, le reste est traité au passage suivant.
 */

const { SnowflakeUtil } = require('discord.js');
const log = require('./logger');

const BULK_MAX_AGE = 14 * 86400 * 1000 - 5 * 60 * 1000; // marge de 5 minutes sous la limite de 14 jours
const PAGE_SIZE = 100;
const DEFAULTS = { maxAge: 0, scope: 'bot', scanLimit: 1000, singleLimit: 100 };

/**
 * @param {import('discord.js').GuildTextBasedChannel} _channel
 * @param {object} _options
 * @param {number} _options.maxAge âge minimal des messages supprimés, en millisecondes (0 = tous)
 * @param {string} _options.scope 'bot' (messages du bot) ou 'all' (tous, droit « Gérer les messages » requis)
 * @param {string} _options.botId identifiant du bot
 * @param {number} [_options.scanLimit] nombre maximal de messages examinés
 * @param {number} [_options.singleLimit] nombre maximal de suppressions une par une (messages de plus de 14 jours)
 * @returns {Promise<{deleted: number, scanned: number, pending: boolean}>}
 */
async function purgeChannel(_channel, _options) {
  const options = { ...DEFAULTS, ..._options };
  const now = Date.now();
  let cursor = SnowflakeUtil.generate({ timestamp: now - options.maxAge }).toString();
  const recent = [];
  const old = [];
  let scanned = 0;
  while (scanned < options.scanLimit) {
    const page = await _channel.messages.fetch({ limit: PAGE_SIZE, before: cursor });
    if (page.size === 0) {
      break;
    }
    scanned += page.size;
    for (const message of page.values()) {
      if (message.pinned || (options.scope === 'bot' && message.author.id !== options.botId)) {
        continue;
      }
      (now - message.createdTimestamp < BULK_MAX_AGE ? recent : old).push(message);
    }
    // Les messages sont renvoyés du plus récent au plus ancien : le curseur est le dernier
    cursor = page.last().id;
    if (page.size < PAGE_SIZE) {
      break;
    }
  }
  let deleted = 0;
  for (let i = 0; i < recent.length; i += PAGE_SIZE) {
    const chunk = recent.slice(i, i + PAGE_SIZE);
    if (chunk.length === 1) {
      await chunk[0].delete();
      deleted += 1;
    } else {
      const result = await _channel.bulkDelete(chunk, true);
      deleted += result.size;
    }
  }
  const singles = old.slice(0, options.singleLimit);
  for (const message of singles) {
    try {
      await message.delete();
      deleted += 1;
    } catch (error) {
      // Message déjà supprimé entre-temps : sans conséquence
      log.debug('[CLEAN] Message ' + message.id + ' non supprimé : ' + error.message);
    }
  }
  const pending = old.length > singles.length || scanned >= options.scanLimit;
  log.info('[CLEAN] #' + _channel.name + ' : ' + deleted + ' message(s) supprimé(s) sur ' + scanned + ' examiné(s)' + (pending ? ', suite au prochain passage' : ''));
  return { deleted, scanned, pending };
}

module.exports = { purgeChannel, BULK_MAX_AGE };
