/* This file is part of the JeeDiscord plugin for Jeedom.
 *
 * Licensed under the MIT License. See the LICENSE file at the root of the project.
 */

/* Permet la réorganisation des commandes dans l'équipement */
$("#table_cmd").sortable({
  axis: "y",
  cursor: "move",
  items: ".cmd",
  placeholder: "ui-state-highlight",
  tolerance: "intersect",
  forcePlaceholderSize: true
})

/* ************************ Sélection du salon ************************ */

var jeediscordGuilds = []

/* Remplit la liste des salons (groupés par serveur) à partir des données du démon */
function jeediscord_fillChannels() {
  var select = document.getElementById('sel_jeediscordChannel')
  var current = $('.eqLogicAttr[data-l1key=configuration][data-l2key=channelId]').value()
  select.innerHTML = ''
  var empty = document.createElement('option')
  empty.value = ''
  empty.textContent = (jeediscordGuilds.length == 0) ? '{{Aucun salon disponible (démon arrêté ?)}}' : '{{Aucun}}'
  select.appendChild(empty)
  var found = (current == '')
  jeediscordGuilds.forEach(function(guild) {
    var group = document.createElement('optgroup')
    group.label = guild.name
    guild.channels.forEach(function(channel) {
      var option = document.createElement('option')
      option.value = channel.id
      option.textContent = (channel.type == 'voice' ? '🔊 ' : '# ') + channel.name + (channel.parent != '' ? ' (' + channel.parent + ')' : '') + (!channel.canSend ? ' - {{droits insuffisants}}' : '')
      option.disabled = !channel.canView
      group.appendChild(option)
      if (channel.id == current) {
        found = true
      }
    })
    select.appendChild(group)
  })
  if (!found) {
    var unknown = document.createElement('option')
    unknown.value = current
    unknown.textContent = '{{Salon inconnu ou inaccessible}} (' + current + ')'
    select.appendChild(unknown)
  }
  select.value = current
}

function jeediscord_loadChannels(_refresh) {
  $.ajax({
    type: 'POST',
    url: 'plugins/jeediscord/core/ajax/jeediscord.ajax.php',
    data: { action: 'getGuilds', refresh: _refresh ? 1 : 0 },
    dataType: 'json',
    global: false,
    error: function(request, status, error) {
      handleAjaxError(request, status, error)
    },
    success: function(data) {
      if (data.state != 'ok') {
        jeedomUtils.showAlert({ message: data.result, level: 'danger' })
        return
      }
      jeediscordGuilds = data.result
      jeediscord_fillChannels()
    }
  })
}

$('#sel_jeediscordChannel').on('change', function() {
  $('.eqLogicAttr[data-l1key=configuration][data-l2key=channelId]').value(this.value)
})

$('#bt_jeediscordRefreshChannels').on('click', function() {
  jeediscord_loadChannels(true)
})

/* Appelée par le core à l'affichage d'un équipement */
function printEqLogic(_eqLogic) {
  jeediscord_fillChannels()
}

jeediscord_loadChannels(false)

/* Fonction permettant l'affichage des commandes dans l'équipement
 * Les commandes sont créées par le plugin : le type et le sous-type ne sont pas modifiables */
function addCmdToTable(_cmd) {
  if (!isset(_cmd)) {
    var _cmd = { configuration: {} }
  }
  if (!isset(_cmd.configuration)) {
    _cmd.configuration = {}
  }
  var tr = '<tr class="cmd" data-cmd_id="' + init(_cmd.id) + '">'
  tr += '<td class="hidden-xs">'
  tr += '<span class="cmdAttr" data-l1key="id"></span>'
  tr += '</td>'
  tr += '<td>'
  tr += '<div class="input-group">'
  tr += '<input class="cmdAttr form-control input-sm roundedLeft" data-l1key="name" placeholder="{{Nom de la commande}}">'
  tr += '<span class="input-group-btn"><a class="cmdAction btn btn-sm btn-default" data-l1key="chooseIcon" title="{{Choisir une icône}}"><i class="fas fa-icons"></i></a></span>'
  tr += '<span class="cmdAttr input-group-addon roundedRight" data-l1key="display" data-l2key="icon" style="font-size:19px;padding:0 5px 0 0!important;"></span>'
  tr += '</div>'
  tr += '</td>'
  tr += '<td>'
  tr += '<input class="cmdAttr form-control input-sm" data-l1key="type" disabled style="margin-bottom:5px;">'
  tr += '<input class="cmdAttr form-control input-sm" data-l1key="subType" disabled>'
  tr += '</td>'
  tr += '<td>'
  tr += '<label class="checkbox-inline"><input type="checkbox" class="cmdAttr" data-l1key="isVisible" checked/>{{Afficher}}</label> '
  if (init(_cmd.type) == 'info') {
    tr += '<label class="checkbox-inline"><input type="checkbox" class="cmdAttr" data-l1key="isHistorized"/>{{Historiser}}</label> '
  }
  tr += '</td>'
  tr += '<td>'
  tr += '<span class="cmdAttr" data-l1key="htmlstate"></span>'
  tr += '</td>'
  tr += '<td>'
  if (is_numeric(_cmd.id)) {
    tr += '<a class="btn btn-default btn-xs cmdAction" data-action="configure"><i class="fas fa-cogs"></i></a> '
    tr += '<a class="btn btn-default btn-xs cmdAction" data-action="test"><i class="fas fa-rss"></i> {{Tester}}</a>'
  }
  tr += '</td>'
  tr += '</tr>'
  $('#table_cmd tbody').append(tr)
  $('#table_cmd tbody tr').last().setValues(_cmd, '.cmdAttr')
}
