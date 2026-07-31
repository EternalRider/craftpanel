import { HandlebarsApplication, MODULE_ID, debug } from "../utils.js";
import { CraftPanelBlend } from "./craftPanelBlend.js";
import { CraftPanelElement } from "./craftPanelElement.js";
import { CraftPanelForge } from "./craftPanelForge.js";
import { CraftPanelCook } from "./craftPanelCook.js";
import { CraftPanelEnchant } from "./craftPanelEnchant.js";
import { CraftPanelHandler } from "./craftPanelHandler.js";
import { FormBuilder } from "./formBuilder.js";

/**
 * 面板类型与对应类/使用模式构造器的映射表。
 * 用于 craftButton / editButton 中根据类型快速查找对应的面板类。
 * @type {Object<string, {cls: Function, useMode: boolean}>}
 */
const PANEL_TYPE_MAP = {
    blend:   { cls: CraftPanelBlend,   useMode: true },
    cook:    { cls: CraftPanelCook,    useMode: true },
    forge:   { cls: CraftPanelForge,   useMode: true },
    enchant: { cls: CraftPanelEnchant, useMode: true },
    handler: { cls: CraftPanelHandler, useMode: true },
    element: { cls: CraftPanelElement, useMode: false },
};

/**
 * 合成面板管理器。
 * 负责列出所有已创建的合成面板，并提供新建、打开、编辑、权限配置和删除等操作入口。
 * @extends HandlebarsApplication
 */
export class CraftPanelManager extends HandlebarsApplication {
    /**
     * 构造管理器实例并绑定按钮事件。
     */
    constructor() {
        super();
        craftPanels ??= [];
        craftPanels.push(this);

        this.options.actions.craft = this.craftButton.bind(this);
        this.options.actions.edit = this.editButton.bind(this);
        this.options.actions.permissions = this.permissionsButton.bind(this);
        this.options.actions.delete = this.deleteButton.bind(this);
        this.options.actions["create-new"] = this.createNewButton.bind(this);
    }

