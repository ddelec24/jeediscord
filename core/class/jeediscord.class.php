<?php
/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

/* * ***************************Includes********************************* */
require_once __DIR__  . '/../../../../core/php/core.inc.php';
require_once __DIR__ . '/jeediscordReport.class.php';

class jeediscord extends eqLogic {
  /*     * *************************Attributs****************************** */

  /*
  * Champs de configuration du plugin chiffrés automatiquement par le core
  */
  public static $_encryptConfigKey = array('token');

  const DEFAULT_SOCKET_PORT = 55095;
  const DAEMON_START_TIMEOUT = 30;
  const NODE_MIN_VERSION = 18;

  /*     * ***********************Methode static*************************** */

  /**
   * Informations complémentaires remontées lors de la création d'un post sur le forum community
   * Aucune donnée sensible (token, identifiants) n'est transmise
   */
  public static function getConfigForCommunity() {
    $return = '<br>';
    $return .= '- ' . __('Nombre de salons configurés', __FILE__) . ' : ' . count(self::byType(__CLASS__)) . '<br>';
    $return .= '- ' . __('Type d\'activité', __FILE__) . ' : ' . config::byKey('activityType', __CLASS__, 'custom') . '<br>';
    $return .= '- Node.js : ' . trim((string) shell_exec('node -v 2>/dev/null')) . '<br>';
    $return .= '- discord.js : ' . self::getDiscordJsVersion() . '<br>';
    return $return;
  }

  /**
   * Indique si une chaîne correspond à un identifiant Discord (snowflake)
   * @param string $_id
   * @return bool
   */
  public static function isSnowflake($_id) {
    return is_string($_id) && preg_match('/^[0-9]{17,20}$/', $_id) === 1;
  }

  /**
   * @return string chemin du dossier du démon
   */
  private static function getDaemonPath() {
    return realpath(__DIR__ . '/../../resources/jeediscordd');
  }

  /**
   * @return string version de discord.js installée, chaîne vide si absente
   */
  public static function getDiscordJsVersion() {
    $file = self::getDaemonPath() . '/node_modules/discord.js/package.json';
    if (!file_exists($file)) {
      return '';
    }
    $package = json_decode(file_get_contents($file), true);
    return is_array($package) && isset($package['version']) ? $package['version'] : '';
  }

  /**
   * @return int port local du démon
   */
  public static function getSocketPort() {
    $port = intval(config::byKey('socketport', __CLASS__, self::DEFAULT_SOCKET_PORT));
    return ($port >= 1024 && $port <= 65535) ? $port : self::DEFAULT_SOCKET_PORT;
  }

  /*     * ************************ Dépendances *************************** */

  /**
   * Vérification appelée par le core en complément de packages.json :
   * version de Node.js suffisante et module discord.js présent
   */
  public static function additionnalDependancyCheck() {
    $version = trim((string) shell_exec('node -v 2>/dev/null'));
    if (!preg_match('/^v(\d+)\./', $version, $matches) || intval($matches[1]) < self::NODE_MIN_VERSION) {
      return array('state' => 'nok');
    }
    if (self::getDiscordJsVersion() == '') {
      return array('state' => 'nok');
    }
    return array('state' => 'ok');
  }

  /*     * ************************ Démon *************************** */

  public static function deamon_info() {
    $return = array();
    $return['log'] = __CLASS__;
    $return['state'] = 'nok';
    $pid_file = jeedom::getTmpFolder(__CLASS__) . '/deamon.pid';
    if (file_exists($pid_file)) {
      $pid = trim(file_get_contents($pid_file));
      if (is_numeric($pid) && posix_getsid(intval($pid))) {
        $return['state'] = 'ok';
      } else {
        shell_exec(system::getCmdSudo() . 'rm -rf ' . escapeshellarg($pid_file) . ' 2>&1 > /dev/null');
      }
    }
    $return['launchable'] = 'ok';
    $fatal = config::byKey('fatalError', __CLASS__, '');
    if (trim((string) config::byKey('token', __CLASS__, '')) == '') {
      $return['launchable'] = 'nok';
      $return['launchable_message'] = __('Le token du bot n\'est pas renseigné', __FILE__);
    } elseif (self::getDiscordJsVersion() == '') {
      $return['launchable'] = 'nok';
      $return['launchable_message'] = __('Dépendances non installées', __FILE__);
    } elseif (is_array($fatal) && isset($fatal['message'])) {
      // Évite de relancer en boucle une connexion refusée par Discord (quota de 1000 connexions par jour)
      $return['launchable'] = 'nok';
      $return['launchable_message'] = __('Connexion refusée par Discord', __FILE__) . ' : ' . self::describeFatalError($fatal) . '. ' . __('Corrigez puis sauvegardez la configuration du plugin', __FILE__);
    }
    return $return;
  }

  public static function deamon_start() {
    self::deamon_stop();
    $deamon_info = self::deamon_info();
    if ($deamon_info['launchable'] != 'ok') {
      throw new Exception(__('Veuillez vérifier la configuration', __FILE__) . ' : ' . $deamon_info['launchable_message']);
    }
    $tmpFolder = jeedom::getTmpFolder(__CLASS__);
    $token = trim((string) config::byKey('token', __CLASS__));

    // Les secrets sont transmis par un fichier lisible uniquement par l'utilisateur web,
    // supprimé par le démon dès sa lecture : ils n'apparaissent ni dans la liste des processus ni dans les logs
    $configFile = $tmpFolder . '/daemon_config.json';
    $oldUmask = umask(0077);
    file_put_contents($configFile, json_encode(array(
      'token' => $token,
      'apikey' => jeedom::getApiKey(__CLASS__),
      'activityType' => config::byKey('activityType', __CLASS__, 'custom'),
      'activity' => config::byKey('activity', __CLASS__, ''),
      'slashEnabled' => config::byKey('slashEnabled', __CLASS__, 1) == 1,
      'channels' => self::getWatchedChannels(),
    )));
    umask($oldUmask);
    chmod($configFile, 0600);
    cache::set('jeediscord::tokenHash', hash('sha256', $token));

    $cmd = 'nice -n 19 node ' . self::getDaemonPath() . '/jeediscordd.js';
    $cmd .= ' --loglevel ' . escapeshellarg(log::convertLogLevel(log::getLogLevel(__CLASS__)));
    $cmd .= ' --socketport ' . self::getSocketPort();
    $cmd .= ' --callback ' . escapeshellarg(network::getNetworkAccess('internal', 'proto:127.0.0.1:port:comp') . '/plugins/jeediscord/core/php/jeeJeediscord.php');
    $cmd .= ' --pid ' . escapeshellarg($tmpFolder . '/deamon.pid');
    $cmd .= ' --config ' . escapeshellarg($configFile);
    log::add(__CLASS__, 'info', __('Lancement du démon', __FILE__));
    log::add(__CLASS__, 'debug', $cmd);
    exec($cmd . ' >> ' . log::getPathToLog('jeediscord_daemon') . ' 2>&1 &');

    $i = 0;
    while ($i < self::DAEMON_START_TIMEOUT) {
      $deamon_info = self::deamon_info();
      if ($deamon_info['state'] == 'ok') {
        break;
      }
      sleep(1);
      $i++;
    }
    if ($i >= self::DAEMON_START_TIMEOUT) {
      if (file_exists($configFile)) {
        unlink($configFile);
      }
      log::add(__CLASS__, 'error', __('Impossible de lancer le démon, vérifiez le log', __FILE__) . ' jeediscord_daemon', 'unableStartDeamon');
      return false;
    }
    message::removeAll(__CLASS__, 'unableStartDeamon');
    return true;
  }

