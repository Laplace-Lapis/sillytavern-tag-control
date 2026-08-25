// getSortableDelay has no SillyTavern.getContext() equivalent
import { getSortableDelay } from '../../../utils.js';

const MODULE_NAME = 'tagControl';
const EXT_PATH = 'third-party/sillytavern-tag-control';

const DEFAULT_SETTINGS = {
    is_enabled: true,
    rules: [],
};

// Registry of extensions this extension can manage.
// Adding a new extension here requires defining displayName, manifestKey, and apply().
const MANAGED_EXTENSIONS = {
    noass: {
        displayName: 'NoAss',
        manifestKey: 'noass',
        hasEnabledParam: true,
        getSets() {
            const { extensionSettings } = SillyTavern.getContext();
            return (extensionSettings.NoAss?.sets ?? []).map(s => s.name);
        },
        async apply(params) {
            const { extensionSettings, eventSource } = SillyTavern.getContext();
            if (!extensionSettings.NoAss) return;
            if (params.enabled) {
                const reloadFlag = { value: false };
                const presetName = params.active_set || extensionSettings.NoAss.active_set;
                await eventSource.emit('/fatpresets/change/noass', { presetName, reloadFlag });
            } else {
                await eventSource.emit('/fatpresets/disable/noass');
            }
        },
    },
    charactericons: {
        displayName: 'CharacterIcons',
        manifestKey: 'sillytavern-charactericons',
        hasEnabledParam: true,
        getSets() {
            const { extensionSettings } = SillyTavern.getContext();
            return (extensionSettings.CharacterIcons?.sets ?? []).map(s => s.name);
        },
        async apply(params) {
            const { extensionSettings, eventSource } = SillyTavern.getContext();
            if (!extensionSettings.CharacterIcons) return;
            if (params.enabled) {
                const reloadFlag = { value: false };
                const presetName = params.active_set || extensionSettings.CharacterIcons.active_set;
                await eventSource.emit('/fatpresets/change/charactericons', { presetName, reloadFlag });
            } else {
                await eventSource.emit('/fatpresets/disable/charactericons');
            }
        },
    },
    moonlit: {
        displayName: 'Moonlit Echoes Theme',
        manifestKey: 'SillyTavern-MoonlitEchoesTheme',
        hasEnabledParam: true,
        getSets() {
            const { extensionSettings } = SillyTavern.getContext();
            // Moonlit stores presets as an object { [name]: settings }, not an array
            return Object.keys(extensionSettings.SillyTavernMoonlitEchoesTheme?.presets ?? {});
        },
        async apply(params) {
            const { extensionSettings } = SillyTavern.getContext();
            if (!extensionSettings.SillyTavernMoonlitEchoesTheme) return;

            // Enable/disable via Moonlit's own checkbox (triggers CSS injection + slash command init)
            // Moonlit uses vanilla addEventListener, so dispatch a vanilla Event (not jQuery trigger)
            const checkbox = document.getElementById('SillyTavernMoonlitEchoesTheme-enabled');
            if (checkbox && checkbox.checked !== params.enabled) {
                checkbox.checked = params.enabled;
                checkbox.dispatchEvent(new Event('change'));
            }

            // Preset loading via Moonlit's public window API (only meaningful while enabled)
            if (params.enabled && params.active_set) {
                globalThis.MoonlitEchoesTheme?.presets?.load(params.active_set);
            }

            // Chat display style — core ST selector extended by Moonlit (0–7)
            // Applied regardless of enabled state; saved to localStorage by Moonlit's change handler
            if (params.chat_style) {
                const chatDisplay = document.getElementById('chat_display');
                if (chatDisplay && chatDisplay.value !== params.chat_style) {
                    chatDisplay.value = params.chat_style;
                    chatDisplay.dispatchEvent(new Event('change'));
                }
            }
        },
    },
    regex: {
        displayName: 'Regex',
        manifestKey: 'regex',
        hasEnabledParam: false,
        getSets() {
            const { extensionSettings } = SillyTavern.getContext();
            return (extensionSettings.regex_presets ?? []).map(p => p.name);
        },
        async apply(params) {
            if (!params.active_set) return;
            const { extensionSettings } = SillyTavern.getContext();
            const preset = (extensionSettings.regex_presets ?? [])
                .find(p => p.name === params.active_set);
            if (!preset) return;
            const select = document.getElementById('regex_presets');
            if (!select || select.value === preset.id) return;
            select.value = preset.id;
            // fromSlashCommand: true skips the unsaved-changes dialog in RegexPresetManager
            select.dispatchEvent(new CustomEvent('change', { detail: { fromSlashCommand: true } }));
        },
    },
};

