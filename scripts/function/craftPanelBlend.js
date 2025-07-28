import { HandlebarsApplication, getItemColor, MODULE_ID, debug, chatMessage, getFolder } from "../utils.js";
import { CraftPanelRecipe } from "./craftPanelRecipe.js";
import { CraftPanelUserRecipe } from "./craftPanelUserRecipe.js";

const DEFAULT_SLOT_DATA = {
    hue: 180,
    shape: "default",
    isNecessary: false,
    isConsumed: true,
    size: 80,
    position: { unlock: false, x: 0, y: 0 },
}

const DEFAULT_RECIPE_DATA = {
    isLocked: false,
    ingredients: [],
    weight: 100,
    unlockCondition: "",
    craftScript: "",
    category: [],
}
const DEFAULT_OWNERSHIP = {
    "canShow": 2,
    "canUse": 1,
    "none": 0,
}
const AsyncFunction = async function () { }.constructor;

export class CraftPanelBlend extends HandlebarsApplication {
    constructor(journalEntry, mode = "edit", options = {}) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        this.journalEntry = journalEntry;
        this.mode = mode;
        this.actor = options.actor;
        this.elements = [];
        this.slotItems = {};
        this.results = [];
        this.slots = [];
        this.recipes = [];
        this.materials = [];
        this.needRefresh = true;
        this.panelOptions = options;
        this.recipe_categories = [];
        this.material_categories = [];

        this.quantityPath = game.settings.get(MODULE_ID, 'quantityPath');
        this.descriptionPath = game.settings.get(MODULE_ID, 'descriptionPath');

        this.scrollPositions = {
            materials: 0,
            recipes: 0,
        };

        if (game.user.isGM) {
            this.options.actions.edit = this.toggleEdit.bind(this);
            this.options.actions["new-recipe"] = this.newRecipe.bind(this);
            this.options.actions["config-user-unlocked"] = this.configUserUnlocked.bind(this);
        } else {
            this.options.window.controls = [];
        }
        this.options.actions.craft = this.craft.bind(this);
        this.options.actions["configure-panel"] = this.configure.bind(this);
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

        this.panelSizes = this.journalEntry.getFlag(MODULE_ID, "panelSizes") ?? {
            recipes: {
                width: 300,
                height: 540,
            },
            materials: {
                width: 300,
                height: 540,
            },
            slots: {
                width: 600,
                height: 300,
            },
            elements: {
                width: 600,
                height: 70,
            },
            results: {
                width: 600,
                height: 100,
            },
        };