  public static function deamon_stop() {
    $pid_file = jeedom::getTmpFolder(__CLASS__) . '/deamon.pid';
    if (file_exists($pid_file)) {
      $pid = intval(trim(file_get_contents($pid_file)));
      system::kill($pid, false);
      // Laisse au démon le temps de fermer proprement la connexion Discord
      for ($i = 0; $i < 10 && posix_getsid($pid); $i++) {
        usleep(300000);
      }
    }
    system::kill('jeediscordd.js');
    system::fuserk(self::getSocketPort());
    $configFile = jeedom::getTmpFolder(__CLASS__) . '/daemon_config.json';
    if (file_exists($configFile)) {
      unlink($configFile);
    }
    config::save('connected', 0, __CLASS__);
  }

  /**
   * Envoie une action au démon et retourne son résultat
   * @param string $_action nom de l'action
   * @param array $_params paramètres
   * @param int $_timeout délai maximum en secondes
   * @return mixed
   * @throws Exception si le démon est injoignable ou renvoie une erreur
   */
  public static function sendToDaemon($_action, $_params = array(), $_timeout = 10) {
    if (!preg_match('/^[A-Za-z]+$/', $_action)) {
      throw new Exception(__('Action invalide', __FILE__) . ' : ' . $_action);
    }
    $deamon_info = self::deamon_info();
    if ($deamon_info['state'] != 'ok') {
      throw new Exception(__('Le démon n\'est pas démarré', __FILE__));
    }
    $payload = json_encode($_params, JSON_UNESCAPED_UNICODE);
    log::add(__CLASS__, 'debug', '[DAEMON] -> ' . $_action . ' ' . $payload);
    $ch = curl_init('http://127.0.0.1:' . self::getSocketPort() . '/action/' . $_action);
    curl_setopt_array($ch, array(
      CURLOPT_POST => true,
      CURLOPT_POSTFIELDS => $payload,
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_CONNECTTIMEOUT => 3,
      CURLOPT_TIMEOUT => $_timeout,
      CURLOPT_HTTPHEADER => array(
        'Content-Type: application/json',
        'X-Jeediscord-Apikey: ' . jeedom::getApiKey(__CLASS__),
      ),
    ));
    $response = curl_exec($ch);
    $error = curl_error($ch);
    curl_close($ch);
    if ($response === false) {
      throw new Exception(__('Démon injoignable', __FILE__) . ' : ' . $error);
    }
    log::add(__CLASS__, 'debug', '[DAEMON] <- ' . $_action . ' ' . $response);
    $result = json_decode($response, true);
    if (!is_array($result) || !isset($result['state'])) {
      throw new Exception(__('Réponse invalide du démon', __FILE__));
    }
    if ($result['state'] != 'ok') {
      throw new Exception(__('Erreur du démon', __FILE__) . ' : ' . (isset($result['error']) ? $result['error'] : ''));
    }
    return isset($result['result']) ? $result['result'] : null;
  }

  /**
   * Traite un événement reçu du démon (appelé par core/php/jeeJeediscord.php)
   * @param array $_data
   */
  public static function handleDaemonEvent($_data) {
    $return = null;
    $event = isset($_data['event']) ? $_data['event'] : '';
    switch ($event) {
      case 'ready':
        config::save('botInfo', isset($_data['bot']) ? $_data['bot'] : array(), __CLASS__);
        config::save('connected', 1, __CLASS__);
        config::remove('fatalError', __CLASS__);
        message::removeAll(__CLASS__, 'daemonError');
        self::saveGuilds(isset($_data['guilds']) ? $_data['guilds'] : array());
        log::add(__CLASS__, 'info', __('Bot connecté à Discord', __FILE__) . ' : ' . (isset($_data['bot']['tag']) ? $_data['bot']['tag'] : ''));
        break;
      case 'channels':
        self::saveGuilds(isset($_data['guilds']) ? $_data['guilds'] : array());
        break;
      case 'message':
        foreach (self::byChannelId(isset($_data['channelId']) ? $_data['channelId'] : '') as $eqLogic) {
          $eqLogic->onMessageReceived($_data);
        }
        break;
      case 'reaction':
        foreach (self::byChannelId(isset($_data['channelId']) ? $_data['channelId'] : '') as $eqLogic) {
          $eqLogic->onReactionReceived($_data);
        }
        break;
      case 'messageSent':
        log::add(__CLASS__, 'debug', __('Message envoyé', __FILE__) . ' : ' . json_encode($_data));
        break;
      case 'askAnswer':
        self::onAskAnswer($_data);
        break;
      case 'purged':
        log::add(__CLASS__, 'info', __('Nettoyage du salon', __FILE__) . ' : ' . (isset($_data['deleted']) ? (int) $_data['deleted'] : 0) . ' ' . __('message(s) supprimé(s)', __FILE__) . (!empty($_data['pending']) ? ' (' . __('suite au prochain passage', __FILE__) . ')' : ''));
        break;
      case 'quickAction':
        return self::runQuickAction($_data);
      case 'slashCommand':
        return self::runSlashCommand($_data);
      case 'slashAutocomplete':
        return self::slashAutocomplete($_data);
      case 'status':
        config::save('connected', !empty($_data['connected']) ? 1 : 0, __CLASS__);
        break;
      case 'error':
        $message = isset($_data['message']) ? $_data['message'] : '';
        log::add(__CLASS__, 'error', __('Erreur du démon', __FILE__) . ' : ' . $message);
        if (!empty($_data['fatal'])) {
          config::save('fatalError', array('code' => isset($_data['code']) ? $_data['code'] : '', 'message' => $message, 'date' => date('Y-m-d H:i:s')), __CLASS__);
          message::add(__CLASS__, __('Connexion refusée par Discord', __FILE__) . ' : ' . self::describeFatalError($_data), '', 'daemonError');
        }
        break;
      default:
        log::add(__CLASS__, 'debug', __('Événement inconnu reçu du démon', __FILE__) . ' : ' . $event);
    }
    return $return;
  }

  // Surveillance des démons et des dépendances des plugins : alertes dans les salons des équipements concernés
  public static function cron5() {
    if (self::deamon_info()['state'] != 'ok') {
      return;
    }
    try {
      jeediscordReport::monitor();
    } catch (Throwable $e) {
      log::add(__CLASS__, 'warning', __('Surveillance en erreur', __FILE__) . ' : ' . $e->getMessage());
    }
  }