function getInstalledManagedExtensions() {
    const { getExtensionManifest } = SillyTavern.getContext();
    return Object.entries(MANAGED_EXTENSIONS)
        .filter(([, ext]) => !!getExtensionManifest(ext.manifestKey))
        .map(([id, ext]) => ({ id, ...ext }));
}

function ensureSettings() {
    const { extensionSettings, saveSettingsDebounced } = SillyTavern.getContext();
    extensionSettings[MODULE_NAME] ??= { ...DEFAULT_SETTINGS, rules: [] };
    extensionSettings[MODULE_NAME].is_enabled ??= DEFAULT_SETTINGS.is_enabled;
    extensionSettings[MODULE_NAME].rules ??= [];
    saveSettingsDebounced();
    return extensionSettings[MODULE_NAME];
}

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    return extensionSettings[MODULE_NAME];
}

function getCurrentTagIds() {
    const { characterId, characters, tagMap } = SillyTavern.getContext();
    const character = characters[characterId];
    if (!character) return [];
    return tagMap[character.avatar] ?? [];
}

function ruleApplies(rule, currentTagIds) {
    const { whitelist, blacklist } = rule;
    if (whitelist.length === 0 && blacklist.length === 0) return false;
    if (blacklist.length > 0 && currentTagIds.some(id => blacklist.includes(id))) return false;
    if (whitelist.length > 0 && !currentTagIds.some(id => whitelist.includes(id))) return false;
    return true;
}

// Tracks the last characterId seen by applyRules so we can distinguish an actual
// character switch (CHAT_CHANGED with a new character) from an in-place reload
// (e.g. triggered by the regex extension after a preset change, same character).
let applyRulesHasRun = false;
/** @type {number|undefined} */
let lastAppliedCharacterId;

async function applyRules() {
    if (!getSettings().is_enabled) return;
    const { characterId } = SillyTavern.getContext();
    if (applyRulesHasRun && characterId === lastAppliedCharacterId) return;
    applyRulesHasRun = true;
    lastAppliedCharacterId = characterId;
    if (characterId === undefined) return; // No character selected (e.g. recent chats page)
    const currentTagIds = getCurrentTagIds();

    const pendingByExtension = new Map();
    for (const rule of getSettings().rules) {
        if (ruleApplies(rule, currentTagIds)) {
            pendingByExtension.set(rule.extensionId, rule.parameters);
        }
    }

    for (const [extensionId, params] of pendingByExtension) {
        await MANAGED_EXTENSIONS[extensionId]?.apply(params);
    }
}

// --- Rule list UI ---

async function renderRuleList() {
    const { t, renderExtensionTemplateAsync } = SillyTavern.getContext();
    const container = document.getElementById('tag-control-rules-list');
    const empty = document.getElementById('tag-control-empty');
    if (!container) return;
    container.innerHTML = '';

    const rules = getSettings().rules;
    if (empty) empty.style.display = rules.length === 0 ? '' : 'none';
    if (rules.length === 0) return;

    for (const rule of rules) {
        const ext = MANAGED_EXTENSIONS[rule.extensionId];
        const html = await renderExtensionTemplateAsync(EXT_PATH, 'rule-row', {
            id: rule.id,
            name: rule.name || t`(unnamed)`,
            extName: ext?.displayName ?? rule.extensionId,
        });
        container.insertAdjacentHTML('beforeend', html);
    }
}

