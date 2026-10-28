# Changelog del plugin JeeDiscord

>**IMPORTANTE**
>
>Se non ci sono informazioni sull'aggiornamento, significa che riguarda solo un aggiornamento della documentazione, della traduzione o dei testi.

# 28/10/2026

- Passaggio alla versione stabile

# 26/10/2026

- Creazione del plugin: struttura, configurazione del bot, dispositivo «canale Discord»
- Demone Node.js (discord.js 14): connessione a Discord, attività del bot, code per canale, log debug con mascheramento delle informazioni sensibili
- Stato del bot nella configurazione, elenco dei canali nei dispositivi
- Comandi «Invia un messaggio», «Invia un embed» e «Invia un file», con moduli dedicati negli scenari
- Menzioni di membri, ruoli e canali tramite il loro nome
- Suddivisione automatica dei messaggi lunghi, rispetto dei limiti di Discord (embed, file)
- Azione «Ask» degli scenari: risposte con pulsanti (menu a tendina oltre 10) o messaggio libero (la domanda indica come rispondere), pulsanti disattivati e messaggio completato dopo la risposta o la scadenza
- Comando «Invia azioni rapide»: pulsanti persistenti che avviano un comando, uno scenario (nome `[Gruppo][Oggetto][Nome]`, `[Gruppo][Nome]` accettato) o un'interazione, con ruoli autorizzati, selettore di scenario e di comando nel modulo
- Correzione: i moduli di scenario «Invia un embed» e «Invia un file» non salvavano i loro campi
- Gli errori imprevisti di un'azione rapida vengono registrati e segnalati all'utente invece di bloccare la risposta
- Documentazione: schermate della configurazione, del dispositivo, dei comandi e dei moduli di scenario
- Comandi «Modifica l'ultimo messaggio inviato» e «Elimina l'ultimo messaggio inviato»
- Comando «Pulisci il canale» (età, messaggi del bot o tutti) e pulizia automatica oraria in base alla durata di conservazione del dispositivo; eliminazione in blocco sotto i 14 giorni, una per una oltre
- Comandi «Rinomina il canale» e «Modifica l'argomento del canale» (canale vocale utilizzabile come display), con unione delle richieste e considerazione del limite di Discord (2 modifiche ogni 10 minuti)
- Comandi slash `/jeedom interaction`, `/jeedom scenario`, `/jeedom cmd` e `/clean`, con completamento automatico, riservati agli amministratori del server e ai ruoli autorizzati, nei canali collegati a un dispositivo attivo; descrizioni tradotte
- Comandi «Invia il riepilogo della casa», «Invia il riepilogo di un oggetto» e «Invia lo stato delle batterie», emoji personalizzabili
- Monitoraggio dei demoni e delle dipendenze dei plugin (ogni 5 minuti): avviso nei canali che lo hanno richiesto, poi messaggio di ritorno alla normalità
- Documentazione dell'invio delle istantanee del plugin Camera
- Comando «Invia il riepilogo di un oggetto»: modulo con selezione dell'oggetto dall'elenco degli oggetti di Jeedom
- Correzione: il nome dell'oggetto (riepilogo di un oggetto) e l'età (pulizia del canale) si cancellavano alla riapertura di uno scenario
- Documentazione: procedura dettagliata di invio delle istantanee del plugin Camera
- Invio di file: un indirizzo web (http, https) può sostituire il percorso di un file; viene scaricato nella cartella temporanea prima dell'invio (con il nome `sendDiscord.<estensione>`), poi eliminato
- Modulo «Invia un embed» degli scenari ridisegnato: un campo per riga, etichette allineate, elenchi Sì / No al posto delle caselle, pulsante di selezione di un comando su tutti i campi di testo
- Documentazione: presentazione delle funzioni, sezione di risoluzione dei problemi, nomi reali dei parametri dei comandi slash
- Correzione: i valori predefiniti della configurazione (porta del demone, comandi slash...) non venivano salvati all'installazione
- Correzione: i moduli del plugin negli scenari (embed, file, azioni rapide, pulizia, riepilogo di un oggetto) sono ora tradotti nella lingua di Jeedom
- Documentazione tradotta nelle sei lingue del plugin, schermate in ogni lingua, panoramica più ampia
- Ricezione di messaggi (contenuto, autore, allegati) e reazioni (emoji, autore, aggiunta o rimozione)