  /**
   * Nettoyage automatique des salons dont l'équipement définit une durée de conservation
   */
  public static function cronHourly() {
    if (self::deamon_info()['state'] != 'ok') {
      return;
    }
    $done = array();
    foreach (self::byType(__CLASS__, true) as $eqLogic) {
      $days = (int) $eqLogic->getConfiguration('retentionDays', 0);
      $channelId = $eqLogic->getConfiguration('channelId', '');
      if ($days <= 0 || $channelId == '' || isset($done[$channelId])) {
        continue;
      }
      $done[$channelId] = true;
      try {
        self::sendToDaemon('purge', array(
          'eqLogicId' => $eqLogic->getId(),
          'channelId' => $channelId,
          'maxAge' => $days * 86400,
          'scope' => $eqLogic->getConfiguration('retentionScope', 'bot') == 'all' ? 'all' : 'bot',
        ));
      } catch (Exception $e) {
        log::add(__CLASS__, 'warning', $eqLogic->getHumanName() . ' : ' . __('nettoyage automatique impossible', __FILE__) . ' : ' . $e->getMessage());
      }
    }
  }

  /**
   * Réponse à une question de scénario (clic sur un bouton, choix dans le menu ou message libre) : transmise au core
   * @param array $_data cmdId, answer
   */
  private static function onAskAnswer($_data) {
    $cmd = cmd::byId(isset($_data['cmdId']) ? $_data['cmdId'] : '');
    if (!is_object($cmd) || $cmd->getEqType() != __CLASS__) {
      log::add(__CLASS__, 'warning', __('Réponse reçue pour une commande inconnue', __FILE__) . ' : ' . (isset($_data['cmdId']) ? $_data['cmdId'] : '?'));
      return;
    }
    $answer = isset($_data['answer']) ? (string) $_data['answer'] : '';
    if ($cmd->askResponse($answer)) {
      log::add(__CLASS__, 'info', __('Réponse transmise au scénario', __FILE__) . ' : ' . $answer);
    } else {
      log::add(__CLASS__, 'debug', __('Réponse ignorée (aucune question en attente ou réponse non prévue)', __FILE__) . ' : ' . $answer);
    }
  }

  /**
   * Enregistrement des définitions des boutons d'actions rapides (identifiant => définition)
   * @return array
   */
  private static function getQuickActions() {
    $actions = config::byKey('quickActions', __CLASS__, array());
    return is_array($actions) ? $actions : array();
  }

  /**
   * Analyse la saisie des actions rapides : une ligne par bouton,
   * « Libellé | cmd, scenario ou interaction | cible | rôles autorisés (optionnel) | couleur (optionnel) ».
   * Les définitions sont conservées pour que les boutons restent actifs après un redémarrage.
   * @param int $_eqLogicId
   * @param string $_text
   * @return array boutons à afficher : id, label, style
   */
  public static function registerQuickActions($_eqLogicId, $_text) {
    $stored = self::getQuickActions();
    $buttons = array();
    foreach (preg_split('/\r\n|\r|\n/', (string) $_text) as $line) {
      if (trim($line) == '') {
        continue;
      }
      $parts = array_map('trim', explode('|', $line));
      $type = isset($parts[1]) ? strtolower($parts[1]) : '';
      $target = isset($parts[2]) ? $parts[2] : '';
      if ($parts[0] == '' || $target == '' || !in_array($type, array('cmd', 'scenario', 'interaction'))) {
        log::add(__CLASS__, 'warning', __('Action rapide ignorée (format attendu : Libellé | cmd, scenario ou interaction | cible)', __FILE__) . ' : ' . $line);
        continue;
      }
      try {
        if ($type == 'cmd') {
          $cmd = cmd::byString($target);
          if ($cmd->getType() != 'action') {
            throw new Exception(__('La commande doit être de type action', __FILE__));
          }
        } elseif ($type == 'scenario') {
          self::findScenario($target);
        }
      } catch (Exception $e) {
        log::add(__CLASS__, 'warning', __('Action rapide ignorée', __FILE__) . ' « ' . $parts[0] . ' » : ' . $e->getMessage());
        continue;
      }
      $roles = isset($parts[3]) ? $parts[3] : '';
      $style = isset($parts[4]) ? strtolower($parts[4]) : '';
      if (!in_array($style, array('primary', 'secondary', 'success', 'danger'))) {
        $style = 'primary';
      }
      $id = substr(sha1($_eqLogicId . '|' . $parts[0] . '|' . $type . '|' . $target . '|' . $roles), 0, 16);
      $stored[$id] = array('eqLogicId' => (int) $_eqLogicId, 'label' => $parts[0], 'type' => $type, 'target' => $target, 'roles' => $roles, 'date' => time());
      $buttons[] = array('id' => $id, 'label' => $parts[0], 'style' => $style);
    }
    if (count($buttons) > 25) {
      log::add(__CLASS__, 'warning', __('25 boutons au maximum par message', __FILE__));
      $buttons = array_slice($buttons, 0, 25);
    }
    if (count($stored) > 1000) {
      uasort($stored, function ($a, $b) {
        return $b['date'] - $a['date'];
      });
      $stored = array_slice($stored, 0, 1000, true);
    }
    config::save('quickActions', $stored, __CLASS__);
    return $buttons;
  }

  /**
   * Scénario désigné par son identifiant ou son nom complet [Groupe][Objet][Nom] (« Aucun » sans objet) ; [Groupe][Nom] est aussi accepté
   * @param string $_target
   * @return scenario
   */
  private static function findScenario($_target) {
    $target = trim(trim((string) $_target), '#');
    if (preg_match('/^scenario(\d+)$/', $target, $matches)) {
      $target = $matches[1];
    }
    if (ctype_digit($target)) {
      $scenario = scenario::byId($target);
    } else {
      $scenario = null;
      $candidates = array('#' . $target . '#');
      // [Groupe][Nom] : le nom complet est [Groupe][Objet][Nom], avec « Aucun » sans objet
      if (preg_match('/^\[([^\]]+)\]\[([^\]]+)\]$/', $target, $matches)) {
        array_unshift($candidates, '#[' . $matches[1] . '][' . __('Aucun', __FILE__) . '][' . $matches[2] . ']#');
      }
      foreach ($candidates as $candidate) {
        try {
          $scenario = scenario::byString($candidate);
          break;
        } catch (Exception $e) {
          $scenario = null;
        }
      }
    }
    if (!is_object($scenario)) {
      throw new Exception(__('Scénario introuvable', __FILE__) . ' : ' . $_target);
    }
    return $scenario;
  }

