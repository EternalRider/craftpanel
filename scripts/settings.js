/* globals game, FormApplication, $ */
import { updateHandler, compareVersions } from './utils.js';

// import * as CONST from './constants.js'
const MODULE_ID = 'craftpanel';

// export const settingVariables = [

// ];

/**
 * 更新设置
 * @param {string} newVersion 
 */
export function updateSettings(newVersion) {
    const currentVersion = game.settings.get(MODULE_ID, 'version') ?? "0";
    if (compareVersions(currentVersion, newVersion) < 0) {
        updateHandler(currentVersion, newVersion);
        game.settings.set(MODULE_ID, 'version', newVersion);
    }
}

export function register_settings() {
    game.settings.register(MODULE_ID, 'quantityPath', {
        name: game.i18n.localize(`${MODULE_ID}.settings.quantityPath`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.quantityPath-hint`),
        type: String,
        default: "system.quantity",
        scope: 'world',
        config: true,
    });
    game.settings.register(MODULE_ID, 'weightPath', {
        name: game.i18n.localize(`${MODULE_ID}.settings.weightPath`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.weightPath-hint`),
        type: String,
        default: "system.weight",
        scope: 'world',
        config: true,
    });
    game.settings.register(MODULE_ID, 'descriptionPath', {
        name: game.i18n.localize(`${MODULE_ID}.settings.descriptionPath`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.descriptionPath-hint`),
        type: String,
        default: "system.description",
        scope: 'world',
        config: true,
    });
    game.settings.register(MODULE_ID, 'defaultAEType', {
        name: game.i18n.localize(`${MODULE_ID}.settings.defaultAEType`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.defaultAEType-hint`),
        type: String,
        default: "base",
        scope: 'world',
        config: true,
        choices: CONFIG.ActiveEffect.typeLabels
    });

    // 用户自定义物品颜色脚本
    game.settings.register(MODULE_ID, 'customItemColorScript', {
        name: game.i18n.localize(`${MODULE_ID}.settings.customItemColorScript`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.customItemColorScript-hint`),
        type: String,
        default: `game.modules.get("rarity-colors")?.api?.getColorFromItem(item) ?? ""`,
        scope: 'world',
        config: true,
        multiline: true,
    });

    game.settings.register(MODULE_ID, 'debug', {
        name: game.i18n.localize(`${MODULE_ID}.settings.debug`),
        hint: game.i18n.localize(`${MODULE_ID}.settings.debug-hint`),
        type: Boolean,
        default: false,
        scope: 'world',
        config: true,
    });

    game.settings.register(MODULE_ID, 'version', {
        type: String,
        default: "0",
        scope: 'world',
        config: false,
    });
}


