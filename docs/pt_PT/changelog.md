# Changelog do plugin JeeDiscord

>**IMPORTANTE**
>
>Se não houver informação sobre a atualização, é porque diz respeito apenas a uma atualização da documentação, da tradução ou de textos.

# 26/10/2026

- Criação do plugin: estrutura, configuração do bot, equipamento «canal Discord»
- Daemon Node.js (discord.js 14): ligação ao Discord, atividade do bot, filas por canal, logs debug com ocultação das informações sensíveis
- Estado do bot na configuração, lista de canais nos equipamentos
- Comandos «Enviar uma mensagem», «Enviar um embed» e «Enviar um ficheiro», com formulários dedicados nos cenários
- Menções de membros, funções e canais pelo nome
- Divisão automática das mensagens longas, respeito pelos limites do Discord (embeds, ficheiros)
- Ação «Ask» dos cenários: respostas em botões (menu pendente a partir de 10) ou mensagem livre (a pergunta indica como responder), botões desativados e mensagem completada após a resposta ou o prazo
- Comando «Enviar ações rápidas»: botões persistentes que lançam um comando, um cenário (nome `[Grupo][Objeto][Nome]`, `[Grupo][Nome]` aceite) ou uma interação, com funções autorizadas, seletor de cenário e de comando no formulário
- Correção: os formulários de cenário «Enviar um embed» e «Enviar um ficheiro» não guardavam os seus campos
- Os erros inesperados de uma ação rápida são registados e comunicados ao utilizador em vez de bloquear a resposta
- Documentação: capturas de ecrã da configuração, do equipamento, dos comandos e dos formulários de cenário
- Comandos «Editar a última mensagem enviada» e «Eliminar a última mensagem enviada»
- Comando «Limpar o canal» (idade, mensagens do bot ou todas) e limpeza automática horária consoante a duração de conservação do equipamento; eliminação em massa abaixo de 14 dias, uma a uma acima
- Comandos «Mudar o nome do canal» e «Alterar o tópico do canal» (canal de voz utilizável como ecrã), com junção dos pedidos e consideração do limite do Discord (2 alterações por cada 10 minutos)
- Comandos slash `/jeedom interaction`, `/jeedom scenario`, `/jeedom cmd` e `/clean`, com preenchimento automático, reservados aos administradores do servidor e às funções autorizadas, nos canais associados a um equipamento ativo; descrições traduzidas
- Comandos «Enviar o resumo da casa», «Enviar o resumo de um objeto» e «Enviar o estado das baterias», emojis personalizáveis
- Monitorização dos daemons e das dependências dos plugins (de 5 em 5 minutos): alerta nos canais que o pediram, depois mensagem de regresso à normalidade
- Documentação do envio das capturas do plugin Câmara
- Comando «Enviar o resumo de um objeto»: formulário com seleção do objeto na lista de objetos do Jeedom
- Correção: o nome do objeto (resumo de um objeto) e a idade (limpeza do canal) apagavam-se ao reabrir um cenário
- Documentação: procedimento detalhado de envio das capturas do plugin Câmara
- Envio de ficheiros: um endereço web (http, https) pode substituir o caminho de um ficheiro; é descarregado para a pasta temporária antes do envio (com o nome `sendDiscord.<extensão>`) e depois eliminado
- Formulário «Enviar um embed» dos cenários redesenhado: um campo por linha, etiquetas alinhadas, listas Sim / Não em vez de caixas de seleção, botão de seleção de um comando em todos os campos de texto
- Documentação: apresentação das funcionalidades, secção de resolução de problemas, nomes reais dos parâmetros dos comandos slash
- Correção: os valores por omissão da configuração (porta do daemon, comandos slash...) não eram guardados na instalação
- Correção: os formulários do plugin nos cenários (embed, ficheiro, ações rápidas, limpeza, resumo de um objeto) são agora traduzidos para a língua do Jeedom
- Documentação traduzida nas seis línguas do plugin, capturas de ecrã em cada língua, visão geral mais larga
- Receção de mensagens (conteúdo, autor, anexos) e de reações (emoji, autor, adição ou remoção)
