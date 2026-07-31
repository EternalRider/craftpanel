import { HandlebarsApplication, MODULE_ID, debug, confirmDialog } from "../utils.js";
import { CraftPanelCook } from "./craftPanelCook.js";

/**
 * 烹饪配方选择子面板。
 * 显示当前面板的所有已保存配方，支持选择、排序和删除操作。
 * 选择配方后会将配方数据填充回父面板。
 * @extends HandlebarsApplication
 */
export class CraftPanelCookRecipe extends HandlebarsApplication {
    /**
     * 构造烹饪配方子面板实例。
     * @param {JournalEntry|string} journalEntry 对应的 JournalEntry 或其 UUID
     * @param {Recipe[]} storedRecipe 已保存的配方列表
     * @param {string} mode 面板模式（空字符串或 "edit"）
     */
    constructor(journalEntry, storedRecipe, mode = "") {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        this.journalEntry = journalEntry;
        this.mode = mode;
        /**@type {Recipe[]} */
        this.storedRecipe = storedRecipe;
        this.choosedIndex = 0;
        this.modifiersJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "modifier").sort((a, b) => (a.sort - b.sort));

        /**@type {CraftPanelCook} */
        this.parentPanel;

        this.dropOccurred = false;
        this.scrollPositions = {
            players: 0,
            recipes: 0,
        };
        this.panelSizes = {
            recipes: {
                width: 300,
                height: 420,
            },
            ingredients: {
                width: 600,
                height: 150,
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

        this.options.actions.choose = this._onClickChoose.bind(this);
        this.options.actions.delete = this.deleteConfirm.bind(this);
        craftPanels ??= [];
        craftPanels.push(this);
        debug("CraftPanelCookRecipe constructor : this journalEntry storedRecipe this.modifiersJE craftPanels", this, journalEntry, storedRecipe, this.modifiersJE, craftPanels);
    }

    /**
     * 默认窗口与表单配置。
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
     * 是否为编辑模式。
     * @returns {boolean}
     */
    get isEdit() {
        return this.mode === "edit";
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
     * 组装渲染上下文：获取配方列表、当前选中配方的详细信息。
     * @param {object} options 渲染选项
     * @returns {Promise<{recipes: Array, elements: Array, ingredients: Array, results: Array, panelSizes: object, isEdit: boolean}>}
     */
    async _prepareContext(options) {
        debug("CraftPanelCookRecipe _prepareContext : this.storedRecipe", this.storedRecipe);
        const recipes = this.storedRecipe.map((re, i) => {
            return {
                name: re.products[0].name,
                image: re.products[0].img,
                index: i,
                ingredients: re.materials,
                choosed: (i == this.choosedIndex) ? "choosed" : ""
            };
        });
        const recipe = this.storedRecipe[this.choosedIndex] ?? {
            products: [],
            materials: [],
            elements: [],
            slotItems: [],
        };
        debug("CraftPanelCookRecipe _prepareContext : recipes recipe", recipes, recipe);
        const results = await Promise.all(recipe.products.map(async (el, i) => {
            let tooltip = await TextEditor.enrichHTML(`<figure><img src='${el.img}'><h2>${el.name}</h2></figure><div class="description">${el.description ?? ""}</div>`);
            return {
                slotIndex: i,
                quantity: el.quantity,
                name: el.name,
                img: el.img,
                tooltip,
                size: Math.min(this.panelSizes.results.width, this.panelSizes.results.height) * 0.75,
            };
        }));
        debug("CraftPanelCookRecipe _prepareContext : results", results);
        const ingredients = [];
        for (let slotItem of recipe.slotItems) {
            let material = recipe.materials.find(m => m.name == slotItem.name);
            if (!material) {
                debug("CraftPanelCookRecipe _prepareContext : no material for slotItem", slotItem);
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.materialDataError`));
            }
            ingredients.push({
                slotIndex: slotItem.key,
                name: material.name,
                img: material.img,
                num: slotItem.quantity ?? 1,
            });
        }
        debug("CraftPanelCookRecipe _prepareContext : ingredients", ingredients);
        return {
            recipes,
            elements: recipe.elements,
            ingredients: ingredients,
            results: results,
            panelSizes: this.panelSizes,
            isEdit: this.isEdit
        }
    }

    /**
     * 渲染完成后绑定交互事件：配方点击切换、右键删除、拖拽排序、滚动记录等。
     * @param {object} context 渲染上下文
     * @param {object} options 渲染选项
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        debug("CraftPanelCookRecipe _onRender : context", context);

        // 恢复滚动条位置
        html.querySelector(".craft-recipes-panel").scrollTop = this.scrollPositions.recipes;

        html.querySelectorAll(".craft-recipe").forEach((recipe) => {
            recipe.addEventListener("click", async (event) => {
                event.preventDefault();
                // 点击配方可以切换配方
                this.choosedIndex = recipe.dataset.index;
                await this.render(true);
            });
            recipe.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                // 右键配方可以删除配方
                let index = recipe.dataset.index;
                this.deleteConfirm(index);
            });
            recipe.addEventListener("dragstart", async (event) => {
                event.dataTransfer.setData(
                    "text/plain",
                    JSON.stringify({
                        type: "CookRecipe",
                        index: recipe.dataset.index,
                        parent: this.journalEntry.uuid,
                    }),
                );
            });
            recipe.addEventListener("dragend", this._onDragEnd.bind(this));
            recipe.addEventListener("drop", this._onDropRecipesPanel.bind(this));
        });
        html.querySelector(".craft-recipes-panel").addEventListener("drop", this._onDropRecipesPanel.bind(this));
        //滚动事件，记录滚动位置
        html.querySelector(".craft-recipes-panel").addEventListener("scrollend", (event) => { this.scrollPositions.recipes = event.target.scrollTop; });
        debug("CraftPanelCookRecipe _onRender : html", html);
    }

    /**
     * 处理配方拖放事件：将配方拖拽到其他配方上调整顺序，或拖到末尾。
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
        debug("CraftPanelCookRecipe _onDropRecipesPanel : data", data);
        this.dropOccurred = true;
        if (data.type !== "CookRecipe") return;
        if (data.parent !== this.journalEntry.uuid) return;
        let targetIndex = event.currentTarget.dataset.index;
        let index = data.index;
        if (index == targetIndex) return;
        let recipe = this.storedRecipe[index];
        if (targetIndex) {
            // 拖曳至配方上
            if (index < targetIndex) {
                // 若原本在其前面，则挪至其后
                this.storedRecipe.splice(index, 1); // 先从原位置移除
                this.storedRecipe.splice(targetIndex, 0, recipe); // 再插入到目标位置
            } else if (index > targetIndex) {
                // 若原本在其后面，则挪至其前
                this.storedRecipe.splice(index, 1); // 先从原位置移除
                this.storedRecipe.splice(targetIndex - 1, 0, recipe); // 再插入到目标位置
            }
        } else {
            // 拖曳至列表末尾
            this.storedRecipe.splice(index, 1);
            this.storedRecipe.push(recipe);
        }
        await this.saveRecipes(this.storedRecipe);
        await this.render(true);
    }

    /**
     * 处理拖拽结束事件：如果拖放到面板外，则删除该配方。
     * @param {DragEvent} event 拖拽结束事件
     */
    async _onDragEnd(event) {
        // 拖拽至其他区域，删除已创建的配方
        event.stopPropagation();
        debug("CraftPanelCookRecipe _onDragEnd : event", event);
        if (!this.dropOccurred) {
            let index = event.currentTarget.dataset.index;
            await this.deleteConfirm(index);
        }
        this.dropOccurred = false;
    }

    /**
     * 选择当前高亮的配方，将其填充到父面板中。
     * @param {Event} event 点击事件
     */
    async _onClickChoose(event) {
        event.stopPropagation();
        if (!this.parentPanel) {
            debug("Error: CraftPanelCookRecipe _onClickChoose : No parentPanel", this);
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.noParentPanel`));
        } else {
            let recipe = this.storedRecipe[this.choosedIndex];
            this.parentPanel.fillByRecipe_Back(recipe);
        }
        this.close();
    }

    /**
     * 弹出确认对话框删除指定配方。
     * @param {number} index 要删除的配方索引
     */
    async deleteConfirm(index) {
        if (typeof index != "number") index = this.choosedIndex;
        let confirm = await confirmDialog(`${MODULE_ID}.${this.APP_ID}.delete-confirm-title`, `${MODULE_ID}.${this.APP_ID}.delete-confirm-info`, `${MODULE_ID}.yes`, `${MODULE_ID}.no`);
        if (confirm === "确定") {
            this.storedRecipe.splice(index, 1);
            debug("CraftPanelCookRecipe _onDragEnd : this.storedRecipe", this.storedRecipe);
            await this.saveRecipes(this.storedRecipe);
            await this.render(true);
        }
    }

    /**
     * 保存配方列表到用户 flag 中（替换当前面板的所有配方）。
     * @param {Recipe[]} recipes 要保存的配方列表
     */
    async saveRecipes(recipes) {
        /**@type {Recipe[]} */
        let allRecipes = game.user.getFlag(MODULE_ID, "storedRecipe") ?? [];
        allRecipes = allRecipes.filter(r => r.panelUuid != this.journalEntry.uuid).concat(recipes);
        await game.user.setFlag(MODULE_ID, "storedRecipe", allRecipes);
    }
}

/**
 * @typedef {Object} Recipe
 * @property {string} panelUuid
 * @property {Array<{
 *   name: string,
 *   img: string,
 *   quantity: number,
 *   description: string,
 * }>} products
 * @property {Array<{
 *   name: string,
 *   img: string,
 *   quantity: number,
 * }>} materials
 * @property {Array<{
 *   uuid: string,
 *   name: string,
 *   img: string,
 * }>} selectedModifiers
 * @property {Array<CraftElement>} elements
 * @property {Array<{
 *   key: number,
 *   name: string,
 * }>} slotItems
 */

/**
 * @typedef {Object} CraftElement
 * @property {string} id - 元素的id，为对应物品的id（非uuid）。用于检测是否为同一元素，可以通过名称与图标相同但id不同的元素实现"虚假"属性。
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