  /**
   * Exécute une action rapide pour un utilisateur Discord et renvoie le message à lui afficher
   * @param array $_data buttonId, channelId, user, roles
   * @return array ok, message
   */
  private static function runQuickAction($_data) {
    $actions = self::getQuickActions();
    $id = isset($_data['buttonId']) ? $_data['buttonId'] : '';
    $userName = isset($_data['user']['name']) ? $_data['user']['name'] : '?';
    if (!isset($actions[$id])) {
      return array('ok' => false, 'message' => '⚠️ ' . __('Ce bouton n\'est plus valide', __FILE__));
    }
    $action = $actions[$id];
    $eqLogic = self::byId($action['eqLogicId']);
    if (!is_object($eqLogic) || $eqLogic->getIsEnable() != 1 || $eqLogic->getConfiguration('channelId', '') !== (string) (isset($_data['channelId']) ? $_data['channelId'] : '')) {
      return array('ok' => false, 'message' => '⚠️ ' . __('Ce bouton n\'est plus valide', __FILE__));
    }
    if (!self::isRoleAllowed($action['roles'], isset($_data['roles']) ? $_data['roles'] : array())) {
      log::add(__CLASS__, 'warning', __('Action rapide refusée', __FILE__) . ' « ' . $action['label'] . ' » : ' . $userName);
      return array('ok' => false, 'message' => '⛔ ' . __('Vous n\'avez pas le droit d\'utiliser ce bouton', __FILE__));
    }
    log::add(__CLASS__, 'info', __('Action rapide', __FILE__) . ' « ' . $action['label'] . ' » (' . $action['type'] . ') ' . __('demandée par', __FILE__) . ' ' . $userName);
    try {
      switch ($action['type']) {
        case 'cmd':
          $cmd = cmd::byString($action['target']);
          $cmd->execCmd();
          return array('ok' => true, 'message' => '✅ ' . $action['label']);
        case 'scenario':
          $scenario = self::findScenario($action['target']);
          $scenario->setTags(array('#jeediscord_user#' => $userName, '#jeediscord_channel#' => $_data['channelId']));
          if ($scenario->launch() === false) {
            return array('ok' => false, 'message' => '⚠️ ' . __('Le scénario est désactivé', __FILE__));
          }
          return array('ok' => true, 'message' => '✅ ' . $action['label']);
        case 'interaction':
          $reply = interactQuery::tryToReply($action['target'], array('plugin' => __CLASS__));
          $text = is_array($reply) && isset($reply['reply']) ? trim((string) $reply['reply']) : '';
          return array('ok' => true, 'message' => $text != '' ? $text : '✅ ' . $action['label']);
      }
    } catch (Throwable $e) {
      log::add(__CLASS__, 'error', __('Action rapide en erreur', __FILE__) . ' « ' . $action['label'] . ' » : ' . $e->getMessage());
      return array('ok' => false, 'message' => '❌ ' . __('Erreur lors de l\'exécution, consultez le log', __FILE__));
    }
    return array('ok' => false, 'message' => '⚠️ ' . __('Ce bouton n\'est plus valide', __FILE__));
  }

  /**
   * Droit d'utiliser les commandes slash : le salon doit être associé à un équipement actif, et l'utilisateur
   * administrateur du serveur ou titulaire d'un des rôles autorisés dans la configuration (liste vide : administrateurs seuls)
   * @param array $_data channelId, roles, admin
   * @return string|null message de refus, null si autorisé
   */
  private static function slashDenied($_data) {
    if (config::byKey('slashEnabled', __CLASS__, 1) != 1) {
      return '⛔ ' . __('Les commandes slash sont désactivées', __FILE__);
    }
    if (count(self::byChannelId(isset($_data['channelId']) ? $_data['channelId'] : '')) == 0) {
      return '⛔ ' . __('Ce salon n\'est associé à aucun équipement JeeDiscord actif', __FILE__);
    }
    if (!empty($_data['admin'])) {
      return null;
    }
    $allowed = trim((string) config::byKey('slashRoles', __CLASS__, ''));
    if ($allowed == '') {
      return '⛔ ' . __('Réservé aux administrateurs du serveur', __FILE__);
    }
    if (!self::isRoleAllowed($allowed, isset($_data['roles']) ? $_data['roles'] : array())) {
      return '⛔ ' . __('Vous n\'avez pas le droit d\'utiliser cette commande', __FILE__);
    }
    return null;
  }

  /**
   * Exécute une commande slash (/jeedom interaction, scenario, cmd et /clean)
   * @param array $_data command, sub, options, channelId, user, roles, admin
   * @return array ok, message, purge (nettoyage à lancer par le démon)
   */
  private static function runSlashCommand($_data) {
    $denied = self::slashDenied($_data);
    if ($denied !== null) {
      log::add(__CLASS__, 'warning', __('Commande slash refusée', __FILE__) . ' : ' . (isset($_data['user']['name']) ? $_data['user']['name'] : '?') . ' (' . $denied . ')');
      return array('ok' => false, 'message' => $denied);
    }
    $options = isset($_data['options']) && is_array($_data['options']) ? $_data['options'] : array();
    $userName = isset($_data['user']['name']) ? $_data['user']['name'] : '?';
    $command = isset($_data['command']) ? $_data['command'] : '';
    $sub = isset($_data['sub']) ? $_data['sub'] : '';
    log::add(__CLASS__, 'info', __('Commande slash', __FILE__) . ' /' . $command . ' ' . $sub . ' ' . __('demandée par', __FILE__) . ' ' . $userName);
    try {
      if ($command == 'clean') {
        $days = isset($options['days']) ? max(0, (int) $options['days']) : 0;
        return array(
          'ok' => true,
          'message' => '🧹 ' . ($days > 0 ? sprintf(__('Nettoyage lancé : messages de plus de %s jour(s)', __FILE__), $days) : __('Nettoyage lancé : tous les messages', __FILE__)),
          'purge' => array('maxAge' => $days * 86400, 'scope' => !empty($options['all']) ? 'all' : 'bot'),
        );
      }
      switch ($sub) {
        case 'interaction':
          $reply = interactQuery::tryToReply(isset($options['text']) ? (string) $options['text'] : '', array('plugin' => __CLASS__));
          $text = is_array($reply) && isset($reply['reply']) ? trim((string) $reply['reply']) : '';
          return array('ok' => true, 'message' => $text != '' ? $text : '✅');
        case 'scenario':
          $scenario = self::findScenario(isset($options['name']) ? $options['name'] : '');
          $action = isset($options['action']) && $options['action'] != '' ? $options['action'] : 'start';
          switch ($action) {
            case 'stop':
              $scenario->stop();
              return array('ok' => true, 'message' => '⏹️ ' . $scenario->getHumanName());
            case 'enable':
            case 'disable':
              $scenario->setIsActive($action == 'enable' ? 1 : 0);
              $scenario->save();
              return array('ok' => true, 'message' => ($action == 'enable' ? '🟢 ' : '⚪ ') . $scenario->getHumanName());
            default:
              $scenario->setTags(array('#jeediscord_user#' => $userName, '#jeediscord_channel#' => $_data['channelId']));
              if ($scenario->launch() === false) {
                return array('ok' => false, 'message' => '⚠️ ' . __('Le scénario est désactivé', __FILE__));
              }
              return array('ok' => true, 'message' => '▶️ ' . $scenario->getHumanName());
          }
        case 'cmd':
          $cmd = self::findActionCmd(isset($options['command']) ? $options['command'] : '');
          $value = isset($options['value']) ? (string) $options['value'] : '';
          $execOptions = array();
          switch ($cmd->getSubType()) {
            case 'slider':
              $execOptions['slider'] = str_replace(',', '.', $value);
              break;
            case 'color':
              $execOptions['color'] = $value;
              break;
            case 'select':
              $execOptions['select'] = $value;
              break;
            case 'message':
              $execOptions['title'] = '';
              $execOptions['message'] = $value;
              break;
          }
          $cmd->execCmd($execOptions);
          return array('ok' => true, 'message' => '✅ ' . $cmd->getHumanName());
      }
    } catch (Throwable $e) {
      log::add(__CLASS__, 'error', __('Commande slash en erreur', __FILE__) . ' : ' . $e->getMessage());
      return array('ok' => false, 'message' => '❌ ' . $e->getMessage());
    }
    return array('ok' => false, 'message' => '⚠️ ' . __('Commande inconnue', __FILE__));
  }