        craftPanels ??= [];
        craftPanels.push(this);
        debug("CraftPanelBlend constructor : this journalEntry mode options craftPanels", this, journalEntry, mode, options, craftPanels);
    }

    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID, "craft"],
            tag: "div",
            window: {
                frame: true,
                positioned: true,
                title: `${MODULE_ID}.${this.APP_ID}.title`,
                icon: "fa-regular fa-flask-round-potion",
                controls: [{
                    icon: "fas fa-edit",
                    action: "edit",
                    label: `${MODULE_ID}.edit-mode`,
                }, {
                    icon: "fas fa-user-lock",
                    action: "config-user-unlocked",
                    label: `${MODULE_ID}.${this.APP_ID}.unlock-recipe`,
                }, {
                    icon: "fas fa-plus",
                    action: "new-recipe",
                    label: `${MODULE_ID}.${this.APP_ID}.new-recipe`,
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
        return game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.title`) + ": " + this.journalEntry.name + (this.isEdit ? " - " + game.i18n.localize(`${MODULE_ID}.edit-mode`) : "");
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
        }
        const slotsJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "slot");
        debug("CraftPanelBlend _prepareContext : slotsJE", slotsJE);
        this.slots = await Promise.all(slotsJE.map(async (je, i) => {
            const overrideStyle = (je.getFlag(MODULE_ID, "shape") ?? "default") !== "default";
            const overrideStyleClass = je.getFlag(MODULE_ID, "shape") == "circle" ? "round" : "";
            let tooltip = await TextEditor.enrichHTML(`<figure><h1>${je.name}</h1></figure><div class="description">${je.text.content ?? ""}</div>`);
            let isLocked = je.getFlag(MODULE_ID, "isLocked") ?? false;
            if (isLocked && !this.isEdit) {
                const script = je.getFlag(MODULE_ID, "unlockCondition");
                if (script && script.trim() != "") {
                    const fn = new AsyncFunction("data", "panel", "actor", "elements", "materials", script);
                    let unlock = false;
                    try {
                        unlock = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.elements, this.materials);
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
                        result = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.elements, this.materials, this.slotItems[i]);
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                    }
                    if (result) {
                        isNecessary = result?.isNecessary ?? isNecessary;
                        isConsumed = result?.isConsumed ?? isConsumed;
                    }
                }
            }
            const position = je.getFlag(MODULE_ID, "position") ?? { unlock: false, x: 0, y: 0 };
            return {
                id: je.id,
                name: je.name,
                image: je.src,
                slotIndex: i,
                uuid: je.uuid,
                hue: je.flags[MODULE_ID].hue,
                size: je.flags[MODULE_ID].size,
                lockSize: je.flags[MODULE_ID].size * 0.8,
                overrideStyle,
                overrideStyleClass,
                tooltip,
                elements: [],
                isNecessary: isNecessary,
                isConsumed: isConsumed,
                isLocked,
                position,
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
                } else {
                    slot.empty = "empty";
                    slot.draggable = false;
                }
            });
        }
        debug("CraftPanelBlend _prepareContext : this.slots", this.slots);

        return {
            isEdit: this.isEdit,
            slots: this.slots,  //中间显示的槽位
            recipes: this.recipes, //左侧显示的配方
            materials: this.materials, //右侧显示的材料
            useCircleStyle: true,
            elements: this.elements,
            results: this.results,
            recipe_categories: this.recipe_categories,
            material_categories: this.material_categories,
            panelSizes: this.panelSizes,
        };
    }

    /**
     * 绑定各项元素的互动效果
     * @returns {}
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        debug("CraftPanelBlend _onRender : context", context);
        // 恢复滚动条位置
        html.querySelector(".craft-materials-panel").scrollTop = this.scrollPositions.materials;
        html.querySelector(".craft-recipes-panel").scrollTop = this.scrollPositions.recipes;

        // 绑定分类图标的点击事件
        html.querySelectorAll(".craft-category-icon").forEach(icon => {
            icon.addEventListener("click", this._onClickCategory.bind(this));
        });

        if (this.isEdit) {
            // html.querySelector("button[name='new-slot']").addEventListener("click", async (event) => {
            //     event.preventDefault();
            //     await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            //         {
            //             name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-slot`),
            //             src: "icons/commodities/materials/bowl-powder-pink.webp",
            //             "text.content": null,
            //             flags: {
            //                 [MODULE_ID]: {
            //                     type: "slot",
            //                     ...DEFAULT_SLOT_DATA,
            //                 },
            //             },
            //         },
            //     ]);
            //     await this.render(true);
            // });
            // html.querySelector("button[name='new-recipe']").addEventListener("click", async (event) => {
            //     event.preventDefault();
            //     await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            //         {
            //             name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-recipe`),
            //             src: "icons/sundries/documents/document-torn-diagram-tan.webp",
            //             "text.content": null,
            //             flags: {
            //                 [MODULE_ID]: {
            //                     type: "recipe",
            //                     results: [],
            //                     "element.craft": [],
            //                     ...DEFAULT_RECIPE_DATA,
            //                 },
            //             },
            //         },
            //     ]);
            //     this.needRefresh = true;
            //     await this.render(true);
            // });
            // html.querySelector("button[name='configure-panel']").addEventListener("click", async (event) => {
            //     event.preventDefault();
            //     await this.configure();
            // });
            html.querySelectorAll(".craft-panel-tittle > i").forEach((icon) => {
                icon.addEventListener("click", this.changePanelSize.bind(this));
            });

            html.querySelector(".craft-recipes-panel").addEventListener("drop", this._onDropResipesPanel.bind(this));
            html.querySelectorAll(".craft-recipe").forEach((recipe) => {
                recipe.addEventListener("contextmenu", async (event) => {
                    // 编辑模式下，右键点击配方可以删除配方
                    event.preventDefault();
                    const pageUuid = recipe.dataset.uuid;
                    const page = await fromUuid(pageUuid);
                    await page.deleteDialog();
                    this.needRefresh = true;
                    await this.render(true);
                });
                recipe.addEventListener("click", async (event) => {
                    // 编辑模式下，点击配方可以编辑配方
                    event.preventDefault();
                    const recipeJEUuid = recipe.dataset.uuid;
                    await this.editRecipe(recipeJEUuid);
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
        }
        // html.querySelector("button[name='close']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     this.close();
        // });
        html.querySelectorAll(".craft-slot").forEach((slot) => {
            const isEmpty = slot.classList.contains("empty");
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

        });
        html.querySelector(".craft-slot-panel").addEventListener("drop", this._onDropSlotPanel.bind(this));
        //滚动事件，记录滚动位置
        html.querySelector(".craft-materials-panel").addEventListener("scrollend", (event) => { this.scrollPositions.materials = event.target.scrollTop; });
        html.querySelector(".craft-recipes-panel").addEventListener("scrollend", (event) => { this.scrollPositions.recipes = event.target.scrollTop; });
        debug("CraftPanelBlend _onRender : html", html);
    }

    /**
     * 配置界面
     */
    async configure() {
        const fb = new Portal.FormBuilder()
            .object(this.journalEntry)
            .title(game.i18n.localize(`${MODULE_ID}.configure`) + ": " + this.journalEntry.name)
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .select({ name: `flags.${MODULE_ID}.shape`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.default`), ...CraftPanelBlend.SHAPE_STYLE } })
            .file({ name: `flags.${MODULE_ID}.background`, type: "image", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.background-image`) })
            .checkbox({ name: `flags.${MODULE_ID}.unlockRecipe`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-recipe`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-recipe-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.mergeByName`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.merge-by-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.merge-by-name-hint`) })
            .select({ name: `flags.${MODULE_ID}.showResult`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.show-result`), options: { "none": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.not-show`), "show": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.show`), "question mark": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.question-mark`) }, hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.show-result-hint`) })
            .tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-requirements-tab`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements-hint`), options: { ...CraftPanelBlend.REQUIREMENTS_TYPE_OPTIONS } })
            .text({ name: `flags.${MODULE_ID}.requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements-name-hint`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
            .textArea({ name: `flags.${MODULE_ID}.requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.panel-requirements-script-hint`) })
            .tab({ id: "scripts", icon: "fa-solid fa-code", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-scripts-tab`) })
            .textArea({ name: `flags.${MODULE_ID}.craft-pre-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-pre-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-pre-script-hint`) })
            .textArea({ name: `flags.${MODULE_ID}.craft-post-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-post-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-post-script-hint`) })

        const data = await fb.render();
        debug("CraftPanelBlend configure : data", data);
        if (!data) return;
        await this.journalEntry.update(data);
        this.needRefresh = true;
        await this.render(true);
    }

    async changePanelSize(event) {
        const name = event.currentTarget.dataset.name;
        const fb = new Portal.FormBuilder()
            .object(this.panelSizes[name])
            .title(game.i18n.localize(`${MODULE_ID}.change-panel-size`))
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
        debug("CraftPanelBlend _onDrop : data", data);
        if (data.type !== "Item") return;
        const index = parseInt(event.currentTarget.dataset.index);
        const item = await fromUuid(data.uuid);
        debug("CraftPanelBlend _onDrop : index item", index, item);
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
        debug("CraftPanelBlend _onDropSlotPanel : data", data);
        if (data.type == "CraftSlot") {
            const position = { unlock: true, x: event.offsetX, y: event.offsetY };
            const slotUuid = this.slots[data.index].uuid;
            const slot = await fromUuid(slotUuid);
            debug("CraftPanelBlend _onDropSlotPanel : slot", slot);
            const size = slot.getFlag(MODULE_ID, "size");
            position.x -= size / 2;
            position.y -= size / 2;
            await slot.setFlag(MODULE_ID, "position", position);
            debug("CraftPanelBlend _onDropSlotPanel : position size event.offsetXY", position, size, { x: event.offsetX, y: event.offsetY });
            await this.render(true);
        } else if (data.type == "Item") {
            for (let i = 0; i < this.slots.length; i++) {
                if (!this.slots[i].isLocked && (this.slotItems[i] === null || this.slotItems[i] === undefined)) {
                    debug("CraftPanelBlend _onDropSlotPanel : i this.slots[i] this.slotItems[i]", i, this.slots[i], this.slotItems[i]);
                    const item = await fromUuid(data.uuid);
                    debug("CraftPanelBlend _onClickSlot : item", item);
                    await this.addIngredient(i, item);
                }
            }
        }
    }
    async _onDropResipesPanel(event) {
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelBlend _onDropResipesPanel : data", data);
        if (data.type !== "Item" && data.type !== "RollTable") return;
        const item = await fromUuid(data.uuid);
        debug("CraftPanelBlend _onDropResipesPanel : item", item);
        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: item.name,
                src: item.img,
                "text.content": foundry.utils.getProperty(item, this.descriptionPath) ?? item.system?.description ?? item.description ?? "",
                flags: {
                    [MODULE_ID]: {
                        type: "recipe",
                        results: [{ uuid: item.uuid, quantity: 1, img: item.img, name: item.name, type: data.type }],
                        ...DEFAULT_RECIPE_DATA,
                    },
                },
            },
        ]);
        this.needRefresh = true;
        await this.render(true);
    }
    /**
     * 处理单击槽位中的物品事件
     * @param {Event} event 
     */
    async _onClickSlot(event) {
        event.preventDefault();
        const index = parseInt(event.currentTarget.dataset.index);
        const isEmpty = event.currentTarget.classList.contains("empty");
        debug("CraftPanelBlend _onClickSlot : index isEmpty", index, isEmpty);
        if (isEmpty) {
            return;
        } else {
            await this.removeIngredient(index);
        }
    }
    async _onClickCategory(event) {
        const category = event.currentTarget.dataset.category;
        const type = event.currentTarget.dataset.type;
        debug("CraftPanelBlend _onClickCategory : category type", category, type);
        if (this.isEdit && category === "add") {
            await this.addCategory(type);
        } else {
            await this.changeCategory(category, type);
        }
    }
    //移除槽位中的物品
    async removeIngredient(index) {
        debug("CraftPanelBlend removeIngredient : index this.slotItems[index]", index, this.slotItems[index]);
        let material = this.materials.find(m => m.uuid == this.slotItems[index]?.uuid);
        if (material) {
            material.quantity++;
        }
        debug("CraftPanelBlend removeIngredient : material", material);
        this.slotItems[index] = null;
        await this.refreshElements();
    }
    //添加物品到槽位中
    async addIngredient(index, item) {
        debug("CraftPanelBlend addIngredient : index item this.slotItems[index]", index, item, this.slotItems[index]);
        if (await this.checkAdd(index, item)) {
            const data = {
                uuid: item.uuid,
                name: item.name,
                img: item.img,
                elements: item.getFlag(MODULE_ID, "element") ?? [],
                itemColor: item ? getItemColor(item) ?? "" : "",
            }
            this.slotItems[index] = data;
            debug("CraftPanelBlend addIngredient : data this.slotItems", data, this.slotItems);
            let material = this.materials.find(m => m.uuid == item.uuid);
            if (material) {
                material.quantity--;
            }
            debug("CraftPanelBlend addIngredient : material", material);
            await this.refreshElements();
        }
    }
    /**
     * 刷新元素和结果
     */
    async refreshElements() {
        this.elements = [];
        this.results = [];
        Object.entries(this.slotItems).forEach(([index, data]) => {
            if (data) {
                let elements = data.elements;
                for (let el of elements) {
                    let element = this.elements.find(e => e.id == el.id);
                    if (element) {
                        element.num += el.num;
                    } else {
                        this.elements.push(JSON.parse(JSON.stringify(el)));
                    }
                }
            }
        });
        //按元素数量排序
        this.elements.sort((a, b) => b.num - a.num);
        debug("CraftPanelBlend refreshElements : this.elements", this.elements);
        const showResult = this.journalEntry.getFlag(MODULE_ID, "showResult");
        debug("CraftPanelBlend refreshElements : showResult", showResult);
        if ((showResult === "show" || showResult === "question mark") && this.checkSlot()) {
            let recipes = await this.matchRecipe();
            debug("CraftPanelBlend refreshElements : recipes", recipes);
            if (recipes.length > 0) {
                if ((recipes.length > 1) || (showResult === "question mark")) {
                    this.results.push({
                        name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unknown-result`),
                        img: "icons/magic/symbols/question-stone-yellow.webp",
                        empty: "empty",
                        slotIndex: 0
                    });
                } else {
                    (recipes[0].getFlag(MODULE_ID, "results") ?? []).forEach(async (re, i) => {
                        const item = await fromUuid(re.uuid);
                        const itemColor = re.type == "Item" ? getItemColor(item) ?? "" : "";
                        this.results.push({
                            name: item?.name ?? re.name,
                            img: item?.img ?? re.img,
                            quantity: re.quantity,
                            uuid: re.uuid,
                            empty: "",
                            itemColor,
                            slotIndex: i
                        });
                    });
                }
                debug("CraftPanelBlend refreshElements : this.results", this.results);
            }
        }
        await this.render(true);
    }
    //刷新材料面板
    async refreshPanel() {
        //记录之前选中的分类
        let recipe_category = this.recipe_categories.find(c => c.choosed)?.id;
        let material_category = this.material_categories.find(c => c.choosed)?.id;
        debug("CraftPanelBlend refreshPanel : recipe_category material_category", recipe_category, material_category);
        //刷新分类
        this.recipe_categories = JSON.parse(JSON.stringify(this.journalEntry.getFlag(MODULE_ID, "recipe-categories") ?? []));
        this.material_categories = JSON.parse(JSON.stringify(this.journalEntry.getFlag(MODULE_ID, "material-categories") ?? []));
        this.recipe_categories.unshift({
            id: "all",
            name: MODULE_ID + ".all",
            icon: "modules/craftpanel/img/svgs/stack.svg",
            choosed: true,
        });
        this.material_categories.unshift({
            id: "all",
            name: `${game.i18n.localize(MODULE_ID + ".all")}`,
            icon: "modules/craftpanel/img/svgs/stack.svg",
            choosed: true,
        });
        debug("CraftPanelBlend refreshPanel : this.recipe_categories this.material_categories", this.recipe_categories, this.material_categories);
        if (this.isEdit) {
            //在编辑模式下，将新增按钮添加到最后
            this.recipe_categories.push({
                id: "add",
                name: `${MODULE_ID}.${this.APP_ID}.new-category`,
                icon: "modules/craftpanel/img/svgs/health-normal.svg",
                choosed: false,
            });
            this.material_categories.push({
                id: "add",
                name: `${game.i18n.localize(MODULE_ID + "." + this.APP_ID + ".new-category")}`,
                icon: "modules/craftpanel/img/svgs/health-normal.svg",
                choosed: false,
            });
        }
        //恢复之前选中的分类
        if (recipe_category && this.recipe_categories.find(c => c.id == recipe_category)) {
            this.recipe_categories.map(c => c.choosed = false);
            this.recipe_categories.find(c => c.id == recipe_category).choosed = true;
        }
        if (material_category && this.material_categories.find(c => c.id == material_category)) {
            this.material_categories.map(c => c.choosed = false);
            this.material_categories.find(c => c.id == material_category).choosed = true;
        }
        debug("CraftPanelBlend refreshPanel : this.recipe_categories this.material_categories", this.recipe_categories, this.material_categories);
        //记录当前选中的分类
        recipe_category = this.recipe_categories.find(c => c.choosed)?.id;
        material_category = this.material_categories.find(c => c.choosed)?.id;
        debug("CraftPanelBlend refreshPanel : recipe_category material_category", recipe_category, material_category);
        //刷新配方
        let unlockedRecipes = game.user.getFlag(MODULE_ID, "unlockedRecipes") ?? [];
        let recipesJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "recipe").sort((a, b) => (a.sort - b.sort));
        if (!this.isEdit && !game.user.isGM) {
            //真实可以匹配到的配方-不需要考虑顺序
            this.recipesJE = [];
            //显示的配方-需要考虑顺序
            recipesJE = await Promise.all(recipesJE.map(async r => {
                let canShow = false; //是否可以显示
                let canUse = true; //是否可以匹配
                if (r.ownership[game.user.id] == 0) {
                    canUse = false;
                } else if (r.ownership[game.user.id] >= 2) {
                    canShow = true;
                }
                let unlockConfig = unlockedRecipes.find(el => el.id == r.id);
                if (unlockConfig) {
                    if (unlockConfig.ownership == DEFAULT_OWNERSHIP[canShow]) {
                        canShow = true;
                    } else if (unlockConfig.ownership == DEFAULT_OWNERSHIP[canUse]) {
                        canUse = true;
                    }
                }
                if (r.getFlag(MODULE_ID, "isLocked")) {
                    canShow = false;
                    canUse = false;
                }
                const unlockCondition = r.getFlag(MODULE_ID, "unlockCondition");
                if (unlockCondition && unlockCondition.trim() != "") {
                    const fn = new AsyncFunction("actor", "game", "recipe", "panel", unlockCondition);
                    let result = undefined;
                    try {
                        result = await fn(this.actor ?? game?.user?.character, game, r, this.journalEntry);
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                    if (result === false || result == 'false') {
                        canShow = canUse = false;
                    } else if (result === true || result == 'true' || result == 'show') {
                        canShow = canUse = true;
                    } else if (result == 'unlock') {
                        canUse = true;
                    }
                }
                if (canUse) {
                    this.recipesJE.push(r);
                }
                return canShow ? r : null;
            }));
            recipesJE = recipesJE.filter(r => r !== null);
        } else {
            this.recipesJE = recipesJE;
        }
        debug("CraftPanelBlend refreshPanel : recipesJE", recipesJE);
        if (recipe_category != "all") {
            // recipesJE = recipesJE.filter(r => r.getFlag(MODULE_ID, "category") == recipe_category);
            recipesJE = recipesJE.filter(r => (r.getFlag(MODULE_ID, "category") ?? []).includes(recipe_category));
        }
        this.recipes = await Promise.all(recipesJE.map(async (je, i) => {
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
            let tooltip = await TextEditor.enrichHTML(`<figure><img src='${je.src}'><h1>${je.name}</h1></figure><div class="description">${je.text.content ?? ""}</div>`);
            return {
                id: je.id,
                name: je.name,
                image: je.src,
                index: i,
                uuid: je.uuid,
                ingredients: ingredients,
                tooltip,
            };
        }));
        debug("CraftPanelBlend refreshPanel : this.recipes", this.recipes);
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
        debug("CraftPanelBlend refreshPanel : requirements", requirements);
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
        debug("CraftPanelBlend refreshPanel : categoryRequirements", categoryRequirements);
        if (this.actor) {
            // materials = await Promise.all(this.actor.items.filter(async i => { return await checkItemRequirements(i, requirements) }));
            materials_items = this.actor.items.contents;
        } else {
            // materials = await Promise.all(game.items.filter(async i => { return await checkItemRequirements(i, requirements) }));
            materials_items = game.items.contents;
        }
        this.materials = [];
        for (let i = 0; i < materials_items.length; i++) {
            const item = materials_items[i];
            if (await checkItemRequirements(item, requirements) && (material_category == "all" || await checkItemRequirements(item, categoryRequirements))) {
                const elements = item.getFlag(MODULE_ID, "element") ?? [];
                const itemColor = item ? getItemColor(item) ?? "" : "";
                let tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h1>${item.name}</h1></figure><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
                let quantity = this.countQuantity(item);
                const showQuantity = (this.actor ?? false) && (typeof quantity === "number");
                let totalElements = 0;
                if (elements.filter(e => e.color != "").length > 0) {
                    totalElements = elements.filter(e => e.color != "").reduce((a, b) => a + b.num, 0);
                } else {
                    totalElements = elements.reduce((a, b) => a + b.num, 0);
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
        this.materials.sort((a, b) => b.totalElements - a.totalElements);
        debug("CraftPanelBlend refreshPanel : this.materials", this.materials);
        this.needRefresh = false;
    }
    //检查能否添加该物品到槽位中
    async checkAdd(index, item) {
        debug("CraftPanelBlend checkAdd : index item this.slots[index] this.actor", index, item, this.slots[index], this.actor);
        if (!item) return false;
        if (this.slots[index].isLocked) return false;
        if (this.actor) {
            //检查数量
            let quantity = this.countQuantity(item);
            debug("CraftPanelBlend checkAdd : quantity", quantity);
            if (quantity === undefined) {
                if (Object.values(this.slotItems).some(data => data.uuid === item.uuid)) {
                    return false;
                }
            } else if (quantity <= 0) {
                return false;
            }
        }
        //检查槽位要求
        const slotJE = this.journalEntry.pages.find(p => p.id == this.slots[index].id);
        debug("CraftPanelBlend checkAdd : slotJE", slotJE);
        const config = slotJE.getFlag(MODULE_ID, "requirements") ?? [];
        debug("CraftPanelBlend checkAdd : config", config);
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
            debug("CraftPanelBlend checkAdd : requirements", requirements);
            return await checkItemRequirements(item, requirements);
        }
        return true;
    }
    //检查必需槽位是否已填满
    checkSlot() {
        let slots = this.slots.filter(slot => slot.isNecessary);
        debug("CraftPanelBlend checkSlot : slots", slots);
        return slots.every(slot => this.slotItems[slot.slotIndex] !== null && this.slotItems[slot.slotIndex] !== undefined);
    }
    countQuantity(item) {
        let quantity = foundry.utils.getProperty(item, this.quantityPath);
        debug("CraftPanelBlend countQuantity : item quantity", item, quantity);
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
        debug("CraftPanelBlend countQuantity : quantity", quantity);
        return quantity;
    }

    /**
     * 编辑槽位
     */
    async editSlot(slotJEUuid) {
        const slotJE = await fromUuid(slotJEUuid);
        debug("CraftPanelBlend editSlot : slotJE", slotJE);
        const fb = new Portal.FormBuilder()
            .object(slotJE)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot`) + ": " + slotJE.name)
            .tab({ id: "aspect", icon: "fas fa-image", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-aspect-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: `src`, type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .number({ name: `flags.${MODULE_ID}.size`, label: game.i18n.localize(`${MODULE_ID}.size`), min: 40, max: 160, step: 5 })
            .select({ name: `flags.${MODULE_ID}.shape`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.default`), ...CraftPanelBlend.SHAPE_STYLE } })
            .number({ name: `flags.${MODULE_ID}.hue`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.hue`), min: 0, max: 360, step: 1 })
            .tab({ id: "behavior", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-behavior-tab`) })
            .checkbox({ name: `flags.${MODULE_ID}.isNecessary`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-necessary`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-necessary-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.isConsumed`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-consumed`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-consumed-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.isLocked`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked-hint`) })
            .textArea({ name: `flags.${MODULE_ID}.unlockCondition`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script-hint`) })
            .tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-slot-requirements-tab`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-hint`), options: { ...CraftPanelBlend.REQUIREMENTS_TYPE_OPTIONS } })
            .text({ name: `flags.${MODULE_ID}.requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-name-hint`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
            .textArea({ name: `flags.${MODULE_ID}.requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.slot-requirements-script-hint`) })
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
        debug("CraftPanelBlend editSlot : data", data);
        if (!data) return;
        await slotJE.update(data);
        await this.render(true);
    }
    /**
     * 编辑配方
     */
    async editRecipe(recipeJEUuid) {
        const recipeJE = await fromUuid(recipeJEUuid);
        debug("CraftPanelBlend editRecipe : recipeJE", recipeJE);
        const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelRecipe));
        if (openWindow) openWindow.close();
        else {
            let newWindow = new CraftPanelRecipe(this.journalEntry, recipeJE);
            newWindow.parentPanel = this;
            newWindow.render(true);
        };
    }
    /**
     * 新增类别配置
     */
    async addCategory(type) {
        debug("CraftPanelBlend addCategory : type", type);
        const defaultData = {
            id: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-category`),
            name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-category`),
            icon: "icons/svg/barrel.svg",
        }
        const fb = new Portal.FormBuilder()
            .object(defaultData)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-category`))
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "icon", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })

        if (type == "material") {
            fb.tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-requirements-tab`) })
                .multiSelect({ name: `requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-hint`), options: { ...CraftPanelBlend.REQUIREMENTS_TYPE_OPTIONS } })
                .text({ name: `requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-name-hint`) })
                .multiSelect({ name: `requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
                .textArea({ name: `requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-script-hint`) })
        }
        const data = await fb.render();
        debug("CraftPanelBlend addCategory : data", data);
        if (!data) return;
        data.id = data.name;
        let categories = this.journalEntry.getFlag(MODULE_ID, type + "-categories") ?? [];
        categories.push(data);
        debug("CraftPanelBlend addCategory : categories", categories);
        await this.journalEntry.setFlag(MODULE_ID, type + "-categories", categories);
        this.needRefresh = true;
        await this.render(true);
    }
    async changeCategory(category, type) {
        debug("CraftPanelBlend changeCategory : category type", category, type);
        if (type == "material") {
            let index = this.material_categories.findIndex(el => el.id == category);
            if (index >= 0) {
                if (!this.material_categories[index].choosed) {
                    this.material_categories.forEach(el => el.choosed = false);
                    this.material_categories[index].choosed = true;
                    debug("CraftPanelBlend changeCategory : this.material_categories", this.material_categories);
                    this.needRefresh = true;
                    await this.render(true);
                }
            }
        } else if (type == "recipe") {
            let index = this.recipe_categories.findIndex(el => el.id == category);
            if (index >= 0) {
                if (!this.recipe_categories[index].choosed) {
                    this.recipe_categories.forEach(el => el.choosed = false);
                    this.recipe_categories[index].choosed = true;
                    debug("CraftPanelBlend changeCategory : this.recipe_categories", this.recipe_categories);
                    this.needRefresh = true;
                    await this.render(true);
                }
            }
        }
    }
    async editCategory(category, type) {
        debug("CraftPanelBlend editCategory : category type", category, type);
        let categories = this.journalEntry.getFlag(MODULE_ID, type + "-categories") ?? [];
        let index = categories.findIndex(el => el.id == category);
        debug("CraftPanelBlend editCategory : index categories", index, categories);
        if (!categories[index]) {
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.objectNotFound`) + " : " + category);
            return;
        }
        let needDelete = false;
        const fb = new Portal.FormBuilder()
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
                .multiSelect({ name: `requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-hint`), options: { ...CraftPanelBlend.REQUIREMENTS_TYPE_OPTIONS } })
                .text({ name: `requirements-name`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-name-hint`) })
                .multiSelect({ name: `requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
                .textArea({ name: `requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.category-requirements-script-hint`) })
        }
        const data = await fb.render();
        debug("CraftPanelBlend editCategory : data needDelete", data, needDelete);
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
        debug("CraftPanelBlend editCategory : categories", categories);
        await this.journalEntry.setFlag(MODULE_ID, type + "-categories", categories);
        this.needRefresh = true;
        await this.render(true);
    }

    //匹配配方
    async matchRecipe() {
        let recipes = [];
        this.recipesJE.forEach(recipe => {
            let ingredients = recipe.getFlag(MODULE_ID, "ingredients") ?? [];
            let elements = ingredients.filter(el => el.type == "element");
            let materials = ingredients.filter(el => el.type == "material");
            debug("CraftPanelBlend matchRecipe : recipe ingredients elements materials", recipe, ingredients, elements, materials);
            let slotMaterials = [];
            //将材料整理成类似元素的格式
            Object.values(this.slotItems).forEach(data => {
                if (data) {
                    if (slotMaterials.some(el => el.name == data.name)) {
                        slotMaterials.find(el => el.name == data.name).num++;
                    } else {
                        slotMaterials.push({
                            num: 1,
                            id: data.name,
                        });
                    }
                }
            });
            debug("CraftPanelBlend matchRecipe : slotMaterials", slotMaterials);
            //只有元素和材料需求都匹配时才能匹配到配方
            if (checkCraftElements(this.elements, elements) && checkCraftElements(slotMaterials, materials)) {
                //计算匹配度
                let match = 0;
                if (elements.length > 0) {
                    match = checkCraftElementsMatch(this.elements, elements) * 10;
                    //取元素成分最大的元素为主元素，增加额外的匹配度
                    let mainElement = this.elements.filter(el => el.num == this.elements[0].num);
                    match += checkCraftElementsMatch(mainElement, elements);
                }
                //材料的匹配度效力更大
                if (materials.length > 0) {
                    match += checkCraftElementsMatch(slotMaterials, materials) * 100;
                }
                //没有任何指定材料和元素时，匹配度为最小值
                if (elements.length == 0 && materials.length == 0) {
                    match = Number.MIN_SAFE_INTEGER;
                }
                recipes.push({
                    recipe: recipe,
                    match: match
                });
            }
        });
        debug("CraftPanelBlend matchRecipe : recipes", recipes);
        //按匹配度排序，取最高匹配度的配方
        recipes.sort((a, b) => b.match - a.match);
        recipes = recipes.filter(el => el.match == recipes[0].match);
        recipes = recipes.map(el => el.recipe);
        debug("CraftPanelBlend matchRecipe : recipes", recipes);
        return recipes;
    }
    /**
     * 合成物品
     */
    async craft() {
        if (!this.checkSlot()) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.must-fill-necessary-slot`));
            return false
        };
        let preScript = this.journalEntry.getFlag(MODULE_ID, "craft-pre-script");
        let postScript = this.journalEntry.getFlag(MODULE_ID, "craft-post-script");
        debug("CraftPanelBlend craft : preScript postScript", preScript, postScript);
        let materials = [];
        let results = [];
        let selectedRecipe = undefined;
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
        debug("CraftPanelBlend craft : materials", materials);
        //执行预处理脚本
        if (preScript && preScript.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "recipes", "elements", "materials", "canceled", preScript);
            try {
                await fn(this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, this.canceled);
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }
        debug("Hooks.call craftPanelBlendPre", this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, this.canceled);
        await Hooks.call("craftPanelBlendPre", this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, this.canceled);
        //匹配配方
        let recipes = await this.matchRecipe();
        debug("CraftPanelBlend craft : recipes", recipes);
        if (recipes.length > 0) {
            if (recipes.length == 1) {
                selectedRecipe = recipes[0];
            } else {
                //根据权重随机选择一个配方
                let weights = recipes.map(recipe => recipe.getFlag(MODULE_ID, "weight") ?? 100);
                let totalWeight = weights.reduce((a, b) => a + b, 0);
                let randomWeight = Math.random() * totalWeight;
                let cumulativeWeight = 0;
                debug("CraftPanelBlend craft : totalWeight randomWeight", totalWeight, randomWeight);
                for (let i = 0; i < recipes.length; i++) {
                    cumulativeWeight += weights[i];
                    if (randomWeight < cumulativeWeight) {
                        selectedRecipe = recipes[i];
                        break;
                    }
                }
            }
            debug("CraftPanelBlend craft : selectedRecipe", selectedRecipe);
            //获取配方结果
            let jeResults = selectedRecipe.getFlag(MODULE_ID, "results") ?? [];
            debug("CraftPanelBlend craft : jeResults", jeResults);
            for (let re of jeResults) {
                const item = await fromUuid(re.uuid);
                debug("CraftPanelBlend craft : item re", item, re);
                if (item) {
                    if (re.type == "Item") {
                        results.push({
                            item: item.toObject(),
                            quantity: re.quantity,
                            uuid: re.uuid
                        })
                    } else if (re.type == "RollTable") {
                        //处理随机表类型的结果
                        for (let j = 0; j < re.quantity; j++) {
                            const object = await item.roll();
                            debug("CraftPanelBlend craft : object", object);
                            for (const r of object.results) {
                                let uuid = r.documentCollection + "." + r.documentId;
                                debug("CraftPanelBlend craft : r uuid", r, uuid);
                                if (r.documentCollection !== "Item") {
                                    const parts = r.documentCollection.split(".");
                                    if (parts.length < 2) {
                                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.tableNotValid`) + r.name);
                                        this.canceled = true;
                                        return false;
                                    }
                                    uuid = "Compendium." + uuid;
                                }
                                const resultItem = await fromUuid(uuid);
                                debug("CraftPanelBlend craft : resultItem", resultItem);
                                if (!resultItem) {
                                    // @ts-ignore
                                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.tableItemNotFound`) + r.name);
                                    this.canceled = true;
                                    return false;
                                }
                                let result = results.find(r => r.uuid == uuid);
                                debug("CraftPanelBlend craft : result", result);
                                if (result) {
                                    result.quantity++;
                                } else {
                                    results.push({
                                        item: resultItem.toObject(),
                                        quantity: 1,
                                        uuid: uuid
                                    });
                                }
                            }
                        }
                    }
                } else {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.itemNotFound`) + re.name + " " + re.uuid);
                    this.canceled = true;
                }
            }
            debug("CraftPanelBlend craft : results", results);
            //执行配方的脚本
            let craftScript = selectedRecipe.getFlag(MODULE_ID, "craftScript");
            if (craftScript && craftScript.trim() != "") {
                const fn = new AsyncFunction("data", "panel", "actor", "recipes", "elements", "materials", "recipe", "results", "canceled", craftScript);
                try {
                    await fn(this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, selectedRecipe, results, this.canceled);
                } catch (e) {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                    console.error(e);
                }
            }
            debug("Hooks.call craftPanelBlendRecipe", this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, selectedRecipe, results, this.canceled);
            await Hooks.call("craftPanelBlendRecipe", this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, selectedRecipe, results, this.canceled);
        }
        //结算结果
        if (this.actor) {
            const updates = {};
            const toDelete = {};
            const products = [];
            let mergeByName = this.journalEntry.getFlag(MODULE_ID, "mergeByName") ?? false;
            if (selectedRecipe && selectedRecipe.getFlag(MODULE_ID, "mergeByName") != undefined) {
                if (selectedRecipe.getFlag(MODULE_ID, "mergeByName") == "yes") {
                    mergeByName = true;
                } else if (selectedRecipe.getFlag(MODULE_ID, "mergeByName") == "no") {
                    mergeByName = false;
                }
            }
            debug("CraftPanelBlend craft : mergeByName", mergeByName);
            if (mergeByName) {
                results.forEach(r => {
                    let item = this.actor.items.find(i => i.name == r.item.name);
                    if (item) {
                        if (foundry.utils.getProperty(item, this.quantityPath)) {
                            updates[this.actor.id] ??= { parent: this.actor, items: [] };
                            updates[this.actor.id].items.push({
                                _id: item.id,
                                [this.quantityPath]: foundry.utils.getProperty(item, this.quantityPath) + r.quantity
                            });
                        }
                    } else {
                        if (foundry.utils.getProperty(r.item, this.quantityPath) != undefined) {
                            foundry.utils.setProperty(r.item, this.quantityPath, r.quantity);
                        }
                        products.push(r.item);
                    }
                });
            } else {
                results.forEach(r => {
                    if (foundry.utils.getProperty(r.item, this.quantityPath) != undefined) {
                        foundry.utils.setProperty(r.item, this.quantityPath, r.quantity);
                    }
                    products.push(r.item);
                });
            }
            debug("CraftPanelBlend craft : updates products", updates, products);

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
                        //处理当合成结果既是材料又是产品，同时还开启了合并名称时的特殊情况
                        if (mergeByName && updates[this.actor.id] && (parent.id == this.actor.id)) {
                            findItem = updates[this.actor.id].items.find(i => i._id == item.id);
                            if (findItem) {
                                newQuantity = parseFloat(findItem[this.quantityPath]) - quantity;
                            }
                        }
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

            debug("CraftPanelBlend craft : updates toDelete products canceled", updates, toDelete, products, canceled);
            if (!this.canceled) {
                // await this.actor.updateEmbeddedDocuments("Item", updates);
                await this.actor.createEmbeddedDocuments("Item", products);
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
                    message += `<li><img src="${el.item.img}" style="vertical-align:middle" width="24" height="24"> ${el.item.name} x${el.quantity}</li>`;
                });
                message += "</ul></li></ul>";
                await chatMessage(message, { img: this.journalEntry.src, title: `${this.journalEntry.name} - ${game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-results`)}`, speaker: this.actor });
            }
        } else if (!this.canceled) {
            const folder = await getFolder(this.journalEntry.name, 'Item');
            debug("CraftPanelBlend craft : results folder", results, folder);
            await Item.createDocuments(results.map(r => {
                r.item.folder = folder;
                return r.item;
            }));
        }
        //解锁配方
        debug("CraftPanelBlend craft : selectedRecipe canceled game.user.isGM this.journalEntry.getFlag(MODULE_ID, unlockRecipe)", selectedRecipe, canceled, game.user.isGM, this.journalEntry.getFlag(MODULE_ID, "unlockRecipe"));
        if (selectedRecipe && !canceled && !game.user.isGM && this.journalEntry.getFlag(MODULE_ID, "unlockRecipe")) {
            // if ((selectedRecipe.ownership?.[game.user.id] ?? selectedRecipe.ownership?.default ?? -1) <= 0) {
            //     if (getActiveGM()) {
            //         await Socket.executeAsGM("updateDocument", selectedRecipe.uuid, { "ownership": { [game.user.id]: 2 } });
            //     } else {
            //         ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.noGM`));
            //     }
            // }
            let unlockedRecipes = game.user.getFlag(MODULE_ID, "unlockedRecipes") ?? [];
            if (!unlockedRecipes.some(el => el.id == selectedRecipe.id)) {
                unlockedRecipes.push({ id: selectedRecipe.id, name: selectedRecipe.name, img: selectedRecipe.src, ownership: DEFAULT_OWNERSHIP["canShow"] });
                await game.user.setFlag(MODULE_ID, "unlockedRecipes", unlockedRecipes);
            }
        }
        //执行后处理脚本
        if (postScript && postScript.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "recipes", "elements", "materials", "recipe", "results", "canceled", postScript);
            try {
                await fn(this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, selectedRecipe, results, this.canceled);
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }
        debug("Hooks.call craftPanelBlendPost", this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, selectedRecipe, results, this.canceled);
        await Hooks.call("craftPanelBlendPost", this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, selectedRecipe, results, this.canceled);
        this.slotItems = {};
        this.elements = [];
        this.results = results.length <= 0 ? [] : results.map((re, i) => {
            const itemColor = getItemColor(re?.item) ?? "";
            return {
                name: re?.item?.name ?? this.recipesJE.name,
                img: re?.item?.img ?? this.recipesJE.src,
                quantity: re?.quantity ?? 1,
                uuid: re.uuid,
                empty: "",
                itemColor,
                slotIndex: i
            }
        });
        this.needRefresh = true;
        await this.render(true);
        return results;
    }

    async newRecipe(event) {
        event.preventDefault();
        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-recipe`),
                src: "icons/sundries/documents/document-torn-diagram-tan.webp",
                "text.content": null,
                flags: {
                    [MODULE_ID]: {
                        type: "recipe",
                        results: [],
                        "element.craft": [],
                        ...DEFAULT_RECIPE_DATA,
                    },
                },
            },
        ]);
        this.needRefresh = true;
        await this.render(true);
    }
    async configUserUnlocked(event) {
        event.preventDefault();
        //配置用户解锁的配方
        const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelUserRecipe));
        if (openWindow) openWindow.close();
        else {
            let newWindow = new CraftPanelUserRecipe(this.journalEntry);
            newWindow.parentPanel = this;
            newWindow.render(true);
        };
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
 * @typedef {Object} CraftElement
 * @property {string} id - 元素的id，为对应物品的id（非uuid）。用于检测是否为同一元素，可以通过名称与图标相同但id不同的元素实现“虚假”属性。
 * @property {string} name - 元素的名称，为对应物品的名称。仅用于显示。
 * @property {string} img - 元素的图标，为对应物品的图标。仅用于显示。
 * @property {string} type - 需求原料的类型，仅用于配方保存的需求。
 * @property {string} class - 元素的类型，仅用于脚本检测。
 * @property {string} color - 元素的颜色，为对应图标的颜色。仅用于显示。
 * @property {number} num - 仅成分元素使用，为元素的数量。用于显示作为合成素材时提供的元素数量。
 * @property {boolean} useMin - 仅需求元素使用，为是否使用最小数量。
 * @property {number} min - 仅需求元素使用，为元素的最小数量。用于显示合成时最少需要的元素数量。
 * @property {boolean} useMax - 仅需求元素使用，为是否使用最大数量。
 * @property {number} max - 仅需求元素使用，为元素的最大数量。用于显示合成时最多需要的元素数量。
 */
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
        return !el2 || (el.useMin && el2.num < el.min) || (el.useMax && el2.num > el.max);
    }));
}
/**
 * 检查当前元素与需求元素的匹配程度
 * 实际为检查当前元素中相比于需求元素多出来的元素种类和数量
 * 当前元素中每比需求元素多一种元素，匹配程度-1
 * 对于有最小值要求的元素，匹配度为最小值乘以100
 * 对于仅有最大值要求的元素，每有一个，匹配程度-1
 * @param {CraftElement[]} elements 当前元素
 * @param {CraftElement[]} craftElements 需求元素
 * @returns {number} 冗余程度，越小越匹配
 */
function checkCraftElementsMatch(elements, craftElements) {
    let match = 0;
    for (let el of elements) {
        let el2 = craftElements.find((el3) => el3.id === el.id);
        if (!el2) match -= 1;
        if (el2?.useMin) match += el2.min * 10;
        if (el2?.useMax && !el.useMin) match -= el.num;
    }
    return match;
}