<?php
/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

require_once __DIR__ . '/../../../../core/php/core.inc.php';

/**
 * Résumés (maison, objet, batteries) et surveillance des démons et des dépendances
 */
class jeediscordReport {
  /*     * *************************Attributs****************************** */

  const COLOR_OK = '#57F287';
  const COLOR_WARNING = '#FEE75C';
  const COLOR_DANGER = '#ED4245';
  const MAX_BATTERY_LINES = 40;
  const DEFAULT_EMOJIS = "temperature | 🌡️\nhumidity | 💧\nluminosity | ☀️\npower | ⚡\nmotion | 🏃\nsecurity | 🚨\ndoor | 🚪\nwindows | 🪟\nshutter | ↕️\nlight | 💡\noutlet | 🔌\nbattery_ok | 🟢\nbattery_warning | 🟠\nbattery_danger | 🔴\nalert | 🚨\nrecovery | ✅";

  /*     * ***********************Emojis*********************************** */

  /**
   * Emojis configurés (clé | emoji, un par ligne), complétés par les valeurs par défaut
   * @return array
   */
  public static function getEmojis() {
    $emojis = array();
    foreach (array(self::DEFAULT_EMOJIS, (string) config::byKey('emojis', 'jeediscord', '')) as $text) {
      foreach (preg_split('/\r\n|\r|\n/', $text) as $line) {
        $parts = explode('|', $line, 2);
        if (count($parts) == 2 && trim($parts[0]) != '' && trim($parts[1]) != '') {
          $emojis[trim($parts[0])] = trim($parts[1]);
        }
      }
    }
    return $emojis;
  }

  private static function emoji($_key) {
    $emojis = self::getEmojis();
    return isset($emojis[$_key]) ? $emojis[$_key] . ' ' : '';
  }

  /*     * ***********************Résumés********************************** */

  /**
   * Résumés Jeedom (température, humidité, ouvertures...) d'un objet, ou de la maison si aucun objet n'est donné
   * @param jeeObject|null $_object
   * @return array champs d'embed
   */
  private static function summaryFields($_object = null) {
    $fields = array();
    $definitions = config::byKey('object:summary');
    if (!is_array($definitions)) {
      return $fields;
    }
    foreach ($definitions as $key => $definition) {
      $value = is_object($_object) ? $_object->getSummary($key) : jeeObject::getGlobalSummary($key);
      if ($value === null || $value === '') {
        continue;
      }
      $unit = isset($definition['unit']) && $definition['unit'] != '' ? ' ' . $definition['unit'] : '';
      $fields[] = array('name' => self::emoji($key) . (isset($definition['name']) ? $definition['name'] : $key), 'value' => $value . $unit, 'inline' => true);
    }
    return $fields;
  }

  /**
   * Équipements à batterie : état, seuils de Jeedom (ceux de l'équipement s'ils sont définis)
   * @return array tableaux name, level, status (ok, warning, danger), date
   */
  public static function getBatteries() {
    $batteries = array();
    foreach (eqLogic::all() as $eqLogic) {
      if ($eqLogic->getIsEnable() != 1) {
        continue;
      }
      $level = $eqLogic->getStatus('battery', null);
      if ($level === null || $level === '') {
        continue;
      }
      $status = 'ok';
      if ($level <= $eqLogic->getConfiguration('battery_danger_threshold', config::byKey('battery::danger'))) {
        $status = 'danger';
      } elseif ($level <= $eqLogic->getConfiguration('battery_warning_threshold', config::byKey('battery::warning'))) {
        $status = 'warning';
      }
      $batteries[] = array('name' => $eqLogic->getHumanName(), 'level' => $level, 'status' => $status, 'date' => $eqLogic->getStatus('batteryDatetime', ''));
    }
    usort($batteries, function ($a, $b) {
      return $a['level'] - $b['level'];
    });
    return $batteries;
  }

  private static function batteryLine($_counts) {
    return self::emoji('battery_ok') . $_counts['ok'] . '  ' . self::emoji('battery_warning') . $_counts['warning'] . '  ' . self::emoji('battery_danger') . $_counts['danger'];
  }

