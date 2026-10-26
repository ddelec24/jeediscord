<?php
/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

/*
 * Point d'entrée des événements envoyés par le démon (POST : apikey + data en JSON)
 */
try {
  require_once __DIR__ . '/../../../../core/php/core.inc.php';

  if (!jeedom::apiAccess(init('apikey'), 'jeediscord')) {
    http_response_code(401);
    echo __('Vous n\'êtes pas autorisé à effectuer cette action', __FILE__);
    die();
  }
  if (init('test') != '') {
    echo 'OK';
    die();
  }
  $data = json_decode(init('data'), true);
  if (!is_array($data)) {
    log::add('jeediscord', 'error', __('Données invalides reçues du démon', __FILE__));
    echo 'OK';
    die();
  }
  log::add('jeediscord', 'debug', '[CALLBACK] ' . (isset($data['event']) ? $data['event'] : '?'));
  jeediscord::handleDaemonEvent($data);
  echo 'OK';
} catch (Exception $e) {
  log::add('jeediscord', 'error', displayException($e));
  echo 'OK';
}