  /**
   * Commande action désignée par son identifiant ou son nom complet
   * @param string $_target
   * @return cmd
   */
  private static function findActionCmd($_target) {
    $_target = trim((string) $_target);
    $cmd = ctype_digit($_target) ? cmd::byId($_target) : cmd::byString($_target);
    if (!is_object($cmd) || $cmd->getType() != 'action') {
      throw new Exception(__('Commande action introuvable', __FILE__) . ' : ' . $_target);
    }
    return $cmd;
  }

  /**
   * Propositions d'autocomplétion des commandes slash (25 au maximum), réservées aux utilisateurs autorisés
   * @param array $_data kind (name ou command), query, channelId, roles, admin
   * @return array choices : tableaux name / value
   */
  private static function slashAutocomplete($_data) {
    $choices = array();
    if (self::slashDenied($_data) !== null) {
      return array('choices' => $choices);
    }
    $query = mb_strtolower(trim(isset($_data['query']) ? (string) $_data['query'] : ''));
    if (isset($_data['kind']) && $_data['kind'] == 'name') {
      foreach (scenario::all() as $scenario) {
        $name = $scenario->getHumanName();
        if ($query == '' || mb_strpos(mb_strtolower($name), $query) !== false) {
          $choices[] = array('name' => ($scenario->getIsActive() == 1 ? '' : '⚪ ') . $name, 'value' => (string) $scenario->getId());
        }
        if (count($choices) >= 25) {
          break;
        }
      }
    } elseif (isset($_data['kind']) && $_data['kind'] == 'command') {
      $rows = DB::Prepare('SELECT c.id AS id, c.name AS cmdName, e.name AS eqName, o.name AS objectName
        FROM cmd c INNER JOIN eqLogic e ON e.id = c.eqLogic_id LEFT JOIN object o ON o.id = e.object_id
        WHERE c.type = \'action\' AND e.isEnable = 1
        AND (c.name LIKE :q OR e.name LIKE :q OR o.name LIKE :q)
        ORDER BY o.name, e.name, c.name LIMIT 25', array('q' => '%' . addcslashes($query, '%_\\') . '%'), DB::FETCH_TYPE_ALL);
      foreach ((array) $rows as $row) {
        $choices[] = array('name' => '[' . ($row['objectName'] != '' ? $row['objectName'] : __('Aucun', __FILE__)) . '][' . $row['eqName'] . '][' . $row['cmdName'] . ']', 'value' => (string) $row['id']);
      }
    }
    return array('choices' => $choices);
  }

  /**
   * Vérifie que l'utilisateur possède l'un des rôles autorisés (nom ou identifiant, séparés par des virgules).
   * Une liste vide autorise tous les utilisateurs du salon.
   * @param string $_allowed
   * @param array $_userRoles tableaux id / name
   * @return bool
   */
  public static function isRoleAllowed($_allowed, $_userRoles) {
    $allowed = array_filter(array_map('trim', explode(',', (string) $_allowed)), 'strlen');
    if (count($allowed) == 0) {
      return true;
    }
    foreach ($allowed as $role) {
      foreach ((array) $_userRoles as $userRole) {
        if ((isset($userRole['id']) && (string) $userRole['id'] === $role) || (isset($userRole['name']) && mb_strtolower($userRole['name']) === mb_strtolower($role))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Identifiants des salons associés à un équipement actif
   * @return array
   */
  public static function getWatchedChannels() {
    $channels = array();
    foreach (self::byType(__CLASS__, true) as $eqLogic) {
      $channelId = $eqLogic->getConfiguration('channelId', '');
      if ($channelId != '') {
        $channels[] = $channelId;
      }
    }
    return array_values(array_unique($channels));
  }

  /**
   * Transmet au démon la liste des salons surveillés (après ajout, modification ou suppression d'un équipement)
   */
  public static function updateWatchedChannels() {
    $deamon_info = self::deamon_info();
    if ($deamon_info['state'] != 'ok') {
      return;
    }
    try {
      self::sendToDaemon('setChannels', array('channels' => self::getWatchedChannels()));
    } catch (Exception $e) {
      log::add(__CLASS__, 'warning', __('Impossible de transmettre la liste des salons au démon', __FILE__) . ' : ' . $e->getMessage());
    }
  }

  /**
   * Équipements actifs associés à un salon
   * @param string $_channelId
   * @return jeediscord[]
   */
  public static function byChannelId($_channelId) {
    $return = array();
    foreach (self::byType(__CLASS__, true) as $eqLogic) {
      if ($eqLogic->getConfiguration('channelId', '') === (string) $_channelId) {
        $return[] = $eqLogic;
      }
    }
    return $return;
  }

  /**
   * Message traduit correspondant à une erreur de connexion bloquante
   * @param array $_error tableau contenant 'code' et 'message'
   * @return string
   */
  private static function describeFatalError($_error) {
    switch (isset($_error['code']) ? $_error['code'] : '') {
      case 'TokenInvalid':
        return __('token du bot invalide', __FILE__);
      case 'DisallowedIntents':
        return __('intent « Message Content » non activé sur le portail développeur Discord', __FILE__);
      default:
        return isset($_error['message']) ? $_error['message'] : '';
    }
  }

  /**
   * Mémorise la liste des serveurs et salons accessibles au bot (utilisée par la page des équipements)
   * @param array $_guilds
   */
  private static function saveGuilds($_guilds) {
    if (!is_array($_guilds)) {
      return;
    }
    cache::set('jeediscord::guilds', $_guilds);
    $count = 0;
    foreach ($_guilds as $guild) {
      $count += isset($guild['channels']) ? count($guild['channels']) : 0;
    }
    log::add(__CLASS__, 'debug', count($_guilds) . ' ' . __('serveur(s)', __FILE__) . ', ' . $count . ' ' . __('salon(s)', __FILE__));
  }

  /**
   * Liste des serveurs et salons connus
   * @param bool $_refresh interroge le démon au lieu du cache
   * @return array
   */
  public static function getGuilds($_refresh = false) {
    if ($_refresh) {
      self::saveGuilds(self::sendToDaemon('getChannels'));
    }
    $guilds = cache::byKey('jeediscord::guilds')->getValue(array());
    return is_array($guilds) ? $guilds : array();
  }

  /*     * ************************ Configuration *************************** */

  // Après modification du token : efface l'erreur bloquante et redémarre le démon si le token a changé
  public static function postConfig_token($_value) {
    config::remove('fatalError', __CLASS__);
    message::removeAll(__CLASS__, 'daemonError');
    $token = trim((string) config::byKey('token', __CLASS__, ''));
    $deamon_info = self::deamon_info();
    if ($deamon_info['state'] == 'ok') {
      if (hash('sha256', $token) != cache::byKey('jeediscord::tokenHash')->getValue('')) {
        log::add(__CLASS__, 'info', __('Token modifié, redémarrage du démon', __FILE__));
        self::deamon_start();
      }
    } elseif ($deamon_info['launchable'] == 'ok' && config::byKey('deamonAutoMode', __CLASS__, 1) == 1) {
      // Premier token saisi (ou erreur bloquante corrigée) : démarrage sans attendre la vérification périodique du core
      log::add(__CLASS__, 'info', __('Token renseigné, démarrage du démon', __FILE__));
      try {
        self::deamon_start();
      } catch (Exception $e) {
        log::add(__CLASS__, 'error', $e->getMessage());
      }
    }
  }

  // Activation ou désactivation des commandes slash : appliquée aussitôt sur les serveurs
  public static function postConfig_slashEnabled($_value) {
    if (self::deamon_info()['state'] != 'ok') {
      return;
    }
    try {
      self::sendToDaemon('setSlash', array('enabled' => $_value == 1));
    } catch (Exception $e) {
      log::add(__CLASS__, 'warning', __('Impossible de mettre à jour les commandes slash', __FILE__) . ' : ' . $e->getMessage());
    }
  }

  public static function postConfig_activity($_value) {
    self::updateActivity();
  }

  public static function postConfig_activityType($_value) {
    self::updateActivity();
  }

  /**
   * Applique l'activité du bot sans redémarrer le démon
   */
  private static function updateActivity() {
    $deamon_info = self::deamon_info();
    if ($deamon_info['state'] != 'ok') {
      return;
    }
    try {
      self::sendToDaemon('setActivity', array(
        'type' => config::byKey('activityType', __CLASS__, 'custom'),
        'text' => config::byKey('activity', __CLASS__, ''),
      ));
    } catch (Exception $e) {
      log::add(__CLASS__, 'warning', __('Impossible de mettre à jour l\'activité du bot', __FILE__) . ' : ' . $e->getMessage());
    }
  }

  /*     * *********************Méthodes d'instance************************* */

  // Fonction exécutée automatiquement avant la sauvegarde (création ou mise à jour) de l'équipement
  public function preSave() {
    $channelId = trim((string) $this->getConfiguration('channelId', ''));
    if ($channelId != '' && !self::isSnowflake($channelId)) {
      throw new Exception(__('L\'identifiant du salon Discord est invalide (17 à 20 chiffres attendus)', __FILE__));
    }
    $this->setConfiguration('channelId', $channelId);
    $this->setConfiguration('receiveAlerts', $this->getConfiguration('receiveAlerts', 0) == 1 ? 1 : 0);
    $this->setConfiguration('retentionDays', max(0, min(3650, (int) $this->getConfiguration('retentionDays', 0))));
    $this->setConfiguration('retentionScope', $this->getConfiguration('retentionScope', 'bot') == 'all' ? 'all' : 'bot');
  }

  // Fonction exécutée automatiquement après la sauvegarde (création ou mise à jour) de l'équipement
  public function postSave() {
    $this->createCommands();
    self::updateWatchedChannels();
  }

  // Fonction exécutée automatiquement après la suppression de l'équipement
  public function postRemove() {
    self::updateWatchedChannels();
  }

  /**
   * Définition des commandes créées automatiquement sur chaque équipement
   * @return array logicalId => paramètres
   */
  public static function getCommandsDefinition() {
    return array(
      'sendMessage' => array(
        'name' => __('Envoyer un message', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 1,
        'display' => array(
          'title_placeholder' => __('Titre (optionnel)', __FILE__),
          'message_placeholder' => __('Message', __FILE__),
        ),
      ),
      'sendEmbed' => array(
        'name' => __('Envoyer un embed', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 0,
        'display' => array(
          'title_placeholder' => __('Titre', __FILE__),
          'message_placeholder' => __('Description', __FILE__),
        ),
        'template' => array('scenario' => 'jeediscord::jeediscordEmbed'),
      ),
      'sendFile' => array(
        'name' => __('Envoyer un fichier', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 0,
        'display' => array(
          'title_disable' => 1,
          'message_placeholder' => __('Message', __FILE__),
        ),
        'template' => array('scenario' => 'jeediscord::jeediscordFile'),
      ),
      'sendQuickActions' => array(
        'name' => __('Envoyer des actions rapides', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 0,
        'display' => array(
          'title_disable' => 1,
          'message_placeholder' => __('Message', __FILE__),
        ),
        'template' => array('scenario' => 'jeediscord::jeediscordQuickActions'),
      ),
      'sendSummary' => array(
        'name' => __('Envoyer le résumé de la maison', __FILE__),
        'type' => 'action',
        'subType' => 'other',
        'isVisible' => 0,
      ),
      'sendObjectSummary' => array(
        'name' => __('Envoyer le résumé d\'un objet', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 0,
        'display' => array(
          'title_disable' => 1,
          'message_placeholder' => __('Nom de l\'objet', __FILE__),
        ),
      ),
      'sendBatterySummary' => array(
        'name' => __('Envoyer l\'état des batteries', __FILE__),
        'type' => 'action',
        'subType' => 'other',
        'isVisible' => 0,
      ),
      'editLastMessage' => array(
        'name' => __('Modifier le dernier message envoyé', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 0,
        'display' => array(
          'title_disable' => 1,
          'message_placeholder' => __('Nouveau texte', __FILE__),
        ),
      ),
      'deleteLastMessage' => array(
        'name' => __('Supprimer le dernier message envoyé', __FILE__),
        'type' => 'action',
        'subType' => 'other',
        'isVisible' => 0,
      ),
      'setChannelName' => array(
        'name' => __('Renommer le salon', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 0,
        'display' => array(
          'title_disable' => 1,
          'message_placeholder' => __('Nouveau nom', __FILE__),
        ),
      ),
      'setChannelTopic' => array(
        'name' => __('Modifier le sujet du salon', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 0,
        'display' => array(
          'title_disable' => 1,
          'message_placeholder' => __('Nouveau sujet', __FILE__),
        ),
      ),
      'cleanChannel' => array(
        'name' => __('Nettoyer le salon', __FILE__),
        'type' => 'action',
        'subType' => 'message',
        'isVisible' => 0,
        'display' => array(
          'title_disable' => 1,
          'message_disable' => 1,
        ),
        'template' => array('scenario' => 'jeediscord::jeediscordClean'),
      ),
      'lastMessage' => array(
        'name' => __('Dernier message', __FILE__),
        'type' => 'info',
        'subType' => 'string',
        'isVisible' => 1,
      ),
      'lastMessageAuthor' => array(
        'name' => __('Auteur du dernier message', __FILE__),
        'type' => 'info',
        'subType' => 'string',
        'isVisible' => 1,
      ),
      'lastMessageAuthorId' => array(
        'name' => __('Identifiant de l\'auteur du dernier message', __FILE__),
        'type' => 'info',
        'subType' => 'string',
        'isVisible' => 0,
      ),
      'lastMessageAttachments' => array(
        'name' => __('Pièces jointes du dernier message', __FILE__),
        'type' => 'info',
        'subType' => 'string',
        'isVisible' => 0,
      ),
      'lastReaction' => array(
        'name' => __('Dernière réaction', __FILE__),
        'type' => 'info',
        'subType' => 'string',
        'isVisible' => 1,
      ),
      'lastReactionAuthor' => array(
        'name' => __('Auteur de la dernière réaction', __FILE__),
        'type' => 'info',
        'subType' => 'string',
        'isVisible' => 0,
      ),
      'lastReactionAdded' => array(
        'name' => __('Dernière réaction ajoutée', __FILE__),
        'type' => 'info',
        'subType' => 'binary',
        'isVisible' => 0,
      ),
    );
  }

  /**
   * Crée les commandes manquantes sans modifier celles existantes (nom, visibilité... personnalisés par l'utilisateur)
   */
  public function createCommands() {
    $order = 0;
    foreach (self::getCommandsDefinition() as $logicalId => $definition) {
      $order++;
      $cmd = $this->getCmd(null, $logicalId);
      if (is_object($cmd)) {
        // Le template de scénario fait partie du fonctionnement de la commande : toujours à jour
        if (isset($definition['template'])) {
          foreach ($definition['template'] as $version => $template) {
            if ($cmd->getTemplate($version) != $template) {
              $cmd->setTemplate($version, $template);
              $cmd->save();
            }
          }
        }
        continue;
      }
      $cmd = new jeediscordCmd();
      $cmd->setEqLogic_id($this->getId());
      $cmd->setLogicalId($logicalId);
      $cmd->setName($definition['name']);
      $cmd->setType($definition['type']);
      $cmd->setSubType($definition['subType']);
      $cmd->setIsVisible($definition['isVisible']);
      $cmd->setOrder($order);
      if (isset($definition['display'])) {
        foreach ($definition['display'] as $key => $value) {
          $cmd->setDisplay($key, $value);
        }
      }
      if (isset($definition['template'])) {
        foreach ($definition['template'] as $version => $template) {
          $cmd->setTemplate($version, $template);
        }
      }
      if ($definition['type'] == 'info') {
        // Le même message ou le même emoji reçu deux fois doit déclencher les scénarios à chaque fois
        $cmd->setConfiguration('repeatEventManagement', 'always');
        $cmd->setIsHistorized(0);
      }
      $cmd->save();
    }
  }

  /**
   * Met à jour les commandes info à la réception d'un message. Le contenu est mis à jour en dernier :
   * un scénario déclenché par « Dernier message » lit ainsi l'auteur et les pièces jointes de ce même message.
   * @param array $_data
   */
  public function onMessageReceived($_data) {
    $urls = array();
    if (isset($_data['attachments']) && is_array($_data['attachments'])) {
      foreach ($_data['attachments'] as $attachment) {
        if (isset($attachment['url'])) {
          $urls[] = $attachment['url'];
        }
      }
    }
    log::add(__CLASS__, 'debug', $this->getHumanName() . ' ' . __('message reçu de', __FILE__) . ' ' . (isset($_data['author']['name']) ? $_data['author']['name'] : '?'));
    $this->checkAndUpdateCmd('lastMessageAuthorId', isset($_data['author']['id']) ? $_data['author']['id'] : '');
    $this->checkAndUpdateCmd('lastMessageAuthor', isset($_data['author']['name']) ? $_data['author']['name'] : '');
    $this->checkAndUpdateCmd('lastMessageAttachments', implode("\n", $urls));
    $this->checkAndUpdateCmd('lastMessage', isset($_data['content']) ? $_data['content'] : '');
  }

  /**
   * Met à jour les commandes info à l'ajout ou au retrait d'une réaction (l'emoji en dernier, pour la même raison)
   * @param array $_data
   */
  public function onReactionReceived($_data) {
    log::add(__CLASS__, 'debug', $this->getHumanName() . ' ' . __('réaction reçue', __FILE__) . ' : ' . (isset($_data['emoji']) ? $_data['emoji'] : '?'));
    $this->checkAndUpdateCmd('lastReactionAuthor', isset($_data['user']['name']) ? $_data['user']['name'] : '');
    $this->checkAndUpdateCmd('lastReactionAdded', !empty($_data['added']) ? 1 : 0);
    $this->checkAndUpdateCmd('lastReaction', isset($_data['emoji']) ? $_data['emoji'] : '');
  }

  // Fonction exécutée automatiquement avant la suppression de l'équipement
  public function preRemove() {
  }

  /*     * **********************Getteur Setteur*************************** */
}

class jeediscordCmd extends cmd {
  /*     * *************************Attributs****************************** */

  /*     * ***********************Methode static*************************** */

  /*     * *********************Methode d'instance************************* */

  // Les commandes sont créées par le plugin : elles ne sont pas supprimées par la sauvegarde de l'équipement
  public function dontRemoveCmd() {
    return true;
  }

  // Exécution d'une commande
  public function execute($_options = array()) {
    $eqLogic = $this->getEqLogic();
    $channelId = $eqLogic->getConfiguration('channelId', '');
    if ($channelId == '') {
      throw new Exception(__('Aucun salon sélectionné pour l\'équipement', __FILE__) . ' ' . $eqLogic->getHumanName());
    }
    $params = array(
      'eqLogicId' => $eqLogic->getId(),
      'channelId' => $channelId,
      'defaultColor' => $eqLogic->getConfiguration('embedColor', ''),
      'content' => '',
      'embed' => null,
      'files' => array(),
    );
    switch ($this->getLogicalId()) {
      case 'sendMessage':
        $title = trim(self::option($_options, 'title'));
        // Un ask du core envoie la question à la fois comme titre et comme message
        if ($title == trim(self::option($_options, 'message'))) {
          $title = '';
        }
        $params['content'] = ($title != '' ? '**' . $title . "**\n" : '') . self::option($_options, 'message');
        $params['files'] = self::normalizeFiles(isset($_options['files']) ? $_options['files'] : array());
        break;
      case 'sendEmbed':
        $params['content'] = self::option($_options, 'content');
        $params['embed'] = array(
          'title' => self::option($_options, 'title'),
          'url' => trim(self::option($_options, 'url')),
          'description' => self::option($_options, 'message'),
          'color' => trim(self::option($_options, 'color')),
          'footer' => self::option($_options, 'footer'),
          'image' => trim(self::option($_options, 'image')),
          'thumbnail' => trim(self::option($_options, 'thumbnail')),
          'fields' => self::parseFields(self::option($_options, 'fields'), self::option($_options, 'fieldsInline') == '1'),
          'timestamp' => self::option($_options, 'timestamp') == '1',
        );
        if ($params['embed']['image'] != '' && !preg_match('#^https?://#i', $params['embed']['image'])) {
          $image = self::normalizeFiles(array($params['embed']['image']));
          $params['embed']['image'] = count($image) > 0 ? $image[0] : '';
        }
        $params['files'] = self::normalizeFiles(isset($_options['files']) ? $_options['files'] : array());
        break;
      case 'sendFile':
        $params['content'] = self::option($_options, 'message');
        $params['files'] = self::normalizeFiles(isset($_options['files']) ? $_options['files'] : array());
        if (count($params['files']) == 0) {
          throw new Exception(__('Aucun fichier valide à envoyer', __FILE__));
        }
        break;
      case 'sendSummary':
        $params['embed'] = jeediscordReport::globalEmbed();
        break;
      case 'sendObjectSummary':
        $params['embed'] = jeediscordReport::objectEmbed(self::option($_options, 'message'));
        break;
      case 'sendBatterySummary':
        $params['embed'] = jeediscordReport::batteryEmbed();
        break;
      case 'editLastMessage':
        $title = trim(self::option($_options, 'title'));
        $params['content'] = ($title != '' ? '**' . $title . "**\n" : '') . self::option($_options, 'message');
        if (trim($params['content']) == '') {
          throw new Exception(__('Le nouveau texte est vide', __FILE__));
        }
        jeediscord::sendToDaemon('editLast', $params);
        return;
      case 'setChannelName':
        $name = trim(self::option($_options, 'message'));
        if ($name == '') {
          throw new Exception(__('Le nouveau nom est vide', __FILE__));
        }
        jeediscord::sendToDaemon('setChannelName', array('eqLogicId' => $eqLogic->getId(), 'channelId' => $channelId, 'name' => $name));
        return;
      case 'setChannelTopic':
        $topic = trim(self::option($_options, 'message'));
        if ($topic == '') {
          throw new Exception(__('Le nouveau sujet est vide', __FILE__));
        }
        jeediscord::sendToDaemon('setChannelTopic', array('eqLogicId' => $eqLogic->getId(), 'channelId' => $channelId, 'topic' => $topic));
        return;
      case 'deleteLastMessage':
        jeediscord::sendToDaemon('deleteLast', $params);
        return;
      case 'cleanChannel':
        $age = max(0, (float) str_replace(',', '.', self::option($_options, 'age')));
        $seconds = (int) round($age * (self::option($_options, 'unit') == 'days' ? 86400 : 3600));
        jeediscord::sendToDaemon('purge', array(
          'eqLogicId' => $eqLogic->getId(),
          'channelId' => $channelId,
          'maxAge' => $seconds,
          'scope' => self::option($_options, 'scope') == 'all' ? 'all' : 'bot',
        ));
        return;
      case 'sendQuickActions':
        $params['content'] = self::option($_options, 'message');
        $params['buttons'] = jeediscord::registerQuickActions($eqLogic->getId(), self::option($_options, 'buttons'));
        if (count($params['buttons']) == 0) {
          throw new Exception(__('Aucune action rapide valide à envoyer', __FILE__));
        }
        break;
      default:
        return;
    }
    // Question d'un scénario (action ask) : réponses proposées en boutons ou en menu déroulant, ou message libre
    if (in_array($this->getLogicalId(), array('sendMessage', 'sendEmbed', 'sendFile')) && isset($_options['answer']) && is_array($_options['answer']) && self::option($_options, 'variable') != '') {
      $params['ask'] = array(
        'cmdId' => $this->getId(),
        'answers' => array_values(array_filter(array_map('trim', $_options['answer']), 'strlen')),
        'timeout' => isset($_options['timeout']) ? (int) $_options['timeout'] : 300,
        'labels' => array(
          'answered' => '> ✅ ' . __('Réponse de %user% : %answer%', __FILE__),
          'timeout' => '> ⏱️ ' . __('Aucune réponse', __FILE__),
          'choose' => __('Choisissez une réponse', __FILE__),
          'hint' => '> ✍️ ' . __('Répondez en écrivant un message dans ce salon', __FILE__),
        ),
      );
    }
    $result = jeediscord::sendToDaemon('send', $params);
    if (is_array($result) && !empty($result['ignoredFiles'])) {
      log::add('jeediscord', 'warning', __('Fichiers ignorés', __FILE__) . ' : ' . implode(', ', $result['ignoredFiles']));
    }
  }

  /**
   * Valeur texte d'une option de commande (les marqueurs #option# non remplacés sont ignorés)
   * @param array $_options
   * @param string $_key
   * @return string
   */
  private static function option($_options, $_key) {
    if (!is_array($_options) || !isset($_options[$_key]) || is_array($_options[$_key])) {
      return '';
    }
    $value = (string) $_options[$_key];
    return ($value == '#' . $_key . '#') ? '' : $value;
  }

  /**
   * Champs d'embed saisis sous la forme « Nom | Valeur », un par ligne
   * @param string $_text
   * @param bool $_inline
   * @return array
   */
  private static function parseFields($_text, $_inline) {
    $fields = array();
    foreach (preg_split('/\r\n|\r|\n/', (string) $_text) as $line) {
      $parts = explode('|', $line, 2);
      if (count($parts) != 2 || trim($parts[0]) == '' || trim($parts[1]) == '') {
        continue;
      }
      $fields[] = array('name' => trim($parts[0]), 'value' => trim($parts[1]), 'inline' => $_inline);
    }
    return $fields;
  }

  /**
   * Liste de fichiers à envoyer : tableau (option files des scénarios, rapports, caméra)
   * ou texte (un chemin par ligne, ou séparés par des virgules ou points-virgules).
   * Les chemins relatifs sont résolus depuis le dossier de Jeedom. Les fichiers de configuration
   * de Jeedom et les dossiers système sensibles sont refusés.
   * @param array|string $_files
   * @return array chemins absolus des fichiers existants
   */
  public static function normalizeFiles($_files) {
    if (!is_array($_files)) {
      $_files = preg_split('/[\r\n,;]+/', (string) $_files);
    }
    $jeedomRoot = realpath(__DIR__ . '/../../../..');
    $forbidden = array($jeedomRoot . '/core/config/', '/etc/', '/root/', '/proc/', '/sys/');
    $return = array();
    foreach ($_files as $file) {
      $file = trim((string) $file);
      if ($file == '' || $file == '#files#') {
        continue;
      }
      if ($file[0] != '/') {
        $file = $jeedomRoot . '/' . $file;
      }
      $path = realpath($file);
      if ($path === false || !is_file($path) || !is_readable($path)) {
        log::add('jeediscord', 'warning', __('Fichier introuvable ou illisible', __FILE__) . ' : ' . $file);
        continue;
      }
      foreach ($forbidden as $prefix) {
        if (strpos($path, $prefix) === 0 || strpos($path, '/.') !== false) {
          log::add('jeediscord', 'warning', __('Envoi de ce fichier refusé', __FILE__) . ' : ' . $path);
          continue 2;
        }
      }
      $return[] = $path;
    }
    return array_values(array_unique($return));
  }

  /*     * **********************Getteur Setteur*************************** */
}