  private static function batteryCounts($_batteries) {
    $counts = array('ok' => 0, 'warning' => 0, 'danger' => 0);
    foreach ($_batteries as $battery) {
      $counts[$battery['status']]++;
    }
    return $counts;
  }

  /**
   * Résumé de la maison : résumés globaux de Jeedom et état des batteries
   * @return array embed
   */
  public static function globalEmbed() {
    $fields = self::summaryFields();
    $counts = self::batteryCounts(self::getBatteries());
    $embed = array(
      'title' => '🏠 ' . __('Résumé de la maison', __FILE__),
      'description' => count($fields) == 0 ? self::emptyGlobalMessage() : '',
      'fields' => $fields,
      'timestamp' => true,
    );
    if (array_sum($counts) > 0) {
      $embed['footer'] = '🔋 ' . __('Batteries', __FILE__) . ' : ' . self::batteryLine($counts);
    }
    return $embed;
  }

  /**
   * Explication quand le résumé global est vide : des résumés existent-ils sur les objets sans être remontés ?
   * @return string
   */
  private static function emptyGlobalMessage() {
    foreach (jeeObject::all() as $object) {
      $summaries = $object->getConfiguration('summary');
      if (is_array($summaries) && count(array_filter($summaries)) > 0) {
        return __('Aucun résumé n\'est remonté dans le résumé global : dans l\'objet, cochez « Remonter dans le résumé global » pour les résumés voulus', __FILE__);
      }
    }
    return __('Aucun résumé défini dans Jeedom (Réglages > Objets > Résumés)', __FILE__);
  }

  /**
   * Résumé d'un objet (désigné par son nom ou son identifiant)
   * @param string $_object
   * @return array embed
   */
  public static function objectEmbed($_object) {
    $_object = trim((string) $_object);
    $object = ctype_digit($_object) ? jeeObject::byId($_object) : jeeObject::byName($_object);
    if (!is_object($object)) {
      throw new Exception(__('Objet introuvable', __FILE__) . ' : ' . $_object);
    }
    $fields = self::summaryFields($object);
    return array(
      'title' => '🏠 ' . $object->getName(),
      'description' => count($fields) == 0 ? __('Aucun résumé défini pour cet objet', __FILE__) : '',
      'fields' => $fields,
      'timestamp' => true,
    );
  }

  /**
   * État des batteries : la liste des piles faibles (avertissement et danger), les autres sont comptées
   * @return array embed
   */
  public static function batteryEmbed() {
    $batteries = self::getBatteries();
    $counts = self::batteryCounts($batteries);
    $lines = array();
    foreach ($batteries as $battery) {
      if ($battery['status'] == 'ok') {
        continue;
      }
      $lines[] = self::emoji('battery_' . $battery['status']) . '**' . $battery['name'] . '** : ' . $battery['level'] . ' %';
    }
    $shown = array_slice($lines, 0, self::MAX_BATTERY_LINES);
    $description = count($lines) == 0 ? '✅ ' . __('Toutes les batteries sont bonnes', __FILE__) : implode("\n", $shown);
    if (count($lines) > count($shown)) {
      $description .= "\n… " . (count($lines) - count($shown)) . ' ' . __('autre(s)', __FILE__);
    }
    return array(
      'title' => '🔋 ' . __('Batteries', __FILE__),
      'description' => $description,
      'footer' => self::batteryLine($counts) . ' · ' . count($batteries) . ' ' . __('équipement(s)', __FILE__),
      'color' => $counts['danger'] > 0 ? self::COLOR_DANGER : ($counts['warning'] > 0 ? self::COLOR_WARNING : self::COLOR_OK),
      'timestamp' => true,
    );
  }

  /*     * ***********************Surveillance***************************** */

