import { HandlebarsApplication, getItemColor, MODULE_ID, getFolder, debug, chatMessage, buildActiveEffect, applyChange, multiShowOptions, multiValueOptions } from "../utils.js";
import { CraftPanelModifier } from "./craftPanelModifier.js";
import { chooseImage } from "../api.js";
import { FormBuilder } from "./formBuilder.js";

const DEFAULT_SLOT_DATA = {
    hue: 180,
    shape: "default",
    isNecessary: false,
    isConsumed: true,
    size: 80,
    position: { unlock: false, x: 0, y: 0 },
}
const DEFAULT_RESULT_DATA = {
    hue: 180,
    shape: "default",
    isNecessary: true,
    position: { unlock: false, x: 0, y: 0 },
}

const DEFAULT_MODIFIER_DATA = {
    isLocked: false,
    ingredients: [],
    unlockCondition: "",
    craftScript: "",
    category: [],
    asAE: false,
    cost: 1,
    auto: false,
}
const AsyncFunction = async function () { }.constructor;

export class CraftPanelEnchant extends HandlebarsApplication {
    constructor(journalEntry, mode = "edit", options = {}) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        this.journalEntry = journalEntry;
        this.mode = mode;
        this.actor = options.actor;
        this.panelOptions = options;

        /**@type {CraftElement[]} */
        this.elements = [];
        /**@type {CraftElementShow[]} */
        this.elementsShow = [];
        /**@type {CraftElement[]} */
        this.elementsAll = [];
        /**@type {CraftElementConfig[]} */
        this.elementConfigs = this.journalEntry.getFlag(MODULE_ID, "elementConfig") ?? [];
        this.slotItems = {};
        this.slotMaterials = [];
        this.results = [];
        this.resultItems = {};
        this.resultOverrides = {};
        this.slots = [];
        this.modifiers = [];
        this.materials = [];
        this.needRefresh = true;
        this.panelOptions = options;
        this.modifier_categories = [];
        this.material_categories = [];
        this.baseCost = journalEntry.getFlag(MODULE_ID, "baseCost") ?? 0;
        this.cost = {
            value: this.baseCost,
            max: this.baseCost,
            icon: journalEntry.getFlag(MODULE_ID, "costIcon") ?? "",
            element: journalEntry.getFlag(MODULE_ID, "costElement") ?? "",
        }
        this.modifierLimit = journalEntry.getFlag(MODULE_ID, "modifierLimit") ?? 0;
        /**@type {number[]} */
        this.choosedModifiers = [];
        /**@type {string[]} */
        this.choosedResults = [];

        this.quantityPath = game.settings.get(MODULE_ID, 'quantityPath');
        this.descriptionPath = game.settings.get(MODULE_ID, 'descriptionPath');

        this.scrollPositions = {
            materials: 0,
            modifiers: 0,
        };

