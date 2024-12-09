import { HandlebarsApplication, MODULE_ID, debug } from "../utils.js";
import { CraftPanelBlend } from "./craftPanelBlend.js";
import { CraftPanelElement } from "./craftPanelElement.js";

export class CraftPanelManager extends HandlebarsApplication {
    constructor() {
        super();
        craftPanels ??= [];
        craftPanels.push(this);
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
                width: 560,
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
        const createNewButton = html.querySelector("button[name='create-new']");
        createNewButton.addEventListener("click", async () => {
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
            }
            const flagdata = { [MODULE_ID]: { isCraftPanel: true, type: data.panelType, ...defaultData } };
            debug("CraftPanelManager create-new : flagdata", flagdata);
            await JournalEntry.implementation.create({
                name: data.name,
                flags: flagdata
            })
            this.render(true);
        });
        // html.querySelector("button[name='config-element']").addEventListener("click", async () => {
        //     new CraftPanelElement().render(true);
        // });
        html.querySelectorAll("button[name='craft']").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                const uuid = event.currentTarget.dataset.uuid;
                const craftPanel = await fromUuid(uuid);
                debug("CraftPanelManager craft : uuid craftPanel", uuid, craftPanel);
                if (craftPanel.getFlag(MODULE_ID, "type") === "blend") {
                    const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelBlend));
                    if (openWindow) openWindow.close();
                    else {
                        let options = {
                            actor: canvas.tokens.controlled[0]?.actor ?? game.user.character,
                        }
                        new CraftPanelBlend(craftPanel, "craft", options).render(true);
                    }
                }
                // this.close();
            });
        });
        html.querySelectorAll("button[name='edit']").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                const uuid = event.currentTarget.dataset.uuid;
                const craftPanel = await fromUuid(uuid);
                debug("CraftPanelManager edit : uuid craftPanel", uuid, craftPanel);
                if (craftPanel.getFlag(MODULE_ID, "type") === "blend") {
                    const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelBlend));
                    if (openWindow) openWindow.close();
                    else new CraftPanelBlend(craftPanel, "edit").render(true);
                } else if (craftPanel.getFlag(MODULE_ID, "type") === "element") {
                    const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelElement));
                    if (openWindow) openWindow.close();
                    else new CraftPanelElement(craftPanel).render(true);
                }
                // this.close();
            });
        });

        html.querySelectorAll("button[name='permissions']").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                const uuid = event.currentTarget.dataset.uuid;
                const craftPanel = await fromUuid(uuid);
                debug("CraftPanelManager permissions : uuid craftPanel", uuid, craftPanel);
                new DocumentOwnershipConfig(craftPanel).render(true);
            });
        });

        html.querySelectorAll("button[name='delete']").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.preventDefault();
                const uuid = event.currentTarget.dataset.uuid;
                const craftPanel = await fromUuid(uuid);
                debug("CraftPanelManager delete : uuid craftPanel", uuid, craftPanel);
                await craftPanel.deleteDialog();
                this.render(true);
            });
        });
        debug("CraftPanelManager _onRender : html", html);
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
            // "forge": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.type-forge`),
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
    static get DEFAULT_ELEMENT_DATA() {
        return {
            noCraft: true,
            "requirements": ["folder", "script"],
            "requirements-folder": "材料",
        };
    }
}