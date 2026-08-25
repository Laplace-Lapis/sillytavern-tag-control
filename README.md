# Tag Control: Manage other extensions via tags

This is a meta extension that manages other extensions via rules, that operate on tags white- and blacklists.
Currently in the out-of-the-box SillyTavern each extension needs to be managed manually or via STScript. This extensions instead allows to create rules, that operate on currently selected character tags and automatically adjust managed extensions setting on character switch or tag change.

## What are rules?

Each rule consists of:
- ID of extension being managed: one rule = one extension. If multiple extensions need to be changed by the same tag, you would neeed to create multiple rules.
- Tag whitelist: for rule to apply character should have at least one tag from this list. Ignored, if empty.
- Tag blacklist: for rule to apply character should not have any tag from this list. Ignored, if empty.
- **IMPORTANT**: if both whitelist and blacklist are empty, rule would not be applied at all.
- Desired extension settings: currently supports enabled/disabled flag and target preset for the managed extension in general. See below for each specific extension's settings.

## When and How are rules applied?

When characters switch occurs (CHAT_CHANGED event with `character_id` being different from the previous one), this extension goes from top to bottom through all rules and determines final target settings based on character tags. Rules at the end of the list override rules at the beginning, so you can have more generic rule at the start and override them with specific ones at the end.
After target settings are determined, extension applies to the managed extension one-by-one, guarantying that each managed extension would be updated no more than once.

You can also manually trigger rules re-application by clicking `Reapply rules` button in the extension settings.

## Which extensions are managed?

Currently (at 1.1.X), following extensions can be managed:
- Built-in RegEx extension: selected preset can be changed
- [Moonlit Echoes Theme](https://github.com/RivelleDays/SillyTavern-MoonlitEchoesTheme): can be enabled/disabled and current chat style can be changed among default ones and theme-specific ones (e.g. Flat/Bubble/Tide/Whisper/etc)
- [NoAss](https://gitgud.io/Monblant/noass): can be enabled/disabled and current preset can be changed.
- [CharacterIcons](https://gitgud.io/Monblant/sillytavern-charactericons"): can be enabled/disabled and current preset can be changed.

## Security guarantees

This extension only operates client-side by triggering events and/or modifying DOM elements (e.g. checking/unckeing "enabled" checkbox in Extensions UI), when no programmatic controls are provided, related to the managed extensions.  No calls should be done to any external APIs, and no modifications should be done to the outgoing or incoming messages.

## How to install

Use this URL with the extension installer: `https://github.com/Laplace-Lapis/sillytavern-tag-control

## License

AGPLv3

## Changelog

### 2.0.0
- **Breaking:** settings storage key renamed `SillyTavern-TagControl` → `tagControl` as part of an
  internal cleanup pass to unify code style across my extensions. 1.x.x rules are not migrated — recreate them after upgrading. 
- Internal cleanup pass to unify all my extensions' code style.
### 1.2.1  
- Added guard to avoid rules applying before the character is selected (on recent chats screen)
### 1.2.0  
- Added `Reapply rules` button to settings to be able to re-trigger rules, if you have edited tags on the current character (as tags edit does not emit any events);
- Fixed conflict with RegExt extension manual preset change, which caused rules to be re-applied. Now rules are not being re-applied until you switch to different character.
### 1.1.0 
- Added support for drag and drop to reorder rules