        if (game.user.isGM) {
            this.options.actions.edit = this.toggleEdit.bind(this);
        } else {
            this.options.window.controls = [];
        }
        this.options.actions.craft = this.craft.bind(this);
        this.options.actions["configure-panel"] = this.configure.bind(this);
        this.options.actions["new-modifier"] = async (event) => {
            event.preventDefault();
            await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
                {
                    name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-modifier`),
                    src: "icons/magic/symbols/rune-sigil-green.webp",
                    "text.content": null,
                    flags: {
                        [MODULE_ID]: {
                            type: "modifier",
                            changes: [],
                            ...DEFAULT_MODIFIER_DATA,
                        },
                    },
                },
            ]);
            this.needRefresh = true;
            await this.render(true);
        };
        this.options.actions["new-slot"] = async (event) => {
            event.preventDefault();
            await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
                {
                    name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-slot`),
                    src: "icons/commodities/materials/bowl-powder-pink.webp",
                    "text.content": null,
                    flags: {
                        [MODULE_ID]: {
                            type: "slot",
                            ...DEFAULT_SLOT_DATA,
                        },
                    },
                },
            ]);
            await this.render(true);
        };
        this.options.actions["new-result"] = async (event) => {
            event.preventDefault();
            await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
                {
                    name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-result`),
                    src: "icons/magic/symbols/runes-etched-steel-blade.webp",
                    "text.content": null,
                    flags: {
                        [MODULE_ID]: {
                            type: "result",
                            images: [{ name: "icons/magic/symbols/runes-etched-steel-blade.webp", src: "icons/magic/symbols/runes-etched-steel-blade.webp" }],
                            size: Math.min(this.panelSizes.results.width, this.panelSizes.results.height) * 0.6,
                            ...DEFAULT_RESULT_DATA,
                        },
                    },
                },
            ]);
            this.needRefresh = true;
            await this.render(true);
        };

        this.panelSizes = this.journalEntry.getFlag(MODULE_ID, "panelSizes") ?? {
            modifiers: {
                width: 300,
                height: 470,
            },
            materials: {
                width: 300,
                height: 540,
            },
            slots: {
                width: 600,
                height: 200,
            },
            elements: {
                width: 600,
                height: 70,
            },
            results: {
                width: 600,
                height: 200,
            },
        };

        craftPanels ??= [];
        craftPanels.push(this);
        debug("CraftPanelEnchant constructor : this journalEntry mode options craftPanels", this, journalEntry, mode, options, craftPanels);
    }

    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID, "craft"],
            tag: "div",
            window: {
                frame: true,
                positioned: true,
                title: `${MODULE_ID}.${this.APP_ID}.title`,
                icon: "fa-solid fa-book-journal-whills",
                controls: [{
                    icon: "fas fa-edit",
                    action: "edit",
                    label: `${MODULE_ID}.edit-mode`,
                }],
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
                width: "auto",
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

    get title() {
        return this.journalEntry.name + (this.isEdit ? " - " + game.i18n.localize(`${MODULE_ID}.edit-mode`) : "");
    }

    get isEdit() {
        return this.mode === "edit";
    }

    /**
     * 准备界面所需的各项数据
     * @returns {}
     */
    async _prepareContext(options) {
        if (this.needRefresh) {
            await this.refreshPanel();
            await this.refreshElements();
            await this.refreshResults();
        }
        await this.refreshModifiers();
        const slotsJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "slot");
        debug("CraftPanelEnchant _prepareContext: slotsJE", slotsJE);
        const defaultShowType = this.journalEntry.getFlag(MODULE_ID, "defaultShowType") ?? "mod1";
        this.slots = await Promise.all(slotsJE.map(async (je, i) => {
            const overrideStyle = (je.getFlag(MODULE_ID, "shape") ?? "default") !== "default";
            const overrideStyleClass = je.getFlag(MODULE_ID, "shape") == "circle" ? "round" : "";
            let tooltip = await TextEditor.enrichHTML(`<figure><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div>`);
            let isLocked = je.getFlag(MODULE_ID, "isLocked") ?? false;
            if (isLocked && !this.isEdit) {
                const script = je.getFlag(MODULE_ID, "unlockCondition");
                if (script && script.trim() != "") {
                    const fn = new AsyncFunction("data", "panel", "actor", "elements", "materials", script);
                    let unlock = false;
                    try {
                        unlock = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.elements, Object.values(this.slotItems));
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                    if (unlock) {
                        isLocked = false;
                    }
                }
            }
            let isNecessary = je.getFlag(MODULE_ID, "isNecessary") ?? false;
            let isConsumed = je.getFlag(MODULE_ID, "isConsumed") ?? true;
            if (!this.isEdit) {
                const script = je.getFlag(MODULE_ID, "slotScript");
                if (script && script.trim() != "") {
                    const fn = new AsyncFunction("data", "panel", "actor", "elements", "materials", "slotItem", script);
                    let result;
                    try {
                        result = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.elements, Object.values(this.slotItems), this.slotItems[i]);
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                    if (result) {
                        isNecessary = result?.isNecessary ?? isNecessary;
                        isConsumed = result?.isConsumed ?? isConsumed;
                    }
                }
            }
            const position = je.getFlag(MODULE_ID, "position") ?? { unlock: false, x: 0, y: 0 };
            const showType = je.getFlag(MODULE_ID, "showType") ?? "default";
            const actualShowType = showType === "default" ? defaultShowType : showType;
            return {
                id: je.id,
                name: je.name,
                image: je.src,
                slotIndex: i,
                uuid: je.uuid,
                hue: je.flags[MODULE_ID].hue,
                size: je.flags[MODULE_ID].size,
                lockSize: je.flags[MODULE_ID].size * 0.6,
                overrideStyle,
                overrideStyleClass,
                tooltip,
                elements: [],
                isNecessary: isNecessary,
                isConsumed: isConsumed,
                isLocked,
                position,
                actualShowType,
            };
        }));
        if (this.isEdit) {
            this.slots.map(slot => {
                slot.empty = "empty";
                slot.draggable = slot.position.unlock;
            });
        } else {
            this.slots.map((slot, i) => {
                let r = this.slotItems[i];
                if (r !== null && r !== undefined) {
                    slot.image = r.img;
                    slot.name = r.name;
                    slot.elements = r.elements.filter(e => e.color != "");
                    slot.uuid = r.uuid;
                    slot.itemColor = r.itemColor;
                    slot.empty = "";
                    slot.draggable = true;
                    slot.tooltip = r.tooltip;
                } else {
                    slot.empty = "empty";
                    slot.draggable = false;
                }
            });
        }
        debug("CraftPanelEnchant _prepareContext: this.slots", this.slots);
        const results = await Promise.all(this.results.map(async (el, i) => {
            let data = { ...el };
            const showType = el.showType ?? "default";
            const actualShowType = showType === "default" ? defaultShowType : showType;
            data.actualShowType = actualShowType;
            if (this.isEdit) {
                data.empty = "empty";
                data.draggable = el.position.unlock;
                data.choosed = "";
            } else {
                data.img = this.resultOverrides[i]?.img ?? this.resultItems[i]?.img ?? el.img;
                data.description = this.resultOverrides[i]?.description ?? this.resultItems[i]?.description ?? el.description;
                data.name = this.resultOverrides[i]?.name ?? this.resultItems[i]?.name ?? el.name;
                let tooltip = await TextEditor.enrichHTML(`<figure><img src='${data.img}'><h2>${data.name}</h2></figure><div class="description">${data.description ?? ""}</div>`);
                let r = this.resultItems[i];
                if (r !== null && r !== undefined) {
                    data.uuid = r.uuid;
                    data.itemColor = r.itemColor;
                    data.empty = "";
                    data.draggable = true;
                    data.choosed = "choosed";
                } else {
                    data.empty = "empty";
                    data.draggable = false;
                    data.choosed = "";
                }
                data.tooltip = tooltip;
            }
            return data;
        }));
        debug("CraftPanelEnchant _prepareContext: results", results);
        let modifiers = this.modifiers;
        let modifier_category = this.modifier_categories.find(c => c.choosed)?.id;
        if (modifier_category != "all") {
            modifiers = modifiers.filter(m => m.category.includes(modifier_category));
        }
        debug("CraftPanelEnchant _prepareContext: modifiers", modifiers);
        const refreshScript = this.journalEntry.getFlag(MODULE_ID, "refresh-script");
        if (refreshScript && refreshScript.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "elements", "materials", refreshScript);
            let unlock = false;
            try {
                unlock = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.elements, Object.values(this.slotItems));
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
            if (unlock) {
                isLocked = false;
            }
        }
        return {
            isEdit: this.isEdit,
            slots: this.slots,  //中间显示的槽位
            modifiers: modifiers, //左侧显示的调整
            materials: this.materials, //右侧显示的材料
            useCircleStyle: true,
            elements: this.elements,
            results,
            modifier_categories: this.modifier_categories,
            material_categories: this.material_categories,
            cost: this.cost,
            panelSizes: this.panelSizes,
            background: `url('${this.journalEntry.getFlag(MODULE_ID, "background") ?? ""}')`,
        };
    }

    /**
     * 绑定各项元素的互动效果
     * @returns {}
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        debug("CraftPanelEnchant _prepareContext: context", context);
        // 恢复滚动条位置
        html.querySelector(".craft-materials-panel").scrollTop = this.scrollPositions.materials;
        html.querySelector(".craft-modifiers-panel").scrollTop = this.scrollPositions.modifiers;

        // 设置背景图像
        const windowContent = html.querySelector('.window-content');
        if (typeof context.background == "string" && windowContent.style.getPropertyValue("background-image") != context.background) {
            windowContent.style.setProperty("background-image", context.background);
        }

        // 绑定分类图标的点击事件
        html.querySelectorAll(".craft-category-icon").forEach(icon => {
            icon.addEventListener("click", this._onClickCategory.bind(this));
        });

        if (this.isEdit) {
            html.querySelectorAll(".craft-panel-tittle > i").forEach((icon) => {
                icon.addEventListener("click", this.changePanelSize.bind(this));
            });

            html.querySelector(".craft-results-panel").addEventListener("drop", this._onDropResultPanel.bind(this));
            html.querySelector(".craft-modifiers-panel").addEventListener("drop", this._onDropModifierPanel.bind(this));
            html.querySelector(".craft-cost-panel").addEventListener("drop", this._onDropCostPanel.bind(this));
            html.querySelector(".craft-elements-panel").addEventListener("drop", this._onDropElementPanel.bind(this));
            html.querySelectorAll(".craft-modifier").forEach((modifier) => {
                modifier.addEventListener("contextmenu", async (event) => {
                    // 编辑模式下，右键点击调整可以删除调整
                    event.preventDefault();
                    const pageUuid = modifier.dataset.uuid;
                    const page = await fromUuid(pageUuid);
                    await page.deleteDialog();
                    this.needRefresh = true;
                    await this.render(true);
                });
                modifier.addEventListener("click", async (event) => {
                    // 编辑模式下，点击调整可以编辑调整
                    event.preventDefault();
                    const modifierJEUuid = modifier.dataset.uuid;
                    await this.editModifier(modifierJEUuid);
                    await this.render(true);
                });
            });
            html.querySelectorAll(".craft-category-icon").forEach(icon => {
                icon.addEventListener("contextmenu", (event) => {
                    // 编辑模式下，右键点击分类可以编辑分类
                    event.preventDefault();
                    const category = event.currentTarget.dataset.category;
                    const type = event.currentTarget.dataset.type;
                    this.editCategory(category, type);
                });
            });
            html.querySelectorAll(".element-slot.elements").forEach((el) => {
                el.addEventListener("dragstart", async (event) => {
                    event.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({
                            type: "CraftElementConfig",
                            parent: this.journalEntry.uuid,
                            elementConfig: this.elementConfigs[el.dataset.index],
                            index: el.dataset.index,
                        }),
                    );
                });
                el.addEventListener("click", (event) => {
                    event.preventDefault();
                    this.editElementConfig(el.dataset.index);
                });
                el.addEventListener("drop", this._onDropElementPanel.bind(this));
            });
            html.querySelectorAll("input").forEach((input) => {
                input.addEventListener("change", async (event) => {
                    const value = event.target.value;
                    const name = event.target.name;
                    if (name === "cost") {
                        this.baseCost = Number(value);
                        await this.journalEntry.setFlag(MODULE_ID, "baseCost", this.baseCost);
                        await this.refreshCost();
                        await this.render(true);
                    }
                });
            });
        } else {
            // html.querySelector("button[name='craft']").addEventListener("click", async (event) => {
            //     event.preventDefault();
            //     await this.craft();
            // });
            html.querySelectorAll(".element-slot.materials").forEach((el) => {
                el.addEventListener("dragstart", (event) => {
                    event.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({
                            type: "Item",
                            uuid: el.dataset.uuid,
                        }),
                    );
                    game.tooltip.deactivate();
                });
                el.addEventListener("click", async (event) => {
                    event.preventDefault();
                    for (let i = 0; i < this.slots.length; i++) {
                        if (!this.slots[i].isLocked && (this.slotItems[i] === null || this.slotItems[i] === undefined)) {
                            const item = await fromUuid(el.dataset.uuid);
                            if (await this.checkAdd(i, item)) {
                                await this.addIngredient(i, item);
                                return;
                            }
                        }
                    }
                });
                el.addEventListener("contextmenu", async (event) => {
                    event.preventDefault();
                    // let index = Object.values(this.slotItems).findIndex(data => data?.uuid === el.dataset.uuid);
                    let index = -1;
                    for (let i = this.slots.length - 1; i >= 0; i--) {
                        if (this.slotItems[i]?.uuid === el.dataset.uuid) {
                            index = i;
                            break;
                        }
                    }
                    if (index >= 0) {
                        await this.removeIngredient(index);
                    } else {
                        const item = await fromUuid(el.dataset.uuid);
                        item.sheet.render(true);
                    }
                });
            });
            html.querySelectorAll(".craft-modifier").forEach((modifier) => {
                modifier.addEventListener("click", async (event) => {
                    // 制作模式下，点击调整可以选择调整
                    event.preventDefault();
                    const modifierJEUuid = modifier.dataset.uuid;
                    await this.chooseModifier(modifierJEUuid);
                    await this.render(true);
                });
            });
        }
        // html.querySelector("button[name='close']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     this.close();
        // });
        html.querySelectorAll(".craft-slot").forEach((slot) => {
            const isEmpty = slot.classList.contains("empty");
            const type = slot.dataset.type;
            if (type === "slot") {
                if (this.isEdit) {
                    // 编辑模式下，右键点击槽位可以删除槽位
                    slot.addEventListener("contextmenu", async (event) => {
                        event.preventDefault();
                        const pageUuid = slot.dataset.uuid;
                        const page = await fromUuid(pageUuid);
                        await page.deleteDialog();
                        await this.render(true);
                    });
                    // 编辑模式下，点击槽位可以编辑槽位
                    slot.addEventListener("click", async (event) => {
                        event.preventDefault();
                        const slotJEUuid = slot.dataset.uuid;
                        await this.editSlot(slotJEUuid);
                        await this.render(true);
                    });
                    // 编辑模式下，拖拽槽位可以移动槽位
                    slot.addEventListener("dragstart", (event) => {
                        event.dataTransfer.setData(
                            "text/plain",
                            JSON.stringify({
                                type: "CraftSlot",
                                index: slot.dataset.index,
                            }),
                        );
                        game.tooltip.deactivate();
                    });
                } else {
                    slot.addEventListener("drop", this._onDropSlot.bind(this));
                    slot.addEventListener("contextmenu", this._onClickSlot.bind(this));
                    slot.addEventListener("click", this._onClickSlot.bind(this));
                    if (!isEmpty) {
                        slot.addEventListener("dragstart", (event) => {
                            event.dataTransfer.setData(
                                "text/plain",
                                JSON.stringify({
                                    type: "Item",
                                    uuid: slot.dataset.uuid,
                                }),
                            );
                            game.tooltip.deactivate();
                        });
                    }
                }
            } else if (type === "result") {
                if (this.isEdit) {
                    // 编辑模式下，右键点击槽位可以删除槽位
                    slot.addEventListener("contextmenu", async (event) => {
                        event.preventDefault();
                        const pageUuid = slot.dataset.uuid;
                        const page = await fromUuid(pageUuid);
                        await page.deleteDialog();
                        await this.render(true);
                    });
                } else {
                    slot.addEventListener("drop", this._onDropResult.bind(this));
                    slot.addEventListener("contextmenu", async (event) => {
                        event.preventDefault();
                        const index = slot.dataset.index;
                        if (!isEmpty) {
                            await this.removeResultItem(index);
                        }
                    });
                }
                slot.addEventListener("click", this._onClickResult.bind(this));
            }
        });
        html.querySelector(".craft-slot-panel").addEventListener("drop", this._onDropSlotPanel.bind(this));
        //滚动事件，记录滚动位置
        html.querySelector(".craft-materials-panel").addEventListener("scrollend", (event) => { this.scrollPositions.materials = event.target.scrollTop; });
        html.querySelector(".craft-modifiers-panel").addEventListener("scrollend", (event) => { this.scrollPositions.modifiers = event.target.scrollTop; });
        debug("CraftPanelEnchant _onRender: html", html);
    }

    /**
     * 配置界面
     */
    async configure() {
        const showTypeOptions = {
            mod1: game.i18n.localize(`${MODULE_ID}.show-type.mod1`),
            mod2: game.i18n.localize(`${MODULE_ID}.show-type.mod2`),
            mod3: game.i18n.localize(`${MODULE_ID}.show-type.mod3`),
            mod4: game.i18n.localize(`${MODULE_ID}.show-type.mod4`),
        };
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(this.journalEntry)
            .title(game.i18n.localize(`${MODULE_ID}.configure`) + ": " + this.journalEntry.name)
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .number({ name: `flags.${MODULE_ID}.resultLimit`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.result-limit`), min: 0, max: Math.max(this.results.length, 1), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.result-limit-hint`), step: 1 })
            .select({ name: `flags.${MODULE_ID}.shape`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.default`), ...CraftPanelEnchant.SHAPE_STYLE } })
            .select({ name: `flags.${MODULE_ID}.defaultShowType`, label: game.i18n.localize(`${MODULE_ID}.show-type.default-show-type`), options: showTypeOptions })
            .file({ name: `flags.${MODULE_ID}.background`, type: "image", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.background-image`) })
            .number({ name: `flags.${MODULE_ID}.modifierLimit`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.modifier-limit`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.modifier-limit-hint`), min: 0, step: 1 })
            .tab({ id: "cost", icon: "fa-solid fa-coins", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-cost-tab`) })
            .number({ name: `flags.${MODULE_ID}.baseCost`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.base-cost`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.base-cost-hint`) })
            .file({ name: `flags.${MODULE_ID}.costIcon`, type: "image", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.cost-icon`) })
            .text({ name: `flags.${MODULE_ID}.costElement`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.cost-element`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.cost-element-hint`) })
            .script({ name: `flags.${MODULE_ID}.costScript`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.cost-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.cost-script-hint`) })
            .tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-requirements-tab`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements-hint`), options: { ...CraftPanelEnchant.REQUIREMENTS_TYPE_OPTIONS } })
            .text({ name: `flags.${MODULE_ID}.requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements-name-hint`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
            .script({ name: `flags.${MODULE_ID}.requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements-script-hint`) })
            .tab({ id: "scripts", icon: "fa-solid fa-code", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-scripts-tab`) })
            .script({ name: `flags.${MODULE_ID}.refresh-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.refresh-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.refresh-script-hint`) })
            .script({ name: `flags.${MODULE_ID}.craft-pre-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-pre-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-pre-script-hint`) })
            .script({ name: `flags.${MODULE_ID}.craft-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script-hint`) })
            .script({ name: `flags.${MODULE_ID}.craft-post-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-post-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-post-script-hint`) })

        const data = await fb.render();
        debug("CraftPanelEnchant configure: data", data);
        if (!data) return;
        await this.journalEntry.update(data);
        this.baseCost = this.journalEntry.getFlag(MODULE_ID, "baseCost") ?? 0;
        this.cost.icon = this.journalEntry.getFlag(MODULE_ID, "costIcon") ?? "";
        this.cost.element = this.journalEntry.getFlag(MODULE_ID, "costElement") ?? "";
        await this.render(true);
    }

    async changePanelSize(event) {
        const name = event.currentTarget.dataset.name;
        // Ensure the panelSizes entry exists
        this.panelSizes[name] = this.panelSizes[name] ?? {};

        // Default localization keys for pre-filling the name field
        const defaultTitleKeys = {
            modifiers: `${MODULE_ID}.modifier`,
            slots: `${MODULE_ID}.${this.APP_ID}.slot`,
            elements: `${MODULE_ID}.element`,
            results: `${MODULE_ID}.result`,
            materials: `${MODULE_ID}.material`,
        };
        const key = defaultTitleKeys[name] ?? `${MODULE_ID}.${name}`;

        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(this.panelSizes[name])
            .title(game.i18n.localize(`${MODULE_ID}.change-panel-size`))
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`), value: this.panelSizes[name].name ?? game.i18n.localize(key) })
            .number({ name: "width", label: game.i18n.localize(`${MODULE_ID}.width`), min: 0 })
            .number({ name: "height", label: game.i18n.localize(`${MODULE_ID}.height`), min: 0 });
        const data = await fb.render();
        if (!data) return;
        this.panelSizes[name] = data;
        await this.journalEntry.setFlag(MODULE_ID, "panelSizes", this.panelSizes);
        this.needRefresh = true;
        await this.render(true);
    }

    _onClose(options) {
        super._onClose(options);
        craftPanels ??= [];
        craftPanels.splice(craftPanels.indexOf(this), 1);
    }

    /**
     * 处理物品放置在槽位中的事件
     * @param {Event} event 
     */
    async _onDropSlot(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelEnchant _onDropSlot: data", data);
        if (data.type !== "Item") return;
        const index = parseInt(event.currentTarget.dataset.index);
        const item = await fromUuid(data.uuid);
        debug("CraftPanelEnchant _onDropSlot: index item", index, item);
        if (item) {
            await this.addIngredient(index, item);
        }
    }
    /**
     * 处理物品放置在槽位面板中的事件
     * @param {Event} event
     */
    async _onDropSlotPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelEnchant _onDropSlotPanel: data", data);
        if ((data.type == "CraftSlot") && this.isEdit) {
            const position = { unlock: true, x: event.offsetX, y: event.offsetY };
            const slotUuid = this.slots[data.index].uuid;
            const slot = await fromUuid(slotUuid);
            debug("CraftPanelEnchant _onDropSlotPanel: slot", slot);
            const size = slot.getFlag(MODULE_ID, "size");
            position.x -= size / 2;
            position.y -= size / 2;
            await slot.setFlag(MODULE_ID, "position", position);
            debug("CraftPanelEnchant _onDropSlotPanel: position", position);
            await this.render(true);
        } else if ((data.type == "Item") && !this.isEdit) {
            for (let i = 0; i < this.slots.length; i++) {
                if (!this.slots[i].isLocked && (this.slotItems[i] === null || this.slotItems[i] === undefined)) {
                    debug("CraftPanelEnchant _onDropSlotPanel : i this.slots[i] this.slotItems[i]", i, this.slots[i], this.slotItems[i]);
                    const item = await fromUuid(data.uuid);
                    debug("CraftPanelEnchant _onDropSlotPanel : item", item);
                    await this.addIngredient(i, item);
                }
            }
        }
    }
    /**
     * 处理物品放置在结果槽位中的事件
     * @param {Event} event 
     */
    async _onDropResult(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelEnchant _onDropResult: data", data);
        if (data.type !== "Item") return;
        const index = parseInt(event.currentTarget.dataset.index);
        const item = await fromUuid(data.uuid);
        debug("CraftPanelEnchant _onDropResult: index item", index, item);
        if (item) {
            await this.addResultItem(index, item);
        }
    }
    async _onDropResultPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelEnchant _onDropResultPanel: data", data);
        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        debug("CraftPanelEnchant _onDropResultPanel: type item", type, item);
        if (type !== "Item" || !item) return;
        if (this.isEdit) {
            await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [{
                name: item.name,
                src: item.img,
                "text.content": foundry.utils.getProperty(item, this.descriptionPath) ?? item?.system?.description ?? item?.description ?? null,
                flags: {
                    [MODULE_ID]: {
                        type: "result",
                        images: [{ name: item.img, src: item.img }],
                        size: Math.min(this.panelSizes.results.width, this.panelSizes.results.height) * 0.6,
                        ...DEFAULT_RESULT_DATA,
                    },
                },
            },]);
            this.needRefresh = true;
            await this.render(true);
        } else {
            debug("CraftPanelEnchant _onDropResultPanel: this.results", this.results);
            for (let i = 0; i < this.results.length; i++) {
                if (this.resultItems[i] === null || this.resultItems[i] === undefined) {
                    const item = await fromUuid(data.uuid);
                    await this.addResultItem(i, item);
                }
            }
        }
    }
    async _onDropModifierPanel(event) {
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelEnchant _onDropModifierPanel: data", data);
        if (data.type !== "Item" && data.type !== "ActiveEffect") return;
        const item = await fromUuid(data.uuid);
        debug("CraftPanelEnchant _onDropModifierPanel: item", item);
        let changes = [];
        if (data.type === "ActiveEffect") {
            changes = JSON.parse(JSON.stringify(item.changes));
        } else if (data.type === "Item") {
            item.effects.forEach(effect => {
                changes.push(...effect.changes);
            });
        }
        debug("CraftPanelEnchant _onDropModifierPanel: changes", changes);
        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: item.name,
                src: item.img,
                "text.content": foundry.utils.getProperty(item, this.descriptionPath) ?? item.system?.description ?? item.description ?? "",
                flags: {
                    [MODULE_ID]: {
                        type: "modifier",
                        changes: changes,
                        ...this.createModifierData(),
                    },
                },
            },
        ]);
        this.needRefresh = true;
        await this.render(true);
    }
    async _onDropCostPanel(event) {
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelEnchant _onDropCostPanel: data", data);
        if (data.type !== "Item" && data.type !== "CraftElement") return;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        debug("CraftPanelEnchant _onDropCostPanel: item", item);
        let element = data?.element;
        debug("CraftPanelEnchant _onDropCostPanel: element", element);
        if (type == "Item") {
            if (item == undefined) return;
            if (item.getFlag(MODULE_ID, "isElement") === true) {
                element = item.getFlag(MODULE_ID, "elementConfig");
                this.cost.element = element.id;
                this.cost.icon = element.img;
                await this.journalEntry.setFlag(MODULE_ID, "costElement", element.id);
                await this.journalEntry.setFlag(MODULE_ID, "costIcon", element.img);
            } else {
                this.cost.icon = item.img;
                await this.journalEntry.setFlag(MODULE_ID, "costIcon", item.img);
            }
        } else if (type == "CraftElement") {
            if (item != undefined && element == undefined) {
                element = item.getFlag(MODULE_ID, "elementConfig");
            }
            if (element == undefined) return;
            this.cost.element = element.id;
            this.cost.icon = element.img;
            await this.journalEntry.setFlag(MODULE_ID, "costElement", element.id);
            await this.journalEntry.setFlag(MODULE_ID, "costIcon", element.img);
        }
        debug("CraftPanelEnchant _onDropCostPanel: this.cost", this.cost);
        await this.render(true);
    }
    /**
     * 处理物品或元素放置在元素面板中的事件
     * @param {Event} event 
     */
    async _onDropElementPanel(event) {
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelBlend _onDropElementPanel : data", data);
        if (data.type !== "Item" && data.type !== "CraftElement" && data.type !== "CraftElementConfig") return;
        const targetIndex = event.currentTarget.dataset.index;
        if (data.type === "CraftElementConfig") {
            /**
             * 如果来源为相同的界面，则调整位置。
             * 如果来源为不同的界面，则新增元素配置。
             */
            if (data.parent === this.journalEntry.uuid) {
                const sourceIndex = data.index;
                /**
                 * 如果没有目标索引，说明是拖拽到空白区域，则放到最后。
                 * 如果目标索引小于来源索引，说明是向前移动，则插入到目标索引位置。
                 * 如果目标索引大于来源索引，说明是向后移动，则插入到目标索引+1位置。
                 */
                if (targetIndex === undefined && (sourceIndex < this.elementConfigs.length - 1)) {
                    const elementConfig = this.elementConfigs.splice(sourceIndex, 1)[0];
                    this.elementConfigs.push(elementConfig);
                } else if (targetIndex < sourceIndex) {
                    const elementConfig = this.elementConfigs.splice(sourceIndex, 1)[0];
                    this.elementConfigs.splice(targetIndex, 0, elementConfig);
                } else if (targetIndex > sourceIndex) {
                    const elementConfig = this.elementConfigs.splice(sourceIndex, 1)[0];
                    this.elementConfigs.splice(targetIndex + 1, 0, elementConfig);
                }
            } else {
                this.elementConfigs.push(JSON.parse(JSON.stringify(data.elementConfig)));
            }
            debug("CraftPanelBlend _onDropElementPanel : this.elementConfigs", this.elementConfigs);
            //保存当前的元素配置。
            this.journalEntry.setFlag(MODULE_ID, "elementConfig", this.elementConfigs);
        } else {
            const item = await fromUuid(data.uuid);
            if (item) {
                const element = item.getFlag(MODULE_ID, "elementConfig");
                if (element) {
                    /**@type {CraftElementConfig} */
                    const elementConfig = {
                        ids: [element.id],
                        name: element.name,
                        img: element.img,
                        color: element.color,
                        size: 60,
                        shape: "circle",
                        multiShow: "max",
                        multiValue: "only-max",
                        plusElements: "",
                        minusElements: "",
                        visible: true,
                        value: 1,
                        useMin: false,
                        min: 0,
                        useMax: false,
                        max: 0,
                    }
                    /**
                     * 如果存在同id的元素配置，则覆盖配置。
                     * 如果不存在，则新增元素配置。
                     */
                    const index = this.elementConfigs.findIndex(elc => elc.ids.includes(element.id));
                    if (index >= 0) {
                        elementConfig.ids = [...this.elementConfigs[index].ids];
                        this.elementConfigs[index] = elementConfig;
                    } else {
                        this.elementConfigs.push(elementConfig);
                    }
                    debug("CraftPanelBlend _onDropElementPanel : elementConfig this.elementConfigs", elementConfig, this.elementConfigs);
                    //保存当前的元素配置。
                    this.journalEntry.setFlag(MODULE_ID, "elementConfig", this.elementConfigs);
                }
            }
        }
        this.needRefresh = true;
        await this.render(true);
    }
    async _onClickResult(event) {
        event.preventDefault();
        const index = event.currentTarget.dataset.index;
        const uuid = event.currentTarget.dataset.uuid;
        const isEmpty = event.currentTarget.classList.contains("empty");
        if (this.isEdit) {
            await this.editResult(uuid);
        } else if (!isEmpty) {
            let result = this.resultOverrides[index];
            if (result == undefined) {
                result = {
                    name: this.resultItems[index]?.name ?? this.results[index]?.name ?? "",
                    img: this.resultItems[index]?.img ?? this.results[index]?.img ?? "",
                    description: this.resultItems[index]?.description ?? this.results[index]?.description ?? "",
                    images: this.results[index].images ?? [{ name: this.resultItems[index]?.img ?? "", src: this.resultItems[index]?.img ?? "" }, { name: this.results[index]?.img ?? "", src: this.results[index]?.img ?? "" }],
                }
            }
            //const fb = new Portal.FormBuilder()
            const fb = new FormBuilder()
                .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-result`))
                .object(result)
                .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
                .editor({ name: `description`, label: game.i18n.localize(`${MODULE_ID}.description`) })
                .button({
                    label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-image`),
                    callback: async () => {
                        //制作模式下，左键点击结果可以选择图片
                        let images = await chooseImage(result.images, this.mode, { choosed: result.img, max: 1 });
                        if (images) {
                            result.img = images[0].src;
                        }
                    },
                    icon: "fas fa-edit",
                })

            const data = await fb.render();
            debug("CraftPanelEnchant _onClickResult: data", data);
            if (!data) return;
            result.name = data.name;
            result.description = data.description;
            this.resultOverrides[index] = result;
            debug("CraftPanelEnchant _onClickResult: this.results this.resultOverrides", this.results, this.resultOverrides);
            await this.render(true);
        }
    }
    /**
     * 处理单击槽位中的物品事件
     * @param {Event} event 
     */
    async _onClickSlot(event) {
        event.preventDefault();
        const index = parseInt(event.currentTarget.dataset.index);
        const isEmpty = event.currentTarget.classList.contains("empty");
        debug("CraftPanelEnchant _onClickSlot: index isEmpty", index, isEmpty);
        if (isEmpty) {
            return;
        } else {
            await this.removeIngredient(index);
        }
    }
    async _onClickCategory(event) {
        const category = event.currentTarget.dataset.category;
        const type = event.currentTarget.dataset.type;
        debug("CraftPanelEnchant _onClickCategory: category type", category, type);
        //如果是编辑模式，点击分类可以编辑分类
        if (this.isEdit && category === "add") {
            await this.addCategory(type);
        } else {
            await this.changeCategory(category, type);
        }
    }
    //移除槽位中的物品
    async removeIngredient(index) {
        let material = this.materials.find(m => m.uuid == this.slotItems[index]?.uuid);
        if (material) {
            material.quantity++;
        }
        this.slotItems[index] = null;
        debug("CraftPanelEnchant removeIngredient: this.slotItems this.materials", this.slotItems, this.materials);
        //将材料整理成类似元素的格式
        this.refreshSlotMaterials();
        await this.refreshElements();
        await this.render(true);
    }
    //添加物品到槽位中
    async addIngredient(index, item) {
        if (await this.checkAdd(index, item)) {
            const elements = item.getFlag(MODULE_ID, "element") ?? [];
            const tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h2>${item.name}</h2></figure><div class="description">${foundry.utils.getProperty(item, this.descriptionPath) ?? item?.system?.description ?? item?.description ?? ""}</div><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
            const data = {
                uuid: item.uuid,
                name: item.name,
                img: item.img,
                elements: elements,
                itemColor: item ? getItemColor(item) ?? "" : "",
                tooltip: tooltip
            }
            this.slotItems[index] = data;
            let material = this.materials.find(m => m.uuid == item.uuid);
            if (material) {
                material.quantity--;
            }
            debug("CraftPanelEnchant addIngredient: this.slotItems this.materials", this.slotItems, this.materials);
            //将材料整理成类似元素的格式
            this.refreshSlotMaterials();
            await this.refreshElements();
            await this.render(true);
        }
    }
    //移除结果槽位中的物品
    async removeResultItem(index) {
        let material = this.materials.find(m => m.uuid == this.resultItems[index]?.uuid);
        if (material) {
            material.quantity++;
        }
        debug("CraftPanelEnchant removeResultItem: this.resultItems this.materials", this.resultItems, this.materials);
        this.resultItems[index] = null;
        this.choosedResults.splice(this.choosedResults.indexOf(this.results[index].id), 1);
        await this.refreshCost();
        await this.render(true);
    }
    //添加物品到结果槽位中
    async addResultItem(index, item) {
        if (await this.checkAdd(index, item, "result")) {
            const data = {
                uuid: item.uuid,
                name: item.name,
                img: item.img,
                // elements: item.getFlag(MODULE_ID, "element") ?? [],
                description: foundry.utils.getProperty(item, this.descriptionPath) ?? item.system?.description ?? item.description ?? "",
                itemColor: item ? getItemColor(item) ?? "" : "",
                enchantments: item.getFlag(MODULE_ID, "enchantments") ?? [],
            }
            this.resultItems[index] = data;
            let material = this.materials.find(m => m.uuid == item.uuid);
            if (material) {
                material.quantity--;
            }
            this.choosedResults.push(this.results[index].id);
            debug("CraftPanelEnchant addResultItem: this.resultItems this.materials", this.resultItems, this.materials);
            await this.refreshCost();
            await this.render(true);
        }
    }
    //将材料整理成类似元素的格式
    refreshSlotMaterials() {
        Object.values(this.slotItems).forEach(data => {
            if (data) {
                if (this.slotMaterials.some(el => el.name == data.name)) {
                    this.slotMaterials.find(el => el.name == data.name).num++;
                } else {
                    this.slotMaterials.push({
                        num: 1,
                        id: data.name,
                    });
                }
            }
        });
        debug("CraftPanelEnchant refreshSlotMaterials: this.slotMaterials", this.slotMaterials);
    }
    /**
     * 刷新元素和结果
     */
    async refreshElements() {
        /**@type {CraftElement[]} */
        this.elements = [];
        this.elementsAll = [];
        this.elementsShow = [];
        /**@type {CraftElementConfig[]} */
        let elementConfigs = this.elementConfigs;
        Object.entries(this.slotItems).forEach(([index, data]) => {
            if (data) {
                let elements = data.elements;
                for (let el of elements) {
                    let element = this.elementsAll.find(e => e.id == el.id);
                    if (element) {
                        element.num += el.num;
                    } else {
                        this.elementsAll.push(JSON.parse(JSON.stringify(el)));
                    }
                }
            }
        });
        if (elementConfigs.length > 0) {
            elementConfigs.forEach((elc) => {
                const ids = elc.ids.map(id => id.trim()).filter(id => id != "");
                const elements = this.elementsAll.filter(el => ids.includes(el.id));
                const plusElements = this.elementsAll.filter(el => elc.plusElements.replaceAll(/，/g, ",").split(",").includes(el.id));
                const minusElements = this.elementsAll.filter(el => elc.minusElements.replaceAll(/，/g, ",").split(",").includes(el.id));
                const mod = plusElements.map(el => el.num).reduce((prev, current) => prev + current, 0) - minusElements.map(el => el.num).reduce((prev, current) => prev + current, 0);
                const visible = elc.visible == true || elc.visible == "true";
                /**@type {CraftElement} */
                let elementShow = {};
                if (elements.length > 0) {
                    /**@type {CraftElement} */
                    let element = {};
                    if (elements.length == 1) {
                        element = JSON.parse(JSON.stringify(elements[0]));
                        elementShow = JSON.parse(JSON.stringify(elements[0]));
                        elementShow.shapeClass = elc.shape == "square" ? "" : "round";
                        elementShow.size = elc.size;
                    } else {
                        let maxElement = elements.reduce((prev, current) => (prev.num > current.num) ? prev : current);
                        let minElement = elements.reduce((prev, current) => (prev.num < current.num) ? prev : current);
                        if (elc.multiShow == "max") {
                            elementShow = JSON.parse(JSON.stringify(maxElement));
                        } else if (elc.multiShow == "min") {
                            elementShow = JSON.parse(JSON.stringify(minElement));
                        } else {
                            elementShow.id = ids[0];
                            elementShow.img = elc.img;
                            elementShow.name = elc.name;
                            elementShow.color = elc.color;
                        }
                        if (elc.multiValue == "only-max") {
                            element = JSON.parse(JSON.stringify(maxElement));
                        } else if (elc.multiValue == "only-min") {
                            element = JSON.parse(JSON.stringify(minElement));
                        } else if (elc.multiValue == "max-plus") {
                            element = JSON.parse(JSON.stringify(maxElement));
                            let value = elements.filter(el => el.id != element.id).map(el => el.num).reduce((prev, current) => prev + current, 0);
                            element.num = element.num + value;
                        } else if (elc.multiValue == "max-minus") {
                            element = JSON.parse(JSON.stringify(maxElement));
                            let value = elements.filter(el => el.id != element.id).map(el => el.num).reduce((prev, current) => prev + current, 0);
                            element.num = element.num - value;
                        } else if (elc.multiValue == "min-plus") {
                            element = JSON.parse(JSON.stringify(minElement));
                            let value = elements.filter(el => el.id != element.id).map(el => el.num).reduce((prev, current) => prev + current, 0);
                            element.num = element.num + value;
                        } else if (elc.multiValue == "min-minus") {
                            element = JSON.parse(JSON.stringify(minElement));
                            let value = elements.filter(el => el.id != element.id).map(el => el.num).reduce((prev, current) => prev + current, 0);
                            element.num = element.num - value;
                        }
                    }
                    if (elc.multiValue == "all") {
                        /**@type {CraftElement[]} */
                        let els = elements.map(el => JSON.parse(JSON.stringify(el)));
                        els.forEach(el => {
                            if (el.num > 0) el.num += mod;
                            if ((elc.useMax ?? false) && (el.num > elc.max)) {
                                el.num = elc.max;
                            } else if ((elc.useMin ?? false) && (el.num < elc.min)) {
                                el.num = elc.min;
                            }
                        });
                        let value = els.map(el => el.num).reduce((prev, current) => prev + current, 0);
                        elementShow.num = value; //显示数量
                        if (visible || (elementShow.num > 0 && elc.visible == "visibleWhenUp0") || (elementShow.num < 0 && elc.visible == "visibleWhenDown0")) {
                            elementShow.shapeClass = elc.shape == "square" ? "" : "round";
                            elementShow.size = elc.size;
                            this.elementsShow.push(elementShow);
                        }
                        this.elements.push(...els);
                    } else {
                        if (element.num > 0) element.num += mod;
                        if ((elc.useMax ?? false) && (element.num > elc.max)) {
                            element.num = elc.max;
                        } else if ((elc.useMin ?? false) && (element.num < elc.min)) {
                            element.num = elc.min;
                        }
                        elementShow.num = element.num; //显示数量
                        if (visible || (elementShow.num > 0 && elc.visible == "visibleWhenUp0") || (elementShow.num < 0 && elc.visible == "visibleWhenDown0")) {
                            elementShow.shapeClass = elc.shape == "square" ? "" : "round";
                            elementShow.size = elc.size;
                            this.elementsShow.push(elementShow);
                        }
                        this.elements.push(element);
                    }
                } else if (this.isEdit || visible) {
                    elementShow.id = ids[0];
                    elementShow.img = elc.img;
                    elementShow.name = elc.name;
                    elementShow.num = 0;
                    elementShow.color = elc.color;
                    elementShow.shapeClass = elc.shape == "square" ? "" : "round";
                    elementShow.size = elc.size;
                    this.elementsShow.push(elementShow);
                }
            });
        } else {
            this.elements = this.elementsAll;
            this.elementsShow = this.elementsAll.map((e) => {
                return {
                    shapeClass: "round",
                    ...e,
                }
            });
            //按元素数量排序
            this.elements.sort((a, b) => b.num - a.num);
            this.elementsShow.sort((a, b) => b.num - a.num);
        }
        this.elementsShow.map((el, i) => el.index = i);
        //按元素数量排序
        this.elements.sort((a, b) => b.num - a.num);
        debug("CraftPanelEnchant refreshElements: this.elements", this.elements);
        await this.refreshCost();
    }
    //刷新材料面板
    async refreshPanel() {
        //记录之前选中的分类
        let material_category = this.material_categories.find(c => c.choosed)?.id;
        //刷新分类
        this.material_categories = JSON.parse(JSON.stringify(this.journalEntry.getFlag(MODULE_ID, "material-categories") ?? []));
        this.material_categories.unshift({
            id: "all",
            name: `${game.i18n.localize(MODULE_ID + ".all")}`,
            icon: "modules/craftpanel/img/svgs/stack.svg",
            choosed: true,
        });
        if (this.isEdit) {
            //在编辑模式下，将新增按钮添加到最后
            this.material_categories.push({
                id: "add",
                name: `${game.i18n.localize(MODULE_ID + "." + this.APP_ID + ".new-category")}`,
                icon: "modules/craftpanel/img/svgs/health-normal.svg",
                choosed: false,
            });
        }
        debug("CraftPanelEnchant refreshPanel: this.material_categories", this.material_categories);
        //恢复之前选中的分类
        if (material_category && this.material_categories.find(c => c.id == material_category)) {
            this.material_categories.map(c => c.choosed = false);
            this.material_categories.find(c => c.id == material_category).choosed = true;
        }
        //记录当前选中的分类
        material_category = this.material_categories.find(c => c.choosed)?.id;
        debug("CraftPanelEnchant refreshPanel: material_category", material_category);
        //刷新材料
        let materials_items = [];
        const requirements = {};
        this.journalEntry.getFlag(MODULE_ID, "requirements").forEach(key => {
            if (key == "script") {
                const script = this.journalEntry.getFlag(MODULE_ID, "requirements-script");
                if (script && script.trim() != "") {
                    const fn = new AsyncFunction("item", script);
                    requirements.script = fn;
                }
            } else {
                requirements[key] = this.journalEntry.getFlag(MODULE_ID, `requirements-${key}`);
            }
        });
        debug("CraftPanelEnchant refreshPanel: requirements", requirements);
        const categoryRequirements = {};
        if (material_category != "all") {
            this.material_categories.find(c => c.id == material_category)?.requirements?.forEach(key => {
                if (key == "script") {
                    const script = this.material_categories.find(c => c.id == material_category)?.["requirements-script"];
                    if (script && script.trim() != "") {
                        const fn = new AsyncFunction("item", script);
                        categoryRequirements.script = fn;
                    }
                } else {
                    categoryRequirements[key] = this.material_categories.find(c => c.id == material_category)?.["requirements-" + key];
                }
            });
        }
        if (this.actor) {
            // materials = await Promise.all(this.actor.items.filter(async i => { return await checkItemRequirements(i, requirements) }));
            materials_items = this.actor.items.contents;
        } else {
            // materials = await Promise.all(game.items.filter(async i => { return await checkItemRequirements(i, requirements) }));
            materials_items = game.items.contents;
        }
        debug("CraftPanelEnchant refreshPanel: materials_items", materials_items);
        this.materials = [];
        for (let i = 0; i < materials_items.length; i++) {
            const item = materials_items[i];
            if (await checkItemRequirements(item, requirements) && (material_category == "all" || await checkItemRequirements(item, categoryRequirements))) {
                const elements = item.getFlag(MODULE_ID, "element") ?? [];
                const itemColor = item ? getItemColor(item) ?? "" : "";
                const tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h2>${item.name}</h2></figure><div class="description">${foundry.utils.getProperty(item, this.descriptionPath) ?? item?.system?.description ?? item?.description ?? ""}</div><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
                let quantity = this.countQuantity(item);
                const showQuantity = (this.actor ?? false) && (typeof quantity === "number");
                let totalElements = 0;
                // 根据elementConfigs中的value配置来计算总元素数量
                if (this.elementConfigs.length > 0) {
                    this.elementConfigs.forEach((elc) => {
                        const ids = elc.ids.map(id => id.trim()).filter(id => id != "");
                        const els = elements.filter(el => ids.includes(el.id));
                        if (els.length > 0) {
                            totalElements += els.map(el => (el.num * elc.value)).reduce((prev, current) => prev + current, 0);
                        }
                    });
                } else {
                    // 计算总元素数量，有颜色的元素数量之和，如果没有颜色的元素，则计算所有元素数量之和
                    if (elements.filter(e => e.color != "").length > 0) {
                        totalElements = elements.filter(e => e.color != "").reduce((a, b) => a + b.num, 0);
                    } else {
                        totalElements = elements.reduce((a, b) => a + b.num, 0);
                    }
                }
                this.materials.push({
                    // slotIndex: i,
                    item: item,
                    uuid: item.uuid,
                    elements: elements.filter(e => e.color != ""),
                    itemColor: itemColor,
                    tooltip,
                    showQuantity,
                    quantity,
                    totalElements,
                    showElements: Array.isArray(elements) && elements.filter(el => el.color != "").length > 0,
                });
            }
        }
        this.materials.sort((a, b) => { return b.totalElements - a.totalElements });
        debug("CraftPanelEnchant refreshPanel: this.materials", this.materials);
        //仅在特定情况下刷新调整
        this.modifiersJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "modifier").sort((a, b) => (a.sort - b.sort));
        this.needRefresh = false;
    }
    //刷新调整面板
    async refreshModifiers() {
        //记录之前选中的分类
        let modifier_category = this.modifier_categories.find(c => c.choosed)?.id;
        //刷新分类
        this.modifier_categories = JSON.parse(JSON.stringify(this.journalEntry.getFlag(MODULE_ID, "modifier-categories") ?? []));
        this.modifier_categories.unshift({
            id: "all",
            name: MODULE_ID + ".all",
            icon: "modules/craftpanel/img/svgs/stack.svg",
            choosed: true,
        });
        if (this.isEdit) {
            //在编辑模式下，将新增按钮添加到最后
            this.modifier_categories.push({
                id: "add",
                name: `${MODULE_ID}.${this.APP_ID}.new-category`,
                icon: "modules/craftpanel/img/svgs/health-normal.svg",
                choosed: false,
            });
        }
        debug("CraftPanelEnchant refreshModifiers: this.modifier_categories", this.modifier_categories);
        //恢复之前选中的分类
        if (modifier_category && this.modifier_categories.find(c => c.id == modifier_category)) {
            this.modifier_categories.map(c => c.choosed = false);
            this.modifier_categories.find(c => c.id == modifier_category).choosed = true;
        }
        //记录当前选中的分类
        modifier_category = this.modifier_categories.find(c => c.choosed)?.id;
        debug("CraftPanelEnchant refreshModifiers: modifier_category", modifier_category);
        //记录附魔对象已经选取过的调整
        let enchantments = [];
        for (let item of Object.values(this.resultItems)) {
            if (!item) continue;
            for (let enchantment of item?.enchantments) {
                if (enchantments.find(e => e.uuid === enchantment.uuid) === undefined) {
                    enchantments.push(enchantment);
                }
            }
        }
        debug("CraftPanelEnchant refreshModifiers: enchantments", enchantments);
        //刷新调整
        this.cost.value = this.cost.max;
        this.modifiers = await Promise.all(this.modifiersJE.map(async (je, i) => {
            const ingredients = (je.getFlag(MODULE_ID, "ingredients") ?? []).map((el) => {
                let num = el.min;
                if (el.useMin && el.useMax) {
                    num = `${el.min}/${el.max}`;
                } else if (el.useMax) {
                    num = `≤${el.max}`;
                }
                return {
                    num: num,
                    ...el,
                };
            });
            let skipCheck = false;
            let locked = je.getFlag(MODULE_ID, "isLocked") ? "locked" : "";
            let auto = je.getFlag(MODULE_ID, "auto") ?? false;
            let hasEnchanted = false;
            let enchant = enchantments.find(m => m.uuid == je.uuid);
            if (enchant) {
                hasEnchanted = true;
            } else {
                const unlockCondition = je.getFlag(MODULE_ID, "unlockCondition");
                if (unlockCondition && unlockCondition.trim() != "") {
                    const fn = new AsyncFunction("actor", "game", "modifier", "panel", unlockCondition);
                    let result = undefined;
                    try {
                        result = await fn(this.actor ?? game?.user?.character, game, je, this.journalEntry);
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                    if (result === false || result == 'false') {
                        locked = "locked";
                    } else if (result === true || result == 'true') {
                        locked = "";
                        skipCheck = true;
                    } else if (result == 'unlock') {
                        locked = "";
                    }
                }
                //检查是否满足条件，不满足则锁定
                if (!(skipCheck || locked)) {
                    let elements = ingredients.filter(el => el.type == "element");
                    let materials = ingredients.filter(el => el.type == "material");
                    if (!checkCraftElements(this.slotMaterials, materials) || !checkCraftElements(this.elements, elements)) {
                        locked = "locked";
                    }
                }
            }

            let tooltip = await TextEditor.enrichHTML(`<figure><img src='${je.src}'><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div>`);
            let choosed = "";
            let cost = je.getFlag(MODULE_ID, "cost") ?? 0;
            if ((auto || hasEnchanted || this.choosedModifiers.includes(je.uuid)) && !locked) {
                choosed = "choosed";
                this.cost.value -= cost;
            }
            let costInfo = "";
            let costClass = "";
            if (cost != 0) {
                if (cost > 0) {
                    costInfo = `-${cost}`;
                    costClass = "minus-cost";
                } else {
                    costInfo = `+${-cost}`;
                    costClass = "plus-cost";
                }
            }
            return {
                id: je.id,
                name: je.name,
                image: je.src,
                index: i,
                uuid: je.uuid,
                ingredients: ingredients,
                tooltip,
                locked,
                auto,
                category: je.getFlag(MODULE_ID, "category") ?? [],
                choosed,
                cost,
                costInfo,
                costClass,
                hasEnchanted,
            };
        }));
        debug("CraftPanelEnchant refreshModifiers: this.modifiers", this.modifiers);
        this.choosedModifiers = this.modifiers.filter(m => m.choosed && !m.hasEnchanted).map(m => m.uuid);
        debug("CraftPanelEnchant refreshModifiers: this.choosedModifiers", this.choosedModifiers);
        enchantments = enchantments.filter(enchantment => !this.modifiers.some(modifier => modifier.uuid === enchantment.uuid));
        let index = this.modifiers.length;
        for (let enchantment of enchantments) {
            this.cost.value -= enchantment.cost;
            let je = await fromUuid(enchantment.uuid);
            if (je) {
                const ingredients = (je.getFlag(MODULE_ID, "ingredients") ?? []).map((el) => {
                    let num = el.min;
                    if (el.useMin && el.useMax) {
                        num = `${el.min}/${el.max}`;
                    } else if (el.useMax) {
                        num = `≤${el.max}`;
                    }
                    return {
                        num: num,
                        ...el,
                    };
                });
                this.modifiers.push({
                    id: je.id,
                    name: je.name,
                    image: je.src,
                    index: index,
                    uuid: je.uuid,
                    ingredients: ingredients,
                    tooltip: await TextEditor.enrichHTML(`<figure><img src='${je.src}'><h2>${je.name}</h2></figure><div class="description">${je.text.content}</div>`),
                    locked: "",
                    auto: false,
                    category: je.getFlag(MODULE_ID, "category") ?? [],
                    choosed: "choosed",
                    cost: enchantment.cost,
                    hasEnchanted: true,
                })
                index++;
            }
        }
        this.modifierLimit = Number(this.modifierLimit) || 0;
        let choosedCount = this.modifiers.filter(m => m.choosed && !m.auto && !m.hasEnchanted).length;
        debug("CraftPanelEnchant refreshModifiers: this.modifiers choosedCount this.modifierLimit", this.modifiers, choosedCount, this.modifierLimit);
        if (this.cost.value < 0 || (choosedCount > this.modifierLimit && this.modifierLimit > 0)) {
            this.modifiers.filter(m => m.choosed && !(m.auto || m.hasEnchanted)).forEach(m => {
                m.choosed = "";
                this.cost.value += m.cost;
            });
            this.choosedModifiers = this.modifiers.filter(m => m.choosed && !m.hasEnchanted).map(m => m.uuid);
        }
        debug("CraftPanelEnchant refreshModifiers: this.cost this.choosedModifiers", this.cost, this.choosedModifiers);
    }
    //刷新可用点数
    async refreshCost() {
        let cost = Number(this.baseCost ?? 0);
        let elementCost = 0;
        debug("CraftPanelEnchant refreshCost: cost elementCost", cost, elementCost);
        if (this.cost.element) {
            let element = this.elements.find(e => e.id == this.cost.element);
            if (element) {
                elementCost = Number(element.num ?? 0);
            }
        }
        cost += elementCost;
        debug("CraftPanelEnchant refreshCost: cost", cost);
        const script = this.journalEntry.getFlag(MODULE_ID, "costScript");
        if (script && script.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "modifiers", "elements", "materials", "baseCost", "elementCost", "cost", script);
            let result = false;
            try {
                result = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.modifiers, this.elements, this.materials, this.baseCost, elementCost, this.cost);
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
            if (typeof result === "number") {
                cost = result;
            }
        }

        this.cost.max = cost;
        debug("CraftPanelEnchant refreshCost: this.cost", this.cost);
    }
    //刷新结果数据
    async refreshResults() {
        const resultsJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "result");
        debug("CraftPanelEnchant refreshResults: resultsJE", resultsJE);
        this.results = await Promise.all(resultsJE.map(async (je, i) => {
            const overrideStyle = (je.getFlag(MODULE_ID, "shape") ?? "default") !== "default";
            const overrideStyleClass = je.getFlag(MODULE_ID, "shape") == "circle" ? "round" : "";
            let tooltip = await TextEditor.enrichHTML(`<figure><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div>`);
            let isLocked = je.getFlag(MODULE_ID, "isLocked") ?? false;
            if (isLocked && !this.isEdit) {
                const script = je.getFlag(MODULE_ID, "unlockCondition");
                if (script && script.trim() != "") {
                    const fn = new AsyncFunction("data", "panel", "actor", "elements", "materials", script);
                    let unlock = false;
                    try {
                        unlock = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.elements, Object.values(this.slotItems));
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                    if (unlock) {
                        isLocked = false;
                    }
                }
            }
            const position = je.getFlag(MODULE_ID, "position") ?? { unlock: false, x: 0, y: 0 };
            const images = je.getFlag(MODULE_ID, "images") ?? [{ name: je.src, src: je.src }];
            return {
                id: je.id,
                name: je.name,
                img: je.src,
                slotIndex: i,
                uuid: je.uuid,
                hue: je.flags[MODULE_ID].hue,
                size: je.flags[MODULE_ID].size,
                lockSize: je.flags[MODULE_ID].size * 0.6,
                overrideStyle,
                overrideStyleClass,
                tooltip,
                isNecessary: je.getFlag(MODULE_ID, "isNecessary") ?? true,
                isLocked,
                position,
                images,
                description: je.text.content ?? "",
            };
        }));
        debug("CraftPanelEnchant refreshResults: this.results", this.results);
    }
    //检查能否添加该物品到槽位中
    async checkAdd(index, item, type = "slot") {
        debug("CraftPanelEnchant checkAdd : index item this.slots[index] this.actor", index, item, this.slots[index], this.actor);
        if (!item) return false;
        let slots = this.slots;
        let slotItems = this.slotItems;
        if (type == "result") {
            slots = this.results;
            slotItems = this.resultItems;
            const resultLimit = this.journalEntry.getFlag(MODULE_ID, "resultLimit") ?? 0;
            if (resultLimit > 0 && this.choosedResults.length >= resultLimit) {
                return false;
            }
        }
        if (slots[index].isLocked) return false;
        if (this.actor) {
            //检查数量
            let quantity = this.countQuantity(item);
            debug("CraftPanelEnchant checkAdd : quantity", quantity);
            if (quantity === undefined) {
                if (Object.values(slotItems).some(data => data.uuid === item.uuid)) {
                    return false;
                }
            } else if (quantity <= 0) {
                return false;
            }
        }
        //检查槽位要求
        const slotJE = this.journalEntry.pages.find(p => p.id == slots[index].id);
        debug("CraftPanelEnchant checkAdd : slotJE", slotJE);
        const config = slotJE.getFlag(MODULE_ID, "requirements") ?? [];
        debug("CraftPanelEnchant checkAdd : config", config);
        if (config.length > 0) {
            const requirements = {};
            config.forEach(key => {
                if (key == "script") {
                    const script = slotJE.getFlag(MODULE_ID, "requirements-script");
                    if (script && script.trim() !== "") {
                        const fn = new AsyncFunction("item", script);
                        requirements.script = fn;
                    }
                } else {
                    requirements[key] = slotJE.getFlag(MODULE_ID, `requirements-${key}`);
                }
            });
            debug("CraftPanelEnchant checkAdd : requirements", requirements);
            return await checkItemRequirements(item, requirements);
        }
        return true;
    }
    //检查必需槽位是否已填满
    checkSlot() {
        let slots = this.slots.filter(slot => slot.isNecessary);
        let results = this.results.filter(result => result.isNecessary);
        debug("CraftPanelEnchant checkSlot : slots results", slots, results);
        return slots.every(slot => this.slotItems[slot.slotIndex] !== null && this.slotItems[slot.slotIndex] !== undefined) && results.every(result => this.resultItems[result.slotIndex] !== null && this.resultItems[result.slotIndex] !== undefined);
    }
    //检查是否未选择结果
    checkNoResult() {
        return this.choosedResults.length == 0;
    }
    countQuantity(item) {
        let quantity = foundry.utils.getProperty(item, this.quantityPath);
        debug("CraftPanelEnchant countQuantity : item quantity", item, quantity);
        if (quantity === undefined) {
            return undefined;
        }
        if (typeof quantity === "string") {
            quantity = parseFloat(quantity);
        }
        Object.entries(this.slotItems).forEach(([index, data]) => {
            if (data) {
                if (data.uuid === item.uuid) {
                    quantity--;
                }
            }
        });
        debug("CraftPanelEnchant countQuantity : quantity", quantity);
        return quantity;
    }
    createModifierData() {
        const ret = foundry.utils.deepClone(DEFAULT_MODIFIER_DATA);
        const categories = this.modifier_categories.filter(i => i.choosed && i.id != 'all' && i.id != 'add');
        for (const key in categories) ret.category.push(categories[key].name)
        return ret;
    }

    /**
     * 编辑槽位
     */
    async editSlot(slotJEUuid) {
        const slotJE = await fromUuid(slotJEUuid);
        debug("CraftPanelEnchant editSlot: slotJE", slotJE);
        const showTypeOptions = {
            default: game.i18n.localize(`${MODULE_ID}.show-type.default`),
            mod1: game.i18n.localize(`${MODULE_ID}.show-type.mod1`),
            mod2: game.i18n.localize(`${MODULE_ID}.show-type.mod2`),
            mod3: game.i18n.localize(`${MODULE_ID}.show-type.mod3`),
            mod4: game.i18n.localize(`${MODULE_ID}.show-type.mod4`),
        };
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(slotJE)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot`) + ": " + slotJE.name)
            .tab({ id: "aspect", icon: "fas fa-image", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-aspect-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: `src`, type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .number({ name: `flags.${MODULE_ID}.size`, label: game.i18n.localize(`${MODULE_ID}.size`), min: 40, max: 160, step: 5 })
            .select({ name: `flags.${MODULE_ID}.shape`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.default`), ...CraftPanelEnchant.SHAPE_STYLE } })
            .number({ name: `flags.${MODULE_ID}.hue`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.hue`), min: 0, max: 360, step: 1 })
            .select({ name: `flags.${MODULE_ID}.showType`, label: game.i18n.localize(`${MODULE_ID}.show-type.show-type`), options: showTypeOptions })
            .tab({ id: "behavior", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-behavior-tab`) })
            .checkbox({ name: `flags.${MODULE_ID}.isNecessary`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-necessary`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-necessary-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.isConsumed`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-consumed`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-consumed-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.isLocked`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked-hint`) })
            .script({ name: `flags.${MODULE_ID}.unlockCondition`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script-hint`) })
            .script({ name: `flags.${MODULE_ID}.slotScript`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-script-hint`) })
            .tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-requirements-tab`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-hint`), options: { ...CraftPanelEnchant.REQUIREMENTS_TYPE_OPTIONS } })
            .text({ name: `flags.${MODULE_ID}.requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-name-hint`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
            .script({ name: `flags.${MODULE_ID}.requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-script-hint`) })
            .tab({ id: "position", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-position-tab`) })
            .checkbox({ name: `flags.${MODULE_ID}.position.unlock`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.position-unlock`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.position-unlock-hint`) })
            .number({ name: `flags.${MODULE_ID}.position.x`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.position-x`) })
            .number({ name: `flags.${MODULE_ID}.position.y`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.position-y`) })
            .button({
                label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-tooltip-button`),
                callback: async () => {
                    slotJE.sheet?.render(true);
                },
                icon: "fas fa-edit",
            })
            .button({
                label: game.i18n.localize(`Delete`),
                callback: async () => {
                    fb.form().close();
                    await slotJE.deleteDialog();
                    await this.render(true);
                },
                icon: "fas fa-trash",
            });
        const data = await fb.render();
        if (!data) return;
        debug("CraftPanelEnchant editSlot: data", data);
        await slotJE.update(data);
        await this.render(true);
    }
    /**
     * 编辑结果槽位
     */
    async editResult(slotJEUuid) {
        const slotJE = await fromUuid(slotJEUuid);
        debug("CraftPanelEnchant editResult: slotJE", slotJE);
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(slotJE)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot`) + ": " + slotJE.name)
            .tab({ id: "aspect", icon: "fas fa-image", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-aspect-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .number({ name: `flags.${MODULE_ID}.size`, label: game.i18n.localize(`${MODULE_ID}.size`), min: 40, max: 160, step: 5 })
            .select({ name: `flags.${MODULE_ID}.shape`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.default`), ...CraftPanelEnchant.SHAPE_STYLE } })
            .number({ name: `flags.${MODULE_ID}.hue`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.hue`), min: 0, max: 360, step: 1 })
            .select({ name: `flags.${MODULE_ID}.showType`, label: game.i18n.localize(`${MODULE_ID}.show-type.label`), options: { "default": game.i18n.localize(`${MODULE_ID}.show-type.default`), "mod1": game.i18n.localize(`${MODULE_ID}.show-type.mod1`), "mod2": game.i18n.localize(`${MODULE_ID}.show-type.mod2`), "mod3": game.i18n.localize(`${MODULE_ID}.show-type.mod3`) } })
            .tab({ id: "behavior", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-behavior-tab`) })
            .checkbox({ name: `flags.${MODULE_ID}.isNecessary`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-necessary`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-necessary-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.isLocked`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked-hint`) })
            .script({ name: `flags.${MODULE_ID}.unlockCondition`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script-hint`) })
            .tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-requirements-tab`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-hint`), options: { ...CraftPanelEnchant.REQUIREMENTS_TYPE_OPTIONS } })
            .text({ name: `flags.${MODULE_ID}.requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-name-hint`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
            .script({ name: `flags.${MODULE_ID}.requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-script-hint`) })
            .tab({ id: "position", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-position-tab`) })
            .checkbox({ name: `flags.${MODULE_ID}.position.unlock`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.position-unlock`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.position-unlock-hint`) })
            .number({ name: `flags.${MODULE_ID}.position.x`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.position-x`) })
            .number({ name: `flags.${MODULE_ID}.position.y`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.position-y`) })
            .button({
                label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-image`),
                callback: async () => {
                    //编辑模式下，左键点击结果可以编辑结果
                    let images = await chooseImage(slotJE.getFlag(MODULE_ID, "images"), this.mode);
                    if (images) {
                        await slotJE.update({
                            [`flags.${MODULE_ID}.images`]: images,
                            src: images[0].src,
                        });
                        await this.render(true);
                    }
                },
                icon: "fas fa-edit",
            })
            .button({
                label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-tooltip-button`),
                callback: async () => {
                    slotJE.sheet?.render(true);
                },
                icon: "fas fa-edit",
            })
            .button({
                label: game.i18n.localize(`Delete`),
                callback: async () => {
                    fb.form().close();
                    await slotJE.deleteDialog();
                    await this.render(true);
                },
                icon: "fas fa-trash",
            });
        const data = await fb.render();
        if (!data) return;
        debug("CraftPanelEnchant editResult: data", data);
        await slotJE.update(data);
        this.needRefresh = true;
        await this.render(true);
    }
    /**
     * 编辑配方
     */
    async editModifier(modifierJEUuid) {
        const modifierJE = await fromUuid(modifierJEUuid);
        debug("CraftPanelEnchant editModifier: modifierJE", modifierJE);
        const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelModifier));
        if (openWindow) openWindow.close();
        else {
            let newWindow = new CraftPanelModifier(this.journalEntry, modifierJE, { focusModifierUuid: modifierJE.uuid });
            newWindow.parentPanel = this;
            newWindow.render(true);
        };
    }
    /**
     * 编辑元素配置
     */
    async editElementConfig(index) {
        const elementConfig = this.elementConfigs[index];
        const text = "edit-element-config";
        debug("CraftPanelBlend editElementConfig : elementConfig", elementConfig);
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(elementConfig)
            .title(game.i18n.localize(`${MODULE_ID}.${text}.title`) + ": " + elementConfig.name)
            .tab({ id: "aspect", icon: "fas fa-image", label: game.i18n.localize(`${MODULE_ID}.${text}.aspect-tab`) })
            .text({ name: "ids", label: game.i18n.localize(`${MODULE_ID}.id`), value: elementConfig.ids.join(","), hint: game.i18n.localize(`${MODULE_ID}.${text}.ids-hint`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`), hint: game.i18n.localize(`${MODULE_ID}.${text}.name-hint`) })
            .file({ name: "img", type: "image", label: game.i18n.localize(`${MODULE_ID}.${text}.img`), hint: game.i18n.localize(`${MODULE_ID}.${text}.img-hint`) })
            .color({ name: "color", label: game.i18n.localize(`${MODULE_ID}.${text}.color`), hint: game.i18n.localize(`${MODULE_ID}.${text}.color-hint`) })
            .number({ name: "size", label: game.i18n.localize(`${MODULE_ID}.size`), min: 40, max: 160, step: 5 })
            .select({ name: "shape", label: game.i18n.localize(`${MODULE_ID}.${text}.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.default`), ...CraftPanelBlend.SHAPE_STYLE } })
            .select({ name: "visible", label: game.i18n.localize(`${MODULE_ID}.${text}.visible`), options: { "true": game.i18n.localize(`${MODULE_ID}.${text}.visible-always-show`), "false": game.i18n.localize(`${MODULE_ID}.${text}.visible-always-not-show`), "visibleWhenUp0": game.i18n.localize(`${MODULE_ID}.${text}.visible-when-up-0`), "visibleWhenDown0": game.i18n.localize(`${MODULE_ID}.${text}.visible-when-down-0`) } })
            .tab({ id: "behavior", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.${text}.behavior-tab`) })
            .number({ name: "value", label: game.i18n.localize(`${MODULE_ID}.${text}.value`), hint: game.i18n.localize(`${MODULE_ID}.${text}.value-hint`) })
            .checkbox({ name: "useMin", label: game.i18n.localize(`${MODULE_ID}.${text}.use-min`), hint: game.i18n.localize(`${MODULE_ID}.${text}.use-min-hint`) })
            .number({ name: "min", label: game.i18n.localize(`${MODULE_ID}.${text}.min`), hint: game.i18n.localize(`${MODULE_ID}.${text}.min-hint`) })
            .checkbox({ name: "useMax", label: game.i18n.localize(`${MODULE_ID}.${text}.use-max`), hint: game.i18n.localize(`${MODULE_ID}.${text}.use-max-hint`) })
            .number({ name: "max", label: game.i18n.localize(`${MODULE_ID}.${text}.max`), hint: game.i18n.localize(`${MODULE_ID}.${text}.max-hint`) })
            .select({ name: "multiShow", label: game.i18n.localize(`${MODULE_ID}.${text}.multi-show`), options: multiShowOptions, hint: game.i18n.localize(`${MODULE_ID}.${text}.multi-show-hint`) })
            .select({ name: "multiValue", label: game.i18n.localize(`${MODULE_ID}.${text}.multi-value`), options: multiValueOptions, hint: game.i18n.localize(`${MODULE_ID}.${text}.multi-value-hint`) })
            .text({ name: "plusElements", label: game.i18n.localize(`${MODULE_ID}.${text}.plus-elements`), hint: game.i18n.localize(`${MODULE_ID}.${text}.plus-elements-hint`) })
            .text({ name: "minusElements", label: game.i18n.localize(`${MODULE_ID}.${text}.minus-elements`), hint: game.i18n.localize(`${MODULE_ID}.${text}.minus-elements-hint`) })
            .button({
                label: game.i18n.localize(`Delete`),
                callback: async () => {
                    fb.form().close();
                    this.elementConfigs.splice(index, 1);
                    await this.journalEntry.setFlag(MODULE_ID, "elementConfig", this.elementConfigs);
                    this.needRefresh = true;
                    await this.render(true);
                },
                icon: "fas fa-trash",
            });
        const data = await fb.render();
        debug("CraftPanelBlend editElementConfig : data", data);
        if (!data) return;
        Object.keys(elementConfig).forEach(key => {
            if (key == "ids") {
                elementConfig[key] = data[key].split(",").map(id => id.trim()).filter(id => id != "");
            } else if (key == "visible") {
                elementConfig[key] = data[key] == "true" ? true : (data[key] == "false" ? false : data[key]);
            } else {
                elementConfig[key] = data[key] ?? elementConfig[key];
            }
        });
        await this.journalEntry.setFlag(MODULE_ID, "elementConfig", this.elementConfigs);
        this.needRefresh = true;
        await this.render(true);
    }
    /**
     * 选择调整
     */
    async chooseModifier(modifierJEUuid) {
        const modifierJE = await fromUuid(modifierJEUuid);
        const modifier = this.modifiers.find(m => m.uuid === modifierJE.uuid);
        debug("CraftPanelEnchant chooseModifier: modifierJE modifier", modifierJE, modifier);
        if (modifier.auto || modifier.hasEnchanted) return;
        const cost = modifier.cost ?? modifierJE.getFlag(MODULE_ID, "cost") ?? 0;
        debug("CraftPanelEnchant chooseModifier: cost this.cost", cost, this.cost);
        if (this.choosedModifiers.includes(modifierJE.uuid)) {
            this.choosedModifiers = this.choosedModifiers.filter(m => m !== modifierJE.uuid);
        } else {
            //检查能否选择
            let choosedCount = this.modifiers.filter(m => m.choosed && !m.auto).length;
            if (modifier.locked || this.cost.value < cost || (choosedCount >= this.modifierLimit && this.modifierLimit > 0)) {
                return;
            }
            let categories = modifierJE.getFlag(MODULE_ID, "category") ?? [];
            debug("CraftPanelEnchant chooseModifier: categories", categories);
            if (categories.length > 0) {
                for (let category of categories) {
                    let limit = this.modifier_categories.find(c => c.id == category)?.limit ?? 0;
                    if (limit > 0) {
                        let choosed = this.choosedModifiers.filter(m => this.modifiers.find(mo => mo.uuid == m).category.includes(category)).length;
                        if (choosed >= limit) {
                            return;
                        }
                    }
                }
            }
            //选择
            this.choosedModifiers.push(modifierJE.uuid);
        }
        debug("CraftPanelEnchant chooseModifier: this.choosedModifiers", this.choosedModifiers);
        await this.render(true);
    }
    /**
     * 新增类别配置
     */
    async addCategory(type) {
        debug("CraftPanelEnchant addCategory : type", type);
        const defaultData = {
            id: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-category`),
            name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-category`),
            icon: "icons/svg/barrel.svg",
        }
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(defaultData)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-category`))
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "icon", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })

        if (type == "material") {
            fb.tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-requirements-tab`) })
                .multiSelect({ name: `requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-hint`), options: { ...CraftPanelEnchant.REQUIREMENTS_TYPE_OPTIONS } })
                .text({ name: `requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-name-hint`) })
                .multiSelect({ name: `requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
                .script({ name: `requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-script-hint`) })
        } else if (type == "modifier") {
            fb.number({ name: "limit", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.limit-num`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.limit-num-hint`), min: 0 });
        }
        const data = await fb.render();
        debug("CraftPanelEnchant addCategory : data", data);
        if (!data) return;
        data.id = data.name;
        let categories = this.journalEntry.getFlag(MODULE_ID, type + "-categories") ?? [];
        categories.push(data);
        debug("CraftPanelEnchant addCategory : categories", categories);
        await this.journalEntry.setFlag(MODULE_ID, type + "-categories", categories);
        this.needRefresh = true;
        await this.render(true);
    }
    async changeCategory(category, type) {
        debug("CraftPanelEnchant changeCategory : category type", category, type);
        if (type == "material") {
            let index = this.material_categories.findIndex(el => el.id == category);
            if (index >= 0) {
                if (!this.material_categories[index].choosed) {
                    this.material_categories.forEach(el => el.choosed = false);
                    this.material_categories[index].choosed = true;
                    debug("CraftPanelEnchant changeCategory : this.material_categories", this.material_categories);
                    this.needRefresh = true;
                    await this.render(true);
                }
            }
        } else if (type == "modifier") {
            let index = this.modifier_categories.findIndex(el => el.id == category);
            if (index >= 0) {
                if (!this.modifier_categories[index].choosed) {
                    this.modifier_categories.forEach(el => el.choosed = false);
                    this.modifier_categories[index].choosed = true;
                    debug("CraftPanelEnchant changeCategory : this.recipe_categories", this.recipe_categories);
                    this.needRefresh = true;
                    await this.render(true);
                }
            }
        }
    }
    async editCategory(category, type) {
        if (category == "all" || category == "add") return;
        debug("CraftPanelEnchant editCategory : category type", category, type);
        let categories = this.journalEntry.getFlag(MODULE_ID, type + "-categories") ?? [];
        let index = categories.findIndex(el => el.id == category);
        debug("CraftPanelEnchant editCategory : index categories", index, categories);
        if (!categories[index]) {
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.objectNotFound`) + " : " + category);
            return;
        }
        let needDelete = false;
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(categories[index])
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-category`) + ": " + category)
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "icon", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .button({
                label: game.i18n.localize(`Delete`),
                callback: async () => {
                    needDelete = true;
                    fb.form().close();
                },
                icon: "fas fa-trash",
            });
        if (type == "material") {
            fb.tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-requirements-tab`) })
                .multiSelect({ name: `requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-hint`), options: { ...CraftPanelEnchant.REQUIREMENTS_TYPE_OPTIONS } })
                .text({ name: `requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-name-hint`) })
                .multiSelect({ name: `requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
                .script({ name: `requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-script-hint`) })
        } else if (type == "modifier") {
            fb.number({ name: "limit", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.limit-num`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.limit-num-hint`), min: 0 });
        }
        const data = await fb.render();
        debug("CraftPanelEnchant editCategory : data needDelete", data, needDelete);
        if (needDelete) {
            categories.splice(index, 1);
            await this.journalEntry.setFlag(MODULE_ID, type + "-categories", categories);
            this.needRefresh = true;
            await this.render(true);
            return;
        }
        if (!data) return;
        data.id = data.name;

        categories[index] = data;
        debug("CraftPanelEnchant editCategory : categories", categories);
        await this.journalEntry.setFlag(MODULE_ID, type + "-categories", categories);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 合成物品
     */
    async craft() {
        if (this.checkNoResult()) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.must-fill-at-least-one-result`));
            return false;
        }
        if (!this.checkSlot()) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.must-fill-necessary-slot`));
            return false
        };
        let preScript = this.journalEntry.getFlag(MODULE_ID, "craft-pre-script");
        let craftScript = this.journalEntry.getFlag(MODULE_ID, "craft-script");
        let postScript = this.journalEntry.getFlag(MODULE_ID, "craft-post-script");
        debug("CraftPanelEnchant craft: preScript postScript", preScript, postScript);
        let materials = [];
        let results = [];
        this.canceled = false;
        //整理所有的材料
        for (let slot of this.slots) {
            let slotItem = this.slotItems[slot.slotIndex];
            if (slotItem) {
                let material = materials.find(m => (m.item.uuid == slotItem.uuid) && (m.isConsumed == slot.isConsumed));
                if (material) {
                    material.quantity++;
                } else {
                    let item = await fromUuid(slotItem.uuid);
                    if (!item) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.itemNotFound`) + slotItem.uuid);
                        this.canceled = true;
                        continue;
                    }
                    materials.push({
                        item: item,
                        isConsumed: slot.isConsumed,
                        quantity: 1
                    });
                }
            }
        }
        debug("CraftPanelEnchant craft: materials", materials);
        //执行预处理脚本
        if (preScript && preScript.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "modifiers", "elements", "materials", "canceled", preScript);
            try {
                await fn(this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, this.canceled);
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }
        debug("Hooks.call craftPanelEnchantPre", this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, this.canceled);
        await Hooks.call("craftPanelEnchantPre", this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, this.canceled);
        //获取当前选择的所有调整
        let selectedModifiers = this.modifiersJE.filter(m => this.choosedModifiers.includes(m.uuid));
        debug("CraftPanelEnchant craft: selectedModifiers", selectedModifiers);
        //获取合成结果
        for (let [index, re] of Object.entries(this.resultItems)) {
            if (!re) continue;
            const item = await fromUuid(re.uuid);
            debug("CraftPanelEnchant craft: item", item);
            if (item) {
                results.push({
                    item: item.toObject(),
                    uuid: re.uuid,
                    name: this.resultOverrides[index]?.name ?? re.name,
                    img: this.resultOverrides[index]?.img ?? re.img,
                    description: this.resultOverrides[index]?.description ?? re.description,
                    parent: item.parent,
                })
            } else {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.itemNotFound`) + re.name + " " + re.uuid);
                this.canceled = true;
            }
        }
        results = results.map(r => {
            debug("CraftPanelEnchant craft: r", r);
            r.item.name = r.name;
            r.item.img = r.img;

            //添加描述
            if (foundry.utils.getProperty(r.item, this.descriptionPath)) {
                r.item[this.descriptionPath] = r.description;
                for (let je of selectedModifiers) {
                    r.item[this.descriptionPath] += `<h2>${je.name}</h2><div class="description">${je.text.content ?? ""}</div>`;
                }
            }
            //保存调整信息
            r.item.flags ??= {};
            r.item.flags[MODULE_ID] ??= {};
            r.item.flags[MODULE_ID].enchantments ??= [];
            r.item.flags[MODULE_ID].enchantments.push(...selectedModifiers.map(m => {
                return {
                    uuid: m.uuid,
                    name: m.name,
                    img: m.src,
                    cost: m.getFlag(MODULE_ID, "cost"),
                }
            }));
            return r;
        });
        debug("CraftPanelEnchant craft: results", results);
        //应用调整
        if (selectedModifiers.length > 0) {
            for (let modifier of selectedModifiers) {
                //执行调整的脚本
                let craftScript = modifier.getFlag(MODULE_ID, "craftScript");
                if (craftScript && craftScript.trim() != "") {
                    const fn = new AsyncFunction("data", "panel", "actor", "modifiers", "elements", "materials", "modifier", "results", "canceled", craftScript);
                    try {
                        await fn(this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, modifier, results, this.canceled);
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                }
                debug("Hooks.call craftPanelEnchantModifier", this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, modifier, results, this.canceled);
                await Hooks.call("craftPanelEnchantModifier", this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, modifier, results, this.canceled);
                //应用调整的效果
                let changes = modifier.getFlag(MODULE_ID, "changes") ?? [];
                let asAE = modifier.getFlag(MODULE_ID, "asAE") ?? false;
                debug("CraftPanelEnchant craft: changes asAE", changes, asAE);
                if (asAE) {
                    if (asAE == "merge") {
                        for (let re of results) {
                            let ae = re.item?.effects?.find(e => e.name == re.name);
                            if (ae) {
                                ae.changes = ae.changes.concat(changes);
                            } else {
                                ae = buildActiveEffect(re.name, re.img, changes, 0);
                                re.item.effects ??= [];
                                re.item.effects.push(ae);
                            }
                        }
                    } else {
                        let aeName = modifier.getFlag(MODULE_ID, "aeName");
                        if (!aeName) {
                            aeName = modifier.name;
                        }
                        let ae = buildActiveEffect(aeName, modifier.src, changes, 0, 3, undefined, modifier.text.content);
                        for (let re of results) {
                            re.item.effects ??= [];
                            re.item.effects.push(ae);
                        }
                    }
                } else {
                    for (let re of results) {
                        for (let change of changes) {
                            if (change.key && /^[a-zA-Z0-9.]+$/.test(change.key)) {
                                applyChange(re.item, change);
                            }
                        }
                    }
                }
            }
        }
        //执行创建物品前最后的脚本
        if (craftScript && craftScript.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "modifiers", "elements", "materials", "results", "canceled", craftScript);
            try {
                await fn(this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, results, this.canceled);
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }
        debug("CraftPanelEnchant craft: results", results);
        //结算结果
        if (this.actor) {
            const updates = {};
            const toDelete = {};
            // const products = results.map(r => r.item);

            debug("CraftPanelEnchant craft: this.actor", this.actor);
            materials.forEach(m => {
                let item = m.item;
                let quantity = m.quantity;
                let parent = item.parent;
                if ((!parent) || (!parent?.isOwner)) {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.noOwner`) + re.name + " " + re.uuid);
                    this.canceled = true;
                } else if (!item) {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.itemNotFound`) + re.name + " " + re.uuid);
                    this.canceled = true;
                } else if (m.isConsumed) {
                    if (foundry.utils.getProperty(item, this.quantityPath) === undefined) {
                        toDelete[parent.id] ??= { parent: parent, items: [] };
                        toDelete[parent.id].items.push(item.id);
                        // toDelete.push({ _id: item.id, parent: item.parent });
                    } else {
                        let newQuantity = parseFloat(foundry.utils.getProperty(item, this.quantityPath)) - quantity;
                        let findItem = false;
                        if (newQuantity < 0) {
                            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.notEnoughMaterial`) + item.name);
                            this.canceled = true;
                        } else if (newQuantity == 0) {
                            // toDelete.push({ _id: item.id, parent: item.parent });
                            toDelete[parent.id] ??= { parent: parent, items: [] };
                            toDelete[parent.id].items.push(item.id);
                            if (findItem) {
                                updates[parent.id].items = updates[parent.id].items.filter(i => i._id != item.id);
                            }
                        } else {
                            if (findItem) {
                                findItem[this.quantityPath] = newQuantity;
                            } else {
                                updates[parent.id] ??= { parent: parent, items: [] };
                                updates[parent.id].items.push({
                                    _id: item.id,
                                    [this.quantityPath]: newQuantity
                                });
                            }
                        }
                    }

                }
            });
            results.forEach(re => {
                let item = re.item;
                let parent = re.parent;
                if ((!parent) || (!parent?.isOwner)) {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.noOwner`) + re.name + " " + re.uuid);
                    this.canceled = true;
                } else {
                    updates[parent.id] ??= { parent: parent, items: [] };
                    updates[parent.id].items.push(item);
                }
            });

            debug("CraftPanelEnchant craft: updates toDelete results", updates, toDelete, results);
            if (!this.canceled) {
                // await this.actor.updateEmbeddedDocuments("Item", updates);
                // await this.actor.createEmbeddedDocuments("Item", products);
                // await this.actor.deleteEmbeddedDocuments("Item", toDelete);
                await Promise.all(Object.values(updates).map(async el => {
                    await el.parent.updateEmbeddedDocuments("Item", el.items);
                }));
                await Promise.all(Object.values(toDelete).map(async el => {
                    await el.parent.deleteEmbeddedDocuments("Item", el.items);
                }));

                //输出合成结果信息
                let message = "<ul>";
                if (materials.filter(el => (el.isConsumed == false)).length > 0) {
                    message += `<li><b>${game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-materials-unconsumed`)}: </b><ul>`;
                    materials.filter(el => (el.isConsumed == false)).forEach(el => {
                        message += `<li><img src="${el.item.img}" style="vertical-align:middle" width="24" height="24"> ${el.item.name} x${el.quantity}</li>`;
                    });
                    message += "</ul></li>";
                }
                if (materials.filter(el => (el.isConsumed == true)).length > 0) {
                    message += `<li><b>${game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-materials-consumed`)}: </b><ul>`;
                    materials.filter(el => (el.isConsumed == true)).forEach(el => {
                        message += `<li><img src="${el.item.img}" style="vertical-align:middle" width="24" height="24"> ${el.item.name} x${el.quantity}</li>`;
                    });
                    message += "</ul></li>";
                }
                message += `<li><b>${game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-results`)}: </b><ul>`;
                results.forEach(el => {
                    message += `<li><img src="${el.item.img}" style="vertical-align:middle" width="24" height="24"> ${el.item.name} </li>`;
                });
                message += "</ul></li></ul>";
                await chatMessage(message, { img: this.journalEntry.src, title: `${this.journalEntry.name} - ${game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-results`)}`, speaker: this.actor });
            }
        } else if (!this.canceled) {
            const folder = await getFolder(this.journalEntry.name, 'Item');
            await Item.createDocuments(results.map(r => {
                r.item.folder = folder;
                return r.item;
            }));
        }
        //执行后处理脚本
        if (postScript && postScript.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "modifiers", "elements", "materials", "results", "canceled", postScript);
            try {
                await fn(this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, results, this.canceled);
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }
        debug("Hooks.call craftPanelEnchantPost", this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, results, this.canceled);
        await Hooks.call("craftPanelEnchantPost", this, this.journalEntry, this.actor, this.modifiersJE, this.elements, materials, results, this.canceled);
        this.slotItems = {};
        this.resultItems = {};
        this.resultOverrides = {};
        this.elements = [];
        this.choosedModifiers = [];
        this.needRefresh = true;
        await this.render(true);
        return results;
    }

    async toggleEdit(event) {
        event.preventDefault();
        //切换编辑模式
        if (!game.user.isGM) return;
        this.mode = this.isEdit ? "use" : "edit";
        this.window.title.textContent = this.title;
        this.needRefresh = true;
        await this.render(true);
    }

    static get SHAPE_STYLE() {
        return {
            square: `${MODULE_ID}.${this.APP_ID}.shape-square`,
            circle: `${MODULE_ID}.${this.APP_ID}.shape-circle`,
        };
    }
    static get REQUIREMENTS_TYPE_OPTIONS() {
        return {
            "name": `${MODULE_ID}.${this.APP_ID}.requirements-name`,
            "type": `${MODULE_ID}.${this.APP_ID}.requirements-type`,
            "script": `${MODULE_ID}.${this.APP_ID}.requirements-script`,
        };
    }
}
/**
 * @typedef {Object} CraftElement
 * @property {string} id - 元素的id，为对应物品的id（非uuid）。用于检测是否为同一元素，可以通过名称与图标相同但id不同的元素实现“虚假”属性。
 * @property {string} name - 元素的名称，为对应物品的名称。仅用于显示。
 * @property {string} img - 元素的图标，为对应物品的图标。仅用于显示。
 * @property {string} type - 需求原料的类型，仅用于配方保存的需求。
 * @property {string} class - 元素的类型，仅用于脚本检测。
 * @property {string} color - 元素的颜色，为对应形状以及边框的颜色。仅用于显示。
 * @property {number} weight - 元素的权重，用于计算匹配度。
 * @property {number} num - 仅成分元素使用，为元素的数量。用于显示作为合成素材时提供的元素数量。
 * @property {boolean} useMin - 仅需求元素使用，为是否使用最小数量。
 * @property {number} min - 仅需求元素使用，为元素的最小数量。用于显示合成时最少需要的元素数量。
 * @property {boolean} useMax - 仅需求元素使用，为是否使用最大数量。
 * @property {number} max - 仅需求元素使用，为元素的最大数量。用于显示合成时最多需要的元素数量。
 * @property {string} shape - 元素的形状，用于显示。默认为圆形circle，还可以配置方形square，以及菱形diamond。
 */
/**
 * @typedef {Object} CraftElementConfig
 * @property {string[]} ids - 显示元素的id。配置时通过逗号分隔以支持多个元素。
 * @property {string} name - 数量为0时显示的默认名称。
 * @property {string} img - 数量为0时显示的默认图标。
 * @property {boolean} useMin - 是否限制最小数量。
 * @property {number} min - 当实际元素少于最小数量时，实际数量为最小数量。
 * @property {boolean} useMax - 是否限制最大数量。
 * @property {number} max - 当实际元素多于最大数量时，实际数量为最大数量。
 * @property {"default" | "max" | "min"} multiShow - 多个元素时的图标和名称显示方式。default: 只显示默认名称和图标，max: 显示最多元素的名称和图标，min: 显示最少元素的名称和图标。
 * @property {"all" | "only-max" | "only-min" | "max-plus" | "max-minus" | "min-plus" | "min-minus"} multiValue - 多个元素时的实际使用的元素数据。all：包含的元素都会被使用（显示总和数量），only-max：只使用最多数量的元素，only-min：只使用最少数量的元素，max-plus：选择数量最多的元素然后其数量加上其他元素，max-minus：选择数量最多的元素然后其数量减去其他元素，min-plus：选择数量最少的元素然后其数量加上其他元素，min-minus：选择数量最少的元素然后其数量减去其他元素。
 * @property {string} plusElements - 配置元素的id（逗号分隔），这些元素不参与multiShow和multiValue的判断，但会在原值不为0时将数量加在最终结果中。
 * @property {string} minusElements - 配置元素的id（逗号分隔），这些元素不参与multiShow和multiValue的判断，但会在原值不为0时将数量减在最终结果中。
 * @property {string} shape - 元素的形状，用于显示。默认为圆形circle，与slot的shape配置相同，可用选项使用CraftPanelBlend.SHAPE_STYLE。
 * @property {boolean | "visibleWhenUp0" | "visibleWhenDown0"} visible - 元素的显示条件。true: 总是显示，false: 总是不显示，visibleWhenUp0: 仅当元素数量大于0时显示，visibleWhenDown0: 仅当元素数量小于等于0时显示。默认为true。
 * @property {number} value - 元素的价值，仅用于右侧材料面板计算元素数量时的参考价值。默认为1。未配置CraftElementConfig的元素价值为0。
 * @property {number} size - 元素的尺寸，仅用于显示时的图标大小。默认为60。
 * @property {string} color - 元素的颜色，边框的默认颜色。仅用于显示。
 */
/**
 * @typedef {Object} CraftElementShow
 * @property {string} id - 元素的id，为对应物品的id（非uuid）。用于检测是否为同一元素，可以通过名称与图标相同但id不同的元素实现“虚假”属性。
 * @property {string} name - 元素的名称，为对应物品的名称。仅用于显示。
 * @property {string} img - 元素的图标，为对应物品的图标。仅用于显示。
 * @property {string} type - 需求原料的类型，仅用于配方保存的需求。
 * @property {string} color - 元素的颜色，为对应形状以及边框的颜色。仅用于显示。
 * @property {number} weight - 元素的权重，用于计算匹配度。
 * @property {number} num - 仅成分元素使用，为元素的数量。用于显示作为合成素材时提供的元素数量。
 * @property {string} shapeClass - 元素的形状，用于显示。默认为圆形circle，与slot的shape配置相同，可用选项使用CraftPanelBlend.SHAPE_STYLE。
 * @property {number} size - 元素的尺寸，仅用于显示时的图标大小。默认为60。
 * @property {number} index - 元素的索引，用于事件绑定时获取指定的元素。
 */
/**
 * 检测物品是否符合要求
 * @param {Item} item - 要检测的物品
 * @param {Object} requirements - 要求的条件
 * @param {string} requirements.name - 名称检测
 * @param {string[]} requirements.type - 类型检测
 * @param {Function} requirements.script - 脚本检测
 * @returns {Promise<boolean>} - 是否符合要求
 */
async function checkItemRequirements(item, requirements) {
    if (requirements.name) {
        if (item?.name == requirements.name) return true;
    }
    if (requirements.script) {
        let result = false;
        try {
            result = await requirements.script(item);
        } catch (e) {
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
            console.error(e);
        }
        if (result === true) return true;
    }
    if (requirements.type) {
        if (requirements.type.includes(item?.type)) return true;
    }
    return false;
}

/**
 * 检查当前元素是否满足配方的元素需求
 * @param {CraftElement[]} elements 当前元素
 * @param {CraftElement[]} craftElements 配方元素需求
 * @returns {boolean} 是否满足条件
 */
function checkCraftElements(elements, craftElements) {
    return !(craftElements.some((el) => {
        let el2 = elements.find((el3) => el3.id === el.id);
        // return !el2 || el2.num < el.min || el2.num > el.max;
        return (el.useMin && (el2?.num ?? 0) < el.min) || (el.useMax && (el2?.num ?? 0) > el.max);
    }));
}