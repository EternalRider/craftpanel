import { HandlebarsApplication, getItemColor, MODULE_ID, debug } from "../utils.js";

export class CraftPanelModifier extends HandlebarsApplication {
    constructor(journalEntry, journalEntryPage) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        if (typeof journalEntryPage === "string") journalEntryPage = fromUuidSync(journalEntryPage);
        // this.ingredients = [];
        // this.changes = [];
        this.elementItems = [];
        this.journalEntry = journalEntry;
        this.journalEntryPage = journalEntryPage;
        // this.ingredients = journalEntryPage.getFlag(MODULE_ID, "ingredients") ?? [];
        // this.changes = journalEntryPage.getFlag(MODULE_ID, "changes") ?? [];
        this.ingredients = journalEntryPage.getFlag(MODULE_ID, "ingredients") ? JSON.parse(JSON.stringify(journalEntryPage.getFlag(MODULE_ID, "ingredients"))) : [];
        this.changes = journalEntryPage.getFlag(MODULE_ID, "changes") ? JSON.parse(JSON.stringify(journalEntryPage.getFlag(MODULE_ID, "changes"))) : [];

        this.needRefresh = true;
        this.scrollPositions = {
            elementItems: 0,
            modifiers: 0,
        };

        this.options.actions.edit = this.editModifier.bind(this);
        this.options.actions.configure = this.configure.bind(this);
        this.options.actions.permissions = async (event) => {
            event.preventDefault();
            new DocumentOwnershipConfig(this.journalEntryPage).render(true);
        };
        this.options.actions['new-modifier'] = this.addChange.bind(this);

        this.panelSizes = {
            modifiers: {
                width: 300,
                height: 420,
            },
            elementitems: {
                width: 300,
                height: 420,
            },
            ingredients: {
                width: 300,
                height: 200,
            },
            changes: {
                width: 300,
                height: 170,
            },
        };