    /**
     * 默认窗口与表单配置。
     * @returns {object}
     */
    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID],
            tag: "div",
            window: {
                frame: true,
                positioned: true,
                title: `${MODULE_ID}.${this.APP_ID}.title`,
                icon: "fas fa-list",
                controls: [],
                minimizable: true,
                resizable: false,
                contentTag: "section",
                contentClasses: [],
            },
            actions: {},
            form: {
                handler: undefined,
                submitOnChange: false,
                closeOnSubmit: false,
            },
            position: {
                width: 600,
                height: "auto",
            },
        };
    }

    /**
     * 视图片段配置。
     * @returns {object}
     */
    static get PARTS() {
        return {
            content: {
                template: `modules/${MODULE_ID}/templates/${this.APP_ID}.hbs`,
                classes: [],
            },
        };
    }

    /**
     * 由类名推导应用 ID。
     * @returns {string}
     */
    static get APP_ID() {
        return this.name
            .split(/(?=[A-Z])/)
            .join("-")
            .toLowerCase();
    }

    /**
     * 当前实例的应用 ID。
     * @returns {string}
     */
    get APP_ID() {
        return this.constructor.APP_ID;
    }

    /**
     * 组装渲染上下文，获取所有已标记为合成面板的 JournalEntry。
     * @param {object} options 渲染选项
     * @returns {Promise<{craftPanels: JournalEntry[]}>}
     */
    async _prepareContext(options) {
        const craftPanels = game.journal.filter(j => j.getFlag(MODULE_ID, "isCraftPanel")).sort((a, b) => a.sort - b.sort);
        return { craftPanels };
    }

    /**
     * 渲染完成后的回调（当前为空实现，保留用于扩展）。
     * @param {object} context 渲染上下文
     * @param {object} options 渲染选项
     */
    _onRender(context, options) {
        super._onRender(context, options);
    }

    /**
     * 新建合成面板按钮的事件处理。
     * 弹出表单让用户输入名称并选择面板类型，然后创建对应的 JournalEntry。
     * @param {Event} event 点击事件
     */
    async createNewButton(event) {
        event.preventDefault();
        const data = await new FormBuilder()
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-craft-panel`))
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .select({ name: "panelType", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.select-type`), options: CraftPanelManager.PANEL_TYPE_OPTIONS })
            .render();
        if (!data) return;
        debug(data);

        let defaultData = {};
        const defaultDataMap = {
            blend: CraftPanelManager.DEFAULT_BLEND_DATA,
            cook: CraftPanelManager.DEFAULT_COOK_DATA,
            forge: CraftPanelManager.DEFAULT_FORGE_DATA,
            enchant: CraftPanelManager.DEFAULT_ENCHANT_DATA,
            handler: CraftPanelManager.DEFAULT_HANDLER_DATA,
        };
        if (data.panelType === "element") {
            defaultData = { ...CraftPanelManager.DEFAULT_ELEMENT_DATA };
            defaultData.defaultClass = data.name.trim();
            defaultData.showClass = data.name.trim();
            defaultData["requirements-script"] = `let element = item.getFlag(MODULE_ID, 'element'); return Array.isArray(element) && element.length > 0 && element.some(e => ['${data.name.trim()}'].includes(e.class));`;
        } else if (defaultDataMap[data.panelType]) {
            defaultData = defaultDataMap[data.panelType];
        }

        const flagdata = { [MODULE_ID]: { isCraftPanel: true, type: data.panelType, ...defaultData } };
        await JournalEntry.implementation.create({
            name: data.name,
            flags: flagdata
        });
        await this.render(true);
    }

    /**
     * 打开/关闭合成面板（使用模式）。
     * 根据面板类型查找对应类，如果已打开则关闭，否则新建并打开。
     * @param {Event} event 点击事件
     */
    async craftButton(event) {
        event.preventDefault();
        const uuid = event.srcElement.dataset.uuid;
        const panelJE = await fromUuid(uuid);
        const type = panelJE.getFlag(MODULE_ID, "type");
        const mapping = PANEL_TYPE_MAP[type];
        if (!mapping || !mapping.useMode) return;

        const openWindow = craftPanels?.find((w) => (w instanceof mapping.cls));
        if (openWindow) openWindow.close();
        else {
            new mapping.cls(panelJE, "craft").render(true);
            this.close();
        }
    }

    /**
     * 打开/关闭合成面板（编辑模式）。
     * 根据面板类型查找对应类，如果同一面板已打开则关闭，否则新建并打开。
     * @param {Event} event 点击事件
     */
    async editButton(event) {
        event.preventDefault();
        const uuid = event.srcElement.dataset.uuid;
        const panelJE = await fromUuid(uuid);
        const type = panelJE.getFlag(MODULE_ID, "type");
        const mapping = PANEL_TYPE_MAP[type];
        if (!mapping) return;

        const openWindow = craftPanels?.find((w) => (w instanceof mapping.cls) && (w.journalEntry.id === panelJE.id));
        if (openWindow) openWindow.close();
        else {
            if (mapping.useMode) {
                new mapping.cls(panelJE, "edit").render(true);
            } else {
                new mapping.cls(panelJE).render(true);
            }
            this.close();
        }
    }

    /**
     * 打开权限配置对话框。
     * @param {Event} event 点击事件
     */
    async permissionsButton(event) {
        event.preventDefault();
        const uuid = event.srcElement.dataset.uuid;
        const craftPanel = await fromUuid(uuid);
        new DocumentOwnershipConfig(craftPanel).render(true);
    }

    /**
     * 删除合成面板（弹出确认对话框后删除 JournalEntry）。
     * @param {Event} event 点击事件
     */
    async deleteButton(event) {
        event.preventDefault();
        const uuid = event.srcElement.dataset.uuid;
        const craftPanel = await fromUuid(uuid);
        await craftPanel.deleteDialog();
        await this.render(true);
    }

    /**
     * 面板关闭时从全局 craftPanels 数组中移除自身。
     * @param {object} options 关闭选项
     */
    _onClose(options) {
        super._onClose(options);
        craftPanels ??= [];
        craftPanels.splice(craftPanels.indexOf(this), 1);
    }

    /**
     * 可选的面板类型列表（用于新建面板时的下拉选项）。
     * @returns {Object<string, string>}
     */
    static get PANEL_TYPE_OPTIONS() {
        return {
            "element": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-element`),
            "blend": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-blend`),
            "forge": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-forge`),
            "cook": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-cook`),
            "enchant": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-enchant`),
            "handler": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-handler`),
        };
    }

    /** 合成面板的默认 flag 数据。 */
    static get DEFAULT_BLEND_DATA() {
        return {
            requirements: ["script"],
            "requirements-script": "let element = item.getFlag(MODULE_ID, 'element'); return Array.isArray(element) && element.length > 0;",
            "owner-check": "return game.user.isGM;",
            showResult: "question mark",
            unlockRecipe: true,
        };
    }

    /** 锻造面板的默认 flag 数据。 */
    static get DEFAULT_FORGE_DATA() {
        return {
            requirements: ["script"],
            "requirements-script": "let element = item.getFlag(MODULE_ID, 'element'); return Array.isArray(element) && element.length > 0;",
            "owner-check": "return game.user.isGM;",
            baseCost: 0,
            resultLimit: 1,
        };
    }

    /** 烹饪面板的默认 flag 数据。 */
    static get DEFAULT_COOK_DATA() {
        return {
            requirements: ["script"],
            "requirements-script": "let element = item.getFlag(MODULE_ID, 'element'); return Array.isArray(element) && element.length > 0;",
            "owner-check": "return game.user.isGM;",
            baseCost: 0,
        };
    }

    /** 附魔面板的默认 flag 数据。 */
    static get DEFAULT_ENCHANT_DATA() {
        return {
            requirements: ["script"],
            "requirements-script": "let element = item.getFlag(MODULE_ID, 'element'); return Array.isArray(element) && element.length > 0;",
            "owner-check": "return game.user.isGM;",
            baseCost: 0,
        };
    }

    /** 元素面板的默认 flag 数据。 */
    static get DEFAULT_ELEMENT_DATA() {
        return {
            noCraft: true,
            "requirements": ["folder", "script"],
            "requirements-folder": "材料",
        };
    }

    /** 处理面板的默认 flag 数据。 */
    static get DEFAULT_HANDLER_DATA() {
        return {
            "default-handler-icon": "icons/sundries/scrolls/scroll-bound-blue-red.webp",
            "handler-empty-text-actors": game.i18n.localize(`${MODULE_ID}.craft-panel-handler.empty-actors-default`),
            "handler-empty-text-handlers": game.i18n.localize(`${MODULE_ID}.craft-panel-handler.empty-handlers-default`),
            "handler-empty-text-templates": game.i18n.localize(`${MODULE_ID}.craft-panel-handler.empty-templates-default`),
            "actor-requirements": ["player-character"],
            "actor-requirements-player-character": true,
        };
    }
}
