# Changelog des Plugins JeeDiscord

>**WICHTIG**
>
>Gibt es keine Informationen zum Update, betrifft es nur ein Update der Dokumentation, der Übersetzung oder von Texten.

# 26/10/2026

- Erstellung des Plugins: Struktur, Konfiguration des Bots, Gerät „Discord-Kanal“
- Node.js-Dämon (discord.js 14): Verbindung zu Discord, Aktivität des Bots, Warteschlangen pro Kanal, Debug-Logs mit Ausblendung sensibler Informationen
- Bot-Status in der Konfiguration, Liste der Kanäle in den Geräten
- Befehle „Nachricht senden“, „Embed senden“ und „Datei senden“, mit eigenen Formularen in den Szenarien
- Erwähnungen von Mitgliedern, Rollen und Kanälen per Namen
- Automatisches Aufteilen langer Nachrichten, Einhaltung der Discord-Limits (Embeds, Dateien)
- Aktion „Ask“ der Szenarien: Antworten als Schaltflächen (Dropdown-Menü ab 10) oder freie Nachricht (die Frage nennt, wie zu antworten ist), Schaltflächen deaktiviert und Nachricht ergänzt nach der Antwort oder der Frist
- Befehl „Schnellaktionen senden“: dauerhafte Schaltflächen, die einen Befehl, ein Szenario (Name `[Gruppe][Objekt][Name]`, `[Gruppe][Name]` akzeptiert) oder eine Interaktion starten, mit erlaubten Rollen, Szenario- und Befehlsauswahl im Formular
- Korrektur: Die Szenarioformulare „Embed senden“ und „Datei senden“ speicherten ihre Felder nicht
- Unerwartete Fehler einer Schnellaktion werden protokolliert und dem Benutzer gemeldet, statt die Antwort zu blockieren
- Dokumentation: Screenshots der Konfiguration, des Geräts, der Befehle und der Szenarioformulare
- Befehle „Zuletzt gesendete Nachricht bearbeiten“ und „Zuletzt gesendete Nachricht löschen“
- Befehl „Kanal bereinigen“ (Alter, Nachrichten des Bots oder alle) und stündliche automatische Bereinigung gemäß der Aufbewahrungsdauer des Geräts; Massenlöschung unter 14 Tagen, darüber einzeln
- Befehle „Kanal umbenennen“ und „Kanalthema ändern“ (Sprachkanal als Anzeige nutzbar), mit Zusammenführung der Anfragen und Berücksichtigung des Discord-Limits (2 Änderungen alle 10 Minuten)
- Slash-Befehle `/jeedom interaction`, `/jeedom scenario`, `/jeedom cmd` und `/clean`, mit Autovervollständigung, reserviert für Serveradministratoren und erlaubte Rollen, in den mit einem aktiven Gerät verknüpften Kanälen; übersetzte Beschreibungen
- Befehle „Zusammenfassung des Hauses senden“, „Zusammenfassung eines Objekts senden“ und „Batteriestatus senden“, anpassbare Emojis
- Überwachung der Dämonen und Abhängigkeiten der Plugins (alle 5 Minuten): Alarm in den Kanälen, die ihn angefordert haben, dann Nachricht über die Rückkehr zur Normalität
- Dokumentation des Sendens der Schnappschüsse des Kamera-Plugins
- Befehl „Zusammenfassung eines Objekts senden“: Formular mit Auswahl des Objekts aus der Objektliste von Jeedom
- Korrektur: Der Objektname (Zusammenfassung eines Objekts) und das Alter (Kanalbereinigung) wurden beim erneuten Öffnen eines Szenarios gelöscht
- Dokumentation: detaillierte Vorgehensweise zum Senden der Schnappschüsse des Kamera-Plugins
- Senden von Dateien: Eine Webadresse (http, https) kann den Pfad einer Datei ersetzen; sie wird vor dem Senden in den temporären Ordner heruntergeladen (unter dem Namen `sendDiscord.<Endung>`) und dann gelöscht
- Formular „Embed senden“ der Szenarien neu gestaltet: ein Feld pro Zeile, ausgerichtete Beschriftungen, Ja / Nein-Listen statt Kontrollkästchen, Schaltfläche zur Befehlsauswahl in allen Textfeldern
- Dokumentation: Vorstellung der Funktionen, Abschnitt zur Fehlerbehebung, tatsächliche Namen der Parameter der Slash-Befehle
- Korrektur: Die Standardwerte der Konfiguration (Port des Dämons, Slash-Befehle...) wurden bei der Installation nicht gespeichert
- Korrektur: Die Formulare des Plugins in den Szenarien (Embed, Datei, Schnellaktionen, Bereinigung, Objektzusammenfassung) werden jetzt in die Sprache von Jeedom übersetzt
- Dokumentation in die sechs Sprachen des Plugins übersetzt, Screenshots in jeder Sprache, breitere Übersicht
- Empfang von Nachrichten (Inhalt, Autor, Anhänge) und Reaktionen (Emoji, Autor, Hinzufügen oder Entfernen)
