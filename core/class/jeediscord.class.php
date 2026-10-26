<?php
/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

/* * ***************************Includes********************************* */
require_once __DIR__  . '/../../../../core/php/core.inc.php';

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
    if ($deamon_info['state'] == 'ok' && hash('sha256', $token) != cache::byKey('jeediscord::tokenHash')->getValue('')) {
      log::add(__CLASS__, 'info', __('Token modifié, redémarrage du démon', __FILE__));
      self::deamon_start();
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
  }

  // Fonction exécutée automatiquement après la sauvegarde (création ou mise à jour) de l'équipement
  public function postSave() {
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

  // Exécution d'une commande
  public function execute($_options = array()) {
  }

  /*     * **********************Getteur Setteur*************************** */
}
