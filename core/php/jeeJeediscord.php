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
  $result = jeediscord::handleDaemonEvent($data);
  // Certains événements attendent une réponse de Jeedom (actions rapides) : elle est renvoyée en JSON
  echo is_array($result) ? json_encode($result) : 'OK';
} catch (Throwable $e) {
  log::add('jeediscord', 'error', $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')');
  $event = isset($data['event']) ? $data['event'] : '';
  if ($event == 'slashAutocomplete') {
    echo json_encode(array('choices' => array()));
  } elseif ($event == 'quickAction' || $event == 'slashCommand') {
    echo json_encode(array('ok' => false, 'message' => '❌ ' . __('Erreur lors de l\'exécution, consultez le log', __FILE__)));
  } else {
    echo 'OK';
  }
}
