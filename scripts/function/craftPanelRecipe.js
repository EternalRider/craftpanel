import { HandlebarsApplication, getItemColor, debug, MODULE_ID } from "../utils.js";
import { FormBuilder } from "./formBuilder.js";

/**
 * 配方编辑子面板。
 * 提供配方的详细编辑功能，包括成分需求、结果物品、分类、解锁条件等。
 * @extends HandlebarsApplication
 */
export class CraftPanelRecipe extends HandlebarsApplication {
    /**
     * 构造配方编辑子面板实例。
     * @param {JournalEntry|string} journalEntry 对应的 JournalEntry 或其 UUID
     * @param {JournalEntryPage|string} journalEntryPage 配方对应的页面或其 UUID
     * @param {object} options 额外选项
     * @param {string} [options.focusRecipeUuid] 需要聚焦滚动的配方 UUID
     */
    constructor(journalEntry, journalEntryPage, options = {}) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        if (typeof journalEntryPage === "string") journalEntryPage = fromUuidSync(journalEntryPage);
        // this.ingredients = [];
        // this.results = [];
        this.elementItems = [];
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
        // Optionally passed by parent panel to request a one-time scroll to a recipe
        this.focusRecipeUuid = options?.focusRecipeUuid ?? null;
        this._scrollScheduled = false;

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
    }

    /**
     * 默认窗口配置。
     * @returns {object}
     */
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

    /**
     * 视图片段配置。
     * @returns {object}
     */
    static get PARTS() {
        return {
            content: {
                template: `modules/${MODULE_ID}/templates/${this.APP_ID}.hbs`,
                classes: ["scrollable"],
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
     * 窗口标题。
     * @returns {string}
     */
    get title() {
        return game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.title`);
    }

    /**
     * 面板关闭时从全局 craftPanels 数组中移除自身，并通知父面板刷新。
     * @param {object} options 关闭选项
     */
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
     * 组装渲染上下文：获取配方列表、成分列表和结果列表。
     * @param {object} options 渲染选项
     * @returns {Promise<{elementItems: Array, recipes: Array, ingredients: Array, results: Array, panelSizes: object}>}
     */
    async _prepareContext(options) {
        if (this.needRefresh) {
            await this.refreshPanel();
        }
        const recipesJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "recipe").sort((a, b) => (a.sort - b.sort));
        const recipes = await Promise.all(recipesJE.map(async (je, i) => {
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
            const results = je.getFlag(MODULE_ID, "results") ? JSON.parse(JSON.stringify(je.getFlag(MODULE_ID, "results"))) : [];
            const tooltip = await TextEditor.enrichHTML(`<figure><img src='${je.src}'><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div><div class="tooltip-elements">${results.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.quantity}</div></div>` }).join('')}</div>`);
            return {
                id: je.id,
                name: je.name,
                image: je.src,
                index: i,
                uuid: je.uuid,
                ingredients: ingredients,
                tooltip,
                choosed: je.id == this.journalEntryPage.id ? "choosed" : ""
            };
        }));
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
        const results = await Promise.all(this.results.map(async (el, i) => {
            const item = await fromUuid(el.uuid);
            const itemColor = item ? getItemColor(item) ?? "" : "";
            let tooltip = await TextEditor.enrichHTML(`<figure><img src='${el.img ?? item?.img}'><h2>${el.name ?? item?.name}</h2></figure><div class="description">${el.description ?? foundry.utils.getProperty(item, this.descriptionPath) ?? item?.description ?? ""}</div>`);
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

        return {
            elementItems: this.elementItems,
            recipes,
            ingredients: ingredients,
            results: results,
            panelSizes: this.panelSizes,
        }
    }
    /**
     * 渲染后绑定交互事件：元素拖放、配方切换/排序、结果编辑、滚动位置恢复等。
     * @param {object} context 渲染上下文
     * @param {object} options 渲染选项
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        // 恢复滚动条位置
        html.querySelector(".craft-elementitems-panel").scrollTop = this.scrollPositions.elementItems;
        html.querySelector(".craft-recipes-panel").scrollTop = this.scrollPositions.recipes;
        // 如果上层请求在打开时聚焦某个配方，则在 DOM 稳定后延迟滚动配方面板一次
        if (this.focusRecipeUuid && !this._scrollScheduled) {
            this._scrollScheduled = true;
            const uuidToFocus = this.focusRecipeUuid;
            // 使用 requestAnimationFrame + setTimeout 延迟微小时间，确保 DOM 渲染与图片加载完成
            requestAnimationFrame(() => {
                setTimeout(() => {
                    try {
                        const panel = html.querySelector('.craft-recipes-panel');
                        const target = panel?.querySelector(`.craft-recipe[data-uuid="${uuidToFocus}"]`);
                        if (panel && target) {
                            const rect = target.getBoundingClientRect();
                            const contRect = panel.getBoundingClientRect();
                            const top = panel.scrollTop + (rect.top - contRect.top) - (panel.clientHeight / 2) + (rect.height / 2);
                            panel.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
                        }
                    } catch (e) { /* ignore silently */ }
                    // clear flags
                    this.focusRecipeUuid = null;
                }, 80);
            });
        }

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
                this.ingredients = this.journalEntryPage.getFlag(MODULE_ID, "ingredients") ? JSON.parse(JSON.stringify(this.journalEntryPage.getFlag(MODULE_ID, "ingredients"))) : [];
                this.results = this.journalEntryPage.getFlag(MODULE_ID, "results") ? JSON.parse(JSON.stringify(this.journalEntryPage.getFlag(MODULE_ID, "results"))) : [];
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
    }

    /**
     * 打开配方配置对话框：名称、图标、排序、分类、权重、解锁条件、脚本等。
     */
    async configure() {
        const recipe_categories = this.journalEntry.getFlag(MODULE_ID, "recipes-categories") ?? [];
        const categoryOptions = {};
        for (const category of recipe_categories) {
            categoryOptions[category.id] = category.name;
        }
        const mergeByNameOptions = {
            "default": game.i18n.localize(`${MODULE_ID}.default`),
            "yes": game.i18n.localize(`${MODULE_ID}.yes`),
            "no": game.i18n.localize(`${MODULE_ID}.no`),
        };
        const showResultOptions = {
            "yes": game.i18n.localize(`${MODULE_ID}.yes`),
            "no": game.i18n.localize(`${MODULE_ID}.no`),
        };
        const craftAsHandlerOptions = {
            "default": game.i18n.localize(`${MODULE_ID}.default`),
            "yes": game.i18n.localize(`${MODULE_ID}.yes`),
            "no": game.i18n.localize(`${MODULE_ID}.no`),
        };
        const fb = new FormBuilder()
            .object(this.journalEntryPage)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-recipe`) + ": " + this.journalEntryPage.name)
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: `src`, type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .number({ name: `sort`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.recipe-sort`) })
            .multiSelect({ name: `flags.${MODULE_ID}.category`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.recipe-category`), options: categoryOptions })
            .number({ name: `flags.${MODULE_ID}.weight`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.recipe-weight`), min: 0 })
            .select({ name: `flags.${MODULE_ID}.mergeByName`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.merge-by-name`), options: mergeByNameOptions })
            .select({ name: `flags.${MODULE_ID}.showResult`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.show-result`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.show-result-hint`), options: showResultOptions })
            .checkbox({ name: `flags.${MODULE_ID}.isLocked`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked-hint`) })
            .select({ name: `flags.${MODULE_ID}.craftAsHandler`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-as-handler`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-as-handler-hint`), options: craftAsHandlerOptions })
            .uuid({ name: `flags.${MODULE_ID}.handlerTemplate`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.handler-template`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.handler-template-hint`), type: "JournalEntryPage" })
            .script({ name: `flags.${MODULE_ID}.unlockCondition`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script-hint`) })
            .script({ name: `flags.${MODULE_ID}.craftScript`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script-hint`) })
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
        if (!data) return;
        await this.journalEntryPage.update(data);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 编辑成分的数量范围（最小值/最大值）。
     * @param {number} index 成分在列表中的索引
     */
    async editNum(index) {
        const ingredient = this.ingredients[index];
        const fb = new FormBuilder()
            .object(ingredient)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-num`))
            .number({ name: "min", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.min`) })
            .checkbox({ name: "useMin", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.use-min`) })
            .number({ name: "max", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.max`) })
            .checkbox({ name: "useMax", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.use-max`) })
            .info(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-num-info`));

        const data = await fb.render();
        if (!data) return;
        // debug("editNum", data);
        this.ingredients[index].min = data.min;
        this.ingredients[index].useMin = data.useMin;
        this.ingredients[index].max = data.max;
        this.ingredients[index].useMax = data.useMax;
        await this.render(true);
    }

    /**
     * 编辑结果物品的数量。
     * @param {number} index 结果在列表中的索引
     */
    async editResultNum(index) {
        const result = this.results[index];
        const fb = new FormBuilder()
            .object(result)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-num`))
            .number({ name: "quantity", label: game.i18n.localize(`${MODULE_ID}.quantity`) })

        const data = await fb.render();
        if (!data) return;
        this.results[index].quantity = data.quantity;
        await this.render(true);
    }

    /**
     * 保存当前编辑的成分和结果数据到 journalEntryPage。
     */
    async editRecipe() {
        const update = {
            flags: {
                [MODULE_ID]: {
                    ingredients: foundry.utils.deepClone(this.ingredients),
                    results: foundry.utils.deepClone(this.results),
                },
            },
        }
        await this.journalEntryPage.update(update);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 处理物品拖放到成分面板的事件：根据类型添加为元素或材料成分。
     * @param {DragEvent} event 拖放事件
     */
    async _onDropSlotPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }

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

    /**
     * 处理物品拖放到结果面板的事件：添加或增加结果数量。
     * @param {DragEvent} event 拖放事件
     */
    async _onDropResultPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }

        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
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

    /**
     * 处理配方拖放排序事件。
     * @param {DragEvent} event 拖放事件
     */
    async _onDropRecipesPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        // debug("CraftPanelBlend._onDropRecipesPanel", event, data, event.currentTarget, event.currentTarget.dataset.index, event.currentTarget.dataset.uuid);
        if (data.type !== "CraftRecipe") return;
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

    /**
     * 添加元素到成分列表，已有则增加数量。
     * @param {CraftElement} element 元素数据
     * @param {string} uuid 元素物品的 UUID
     */
    async addElement(element, uuid) {
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
        await this.render(true);
    }

    /**
     * 减少元素数量，数量归零时移除。
     * @param {CraftElement} element 元素数据
     * @param {string} uuid 元素物品的 UUID
     */
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

    /**
     * 添加材料到成分列表，已有则增加数量。
     * @param {Item} item 材料物品
     */
    async addMaterial(item) {
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
        await this.render(true);
    }

    /**
     * 移除指定索引的成分。
     * @param {number} index 成分索引
     */
    async removeIngredient(index) {
        this.ingredients.splice(index, 1);
        await this.render(true);
    }

    /**
     * 移除指定索引的结果。
     * @param {number} index 结果索引
     */
    async removeResult(index) {
        this.results.splice(index, 1);
        await this.render(true);
    }

    /**
     * 刷新面板：重新获取所有元素物品列表。
     */
    async refreshPanel() {
        const elementItems_items = [];
        for (const item of game.items.contents) {
            if (item.getFlag(MODULE_ID, "isElement") === true) {
                elementItems_items.push(item);
            }
        }
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
                shape: element.shape,
            };
        });
        this.elementItems.sort((a, b) => { return b.class != a.class ? b.class.localeCompare(a.class) : b.name.localeCompare(a.name) });
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
 * @property {string} color - 元素的颜色，为对应形状以及边框的颜色。仅用于显示。
 * @property {number} weight - 元素的权重，用于计算匹配度。
 * @property {number} num - 仅成分元素使用，为元素的数量。用于显示作为合成素材时提供的元素数量。
 * @property {boolean} useMin - 仅需求元素使用，为是否使用最小数量。
 * @property {number} min - 仅需求元素使用，为元素的最小数量。用于显示合成时最少需要的元素数量。
 * @property {boolean} useMax - 仅需求元素使用，为是否使用最大数量。
 * @property {number} max - 仅需求元素使用，为元素的最大数量。用于显示合成时最多需要的元素数量。
 */