        craftPanels ??= [];
        craftPanels.push(this);
        debug("CraftPanelModifier constructor : this journalEntry, journalEntryPage", this, journalEntry, journalEntryPage);
    }

    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID, "craft"],
            tag: "div",
            window: {
                frame: true,
                positioned: true,
                title: `${MODULE_ID}.${this.APP_ID}.title`,
                icon: "fas fa-list-check",
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
        return game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.title`);
    }

    _onClose(options) {
        super._onClose(options);
        craftPanels ??= [];
        craftPanels.splice(craftPanels.indexOf(this), 1);
        if (this.parentPanel) {
            this.parentPanel.needRefresh = true;
            this.parentPanel?.render(true);
        }
    }

    /**
     * 准备界面所需的各项数据
     * @returns {}
     */
    async _prepareContext(options) {
        if (this.needRefresh) {
            await this.refreshPanel();
        }
        const modifiersJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "modifier").sort((a, b) => (a.sort - b.sort));
        debug("CraftPanelModifier _prepareContext : modifiersJE", modifiersJE);
        const modifiers = modifiersJE.map((je, i) => {
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
            return {
                id: je.id,
                name: je.name,
                image: je.src,
                index: i,
                uuid: je.uuid,
                ingredients: ingredients,
                choosed: je.id == this.journalEntryPage.id ? "choosed" : ""
            };
        });
        debug("CraftPanelModifier _prepareContext : modifiers", modifiers);
        this.ingredients.sort((a, b) => {
            if (a.type == "element" && b.type == "material") return 1;
            if (a.type == "material" && b.type == "element") return -1;
            return b.min - a.min;
        });
        const ingredients = this.ingredients.map((el, i) => {
            let num = el.min;
            if (el.useMin && el.useMax) {
                num = `${el.min}/${el.max}`;
            } else if (el.useMax) {
                num = `≤${el.max}`;
            }
            let itemColor = "";
            if (el.type == "material" && el.color) {
                itemColor = el.color;
            }
            return {
                slotIndex: i,
                num: num,
                itemColor: itemColor,
                ...el,
            };
        });
        debug("CraftPanelModifier _prepareContext : ingredients", ingredients);
        // const changes = await Promise.all(this.changes.map(async (el, i) => {
            // const item = await fromUuid(el.uuid);
            // const itemColor = item ? getItemColor(item) ?? "" : "";
            // return {
            //     slotIndex: i,
            //     uuid: el.uuid,
            //     quantity: el.quantity,
            //     name: item?.name ?? el.name,
            //     img: item?.img ?? el.img,
            //     itemColor: itemColor,
            // };
        // }));


        return {
            elementItems: this.elementItems,
            modifiers,
            ingredients: ingredients,
            changes: this.changes,
            panelSizes: this.panelSizes,
        }
    }
    /**
     * 绑定各项元素的互动效果
     * @returns {}
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        debug("CraftPanelModifier _onRender : context", context);
        // 恢复滚动条位置
        html.querySelector(".craft-elementitems-panel").scrollTop = this.scrollPositions.elementItems;
        html.querySelector(".craft-modifiers-panel").scrollTop = this.scrollPositions.modifiers;

        // html.querySelector("button[name='edit']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     this.editModifier();
        // });
        // html.querySelector("button[name='permissions']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     new DocumentOwnershipConfig(this.journalEntryPage).render(true);
        // });
        // html.querySelector("button[name='configure']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     await this.configure();
        // });
        // html.querySelector("button[name='close']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     this.close();
        // });
        // html.querySelector("button[name='new-modifier']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     this.addChange();
        // });
        html.querySelectorAll(".element-slot.elements").forEach((el) => {
            el.addEventListener("dragstart", async (event) => {
                if (el.dataset.inslot != "true") {
                    const item = await fromUuid(el.dataset.uuid);
                    const element = item.getFlag(MODULE_ID, "elementConfig");
                    event.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({
                            type: "CraftElement",
                            uuid: el.dataset.uuid,
                            element: element,
                        }),
                    );
                }
            });
            el.addEventListener("click", (event) => {
                event.preventDefault();
                if (el.dataset.inslot == "true") {
                    this.editNum(el.dataset.index);
                } else {
                    this.addElement(el.dataset.element, el.dataset.uuid);
                }
            });
            el.addEventListener("contextmenu", async (event) => {
                event.preventDefault();
                if (el.dataset.inslot == "true") {
                    this.removeIngredient(el.dataset.index);
                } else {
                    this.removeElement(el.dataset.element, el.dataset.uuid);
                }
            });
        });
        html.querySelectorAll(".craft-slot").forEach((el) => {
            el.addEventListener("click", (event) => {
                event.preventDefault();
                this.editResultNum(el.dataset.index);
            });
            el.addEventListener("contextmenu", async (event) => {
                event.preventDefault();
                this.removeResult(el.dataset.index);
            });
        });
        html.querySelectorAll(".craft-modifier").forEach((modifier) => {
            modifier.addEventListener("dragstart", async (event) => {
                event.dataTransfer.setData(
                    "text/plain",
                    JSON.stringify({
                        type: "CraftModifier",
                        uuid: modifier.dataset.uuid,
                        index: modifier.dataset.index,
                        parent: this.journalEntry.uuid,
                    }),
                );
            });
            modifier.addEventListener("contextmenu", async (event) => {
                // 右键点击配方可以删除配方
                event.preventDefault();
                const pageUuid = modifier.dataset.uuid;
                const pageIndex = modifier.dataset.index;
                const page = await fromUuid(pageUuid);
                await page.deleteDialog();
                const JE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "modifier")[pageIndex];
                if (JE.id == this.journalEntryPage.id) return;
                if (JE) {
                    this.journalEntryPage = JE;
                } else {
                    this.journalEntryPage = this.journalEntry.pages.content[0];
                }
                this.ingredients = this.journalEntryPage.getFlag(MODULE_ID, "ingredients") ? JSON.parse(JSON.stringify(this.journalEntryPage.getFlag(MODULE_ID, "ingredients"))) : [];
                this.changes = this.journalEntryPage.getFlag(MODULE_ID, "changes") ? JSON.parse(JSON.stringify(this.journalEntryPage.getFlag(MODULE_ID, "changes"))) : [];
                await this.render(true);
            });
            modifier.addEventListener("click", async (event) => {
                // 点击配方可以切换配方
                event.preventDefault();
                const pageUuid = modifier.dataset.uuid;
                if (this.journalEntryPage.uuid == pageUuid) return;
                this.journalEntryPage = this.journalEntry.pages.find(p => p.uuid == pageUuid);
                this.ingredients = this.journalEntryPage.getFlag(MODULE_ID, "ingredients") ?? [];
                this.changes = this.journalEntryPage.getFlag(MODULE_ID, "changes") ?? [];
                await this.render(true);
            });
            modifier.addEventListener("drop", this._onDropModifiersPanel.bind(this));
        });
        html.querySelectorAll(".effect-change").forEach((el) => {
            el.addEventListener("click", (event) => {
                event.preventDefault();
                this.editChange(el.dataset.index);
            });
        });
        html.querySelector(".craft-ingredients-panel").addEventListener("drop", this._onDropSlotPanel.bind(this));
        html.querySelector(".craft-changes-panel").addEventListener("drop", this._onDropChangePanel.bind(this));
        html.querySelector(".craft-modifiers-panel").addEventListener("drop", this._onDropModifiersPanel.bind(this));
        //滚动事件，记录滚动位置
        html.querySelector(".craft-elementitems-panel").addEventListener("scrollend", (event) => { this.scrollPositions.elementItems = event.target.scrollTop; });
        html.querySelector(".craft-modifiers-panel").addEventListener("scrollend", (event) => { this.scrollPositions.modifiers = event.target.scrollTop; });
        debug("CraftPanelModifier _onRender : html", html);
    }

    async configure() {
        const modifier_categories = this.journalEntry.getFlag(MODULE_ID, "modifier-categories") ?? [];
        const categoryOptions = {};
        for (const category of modifier_categories) {
            categoryOptions[category.id] = category.name;
        }
        const fb = new Portal.FormBuilder()
            .object(this.journalEntryPage)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-modifier`) + ": " + this.journalEntryPage.name)
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: `src`, type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .number({ name: `sort`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.modifier-sort`) })
            .number({ name: `flags.${MODULE_ID}.cost`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.modifier-cost`) })
            .multiSelect({ name: `flags.${MODULE_ID}.category`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.modifier-category`), options: categoryOptions })
            .checkbox({ name: `flags.${MODULE_ID}.auto`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.auto-apply`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.auto-apply-hint`) })
            .select({ name: `flags.${MODULE_ID}.asAE`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.as-ae`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.as-ae-hint`), options: { "false": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.as-ae-not`), "merge": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.as-ae-merge`), "separate": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.as-ae-separate`) } })
            .text({ name: `flags.${MODULE_ID}.aeName`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.ae-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.ae-name-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.isLocked`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked-hint`) })
            .textArea({ name: `flags.${MODULE_ID}.unlockCondition`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script-hint`) })
            .textArea({ name: `flags.${MODULE_ID}.craftScript`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script-hint`) })
            .button({
                label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-modifier-tooltip-button`),
                callback: async () => {
                    this.journalEntryPage.sheet?.render(true);
                },
                icon: "fas fa-edit",
            })
            .button({
                label: game.i18n.localize(`Delete`),
                callback: async () => {
                    fb.form().close();
                    await this.journalEntryPage.deleteDialog();
                    await this.render(true);
                },
                icon: "fas fa-trash",
            });
        const data = await fb.render();
        debug("CraftPanelModifier configure : data", data);
        if (!data) return;
        if (data.flags[MODULE_ID].asAE == "false") {
            data.flags[MODULE_ID].asAE = false;
        }
        await this.journalEntryPage.update(data);
        this.needRefresh = true;
        await this.render(true);
    }
    async editNum(index) {
        const ingredient = this.ingredients[index];
        const fb = new Portal.FormBuilder()
            .object(ingredient)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-num`))
            .number({ name: "min", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.min`) })
            .checkbox({ name: "useMin", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.use-min`) })
            .number({ name: "max", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.max`) })
            .checkbox({ name: "useMax", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.use-max`) })
            .info(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-num-info`));

        const data = await fb.render();
        debug("CraftPanelModifier editNum : data", data);
        if (!data) return;
        this.ingredients[index].min = data.min;
        this.ingredients[index].useMin = data.useMin;
        this.ingredients[index].max = data.max;
        this.ingredients[index].useMax = data.useMax;
        await this.render(true);
    }
    async editResultNum(index) {
        const result = this.changes[index];
        const fb = new Portal.FormBuilder()
            .object(result)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-num`))
            .number({ name: "quantity", label: game.i18n.localize(`${MODULE_ID}.quantity`) })

        const data = await fb.render();
        debug("CraftPanelModifier editResultNum : data", data);
        if (!data) return;
        this.changes[index].quantity = data.quantity;
        await this.render(true);
    }
    async editModifier() {
        const update = {
            flags: {
                [MODULE_ID]: {
                    ingredients: this.ingredients,
                    changes: this.changes,
                },
            },
        }
        debug("CraftPanelModifier editModifier : update", update);
        await this.journalEntryPage.update(update);
        this.needRefresh = true;
        await this.render(true);
    }

    async _onDropSlotPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelModifier _onDropSlotPanel : data", data);
        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        let element = data?.element;
        if (type == "Item") {
            if (item == undefined) return;
            if (item.getFlag(MODULE_ID, "isElement") === true) {
                element = item.getFlag(MODULE_ID, "elementConfig");
                this.addElement(element, data.uuid);
            } else {
                this.addMaterial(item);
            }
        } else if (type == "CraftElement") {
            if (item != undefined && element == undefined) {
                element = item.getFlag(MODULE_ID, "elementConfig");
            }
            if (element == undefined) return;
            this.addElement(element, data.uuid);
        }
    }
    async _onDropChangePanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelModifier _onDropChangePanel : data", data);
        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        if (type !== "Item" && type !== "ActiveEffect") return;
        if (item) {

        }
    }
    async _onDropModifiersPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelModifier _onDropModifiersPanel : data", data);
        if (data.type !== "CraftModifier") return;
        if (data.parent !== this.journalEntry.uuid) return;
        let targetUuid = event.currentTarget.dataset.uuid;
        let page = await fromUuid(data.uuid);
        if (!page) return;
        let sortTarget;
        if (targetUuid) {
            sortTarget = await fromUuid(targetUuid);
        }
        await page.sortRelative({
            sortKey: "sort",
            target: sortTarget,
            siblings: this.journalEntry.pages.filter(p => p.id !== page.id)
        });
        await this.render(true);
    }

    async addElement(element, uuid) {
        debug("CraftPanelModifier addElement : element uuid", element, uuid);
        if (element == undefined) {
            let item = await fromUuid(uuid);
            element = item.getFlag(MODULE_ID, "elementConfig");
        }
        let el = this.ingredients.find((el) => (el.type == "element") && (el.id == element.id));
        if (el) {
            if (el.useMin) {
                el.min++;
            } else {
                el.max++;
            }
            if (el.useMax && (el.min > el.max)) {
                el.max = el.min;
            }
        } else {
            el = {
                min: 1,
                max: 1,
                uuid: uuid,
                useMin: true,
                useMax: false,
                type: "element",
                ...element,
            };
            this.ingredients.push(el);
        }
        debug("CraftPanelModifier addElement : this.ingredients", this.ingredients);
        await this.render(true);
    }
    async removeElement(element, uuid) {
        debug("CraftPanelModifier removeElement : element uuid", element, uuid);
        if (element == undefined) {
            let item = await fromUuid(uuid);
            element = item.getFlag(MODULE_ID, "elementConfig");
        }
        let el = this.ingredients.find((el) => (el.type == "element") && (el.id == element.id));
        if (el) {
            if (el.useMin) {
                el.min--;
                if (el.min <= 0) {
                    this.ingredients.splice(this.ingredients.indexOf(el), 1);
                }
            } else {
                el.max--;
            }
        }
        debug("CraftPanelModifier removeElement : this.ingredients", this.ingredients);
        await this.render(true);
    }
    async addMaterial(item) {
        debug("CraftPanelModifier addMaterial : item", item);
        if (!item) return;
        let el = this.ingredients.find((el) => (el.type == "material") && (el.name == item.name));
        if (el) {
            if (el.useMin) {
                el.min++;
            } else {
                el.max++;
            }
        } else {
            el = {
                min: 1,
                max: 1,
                uuid: item.uuid,
                useMin: true,
                useMax: false,
                type: "material",
                name: item.name,
                img: item.img,
                id: item.name,
                color: getItemColor(item) ?? "",
            };
            this.ingredients.push(el);
        }
        debug("CraftPanelModifier addMaterial : this.ingredients", this.ingredients);
        await this.render(true);
    }

    async removeIngredient(index) {
        debug("CraftPanelModifier removeIngredient : index this.ingredients", index, this.ingredients);
        this.ingredients.splice(index, 1);
        await this.render(true);
    }
    async removeResult(index) {
        debug("CraftPanelModifier removeResult : index this.changes", index, this.changes);
        this.changes.splice(index, 1);
        await this.render(true);
    }

    async refreshPanel() {
        const elementItems_items = [];
        for (const item of game.items.contents) {
            if (item.getFlag(MODULE_ID, "isElement") === true) {
                elementItems_items.push(item);
            }
        }
        debug("CraftPanelModifier refreshPanel : elementItems_items", elementItems_items);
        this.elementItems = elementItems_items.map((item, i) => {
            const element = item.getFlag(MODULE_ID, "elementConfig");
            return {
                slotIndex: i,
                uuid: item.uuid,
                id: element.id,
                name: element.name,
                img: element.img,
                color: element.color,
                class: element.class,
            };
        });
        this.elementItems.sort((a, b) => { return b.class != a.class ? b.class.localeCompare(a.class) : b.name.localeCompare(a.name) });
        debug("CraftPanelModifier refreshPanel : this.elementItems", this.elementItems);
        this.needRefresh = false;
    }

    async addChange() {
        const fb = new Portal.FormBuilder()
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.add-change`) + ": " + this.journalEntryPage.name)
            .text({ name: "key", label: game.i18n.localize("EFFECT.ChangeKey") })
            .select({ name: "mode", label: game.i18n.localize("EFFECT.ChangeMode"), options: EFFECTCHANGEMOD, value: 2 })
            .text({ name: "value", label: game.i18n.localize("EFFECT.ChangeValue") })
        
        const data = await fb.render();
        debug("CraftPanelModifier addChange : data", data);
        if (!data) return;
        this.changes.push(data);
        await this.render(true);
    }
    async editChange(index) {
        const change = this.changes[index];
        const fb = new Portal.FormBuilder()
            .object(change)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-change`))
            .text({ name: "key", label: game.i18n.localize("EFFECT.ChangeKey") })
            .select({ name: "mode", label: game.i18n.localize("EFFECT.ChangeMode"), options: EFFECTCHANGEMOD })
            .text({ name: "value", label: game.i18n.localize("EFFECT.ChangeValue") })
        
        const data = await fb.render();
        debug("CraftPanelModifier editChange : data", data);
        if (!data) return;
        this.changes[index] = data;
        await this.render(true);
    }
}

