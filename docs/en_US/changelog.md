# JeeDiscord plugin changelog

>**IMPORTANT**
>
>If there is no information about an update, it only concerns documentation, translation or text updates.

# 26/10/2026

- Plugin creation: structure, bot configuration, "Discord channel" equipment
- Node.js daemon (discord.js 14): connection to Discord, bot activity, per-channel queues, debug logs hiding sensitive information
- Bot status in the configuration, list of channels in the equipments
- "Send a message", "Send an embed" and "Send a file" commands, with dedicated forms in scenarios
- Mentions of members, roles and channels by name
- Automatic splitting of long messages, respect of Discord's limits (embeds, files)
- Scenarios "Ask" action: answers as buttons (drop-down menu beyond 10) or free message (the question tells how to answer), buttons disabled and message completed after the answer or the timeout
- "Send quick actions" command: persistent buttons running a command, a scenario (name `[Group][Object][Name]`, `[Group][Name]` accepted) or an interaction, with allowed roles, scenario and command selectors in the form
- Fix: the "Send an embed" and "Send a file" scenario forms did not save their fields
- Unexpected errors of a quick action are logged and reported to the user instead of blocking the answer
- Documentation: screenshots of the configuration, the equipment, the commands and the scenario forms
- "Edit the last sent message" and "Delete the last sent message" commands
- "Clean the channel" command (age, bot's or all messages) and hourly automatic cleanup according to the equipment's retention period; bulk deletion under 14 days, one by one beyond
- "Rename the channel" and "Change the channel topic" commands (voice channel usable as a display), with merging of requests and handling of Discord's limit (2 changes every 10 minutes)
- Slash commands `/jeedom interaction`, `/jeedom scenario`, `/jeedom cmd` and `/clean`, with autocompletion, reserved to server administrators and allowed roles, in the channels linked to an active equipment; translated descriptions
- "Send the home summary", "Send an object summary" and "Send the battery status" commands, customizable emojis
- Monitoring of plugin daemons and dependencies (every 5 minutes): alert in the channels that asked for it, then a back-to-normal message
- Documentation of sending the Camera plugin's snapshots
- "Send an object summary" command: form with selection of the object from Jeedom's list of objects
- Fix: the object name (object summary) and the age (channel cleanup) were erased when reopening a scenario
- Documentation: detailed procedure to send the Camera plugin's snapshots
- File sending: a web address (http, https) can replace a file path; it is downloaded into the temporary folder before sending (named `sendDiscord.<extension>`), then deleted
- Scenario "Send an embed" form redesigned: one field per line, aligned labels, Yes / No lists instead of check boxes, command selection button on all text fields
- Documentation: presentation of the features, troubleshooting section, real names of the slash command parameters
- Fix: the configuration default values (daemon port, slash commands...) were not saved at installation
- Fix: the plugin's forms in scenarios (embed, file, quick actions, cleanup, object summary) are now translated into Jeedom's language
- Documentation translated into the plugin's six languages, screenshots in each language, wider overview
- Receiving messages (content, author, attachments) and reactions (emoji, author, addition or removal)
