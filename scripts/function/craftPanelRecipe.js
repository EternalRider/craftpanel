import { HandlebarsApplication, getItemColor, debug, MODULE_ID } from "../utils.js";

export class CraftPanelRecipe extends HandlebarsApplication {
    constructor(journalEntry, journalEntryPage) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        if (typeof journalEntryPage === "string") journalEntryPage = fromUuidSync(journalEntryPage);
        // this.ingredients = [];
        // this.results = [];
        this.journalEntry = journalEntry;
        this.journalEntryPage = journalEntryPage;
        // this.ingredients = journalEntryPage.getFlag(MODULE_ID, "ingredients") ?? [];
        // this.results = journalEntryPage.getFlag(MODULE_ID, "results") ?? [];
        this.ingredients = journalEntryPage.getFlag(MODULE_ID, "ingredients") ? JSON.parse(JSON.stringify(journalEntryPage.getFlag(MODULE_ID, "ingredients"))) : [];
        this.results = journalEntryPage.getFlag(MODULE_ID, "results") ? JSON.parse(JSON.stringify(journalEntryPage.getFlag(MODULE_ID, "results"))) : [];

        this.needRefresh = true;
        this.scrollPositions = {
            elementItems: 0,
            recipes: 0,
        };
        
        this.options.actions.edit = this.editRecipe.bind(this);
        this.options.actions.configure = this.configure.bind(this);
        this.options.actions.permissions = async (event) => {
            event.preventDefault();
            new DocumentOwnershipConfig(this.journalEntryPage).render(true);
        };

