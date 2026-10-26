/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

'use strict';

/**
 * Préparation des messages à envoyer : découpage du texte, embeds, fichiers et mentions,
 * dans le respect des limites de l'API Discord.
 */

const fs = require('fs');
const path = require('path');
const { GuildPremiumTier } = require('discord.js');
const log = require('./logger');

/* Limites de l'API Discord (https://docs.discord.com/developers/resources/message) */
const LIMITS = {
  content: 2000,
  filesPerMessage: 10,
  embedTitle: 256,
  embedDescription: 4096,
  embedFields: 25,
  embedFieldName: 256,
  embedFieldValue: 1024,
  embedFooter: 2048,
  embedTotal: 6000,
  maxParts: 10, // nombre maximum de messages produits par un seul envoi
};

// Taille maximale d'une pièce jointe selon le niveau de boost du serveur
const UPLOAD_LIMITS = {
  [GuildPremiumTier.None]: 10 * 1000 * 1000,
  [GuildPremiumTier.Tier1]: 10 * 1000 * 1000,
  [GuildPremiumTier.Tier2]: 50 * 1000 * 1000,
  [GuildPremiumTier.Tier3]: 100 * 1000 * 1000,
};

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
const MENTION_CACHE_TTL = 3600 * 1000;
const DEFAULT_COLOR = 0x5865f2;

const memberCache = new Map(); // "guildId:nom" -> { id, expires }

/* ****************************** Utilitaires ****************************** */

/**
 * Tronque un texte à la longueur maximale, avec des points de suspension
 * @param {string} _text
 * @param {number} _max
 * @returns {string}
 */
function truncate(_text, _max) {
  const text = String(_text ?? '');
  return text.length > _max ? text.substring(0, _max - 1) + '…' : text;
}

/**
 * Découpe un texte en morceaux de 2000 caractères maximum, de préférence sur les retours à la ligne
 * @param {string} _text
 * @returns {string[]}
 */
function splitContent(_text) {
  const text = String(_text ?? '').trim();
  if (text === '') {
    return [];
  }
  const parts = [];
  let current = '';
  for (const line of text.split('\n')) {
    let remaining = line;
    // Ligne seule trop longue : découpe sur les espaces, sinon découpe brute
    while (remaining.length > LIMITS.content) {
      if (current !== '') {
        parts.push(current);
        current = '';
      }
      let cut = remaining.lastIndexOf(' ', LIMITS.content);
      if (cut <= 0) {
        cut = LIMITS.content;
      }
      parts.push(remaining.substring(0, cut));
      remaining = remaining.substring(cut).replace(/^ /, '');
    }
    const candidate = current === '' ? remaining : current + '\n' + remaining;
    if (candidate.length > LIMITS.content) {
      parts.push(current);
      current = remaining;
    } else {
      current = candidate;
    }
  }
  if (current !== '') {
    parts.push(current);
  }
  return parts;
}

/**
 * Convertit une couleur (#RRGGBB, RRGGBB ou entier) en entier, ou null si invalide
 * @param {string|number} _color
 * @returns {number|null}
 */
function parseColor(_color) {
  if (typeof _color === 'number' && _color >= 0 && _color <= 0xffffff) {
    return _color;
  }
  const match = /^#?([0-9a-f]{6})$/i.exec(String(_color ?? '').trim());
  return match ? parseInt(match[1], 16) : null;
}

function isHttpUrl(_value) {
  return /^https?:\/\/\S+$/i.test(String(_value ?? '').trim());
}

/**
 * Nom de fichier utilisable dans une référence attachment:// (ASCII, sans espace)
 * @param {string} _name
 * @param {Set<string>} _used noms déjà utilisés dans le message
 * @returns {string}
 */
function safeFileName(_name, _used) {
  const ext = path.extname(_name).toLowerCase().replace(/[^.a-z0-9]/g, '');
  let base = path.basename(_name, path.extname(_name)).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
  base = base.substring(0, 60);
  let name = base + ext;
  for (let i = 2; _used.has(name); i++) {
    name = base + '_' + i + ext;
  }
  _used.add(name);
  return name;
}

/* ****************************** Fichiers ****************************** */

/**
 * @param {import('discord.js').Guild} _guild
 * @returns {number} taille maximale d'une pièce jointe en octets
 */