function bindDelegatedHandlers() {
    const container = document.getElementById('tag-control-rules-list');
    if (!container) return;
    container.addEventListener('click', (event) => {
        const row = event.target.closest('.tag-control-rule');
        if (!row) return;
        if (event.target.closest('.tag-control-edit-rule')) {
            openRuleEditor(row.dataset.id);
        } else if (event.target.closest('.tag-control-delete-rule')) {
            deleteRule(row.dataset.id);
        }
    });
}

function initSortable() {
    $('#tag-control-rules-list').sortable({
        delay: getSortableDelay(),
        handle: '.drag-handle',
        stop: function () {
            const rules = getSettings().rules;
            const newRules = [];
            $('#tag-control-rules-list').children('.tag-control-rule').each(function () {
                const id = $(this).data('id');
                const rule = rules.find(r => r.id === id);
                if (rule) newRules.push(rule);
            });
            getSettings().rules = newRules;
            SillyTavern.getContext().saveSettingsDebounced();
        },
    });
}

async function deleteRule(id) {
    const { t, Popup, POPUP_TYPE, POPUP_RESULT, saveSettingsDebounced } = SillyTavern.getContext();
    const rules = getSettings().rules;
    const idx = rules.findIndex(r => r.id === id);
    if (idx === -1) return;
    const name = rules[idx].name || t`(unnamed)`;
    const result = await new Popup(t`Delete rule "${name}"?`, POPUP_TYPE.CONFIRM).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;
    rules.splice(idx, 1);
    saveSettingsDebounced();
    await renderRuleList();
}

// --- Rule editor ---

