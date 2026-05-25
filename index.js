const context = SillyTavern.getContext();
const {
    eventSource,
    event_types,
    extensionSettings,
    saveSettingsDebounced,
    renderExtensionTemplateAsync,
    callPopup,
    uuidv4,
    getExtensionManifest,
    Popup,
    POPUP_TYPE,
    POPUP_RESULT,
} = context;

const EXT_NAME = 'SillyTavern-TagControl';
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
        getSets() {
            return (extensionSettings.NoAss?.sets ?? []).map(s => s.name);
        },
        async apply(params) {
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
        getSets() {
            return (extensionSettings.CharacterIcons?.sets ?? []).map(s => s.name);
        },
        async apply(params) {
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
        getSets() {
            // Moonlit stores presets as an object { [name]: settings }, not an array
            return Object.keys(extensionSettings.SillyTavernMoonlitEchoesTheme?.presets ?? {});
        },
        async apply(params) {
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
};

function getInstalledManagedExtensions() {
    return Object.entries(MANAGED_EXTENSIONS)
        .filter(([, ext]) => !!getExtensionManifest(ext.manifestKey))
        .map(([id, ext]) => ({ id, ...ext }));
}

function checkSettings() {
    if (!extensionSettings[EXT_NAME]) {
        extensionSettings[EXT_NAME] = { ...DEFAULT_SETTINGS, rules: [] };
    }
    extensionSettings[EXT_NAME].is_enabled ??= DEFAULT_SETTINGS.is_enabled;
    extensionSettings[EXT_NAME].rules ??= [];
    saveSettingsDebounced();
}

function getCurrentTagIds() {
    // Call getContext() fresh to get the current characterId (module-level context is a snapshot)
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

async function applyRules() {
    if (!extensionSettings[EXT_NAME].is_enabled) return;
    const currentTagIds = getCurrentTagIds();
    for (const rule of extensionSettings[EXT_NAME].rules) {
        if (ruleApplies(rule, currentTagIds)) {
            await MANAGED_EXTENSIONS[rule.extensionId]?.apply(rule.parameters);
        }
    }
}

// --- Rule list UI ---

function renderRuleList() {
    const container = document.getElementById('tag-control-rules-list');
    if (!container) return;
    container.innerHTML = '';

    const rules = extensionSettings[EXT_NAME].rules;
    if (rules.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tag-control-empty';
        empty.textContent = 'No rules yet. Click "Add Rule" to create one.';
        container.appendChild(empty);
        return;
    }

    for (const rule of rules) {
        const ext = MANAGED_EXTENSIONS[rule.extensionId];
        const row = document.createElement('div');
        row.className = 'tag-control-rule';
        row.dataset.id = rule.id;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tag-control-rule-name';
        nameSpan.textContent = rule.name || '(unnamed)';

        const extSpan = document.createElement('span');
        extSpan.className = 'tag-control-rule-ext';
        extSpan.textContent = ext?.displayName ?? rule.extensionId;

        const editBtn = document.createElement('button');
        editBtn.className = 'tag-control-edit-rule menu_button menu_button_icon interactable';
        editBtn.title = 'Edit rule';
        editBtn.tabIndex = 0;
        editBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i>';
        editBtn.addEventListener('click', () => openRuleEditor(rule.id));

        const delBtn = document.createElement('button');
        delBtn.className = 'tag-control-delete-rule menu_button menu_button_icon interactable';
        delBtn.title = 'Delete rule';
        delBtn.tabIndex = 0;
        delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
        delBtn.addEventListener('click', () => deleteRule(rule.id));

        row.appendChild(nameSpan);
        row.appendChild(extSpan);
        row.appendChild(editBtn);
        row.appendChild(delBtn);
        container.appendChild(row);
    }
}

async function deleteRule(id) {
    const rules = extensionSettings[EXT_NAME].rules;
    const idx = rules.findIndex(r => r.id === id);
    if (idx === -1) return;
    const confirmed = await callPopup(`Delete rule "${rules[idx].name || '(unnamed)'}"?`, 'confirm');
    if (!confirmed) return;
    rules.splice(idx, 1);
    saveSettingsDebounced();
    renderRuleList();
}

// --- Rule editor ---

async function openRuleEditor(ruleId) {
    const rules = extensionSettings[EXT_NAME].rules;
    const existingRule = ruleId ? rules.find(r => r.id === ruleId) : null;

    const installedExts = getInstalledManagedExtensions();
    if (installedExts.length === 0) {
        toastr.warning('No supported managed extensions are installed.');
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
    for (const tag of context.tags) {
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
        presetSel.append($('<option>').val('').text('— keep current —'));
        const sets = MANAGED_EXTENSIONS[extId]?.getSets() ?? [];
        for (const name of sets) {
            presetSel.append($('<option>').val(name).text(name));
        }
        if (prevVal && sets.includes(prevVal)) presetSel.val(prevVal);
    }

    function syncPresetEnabled() {
        presetSel.prop('disabled', !enabledChk.prop('checked'));
    }

    // Chat style field — only shown when the moonlit extension is selected
    const chatStyleRow = template.find('#rule-chat-style-row');
    const chatStyleSel = template.find('#rule-param-chat-style');

    function syncChatStyleVisibility(extId) {
        chatStyleRow.toggle(extId === 'moonlit');
    }

    updatePresetOptions(extSelect.val());
    syncPresetEnabled();
    syncChatStyleVisibility(extSelect.val());
    extSelect.on('change', function() {
        updatePresetOptions($(this).val());
        syncChatStyleVisibility($(this).val());
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
    const popup = new Popup(template[0], POPUP_TYPE.CONFIRM, '', { wide: true, okButton: 'Save' });
    const popupPromise = popup.show();

    // Initialize Select2 now that the content is in the live DOM.
    // dropdownParent points to the dialog element so the dropdown is inside the
    // top-layer context and isn't clipped by the modal backdrop.
    const s2Opts = {
        width: '100%',
        placeholder: 'Select tags...',
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
    renderRuleList();
}

// --- Init ---

jQuery(async () => {
    checkSettings();

    $('#extensions_settings2').append(await renderExtensionTemplateAsync(EXT_PATH, 'settings'));

    $('#tag-control-enabled')
        .prop('checked', extensionSettings[EXT_NAME].is_enabled)
        .on('click', function () {
            extensionSettings[EXT_NAME].is_enabled = $(this).prop('checked');
            saveSettingsDebounced();
        });

    $('#tag-control-add-rule').on('click', () => openRuleEditor(null));

    renderRuleList();

    eventSource.makeLast(event_types.CHAT_CHANGED, applyRules);

    await applyRules();
});