function getUploadLimit(_guild) {
  return UPLOAD_LIMITS[_guild?.premiumTier] ?? UPLOAD_LIMITS[GuildPremiumTier.None];
}

/**
 * Lit les fichiers en mémoire tout de suite : le fichier source (capture caméra, rapport...)
 * peut être supprimé par Jeedom avant l'envoi effectif s'il est mis en file d'attente.
 * Les fichiers absents ou trop volumineux sont ignorés avec un avertissement.
 * @param {string[]} _paths chemins absolus
 * @param {number} _maxSize taille maximale par fichier
 * @returns {{files: Array<{attachment: Buffer, name: string, isImage: boolean}>, errors: string[]}}
 */
function loadFiles(_paths, _maxSize) {
  const files = [];
  const errors = [];
  const used = new Set();
  for (const filePath of _paths || []) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        errors.push(filePath + ' : not a file');
        continue;
      }
      if (stat.size > _maxSize) {
        errors.push(filePath + ' : ' + Math.round(stat.size / 100000) / 10 + ' MB > ' + Math.round(_maxSize / 100000) / 10 + ' MB');
        continue;
      }
      const name = safeFileName(path.basename(filePath), used);
      files.push({ attachment: fs.readFileSync(filePath), name, isImage: IMAGE_EXTENSIONS.includes(path.extname(name)) });
      log.debug('[SEND] Fichier chargé : ' + filePath + ' (' + stat.size + ' octets) -> ' + name);
    } catch (error) {
      errors.push(filePath + ' : ' + error.code);
    }
  }
  for (const error of errors) {
    log.warning('[SEND] Fichier ignoré : ' + error);
  }
  return { files, errors };
}

/* ****************************** Mentions ****************************** */

/**
 * Remplace les mentions lisibles par la syntaxe Discord :
 *  - @{pseudo}  -> <@id>   (recherche du membre par nom, sans intent privilégié)
 *  - @&{rôle}   -> <@&id>
 *  - #{salon}   -> <#id>
 * Une mention introuvable est laissée en texte simple.
 * @param {string} _text
 * @param {import('discord.js').Guild} _guild
 * @returns {Promise<string>}
 */
async function resolveMentions(_text, _guild) {
  let text = String(_text ?? '');
  if (!_guild || !/[@#]&?\{/.test(text)) {
    return text;
  }
  text = text.replace(/@&\{([^}]{1,100})\}/g, (match, name) => {
    const role = _guild.roles.cache.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
    if (!role) {
      log.warning('[SEND] Rôle introuvable : ' + name);
      return '@' + name;
    }
    return '<@&' + role.id + '>';
  });
  text = text.replace(/#\{([^}]{1,100})\}/g, (match, name) => {
    const channel = _guild.channels.cache.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (!channel) {
      log.warning('[SEND] Salon introuvable : ' + name);
      return '#' + name;
    }
    return '<#' + channel.id + '>';
  });
  const names = [...new Set([...text.matchAll(/@\{([^}]{1,100})\}/g)].map((m) => m[1]))];
  for (const name of names) {
    const id = await findMemberId(_guild, name.trim());
    text = text.split('@{' + name + '}').join(id ? '<@' + id + '>' : '@' + name);
  }
  return text;
}

/**
 * Recherche un membre par pseudo, nom d'affichage ou surnom (résultat mis en cache 1 h)
 * @param {import('discord.js').Guild} _guild
 * @param {string} _name
 * @returns {Promise<string|null>}
 */
async function findMemberId(_guild, _name) {
  const key = _guild.id + ':' + _name.toLowerCase();
  const cached = memberCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.id;
  }
  try {
    // Requête par nom : autorisée sans l'intent privilégié « Server Members »
    const members = await _guild.members.fetch({ query: _name, limit: 10 });
    const lower = _name.toLowerCase();
    const member = members.find((m) => [m.user.username, m.user.globalName, m.nickname].some((n) => n && n.toLowerCase() === lower)) || members.first();
    if (!member) {
      log.warning('[SEND] Membre introuvable : ' + _name);
      return null;
    }
    memberCache.set(key, { id: member.id, expires: Date.now() + MENTION_CACHE_TTL });
    return member.id;
  } catch (error) {
    log.warning('[SEND] Recherche du membre ' + _name + ' impossible : ' + error.message);
    return null;
  }
}

