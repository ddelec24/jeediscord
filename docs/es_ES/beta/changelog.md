# Changelog del plugin JeeDiscord

>**IMPORTANTE**
>
>Si no hay información sobre la actualización, es que solo se trata de una actualización de documentación, de traducción o de texto.

# 28/10/2026

- Paso a la versión estable

# 26/10/2026

- Creación del plugin: estructura, configuración del bot, equipo «canal de Discord»
- Demonio Node.js (discord.js 14): conexión a Discord, actividad del bot, colas por canal, logs debug que ocultan la información sensible
- Estado del bot en la configuración, lista de canales en los equipos
- Comandos «Enviar un mensaje», «Enviar un embed» y «Enviar un archivo», con formularios específicos en los escenarios
- Menciones de miembros, roles y canales por su nombre
- División automática de los mensajes largos, respeto de los límites de Discord (embeds, archivos)
- Acción «Ask» de los escenarios: respuestas en botones (menú desplegable a partir de 10) o mensaje libre (la pregunta indica cómo responder), botones desactivados y mensaje completado tras la respuesta o el plazo
- Comando «Enviar acciones rápidas»: botones persistentes que lanzan un comando, un escenario (nombre `[Grupo][Objeto][Nombre]`, `[Grupo][Nombre]` aceptado) o una interacción, con roles autorizados, selector de escenario y de comando en el formulario
- Corrección: los formularios de escenario «Enviar un embed» y «Enviar un archivo» no guardaban sus campos
- Los errores inesperados de una acción rápida se registran y se comunican al usuario en lugar de bloquear la respuesta
- Documentación: capturas de pantalla de la configuración, del equipo, de los comandos y de los formularios de escenario
- Comandos «Modificar el último mensaje enviado» y «Eliminar el último mensaje enviado»
- Comando «Limpiar el canal» (edad, mensajes del bot o todos) y limpieza automática cada hora según la duración de conservación del equipo; eliminación en masa por debajo de 14 días, una a una más allá
- Comandos «Renombrar el canal» y «Cambiar el tema del canal» (canal de voz utilizable como pantalla), con fusión de las peticiones y tenida en cuenta del límite de Discord (2 cambios cada 10 minutos)
- Comandos slash `/jeedom interaction`, `/jeedom scenario`, `/jeedom cmd` y `/clean`, con autocompletado, reservados a los administradores del servidor y a los roles autorizados, en los canales vinculados a un equipo activo; descripciones traducidas
- Comandos «Enviar el resumen de la casa», «Enviar el resumen de un objeto» y «Enviar el estado de las baterías», emojis personalizables
- Supervisión de los demonios y de las dependencias de los plugins (cada 5 minutos): alerta en los canales que la han solicitado y luego mensaje de vuelta a la normalidad
- Documentación del envío de las capturas del plugin Cámara
- Comando «Enviar el resumen de un objeto»: formulario con selección del objeto en la lista de objetos de Jeedom
- Corrección: el nombre del objeto (resumen de un objeto) y la edad (limpieza del canal) se borraban al reabrir un escenario
- Documentación: procedimiento detallado de envío de las capturas del plugin Cámara
- Envío de archivos: una dirección web (http, https) puede sustituir la ruta de un archivo; se descarga en la carpeta temporal antes del envío (con el nombre `sendDiscord.<extensión>`) y luego se elimina
- Formulario «Enviar un embed» de los escenarios rediseñado: un campo por línea, etiquetas alineadas, listas Sí / No en lugar de casillas, botón de selección de un comando en todos los campos de texto
- Documentación: presentación de las funciones, sección de solución de problemas, nombres reales de los parámetros de los comandos slash
- Corrección: los valores por defecto de la configuración (puerto del demonio, comandos slash...) no se guardaban en la instalación
- Corrección: los formularios del plugin en los escenarios (embed, archivo, acciones rápidas, limpieza, resumen de objeto) se traducen ahora al idioma de Jeedom
- Documentación traducida a los seis idiomas del plugin, capturas de pantalla en cada idioma, vista general más ancha
- Recepción de mensajes (contenido, autor, archivos adjuntos) y de reacciones (emoji, autor, adición o retirada)
