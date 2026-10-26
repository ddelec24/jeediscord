<?php
/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

try {
  require_once dirname(__FILE__) . '/../../../../core/php/core.inc.php';
  include_file('core', 'authentification', 'php');

  if (!isConnect('admin')) {
    throw new Exception(__('401 - Accès non autorisé', __FILE__));
  }

  ajax::init();

  // Liste des serveurs et salons accessibles au bot
  if (init('action') == 'getGuilds') {
    ajax::success(jeediscord::getGuilds(init('refresh') == 1));
  }

  // État du bot (démon démarré, connexion Discord, compte du bot)
  if (init('action') == 'getBotStatus') {
    $return = array('daemon' => false, 'ready' => false, 'bot' => null);
    $deamon_info = jeediscord::deamon_info();
    if ($deamon_info['state'] == 'ok') {
      $return['daemon'] = true;
      try {
        $return = array_merge($return, jeediscord::sendToDaemon('ping', array(), 5));
      } catch (Exception $e) {
        $return['error'] = $e->getMessage();
      }
    }
    ajax::success($return);
  }

  throw new Exception(__('Aucune méthode correspondante à', __FILE__) . ' : ' . init('action'));
  /*     * *********Catch exeption*************** */
} catch (Exception $e) {
  ajax::error(displayException($e), $e->getCode());
}
