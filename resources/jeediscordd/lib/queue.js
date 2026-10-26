/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

'use strict';

const log = require('./logger');

/**
 * Files d'attente séquentielles, une par clé (en général l'identifiant du salon).
 *
 * discord.js gère déjà les limites de débit de l'API (bucket par route, limite globale,
 * réponses 429). Ces files ajoutent :
 *  - l'ordre garanti des actions sur un même salon (un message envoyé avant son édition, etc.) ;
 *  - une taille maximale pour ne pas accumuler indéfiniment en cas de coupure Discord ;
 *  - la fusion des tâches « coalescentes » : seule la dernière valeur en attente est envoyée
 *    (renommage de salon, sujet, statut...).
 */
class KeyedQueue {
  /**
   * @param {object} _options
   * @param {number} [_options.maxSize=100] nombre maximum de tâches en attente par clé
   */
  constructor(_options = {}) {
    this.maxSize = _options.maxSize ?? 100;
    this.queues = new Map();
  }

  /**
   * Ajoute une tâche à la file de la clé
   * @param {string} _key
   * @param {function(): Promise<*>} _task
   * @param {object} [_options]
   * @param {string} [_options.coalesce] identifiant de fusion : une tâche en attente avec le même identifiant est remplacée
   * @param {string} [_options.label] libellé pour les logs
   * @returns {Promise<*>} résultat de la tâche
   */
  push(_key, _task, _options = {}) {
    let queue = this.queues.get(_key);
    if (!queue) {
      queue = { items: [], running: false };
      this.queues.set(_key, queue);
    }
    const label = _options.label || 'task';
    if (_options.coalesce) {
      const pending = queue.items.find((item) => item.coalesce === _options.coalesce);
      if (pending) {
        log.debug('[QUEUE] ' + _key + ' : ' + label + ' fusionnée avec la tâche en attente');
        pending.task = _task;
        return pending.promise;
      }
    }
    if (queue.items.length >= this.maxSize) {
      log.warning('[QUEUE] ' + _key + ' : file pleine (' + this.maxSize + '), ' + label + ' ignorée');
      return Promise.reject(new Error('Queue full'));
    }
    const item = { task: _task, coalesce: _options.coalesce, label };
    item.promise = new Promise((resolve, reject) => {
      item.resolve = resolve;
      item.reject = reject;
    });
    queue.items.push(item);
    log.debug('[QUEUE] ' + _key + ' : ' + label + ' ajoutée (' + queue.items.length + ' en attente)');
    this.run(_key, queue);
    return item.promise;
  }

  async run(_key, _queue) {
    if (_queue.running) {
      return;
    }
    _queue.running = true;
    while (_queue.items.length > 0) {
      const item = _queue.items.shift();
      const start = Date.now();
      try {
        item.resolve(await item.task());
        log.debug('[QUEUE] ' + _key + ' : ' + item.label + ' terminée en ' + (Date.now() - start) + ' ms');
      } catch (error) {
        log.debug('[QUEUE] ' + _key + ' : ' + item.label + ' en erreur après ' + (Date.now() - start) + ' ms');
        item.reject(error);
      }
    }
    _queue.running = false;
    this.queues.delete(_key);
  }

  /**
   * Nombre total de tâches en attente
   * @returns {number}
   */
  size() {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.items.length;
    }
    return total;
  }
}

module.exports = { KeyedQueue };