const EFFECTCHANGEMOD = {
    0: "EFFECT.MODE_CUSTOM",
    1: "EFFECT.MODE_MULTIPLY",
    2 : "EFFECT.MODE_ADD",
    3 : "EFFECT.MODE_DOWNGRADE",
    4 : "EFFECT.MODE_UPGRADE",
    5 : "EFFECT.MODE_OVERRIDE",
}
/**
 * @typedef {Object} CraftElement
 * @property {string} id - 元素的id，为对应物品的id（非uuid）。用于检测是否为同一元素，可以通过名称与图标相同但id不同的元素实现“虚假”属性。
 * @property {string} name - 元素的名称，为对应物品的名称。仅用于显示。
 * @property {string} img - 元素的图标，为对应物品的图标。仅用于显示。
 * @property {string} type - 需求原料的类型，仅用于配方保存的需求。
 * @property {string} class - 元素的类型，仅用于脚本检测。
 * @property {string} color - 元素的颜色，为对应图标的颜色。仅用于显示。
 * @property {number} weight - 元素的权重，用于计算匹配度。
 * @property {number} num - 仅成分元素使用，为元素的数量。用于显示作为合成素材时提供的元素数量。
 * @property {boolean} useMin - 仅需求元素使用，为是否使用最小数量。
 * @property {number} min - 仅需求元素使用，为元素的最小数量。用于显示合成时最少需要的元素数量。
 * @property {boolean} useMax - 仅需求元素使用，为是否使用最大数量。
 * @property {number} max - 仅需求元素使用，为元素的最大数量。用于显示合成时最多需要的元素数量。
 */