        this.panelSizes = {
            recipes: {
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
            results: {
                width: 300,
                height: 170,
            },
        };

        craftPanels ??= [];
        craftPanels.push(this);
        debug("CraftPanelRecipe constructor : this journalEntry journalEntryPage this.ingredients this.results craftPanels", this, journalEntry, journalEntryPage, this.ingredients, this.results, craftPanels);
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
        const recipesJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "recipe").sort((a, b) => (a.sort - b.sort));
        debug("CraftPanelRecipe _prepareContext : recipesJE", recipesJE);
        const recipes = recipesJE.map((je, i) => {
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
        debug("CraftPanelRecipe _prepareContext : recipes", recipes);
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
        debug("CraftPanelRecipe _prepareContext : ingredients", ingredients);
        const results = await Promise.all(this.results.map(async (el, i) => {
            const item = await fromUuid(el.uuid);
            const itemColor = item ? getItemColor(item) ?? "" : "";
            let tooltip = await TextEditor.enrichHTML(`<figure><img src='${el.img ?? item?.img}'><h1>${el.name ?? item?.name}</h1></figure><div class="description">${el.description ?? item?.system?.description ?? item?.description ?? ""}</div>`);
            return {
                slotIndex: i,
                uuid: el.uuid,
                quantity: el.quantity,
                name: item?.name ?? el.name,
                img: item?.img ?? el.img,
                itemColor: itemColor,
                tooltip,
            };
        }));
        debug("CraftPanelRecipe _prepareContext : results", results);
        return {
            elementItems: this.elementItems,
            recipes,
            ingredients: ingredients,
            results: results,
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
        debug("CraftPanelRecipe _onRender : context", context);

        // 恢复滚动条位置
        html.querySelector(".craft-elementitems-panel").scrollTop = this.scrollPositions.elementItems;
        html.querySelector(".craft-recipes-panel").scrollTop = this.scrollPositions.recipes;

        // html.querySelector("button[name='edit']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     this.editRecipe();
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
        html.querySelectorAll(".craft-recipe").forEach((recipe) => {
            recipe.addEventListener("dragstart", async (event) => {
                event.dataTransfer.setData(
                    "text/plain",
                    JSON.stringify({
                        type: "CraftRecipe",
                        uuid: recipe.dataset.uuid,
                        index: recipe.dataset.index,
                        parent: this.journalEntry.uuid,
                    }),
                );
            });
            recipe.addEventListener("contextmenu", async (event) => {
                // 右键点击配方可以删除配方
                event.preventDefault();
                const pageUuid = recipe.dataset.uuid;
                const pageIndex = recipe.dataset.index;
                const page = await fromUuid(pageUuid);
                await page.deleteDialog();
                const JE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "recipe")[pageIndex];
                if (JE.id == this.journalEntryPage.id) return;
                if (JE) {
                    this.journalEntryPage = JE;
                } else {
                    this.journalEntryPage = this.journalEntry.pages.content[0];
                }
                this.ingredients = this.journalEntryPage.getFlag(MODULE_ID, "ingredients") ? JSON.parse(JSON.stringify(this.journalEntryPage.getFlag(MODULE_ID, "ingredients"))) : [];
                this.results = this.journalEntryPage.getFlag(MODULE_ID, "results") ? JSON.parse(JSON.stringify(this.journalEntryPage.getFlag(MODULE_ID, "results"))) : [];
                await this.render(true);
            });
            recipe.addEventListener("click", async (event) => {
                // 点击配方可以切换配方
                event.preventDefault();
                const pageUuid = recipe.dataset.uuid;
                if (this.journalEntryPage.uuid == pageUuid) return;
                this.journalEntryPage = this.journalEntry.pages.find(p => p.uuid == pageUuid);
                this.ingredients = this.journalEntryPage.getFlag(MODULE_ID, "ingredients") ?? [];
                this.results = this.journalEntryPage.getFlag(MODULE_ID, "results") ?? [];
                await this.render(true);
            });
            recipe.addEventListener("drop", this._onDropRecipesPanel.bind(this));
        });
        html.querySelector(".craft-ingredients-panel").addEventListener("drop", this._onDropSlotPanel.bind(this));
        html.querySelector(".craft-results-panel").addEventListener("drop", this._onDropResultPanel.bind(this));
        html.querySelector(".craft-recipes-panel").addEventListener("drop", this._onDropRecipesPanel.bind(this));
        //滚动事件，记录滚动位置
        html.querySelector(".craft-elementitems-panel").addEventListener("scrollend", (event) => { this.scrollPositions.elementItems = event.target.scrollTop; });
        html.querySelector(".craft-recipes-panel").addEventListener("scrollend", (event) => { this.scrollPositions.recipes = event.target.scrollTop; });
        debug("CraftPanelRecipe _onRender : html", html);
    }

    async configure() {
        const recipe_categories = this.journalEntry.getFlag(MODULE_ID, "recipe-categories") ?? [];
        const categoryOptions = {};
        for (const category of recipe_categories) {
            categoryOptions[category.id] = category.name;
        }
        debug("CraftPanelRecipe configure : recipe_categories categoryOptions", recipe_categories, categoryOptions);
        const fb = new Portal.FormBuilder()
            .object(this.journalEntryPage)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-recipe`) + ": " + this.journalEntryPage.name)
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: `src`, type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .number({ name: `sort`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.recipe-sort`) })
            .multiSelect({ name: `flags.${MODULE_ID}.category`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.recipe-category`), options: categoryOptions })
            .number({ name: `flags.${MODULE_ID}.weight`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.recipe-weight`), min: 0 })
            .select({ name: `flags.${MODULE_ID}.mergeByName`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.merge-by-name`), options: { "default": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.default`), "yes": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.yes`), "no": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.no`) } })
            .checkbox({ name: `flags.${MODULE_ID}.isLocked`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked-hint`) })
            .textArea({ name: `flags.${MODULE_ID}.unlockCondition`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script-hint`) })
            .textArea({ name: `flags.${MODULE_ID}.craftScript`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script-hint`) })
            .button({
                label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-recipe-tooltip-button`),
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
        debug("CraftPanelRecipe configure : data", data);
        if (!data) return;
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
        debug("CraftPanelRecipe editNum : data", data);
        if (!data) return;
        this.ingredients[index].min = data.min;
        this.ingredients[index].useMin = data.useMin;
        this.ingredients[index].max = data.max;
        this.ingredients[index].useMax = data.useMax;
        debug("CraftPanelRecipe editNum : this.ingredients", this.ingredients);
        await this.render(true);
    }
    async editResultNum(index) {
        const result = this.results[index];
        const fb = new Portal.FormBuilder()
            .object(result)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-num`))
            .number({ name: "quantity", label: game.i18n.localize(`${MODULE_ID}.quantity`) })

        const data = await fb.render();
        debug("CraftPanelRecipe editResultNum : data", data);
        if (!data) return;
        this.results[index].quantity = data.quantity;
        await this.render(true);
    }
    async editRecipe() {
        const update = {
            flags: {
                [MODULE_ID]: {
                    ingredients: this.ingredients,
                    results: this.results,
                },
            },
        }
        debug("CraftPanelRecipe editRecipe : update", update);
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
        debug("CraftPanelRecipe _onDropSlotPanel : data", data);
        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        let element = data?.element;
        debug("CraftPanelRecipe _onDropSlotPanel : type item element", type, item, element);
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
    async _onDropResultPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelRecipe _onDropResultPanel : data", data);
        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        debug("CraftPanelRecipe _onDropResultPanel : type item", type, item);
        if (type !== "Item" && type !== "RollTable") return;
        if (item) {
            let r = this.results.find((r) => r.uuid == item.uuid);
            if (r) {
                r.quantity++;
            } else {
                this.results.push({ uuid: item.uuid, quantity: 1, img: item.img, name: item.name, type: type });
            }
            await this.render(true);
        }
    }
    async _onDropRecipesPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelRecipe _onDropRecipesPanel : data", data);
        if (data.type !== "CraftRecipe") return;
        if (data.parent !== this.journalEntry.uuid) return;
        let targetUuid = event.currentTarget.dataset.uuid;
        let page = await fromUuid(data.uuid);
        if (!page) return;
        let sortTarget;
        if (targetUuid) {
            sortTarget = await fromUuid(targetUuid);
        }
        debug("CraftPanelRecipe _onDropRecipesPanel : page targetUuid sortTarget", page, targetUuid, sortTarget);
        await page.sortRelative({
            sortKey: "sort",
            target: sortTarget,
            siblings: this.journalEntry.pages.filter(p => p.id !== page.id)
        });
        await this.render(true);
    }

    async addElement(element, uuid) {
        debug("CraftPanelRecipe addElement : element uuid", element, uuid);
        if (element == undefined) {
            let item = await fromUuid(uuid);
            element = item.getFlag(MODULE_ID, "elementConfig");
        }
        let el = this.ingredients.find((el) => (el.type == "element") && (el.id == element.id));
        debug("CraftPanelRecipe addElement : element el", element, el);
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
        await this.render(true);
    }
    async removeElement(element, uuid) {
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
        await this.render(true);
    }

    async addMaterial(item) {
        debug("CraftPanelRecipe addMaterial : item", item);
        if (!item) return;
        let el = this.ingredients.find((el) => (el.type == "material") && (el.name == item.name));
        debug("CraftPanelRecipe addMaterial : el", el);
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
        await this.render(true);
    }

    async removeIngredient(index) {
        this.ingredients.splice(index, 1);
        await this.render(true);
    }
    async removeResult(index) {
        this.results.splice(index, 1);
        await this.render(true);
    }

    async refreshPanel() {
        const elementItems_items = [];
        for (const item of game.items.contents) {
            if (item.getFlag(MODULE_ID, "isElement") === true) {
                elementItems_items.push(item);
            }
        }
        debug("CraftPanelRecipe refreshPanel : elementItems_items", elementItems_items);
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
        debug("CraftPanelRecipe refreshPanel : this.elementItems", this.elementItems);
        this.needRefresh = false;
    }
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