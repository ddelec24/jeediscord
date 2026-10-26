/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

'use strict';

/**
 * Logger du démon : même format que les logs Jeedom, avec masquage systématique
 * des informations sensibles (token du bot, apikey Jeedom, jetons d'interaction et de webhook).
 */

const LEVELS = { debug: 100, info: 200, notice: 250, warning: 300, error: 400, critical: 500, alert: 550, emergency: 600, none: 1000 };
const MASK = '***';

// Motifs génériques masqués même s'ils ne sont pas déclarés comme secrets
const PATTERNS = [
  // Token affiché partiellement masqué par discord.js
  [/(Provided token:\s*)\S+/g, '$1' + MASK],
  // Token de bot Discord : base64(id).timestamp.hmac
  [/[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}/g, MASK],
  // En-tête d'autorisation
  [/(Bot|Bearer)\s+[A-Za-z0-9._-]{20,}/gi, '$1 ' + MASK],
  // Jetons d'interaction et de webhook présents dans les routes REST
  [/(\/(?:interactions|webhooks)\/\d+\/)[A-Za-z0-9._-]{20,}/g, '$1' + MASK],
  // apikey Jeedom passée en paramètre
  [/(apikey["']?\s*[=:]\s*["']?)[A-Za-z0-9]{16,}/gi, '$1' + MASK],
];

let currentLevel = LEVELS.error;
const secrets = new Set();

function pad(_n) {
  return String(_n).padStart(2, '0');
}

function timestamp() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function stringify(_value) {
  if (_value instanceof Error) {
    return _value.stack || _value.message;
  }
  if (typeof _value === 'string') {
    return _value;
  }
  try {
    return JSON.stringify(_value);
  } catch (e) {
    return String(_value);
  }
}

/**
 * Masque toutes les informations sensibles d'un texte
 * @param {*} _value
 * @returns {string}
 */
function redact(_value) {
  let text = stringify(_value);
  for (const secret of secrets) {
    text = text.split(secret).join(MASK);
  }
  for (const [regex, replacement] of PATTERNS) {
    text = text.replace(regex, replacement);
  }
  return text;
}

function write(_level, _args) {
  if (LEVELS[_level] < currentLevel) {
    return;
  }
  const message = _args.map(redact).join(' ');
  process.stdout.write('[' + timestamp() + '][' + _level.toUpperCase() + '] : ' + message + '\n');
}

module.exports = {
  /**
   * @param {string} _level niveau Jeedom (debug, info, warning, error, none...)
   */
  setLevel(_level) {
    currentLevel = LEVELS[String(_level).toLowerCase()] ?? LEVELS.error;
  },
  isDebug() {
    return currentLevel <= LEVELS.debug;
  },
  /**
   * Déclare une valeur à masquer dans tous les logs (ignorée si trop courte pour être un secret)
   * @param {string} _secret
   */
  addSecret(_secret) {
    if (typeof _secret === 'string' && _secret.length >= 8) {
      secrets.add(_secret);
    }
  },
  redact,
  debug: (...args) => write('debug', args),
  info: (...args) => write('info', args),
  warning: (...args) => write('warning', args),
  error: (...args) => write('error', args),
};