async function openRuleEditor(ruleId) {
    const {
        t,
        tags,
        saveSettingsDebounced,
        renderExtensionTemplateAsync,
        uuidv4,
        Popup,
        POPUP_TYPE,
        POPUP_RESULT,
    } = SillyTavern.getContext();

    const rules = getSettings().rules;
    const existingRule = ruleId ? rules.find(r => r.id === ruleId) : null;

    const installedExts = getInstalledManagedExtensions();
    if (installedExts.length === 0) {
        toastr.warning(t`No supported managed extensions are installed.`);
        return;
    }

    const templateHtml = await renderExtensionTemplateAsync(EXT_PATH, 'rule-editor');
    const template = $(templateHtml);

    // Populate extension dropdown
    const extSelect = template.find('#rule-extension');
    for (const ext of installedExts) {
        extSelect.append($('<option>').val(ext.id).text(ext.displayName));
    }

    // Populate tag options in both selects from the live tags array
    const whitelistSel = template.find('#rule-whitelist-select');
    const blacklistSel = template.find('#rule-blacklist-select');
    for (const tag of tags) {
        whitelistSel.append($('<option>').val(tag.id).text(tag.name));
        blacklistSel.append($('<option>').val(tag.id).text(tag.name));
    }

    // Fill scalar fields from existing rule or set defaults
    if (existingRule) {
        template.find('#rule-name').val(existingRule.name ?? '');
        extSelect.val(existingRule.extensionId);
        template.find('#rule-param-enabled').prop('checked', existingRule.parameters.enabled);
    } else {
        template.find('#rule-param-enabled').prop('checked', true);
    }

    // Preset select: repopulate options whenever the extension changes
    const presetSel = template.find('#rule-param-preset');
    const enabledChk = template.find('#rule-param-enabled');

    function updatePresetOptions(extId) {
        const prevVal = presetSel.val();
        presetSel.empty();
        presetSel.append($('<option>').val('').text(t`— keep current —`));
        const sets = MANAGED_EXTENSIONS[extId]?.getSets() ?? [];
        for (const name of sets) {
            presetSel.append($('<option>').val(name).text(name));
        }
        if (prevVal && sets.includes(prevVal)) presetSel.val(prevVal);
    }

    function syncPresetEnabled() {
        const extId = extSelect.val();
        const hasEnabled = MANAGED_EXTENSIONS[extId]?.hasEnabledParam !== false;
        presetSel.prop('disabled', hasEnabled && !enabledChk.prop('checked'));
    }

    // Chat style field — only shown when the moonlit extension is selected
    const chatStyleRow = template.find('#rule-chat-style-row');
    const chatStyleSel = template.find('#rule-param-chat-style');

    function syncChatStyleVisibility(extId) {
        chatStyleRow.toggle(extId === 'moonlit');
    }

    // Enabled row — hidden for extensions that don't support an enable/disable toggle
    const enabledRow = template.find('#rule-enabled-row');

    function syncEnabledVisibility(extId) {
        enabledRow.toggle(MANAGED_EXTENSIONS[extId]?.hasEnabledParam !== false);
    }

    updatePresetOptions(extSelect.val());
    syncPresetEnabled();
    syncChatStyleVisibility(extSelect.val());
    syncEnabledVisibility(extSelect.val());
    extSelect.on('change', function () {
        updatePresetOptions($(this).val());
        syncChatStyleVisibility($(this).val());
        syncEnabledVisibility($(this).val());
    });
    enabledChk.on('change', syncPresetEnabled);

    if (existingRule?.parameters?.active_set) {
        presetSel.val(existingRule.parameters.active_set);
    }
    if (existingRule?.parameters?.chat_style) {
        chatStyleSel.val(existingRule.parameters.chat_style);
    }

    // Show popup — Popup.show() appends the dialog to document.body synchronously
    // before returning the promise, so Select2 can be initialized right after.
    const popup = new Popup(template[0], POPUP_TYPE.CONFIRM, '', { wide: true, okButton: t`Save` });
    const popupPromise = popup.show();

    // Initialize Select2 now that the content is in the live DOM.
    // dropdownParent points to the dialog element so the dropdown is inside the
    // top-layer context and isn't clipped by the modal backdrop.
    const s2Opts = {
        width: '100%',
        placeholder: t`Select tags...`,
        allowClear: true,
        closeOnSelect: false,
        dropdownParent: $(popup.dlg),
    };
    whitelistSel.select2(s2Opts);
    blacklistSel.select2(s2Opts);

    // Pre-select saved tag IDs (must happen after select2() init)
    if (existingRule?.whitelist?.length) {
        whitelistSel.val(existingRule.whitelist).trigger('change');
    }
    if (existingRule?.blacklist?.length) {
        blacklistSel.val(existingRule.blacklist).trigger('change');
    }

    // For CONFIRM type, popup resolves with POPUP_RESULT.AFFIRMATIVE (1) on OK,
    // POPUP_RESULT.NEGATIVE (0) on Cancel, null on Escape.
    const result = await popupPromise;
    if (result !== POPUP_RESULT.AFFIRMATIVE) return;

    const name = template.find('#rule-name').val().trim();
    const extensionId = extSelect.val();
    const enabled = template.find('#rule-param-enabled').prop('checked');
    const active_set = presetSel.val() || null;
    const chat_style = chatStyleSel.val() || null;
    const whitelist = whitelistSel.val() ?? [];
    const blacklist = blacklistSel.val() ?? [];

    const rule = {
        id: existingRule?.id ?? uuidv4(),
        name,
        extensionId,
        whitelist,
        blacklist,
        parameters: { enabled, active_set, chat_style },
    };

    if (existingRule) {
        const idx = rules.findIndex(r => r.id === existingRule.id);
        if (idx !== -1) rules[idx] = rule;
    } else {
        rules.push(rule);
    }

    saveSettingsDebounced();
    await renderRuleList();
}

// --- Init ---

export async function init() {
    ensureSettings();
    const { eventSource, event_types, renderExtensionTemplateAsync } = SillyTavern.getContext();

    $('#extensions_settings2').append(await renderExtensionTemplateAsync(EXT_PATH, 'settings'));

    $('#tag-control-enabled')
        .prop('checked', getSettings().is_enabled)
        .on('click', function () {
            getSettings().is_enabled = $(this).prop('checked');
            SillyTavern.getContext().saveSettingsDebounced();
        });

    $('#tag-control-add-rule').on('click', () => openRuleEditor(null));
    $('#tag-control-reapply-rules').on('click', () => {
        applyRulesHasRun = false;
        applyRules();
    });

    await renderRuleList();
    bindDelegatedHandlers();
    initSortable();

    eventSource.makeLast(event_types.CHAT_CHANGED, applyRules);

    await applyRules();
}

jQuery(async () => {
    await init();
});
