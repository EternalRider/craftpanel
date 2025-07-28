import { HandlebarsApplication, MODULE_ID, debug, confirmDialog } from "../utils.js";
import { CraftPanelCook } from "./craftPanelCook.js";

export class CraftPanelCookRecipe extends HandlebarsApplication {
    constructor(journalEntry, storedRecipe) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        this.journalEntry = journalEntry;
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
        craftPanels ??= [];
        craftPanels.push(this);
        debug("CraftPanelCookRecipe constructor : this journalEntry storedRecipe this.modifiersJE craftPanels", this, journalEntry, storedRecipe, this.modifiersJE, craftPanels);
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
    }

    /**
     * 准备界面所需的各项数据
     * @returns {}
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
            let tooltip = await TextEditor.enrichHTML(`<figure><img src='${el.img}'><h1>${el.name}</h1></figure><div class="description">${el.description ?? ""}</div>`);
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
                quantity: 1,
                // size: Math.min(this.panelSizes.ingredients.width, this.panelSizes.ingredients.height) * 0.75,
            });
        }
        debug("CraftPanelCookRecipe _prepareContext : ingredients", ingredients);
        return {
            recipes,
            elements: recipe.elements,
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
                // 点击配方可以切换配方
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
        // game.user.setFlag(MODULE_ID, "storedRecipe", this.storedRecipe);
        await this.saveRecipes(this.storedRecipe);
        await this.render(true);
    }
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
    async _onClickChoose(event) {
        event.stopPropagation();
        if (!this.parentPanel) {
            debug("Error: CraftPanelCookRecipe _onClickChoose : No parentPanel", this);
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.noParentPanel`));
        } else {
            let recipe = this.storedRecipe[this.choosedIndex];
            this.parentPanel.fillByRecipe_Back(recipe);
            // this.parentPanel.render(true);
        }
        this.close();
    }
    async deleteConfirm(index) {
        let confirm = await confirmDialog(`${MODULE_ID}.${this.APP_ID}.delete-confirm-title`, `${MODULE_ID}.${this.APP_ID}.delete-confirm-info`, `${MODULE_ID}.yes`, `${MODULE_ID}.no`);
        if (confirm) {
            this.storedRecipe.splice(index, 1);
            debug("CraftPanelCookRecipe _onDragEnd : this.storedRecipe", this.storedRecipe);
            // game.user.setFlag(MODULE_ID, "storedRecipe", this.storedRecipe);
            await this.saveRecipes(this.storedRecipe);
            await this.render(true);
        }
    }

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