/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

'use strict';

/**
 * Communication avec Jeedom :
 *  - lecture des arguments et du fichier de secrets ;
 *  - envoi des événements vers le callback PHP (POST, apikey dans le corps et non dans l'URL) ;
 *  - serveur HTTP local (127.0.0.1) recevant les actions de Jeedom.
 * Aucune dépendance externe : modules natifs de Node uniquement.
 */

const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const log = require('./logger');

const MAX_BODY_SIZE = 1024 * 1024; // les fichiers sont transmis par chemin, pas dans le corps
const CALLBACK_TIMEOUT = 15000;
const CALLBACK_MAX_PENDING = 500;

/**
 * Arguments de la forme --clé valeur
 * @returns {Object<string, string>}
 */
function getArgs() {
  const result = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

/**
 * Lit puis supprime le fichier de secrets écrit par Jeedom (droits 0600)
 * Les secrets ne passent ainsi ni par la ligne de commande ni par l'environnement.
 * @param {string} _file
 * @returns {{token: string, apikey: string}}
 */
function readSecrets(_file) {
  const content = fs.readFileSync(_file, 'utf8');
  try {
    fs.unlinkSync(_file);
  } catch (e) {
    log.warning('Impossible de supprimer le fichier de secrets : ' + e.message);
  }
  const secrets = JSON.parse(content);
  if (!secrets.token || !secrets.apikey) {
    throw new Error('Secrets file is incomplete');
  }
  log.addSecret(secrets.token);
  log.addSecret(secrets.apikey);
  return secrets;
}

function writePid(_file) {
  fs.writeFileSync(_file, String(process.pid));
}

function safeEqual(_a, _b) {
  const a = Buffer.from(String(_a || ''));
  const b = Buffer.from(String(_b || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Envoi des événements vers Jeedom, dans l'ordre, un à la fois
 */
class Callback {
  constructor(_url, _apikey) {
    this.url = _url;
    this.apikey = _apikey;
    this.pending = [];
    this.draining = null;
  }

  /**
   * @param {string} _event nom de l'événement
   * @param {object} [_data] contenu
   */
  send(_event, _data = {}) {
    if (this.pending.length >= CALLBACK_MAX_PENDING) {
      log.warning('[JEEDOM] Trop d\'événements en attente, ' + _event + ' ignoré');
      return;
    }
    this.pending.push({ event: _event, ..._data });
    this.flush();
  }

  /**
   * Vide la file d'événements
   * @returns {Promise<void>} résolue quand tous les événements en attente sont envoyés
   */
  flush() {
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = null;
      });
    }
    return this.draining;
  }

  async drain() {
    while (this.pending.length > 0) {
      const payload = this.pending.shift();
      const json = JSON.stringify(payload);
      log.debug('[JEEDOM] -> ' + json);
      try {
        const response = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ apikey: this.apikey, data: json }),
          signal: AbortSignal.timeout(CALLBACK_TIMEOUT),
        });
        const text = (await response.text()).trim();
        if (!response.ok || text !== 'OK') {
          log.error('[JEEDOM] Réponse inattendue du callback (' + response.status + ') : ' + text.substring(0, 300));
        }
      } catch (error) {
        log.error('[JEEDOM] Erreur d\'envoi vers Jeedom (' + payload.event + ') : ' + error.message);
      }
    }
  }

  /**
   * Vérifie que le callback est joignable avant de se connecter à Discord
   * @returns {Promise<boolean>}
   */
  async test() {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ apikey: this.apikey, test: '1' }),
        signal: AbortSignal.timeout(CALLBACK_TIMEOUT),
      });
      const text = (await response.text()).trim();
      if (text !== 'OK') {
        log.error('[JEEDOM] Le callback a répondu : ' + text.substring(0, 300));
        return false;
      }
      return true;
    } catch (error) {
      log.error('[JEEDOM] Callback injoignable, vérifiez la configuration réseau de Jeedom : ' + error.message);
      return false;
    }
  }
}

/**
 * Serveur HTTP local recevant les actions de Jeedom : POST /action/<nom> avec un corps JSON
 * et l'apikey dans l'en-tête X-Jeediscord-Apikey.
 * @param {number} _port
 * @param {string} _apikey
 * @param {function(string, object): Promise<*>} _handler
 * @returns {Promise<http.Server>}
 */
function startServer(_port, _apikey, _handler) {
  const server = http.createServer((req, res) => {
    const reply = (_status, _body) => {
      res.writeHead(_status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_body));
    };
    if (!safeEqual(req.headers['x-jeediscord-apikey'], _apikey)) {
      log.warning('[HTTP] Requête refusée (apikey invalide) : ' + req.method + ' ' + req.url);
      return reply(401, { state: 'error', error: 'Unauthorized' });
    }
    const match = req.method === 'POST' && /^\/action\/([A-Za-z]+)$/.exec(req.url);
    if (!match) {
      return reply(404, { state: 'error', error: 'Not found' });
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reply(413, { state: 'error', error: 'Payload too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (res.writableEnded) {
        return;
      }
      let params = {};
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        params = raw ? JSON.parse(raw) : {};
      } catch (e) {
        return reply(400, { state: 'error', error: 'Invalid JSON' });
      }
      const action = match[1];
      log.debug('[HTTP] <- ' + action + ' ' + JSON.stringify(params));
      try {
        const result = await _handler(action, params);
        reply(200, { state: 'ok', result: result ?? null });
      } catch (error) {
        if (error.statusCode && error.statusCode < 500) {
          // Erreur attendue (paramètre invalide, action inconnue...) : pas de pile d'appels
          log.warning('[HTTP] Action ' + action + ' refusée : ' + error.message);
        } else {
          log.error('[HTTP] Action ' + action + ' en erreur : ' + error.message);
          log.debug(error);
        }
        reply(error.statusCode || 500, { state: 'error', error: log.redact(error.message) });
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(_port, '127.0.0.1', () => {
      log.info('[HTTP] Écoute sur 127.0.0.1:' + _port);
      resolve(server);
    });
  });
}

module.exports = { getArgs, readSecrets, writePid, Callback, startServer };