/* ****************************** Embeds ****************************** */

/**
 * Construit un embed conforme aux limites de Discord
 * @param {object} _params title, url, description, color, footer, image, thumbnail, fields, timestamp
 * @param {Array<{name: string, isImage: boolean}>} _files fichiers joints (pour attachment://)
 * @param {number|null} _defaultColor
 * @returns {object} embed au format de l'API
 */
function buildEmbed(_params, _files, _defaultColor) {
  const embed = {};
  let total = 0;
  const add = (_value, _max) => {
    const text = truncate(_value, Math.min(_max, LIMITS.embedTotal - total));
    total += text.length;
    return text;
  };
  if (_params.title) {
    embed.title = add(_params.title, LIMITS.embedTitle);
    if (isHttpUrl(_params.url)) {
      embed.url = _params.url.trim();
    }
  }
  if (_params.description) {
    embed.description = add(_params.description, LIMITS.embedDescription);
  }
  embed.color = parseColor(_params.color) ?? _defaultColor ?? DEFAULT_COLOR;
  if (Array.isArray(_params.fields)) {
    embed.fields = [];
    for (const field of _params.fields.slice(0, LIMITS.embedFields)) {
      if (!field || !field.name || !field.value || total >= LIMITS.embedTotal) {
        continue;
      }
      embed.fields.push({ name: add(field.name, LIMITS.embedFieldName), value: add(field.value, LIMITS.embedFieldValue), inline: Boolean(field.inline) });
    }
  }
  if (_params.footer) {
    embed.footer = { text: add(_params.footer, LIMITS.embedFooter) };
  }
  if (_params.timestamp) {
    embed.timestamp = new Date().toISOString();
  }
  // Image : URL, ou première image du premier lot de fichiers (même message que l'embed)
  const firstImage = _files.slice(0, LIMITS.filesPerMessage).find((f) => f.isImage);
  if (isHttpUrl(_params.image)) {
    embed.image = { url: _params.image.trim() };
  } else if (firstImage) {
    embed.image = { url: 'attachment://' + firstImage.name };
  }
  if (isHttpUrl(_params.thumbnail)) {
    embed.thumbnail = { url: _params.thumbnail.trim() };
  }
  if (!embed.title && !embed.description && !embed.fields?.length && !embed.image) {
    return null;
  }
  return embed;
}

/* ****************************** Assemblage ****************************** */

/**
 * Découpe un envoi en une suite de messages Discord valides :
 * texte découpé en blocs de 2000 caractères, puis embed et fichiers (10 par message)
 * @param {object} _options
 * @param {string} _options.content texte (mentions déjà résolues)
 * @param {object|null} _options.embed
 * @param {Array} _options.files
 * @returns {Array<object>} charges utiles pour channel.send()
 */
function buildPayloads(_options) {
  const chunks = splitContent(_options.content);
  const files = (_options.files || []).map((f) => ({ attachment: f.attachment, name: f.name }));
  const payloads = chunks.map((content) => ({ content }));
  // L'embed et le premier lot de fichiers accompagnent le dernier bloc de texte
  const fileGroups = [];
  for (let i = 0; i < files.length; i += LIMITS.filesPerMessage) {
    fileGroups.push(files.slice(i, i + LIMITS.filesPerMessage));
  }
  if (_options.embed || fileGroups.length > 0) {
    if (payloads.length === 0) {
      payloads.push({});
    }
    const last = payloads[payloads.length - 1];
    if (_options.embed) {
      last.embeds = [_options.embed];
    }
    if (fileGroups.length > 0) {
      last.files = fileGroups.shift();
    }
  }
  for (const group of fileGroups) {
    payloads.push({ files: group });
  }
  if (payloads.length > LIMITS.maxParts) {
    log.warning('[SEND] Envoi limité à ' + LIMITS.maxParts + ' messages (' + payloads.length + ' demandés)');
    return payloads.slice(0, LIMITS.maxParts);
  }
  return payloads;
}

module.exports = { LIMITS, truncate, splitContent, parseColor, safeFileName, getUploadLimit, loadFiles, resolveMentions, buildEmbed, buildPayloads };