  /**
   * Problèmes en cours : démons arrêtés alors qu'ils devraient tourner, dépendances en erreur
   * @return array clé => libellé
   */
  public static function getProblems() {
    $problems = array();
    foreach (plugin::listPlugin(true) as $plugin) {
      $id = $plugin->getId();
      if ($id == 'jeediscord') {
        continue;
      }
      try {
        if ($plugin->getHasOwnDeamon() == 1) {
          $info = $plugin->deamon_info();
          if (isset($info['auto'], $info['launchable'], $info['state']) && $info['auto'] == 1 && $info['launchable'] == 'ok' && $info['state'] != 'ok') {
            $problems['daemon::' . $id] = $plugin->getName() . ' : ' . __('démon arrêté', __FILE__);
          }
        }
        if ($plugin->getHasDependency() == 1) {
          $info = $plugin->dependancy_info();
          if (isset($info['state']) && $info['state'] == 'nok') {
            $problems['dependancy::' . $id] = $plugin->getName() . ' : ' . __('dépendances en erreur', __FILE__);
          }
        }
      } catch (Throwable $e) {
        log::add('jeediscord', 'debug', __('Surveillance impossible pour', __FILE__) . ' ' . $id . ' : ' . $e->getMessage());
      }
    }
    return $problems;
  }

  /**
   * Compare les problèmes à ceux du passage précédent. Une panne n'est signalée qu'après deux constats
   * consécutifs (Jeedom relance lui-même les démons), une seule fois, puis le retour à la normale est signalé.
   * @param array $_problems clé => libellé
   * @param array $_state état précédent (clé => bad, alerted, label)
   * @return array alertes, retours, nouvel état
   */
  public static function compare($_problems, $_state) {
    $alerts = array();
    $recoveries = array();
    $state = array();
    foreach ($_problems as $key => $label) {
      $previous = isset($_state[$key]) ? $_state[$key] : array('bad' => 0, 'alerted' => false);
      $entry = array('bad' => $previous['bad'] + 1, 'alerted' => $previous['alerted'], 'label' => $label);
      if ($entry['bad'] >= 2 && !$entry['alerted']) {
        $entry['alerted'] = true;
        $alerts[] = $label;
      }
      $state[$key] = $entry;
    }
    foreach ($_state as $key => $previous) {
      if (!isset($_problems[$key]) && !empty($previous['alerted'])) {
        $recoveries[] = isset($previous['label']) ? $previous['label'] : $key;
      }
    }
    return array('alerts' => $alerts, 'recoveries' => $recoveries, 'state' => $state);
  }

  /**
   * Surveillance périodique : envoie les alertes aux salons des équipements qui les reçoivent
   */
  public static function monitor() {
    $recipients = array();
    foreach (eqLogic::byType('jeediscord', true) as $eqLogic) {
      $channelId = $eqLogic->getConfiguration('channelId', '');
      if ($channelId != '' && $eqLogic->getConfiguration('receiveAlerts', 0) == 1 && !isset($recipients[$channelId])) {
        $recipients[$channelId] = $eqLogic;
      }
    }
    if (count($recipients) == 0) {
      cache::set('jeediscord::monitor', array());
      return;
    }
    $previous = cache::byKey('jeediscord::monitor')->getValue(array());
    $result = self::compare(self::getProblems(), is_array($previous) ? $previous : array());
    cache::set('jeediscord::monitor', $result['state']);
    $embeds = array();
    if (count($result['alerts']) > 0) {
      $embeds[] = array('title' => self::emoji('alert') . __('Surveillance Jeedom', __FILE__), 'description' => '• ' . implode("\n• ", $result['alerts']), 'color' => self::COLOR_DANGER, 'timestamp' => true);
    }
    if (count($result['recoveries']) > 0) {
      $embeds[] = array('title' => self::emoji('recovery') . __('Retour à la normale', __FILE__), 'description' => '• ' . implode("\n• ", $result['recoveries']), 'color' => self::COLOR_OK, 'timestamp' => true);
    }
    foreach ($embeds as $embed) {
      foreach ($recipients as $channelId => $eqLogic) {
        try {
          jeediscord::sendToDaemon('send', array('eqLogicId' => $eqLogic->getId(), 'channelId' => $channelId, 'defaultColor' => '', 'content' => '', 'embed' => $embed, 'files' => array()));
        } catch (Exception $e) {
          log::add('jeediscord', 'warning', __('Alerte de surveillance non envoyée', __FILE__) . ' : ' . $e->getMessage());
        }
      }
    }
  }
}
