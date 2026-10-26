<?php
/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

require_once dirname(__FILE__) . '/../../../core/php/core.inc.php';
include_file('core', 'authentification', 'php');
if (!isConnect()) {
  include_file('desktop', '404', 'php');
  die();
}
?>
<form class="form-horizontal">
  <fieldset>
    <legend><i class="fab fa-discord"></i> {{Bot Discord}}</legend>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Token du bot}}
        <sup><i class="fas fa-question-circle tooltips" title="{{Token du bot, disponible sur le portail développeur Discord (Applications > votre application > Bot > Reset Token)}}"></i></sup>
      </label>
      <div class="col-md-4">
        <input type="text" class="configKey form-control inputPassword" data-l1key="token" autocomplete="off">
      </div>
    </div>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Statut du bot}}</label>
      <div class="col-md-4">
        <span id="span_jeediscordBotStatus" class="label label-default">{{Inconnu}}</span>
        <a class="btn btn-xs btn-default" id="bt_jeediscordRefreshStatus" title="{{Actualiser}}"><i class="fas fa-sync"></i></a>
      </div>
    </div>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Type d'activité}}
        <sup><i class="fas fa-question-circle tooltips" title="{{Préfixe affiché par Discord devant le texte d'activité. Personnalisé : le texte seul}}"></i></sup>
      </label>
      <div class="col-md-4">
        <select class="configKey form-control" data-l1key="activityType">
          <option value="custom">{{Personnalisé}}</option>
          <option value="playing">{{Joue à}}</option>
          <option value="watching">{{Regarde}}</option>
          <option value="listening">{{Écoute}}</option>
          <option value="competing">{{Participe à}}</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Texte d'activité}}
        <sup><i class="fas fa-question-circle tooltips" title="{{Texte affiché sous le nom du bot. Laisser vide pour ne rien afficher}}"></i></sup>
      </label>
      <div class="col-md-4">
        <input type="text" class="configKey form-control" data-l1key="activity" maxlength="128">
      </div>
    </div>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Intents privilégiés}}</label>
      <div class="col-md-8">
        <div class="alert alert-info" style="margin-bottom:0;">
          {{Sur le portail développeur Discord, onglet Bot, activez l'intent « Message Content » pour que le plugin puisse lire le contenu des messages reçus. Les autres intents privilégiés ne sont pas nécessaires.}}
          <br><a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer"><i class="fas fa-external-link-alt"></i> {{Portail développeur Discord}}</a>
        </div>
      </div>
    </div>

    <legend><i class="fas fa-terminal"></i> {{Commandes slash}}</legend>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Commandes slash}}
        <sup><i class="fas fa-question-circle tooltips" title="{{Commandes /jeedom (interaction, scenario, cmd) et /clean, enregistrées sur chaque serveur du bot. Elles ne fonctionnent que dans les salons associés à un équipement actif}}"></i></sup>
      </label>
      <div class="col-md-4">
        <select class="configKey form-control" data-l1key="slashEnabled">
          <option value="1">{{Activées}}</option>
          <option value="0">{{Désactivées}}</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Rôles autorisés}}
        <sup><i class="fas fa-question-circle tooltips" title="{{Noms ou identifiants de rôles Discord, séparés par des virgules. Les administrateurs du serveur sont toujours autorisés. Vide : administrateurs uniquement}}"></i></sup>
      </label>
      <div class="col-md-4">
        <input type="text" class="configKey form-control" data-l1key="slashRoles" placeholder="Famille, Admin">
      </div>
    </div>

    <legend><i class="fas fa-cogs"></i> {{Avancé}}</legend>
    <div class="form-group">
      <label class="col-md-4 control-label">{{Port interne du démon}}
        <sup><i class="fas fa-question-circle tooltips" title="{{Port local utilisé entre Jeedom et le démon. Ne le modifiez qu'en cas de conflit avec un autre plugin}}"></i></sup>
      </label>
      <div class="col-md-2">
        <input type="number" class="configKey form-control" data-l1key="socketport" min="1024" max="65535" placeholder="55095">
      </div>
    </div>
  </fieldset>
</form>

<script>
  /* Affiche l'état du bot. _poll : nombre de nouvelles tentatives tant que le bot n'est pas connecté */
  function jeediscord_refreshBotStatus(_poll) {
    var status = document.getElementById('span_jeediscordBotStatus')
    var icon = document.querySelector('#bt_jeediscordRefreshStatus i')
    if (!status) {
      return
    }
    icon.classList.add('fa-spin')
    domUtils.ajax({
      type: 'POST',
      url: 'plugins/jeediscord/core/ajax/jeediscord.ajax.php',
      data: { action: 'getBotStatus' },
      dataType: 'json',
      global: false,
      error: function() {
        icon.classList.remove('fa-spin')
        status.className = 'label label-danger'
        status.textContent = '{{Erreur}}'
      },
      success: function(data) {
        icon.classList.remove('fa-spin')
        if (data.state != 'ok') {
          status.className = 'label label-danger'
          status.textContent = '{{Erreur}}'
          return
        }
        var result = data.result
        if (result.daemon && result.ready) {
          status.className = 'label label-success'
          status.textContent = '{{Connecté}} : ' + result.bot.tag + ' (' + result.guilds + ' {{serveur(s)}}, ' + result.wsPing + ' ms)'
          return
        }
        status.className = 'label label-warning'
        status.textContent = result.daemon ? '{{Connexion à Discord en cours}}' : '{{Démon arrêté}}'
        if (_poll > 0) {
          setTimeout(function() { jeediscord_refreshBotStatus(_poll - 1) }, 2000)
        }
      }
    })
  }

  /* Appelée par le core après la sauvegarde de la configuration : le démon peut démarrer ou redémarrer */
  function jeediscord_postSaveConfiguration() {
    jeediscord_refreshBotStatus(10)
  }

  document.getElementById('bt_jeediscordRefreshStatus').addEventListener('click', function() {
    jeediscord_refreshBotStatus(0)
  })
  jeediscord_refreshBotStatus(0)
</script>
