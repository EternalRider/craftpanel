import { HandlebarsApplication, getItemColor, MODULE_ID, debug } from "../utils.js";
import { FormBuilder } from "./formBuilder.js";

/**
 * 调整器编辑子面板。
 * 提供调整器的详细编辑功能，包括成分需求、效果变更、排序等。
 * @extends HandlebarsApplication
 */
export class CraftPanelModifier extends HandlebarsApplication {
    /**
     * 构造调整器编辑子面板实例。
     * @param {JournalEntry|string} journalEntry 对应的 JournalEntry 或其 UUID
     * @param {JournalEntryPage|string} journalEntryPage 调整器对应的页面或其 UUID
     * @param {object} options 额外选项
     * @param {string} [options.focusModifierUuid] 需要聚焦滚动的调整器 UUID
     */
    constructor(journalEntry, journalEntryPage, options = {}) {
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
        this.focusModifierUuid = options?.focusModifierUuid ?? null;
        this._scrollScheduled = false;

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
     * 组装渲染上下文：获取调整器列表、成分列表和变更列表。
     * @param {object} options 渲染选项
     * @returns {Promise<{elementItems: Array, modifiers: Array, ingredients: Array, changes: Array, panelSizes: object}>}
     */
    async _prepareContext(options) {
        if (this.needRefresh) {
            await this.refreshPanel();
        }
        const modifiersJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "modifier").sort((a, b) => (a.sort - b.sort));
        const modifiers = await Promise.all(modifiersJE.map(async (je, i) => {
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
            const tooltip = await TextEditor.enrichHTML(`<figure><img src='${je.src}'><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div>`);
            let cost = je.getFlag(MODULE_ID, "cost") ?? 0;
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
                choosed: je.id == this.journalEntryPage.id ? "choosed" : "",
                cost,
                costInfo,
                costClass,
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
     * 渲染后绑定交互事件：元素拖放、调整器切换/排序、变更编辑、滚动位置恢复等。
     * @param {object} context 渲染上下文
     * @param {object} options 渲染选项
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;

        // 恢复滚动条位置
        html.querySelector(".craft-elementitems-panel").scrollTop = this.scrollPositions.elementItems;
        html.querySelector(".craft-modifiers-panel").scrollTop = this.scrollPositions.modifiers;
        // 如果请求聚焦某个调整项，则在 DOM 稳定后延迟滚动一次
        if (this.focusModifierUuid && !this._scrollScheduled) {
            this._scrollScheduled = true;
            const uuidToFocus = this.focusModifierUuid;
            requestAnimationFrame(() => {
                setTimeout(() => {
                    try {
                        const panel = html.querySelector('.craft-modifiers-panel');
                        const target = panel?.querySelector(`.craft-modifier[data-uuid="${uuidToFocus}"]`);
                        if (panel && target) {
                            const rect = target.getBoundingClientRect();
                            const contRect = panel.getBoundingClientRect();
                            const top = panel.scrollTop + (rect.top - contRect.top) - (panel.clientHeight / 2) + (rect.height / 2);
                            panel.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
                        }
                    } catch (e) { }
                    this.focusModifierUuid = null;
                }, 80);
            });
        }

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
                this.ingredients = this.journalEntryPage.getFlag(MODULE_ID, "ingredients") ? JSON.parse(JSON.stringify(this.journalEntryPage.getFlag(MODULE_ID, "ingredients"))) : [];
                this.changes = this.journalEntryPage.getFlag(MODULE_ID, "changes") ? JSON.parse(JSON.stringify(this.journalEntryPage.getFlag(MODULE_ID, "changes"))) : [];
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
    }

    /**
     * 打开调整器配置对话框：名称、图标、排序、成本、分类、AE 设置、脚本等。
     */
    async configure() {
        const modifier_categories = this.journalEntry.getFlag(MODULE_ID, "modifiers-categories") ?? [];
        const categoryOptions = {};
        for (const category of modifier_categories) {
            categoryOptions[category.id] = category.name;
        }
        const aeTypeOptions = foundry.utils.deepClone(CONFIG.ActiveEffect.typeLabels);
        aeTypeOptions.default = game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.default`);
        const fb = new FormBuilder()
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
            .select({ name: `flags.${MODULE_ID}.aeType`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.ae-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.ae-type-hint`), options: aeTypeOptions, value: "default" })
            .checkbox({ name: `flags.${MODULE_ID}.isLocked`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.is-locked-hint`) })
            .script({ name: `flags.${MODULE_ID}.unlockCondition`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-script-hint`) })
            .script({ name: `flags.${MODULE_ID}.craftScript`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.craft-script-hint`) })
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
        if (!data) return;
        if (data.flags[MODULE_ID].asAE == "false") {
            data.flags[MODULE_ID].asAE = false;
        }
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
     * 编辑变更的数量。
     * @param {number} index 变更在列表中的索引
     */
    async editResultNum(index) {
        const result = this.changes[index];
        const fb = new FormBuilder()
            .object(result)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-num`))
            .number({ name: "quantity", label: game.i18n.localize(`${MODULE_ID}.quantity`) })

