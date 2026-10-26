<?php
/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

require_once dirname(__FILE__) . '/../../../core/php/core.inc.php';

/**
 * Initialise les valeurs par défaut de la configuration du plugin sans écraser celles déjà saisies
 */
function jeediscord_setDefaultConfig() {
  $defaults = array(
    'socketport' => 55095,
    'activityType' => 'custom',
    'activity' => '',
  );
  foreach ($defaults as $key => $value) {
    if (config::byKey($key, 'jeediscord', null) === null) {
      config::save($key, $value, 'jeediscord');
    }
  }
}

// Fonction exécutée automatiquement après l'installation du plugin
function jeediscord_install() {
  jeediscord_setDefaultConfig();
}

// Fonction exécutée automatiquement après la mise à jour du plugin
function jeediscord_update() {
  jeediscord_setDefaultConfig();
  foreach (eqLogic::byType('jeediscord') as $eqLogic) {
    $eqLogic->save();
  }
}

// Fonction exécutée automatiquement après la suppression du plugin
function jeediscord_remove() {
}
