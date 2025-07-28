import { HandlebarsApplication, MODULE_ID, debug } from "../utils.js";
import { CraftPanelBlend } from "./craftPanelBlend.js";
import { CraftPanelElement } from "./craftPanelElement.js";
import { CraftPanelForge } from "./craftPanelForge.js";
import { CraftPanelCook } from "./craftPanelCook.js";
import { CraftPanelEnchant } from "./craftPanelEnchant.js";

export class CraftPanelManager extends HandlebarsApplication {
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
            actions: {},
        };
    }

    static get PARTS() {
        return {
            content: {
                template: `modules/${MODULE_ID}/templates/${this.APP_ID}.hbs`,
                classes: ["scrollable"],
            },
        };
    }

    static get APP_ID() {
        return this.name
            .split(/(?=[A-Z])/)
            .join("-")
            .toLowerCase();
    }

    get APP_ID() {
        return this.constructor.APP_ID;
    }

    async _prepareContext(options) {
        const craftPanels = game.journal.filter(j => j.getFlag(MODULE_ID, "isCraftPanel")).sort((a, b) => a.sort - b.sort);
        debug("CraftPanelManager _prepareContext : craftPanels", craftPanels);
        return { craftPanels };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        debug("CraftPanelManager _onRender : context", context);
        const html = this.element;
        debug("CraftPanelManager _onRender : html", html);
    }

    async createNewButton(event) {
        event.preventDefault();
        const data = await new Portal.FormBuilder()
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-craft-panel`))
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .select({ name: "panelType", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.select-type`), options: CraftPanelManager.PANEL_TYPE_OPTIONS })
            .render();
        debug("CraftPanelManager create-new : data", data);
        if (!data) return;
        let defaultData = {};
        if (data.panelType === "blend") {
            defaultData = CraftPanelManager.DEFAULT_BLEND_DATA;
        } else if (data.panelType === "element") {
            defaultData = CraftPanelManager.DEFAULT_ELEMENT_DATA;
            defaultData.defaultClass = data.name.trim();
            defaultData.showClass = data.name.trim();
            defaultData["requirements-script"] = `let element = item.getFlag('craftpanel', 'element'); return Array.isArray(element) && element.length > 0 && element.some(e => ['${data.name.trim()}'].includes(e.class));`;
        } else if (data.panelType === "cook") {
            defaultData = CraftPanelManager.DEFAULT_COOK_DATA;
        } else if (data.panelType === "forge") {
            defaultData = CraftPanelManager.DEFAULT_FORGE_DATA;
        } else if (data.panelType === "enchant") {
            defaultData = CraftPanelManager.DEFAULT_ENCHANT_DATA;
        }
        const flagdata = { [MODULE_ID]: { isCraftPanel: true, type: data.panelType, ...defaultData } };
        debug("CraftPanelManager create-new : flagdata", flagdata);
        await JournalEntry.implementation.create({
            name: data.name,
            flags: flagdata
        })
        await this.render(true);
    }

    async craftButton(event) {
        event.preventDefault();
        const uuid = event.srcElement.dataset.uuid;
        const craftPanel = await fromUuid(uuid);
        let options = {
            actor: canvas.tokens.controlled[0]?.actor ?? game.user.character,
        }
        debug("CraftPanelManager craft : uuid craftPanel", uuid, craftPanel);
        if (craftPanel.getFlag(MODULE_ID, "type") === "blend") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelBlend) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else {
                new CraftPanelBlend(craftPanel, "craft", options).render(true);
            }
        } else if (craftPanel.getFlag(MODULE_ID, "type") === "cook") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelCook) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else {
                new CraftPanelCook(craftPanel, "craft", options).render(true);
            }
        } else if (craftPanel.getFlag(MODULE_ID, "type") === "forge") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelForge) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else {
                new CraftPanelForge(craftPanel, "craft", options).render(true);
            }
        } else if (craftPanel.getFlag(MODULE_ID, "type") === "enchant") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelEnchant) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else {
                new CraftPanelEnchant(craftPanel, "craft", options).render(true);
            }
        }
    }

    async editButton(event) {
        event.preventDefault();
        const uuid = event.srcElement.dataset.uuid;
        const craftPanel = await fromUuid(uuid);
        debug("CraftPanelManager edit : uuid craftPanel", uuid, craftPanel);
        if (craftPanel.getFlag(MODULE_ID, "type") === "blend") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelBlend) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else new CraftPanelBlend(craftPanel, "edit").render(true);
        } else if (craftPanel.getFlag(MODULE_ID, "type") === "element") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelElement) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else new CraftPanelElement(craftPanel).render(true);
        } else if (craftPanel.getFlag(MODULE_ID, "type") === "cook") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelCook) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else new CraftPanelCook(craftPanel, "edit").render(true);
        } else if (craftPanel.getFlag(MODULE_ID, "type") === "forge") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelForge) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else new CraftPanelForge(craftPanel, "edit").render(true);
        } else if (craftPanel.getFlag(MODULE_ID, "type") === "enchant") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelEnchant) && (w.journalEntry.id === craftPanel.id));
            if (openWindow) openWindow.close();
            else new CraftPanelEnchant(craftPanel, "edit").render(true);
        }
    }

    async permissionsButton(event) {
        event.preventDefault();
        const uuid = event.srcElement.dataset.uuid;
        const craftPanel = await fromUuid(uuid);
        debug("CraftPanelManager permissions : uuid craftPanel", uuid, craftPanel);
        new DocumentOwnershipConfig(craftPanel).render(true);
    }

    async deleteButton(event) {
        event.preventDefault();
        const uuid = event.srcElement.dataset.uuid;
        const craftPanel = await fromUuid(uuid);
        debug("CraftPanelManager delete : uuid craftPanel", uuid, craftPanel);
        await craftPanel.deleteDialog();
        await this.render(true);
    }

    _onClose(options) {
        super._onClose(options);
        craftPanels ??= [];
        craftPanels.splice(craftPanels.indexOf(this), 1);
    }

    static get PANEL_TYPE_OPTIONS() {
        return {
            "element": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-element`),
            "blend": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-blend`),
            "forge": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-forge`),
            "cook": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-cook`),
            "enchant": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-enchant`),
        };
    }
    static get DEFAULT_BLEND_DATA() {
        return {
            requirements: ["script"],
            "requirements-script": "let element = item.getFlag('craftpanel', 'element'); return Array.isArray(element) && element.length > 0;",
            showResult: "question mark",
            unlockRecipe: true,
        };
    }
    static get DEFAULT_FORGE_DATA() {
        return {
            requirements: ["script"],
            "requirements-script": "let element = item.getFlag('craftpanel', 'element'); return Array.isArray(element) && element.length > 0;",
            baseCost: 0,
            resultLimit: 1,
        };
    }
    static get DEFAULT_COOK_DATA() {
        return {
            requirements: ["script"],
            "requirements-script": "let element = item.getFlag('craftpanel', 'element'); return Array.isArray(element) && element.length > 0;",
            baseCost: 0,
        };
    }
    static get DEFAULT_ENCHANT_DATA() {
        return {
            requirements: ["script"],
            "requirements-script": "let element = item.getFlag('craftpanel', 'element'); return Array.isArray(element) && element.length > 0;",
            baseCost: 0,
        };
    }
    static get DEFAULT_ELEMENT_DATA() {
        return {
            noCraft: true,
            "requirements": ["folder", "script"],
            "requirements-folder": "材料",
        };
    }
}