        const data = await fb.render();
        if (!data) return;
        this.changes[index].quantity = data.quantity;
        await this.render(true);
    }

    /**
     * 保存当前编辑的成分和变更数据到 journalEntryPage。
     */
    async editModifier() {
        const update = {
            flags: {
                [MODULE_ID]: {
                    ingredients: foundry.utils.deepClone(this.ingredients),
                    changes: foundry.utils.deepClone(this.changes),
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
     * 处理物品拖放到变更面板的事件（预留接口）。
     * @param {DragEvent} event 拖放事件
     */
    async _onDropChangePanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }

        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        if (type !== "Item" && type !== "ActiveEffect") return;
        if (item) {

        }
    }

    /**
     * 处理调整器拖放排序事件。
     * @param {DragEvent} event 拖放事件
     */
    async _onDropModifiersPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        // debug("CraftPanelBlend._onDropModifiersPanel", event, data, event.currentTarget, event.currentTarget.dataset.index, event.currentTarget.dataset.uuid);
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
     * 移除指定索引的变更。
     * @param {number} index 变更索引
     */
    async removeResult(index) {
        this.changes.splice(index, 1);
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

    /**
     * 添加新的效果变更条目。
     */
    async addChange() {
        const fb = new FormBuilder()
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.add-change`) + ": " + this.journalEntryPage.name)
            .text({ name: "key", label: game.i18n.localize("EFFECT.ChangeKey") })
            .select({ name: "mode", label: game.i18n.localize("EFFECT.ChangeMode"), options: EFFECTCHANGEMOD, value: 2 })
            .text({ name: "value", label: game.i18n.localize("EFFECT.ChangeValue") })
        
        const data = await fb.render();
        if (!data) return;
        this.changes.push(data);
        await this.render(true);
    }

    /**
     * 编辑效果变更条目。
     * @param {number} index 变更在列表中的索引
     */
    async editChange(index) {
        const change = this.changes[index];
        const fb = new FormBuilder()
            .object(change)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-change`))
            .text({ name: "key", label: game.i18n.localize("EFFECT.ChangeKey") })
            .select({ name: "mode", label: game.i18n.localize("EFFECT.ChangeMode"), options: EFFECTCHANGEMOD })
            .text({ name: "value", label: game.i18n.localize("EFFECT.ChangeValue") })
        
        const data = await fb.render();
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
 * @property {string} color - 元素的颜色，为对应形状以及边框的颜色。仅用于显示。
 * @property {number} weight - 元素的权重，用于计算匹配度。
 * @property {number} num - 仅成分元素使用，为元素的数量。用于显示作为合成素材时提供的元素数量。
 * @property {boolean} useMin - 仅需求元素使用，为是否使用最小数量。
 * @property {number} min - 仅需求元素使用，为元素的最小数量。用于显示合成时最少需要的元素数量。
 * @property {boolean} useMax - 仅需求元素使用，为是否使用最大数量。
 * @property {number} max - 仅需求元素使用，为元素的最大数量。用于显示合成时最多需要的元素数量。
 */