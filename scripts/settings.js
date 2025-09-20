/* globals game, FormApplication, $ */

// import * as CONST from './constants.js'
const MODULE_ID = 'craftpanel';

// export const settingVariables = [

// ];

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
}


