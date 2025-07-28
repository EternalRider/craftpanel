import { HandlebarsApplication, debug, MODULE_ID } from "../utils.js";

export class CraftPanelUserRecipe extends HandlebarsApplication {
    constructor(journalEntry) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        this.journalEntry = journalEntry;
        this.user = null;
        this.unlockedRecipes = [];

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
            players: {
                width: 150,
                height: 420,
            },
        };

        this.options.actions.edit = this.edit.bind(this);
        craftPanels ??= [];
        craftPanels.push(this);
        debug("CraftPanelUserRecipe constructor : this journalEntry craftPanels", this, journalEntry, craftPanels);
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
        const recipesJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "recipe").sort((a, b) => (a.sort - b.sort));
        debug("CraftPanelUserRecipe _prepareContext : recipesJE", recipesJE);
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
            };
        });
        debug("CraftPanelUserRecipe _prepareContext : recipes", recipes);
        let users = game.users.filter((u) => !u.isGM);
        if (!this.user) {
            this.user = users[0];
            this.unlockedRecipes = this.user.getFlag(MODULE_ID, "unlockedRecipes") ?? [];
        }
        users = users.map((u) => {
            return {
                id: u.id,
                uuid: u.uuid,
                name: u.name,
                color: u.color,
                choosed: u.id === this.user.id ? "choosed" : "",
            }
        });
        debug("CraftPanelUserRecipe _prepareContext : users unlockedRecipes", users, this.unlockedRecipes);
        return {
            players: users,
            recipes: recipes.filter((r) => this.unlockedRecipes.some((ur) => ur.id === r.id)),
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
        debug("CraftPanelUserRecipe _onRender : context", context);

        // 恢复滚动条位置
        html.querySelector(".craft-players-panel").scrollTop = this.scrollPositions.players;
        html.querySelector(".craft-recipes-panel").scrollTop = this.scrollPositions.recipes;

        html.querySelectorAll(".craft-player").forEach((el) => {
            el.addEventListener("click", async (event) => {
                event.preventDefault();
                // 点击玩家可以切换玩家
                const userId = el.dataset.id;
                if (this.user.id === userId) return;
                this.user = game.users.get(userId);
                this.unlockedRecipes = this.user.getFlag(MODULE_ID, "unlockedRecipes") ?? [];
                await this.render(true);
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
            recipe.addEventListener("dragend", this._onDragEnd.bind(this));
            // recipe.addEventListener("drop", this._onDropRecipesPanel.bind(this));
        });
        html.querySelector(".craft-recipes-panel").addEventListener("drop", this._onDropRecipesPanel.bind(this));
        //滚动事件，记录滚动位置
        html.querySelector(".craft-players-panel").addEventListener("scrollend", (event) => { this.scrollPositions.players = event.target.scrollTop; });
        html.querySelector(".craft-recipes-panel").addEventListener("scrollend", (event) => { this.scrollPositions.recipes = event.target.scrollTop; });
        debug("CraftPanelUserRecipe _onRender : html", html);
    }
    async _onDropRecipesPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelUserRecipe _onDropRecipesPanel : data", data);
        this.dropOccurred = true;
        if (data.type !== "CraftRecipe") return;
        if (data.parent !== this.journalEntry.uuid) return;
        let page = await fromUuid(data.uuid);
        if (!page) return;
        if (!this.unlockedRecipes.some(el => el.id == page.id)) {
            this.unlockedRecipes.push({ id: page.id, name: page.name, img: page.src, ownership: DEFAULT_OWNERSHIP["canShow"] });
        }
        await this.render(true);
    }
    async _onDragEnd(event) {
        // 拖拽至其他区域，删除已解锁配置
        event.stopPropagation();
        debug("CraftPanelUserRecipe _onDragEnd : event", event);
        if (!this.dropOccurred) {
            let uuid = event.currentTarget.dataset.uuid;
            let page = await fromUuid(uuid);
            this.unlockedRecipes = this.unlockedRecipes.filter(el => el.id !== page?.id);
        }
        this.dropOccurred = false;
        await this.render(true);
    }
    async edit(event) {
        event.stopPropagation();
        if (this.unlockedRecipes.length >= 1) {
            await this.user.setFlag(MODULE_ID, "unlockedRecipes", this.unlockedRecipes);
        } else {
            await this.user.unsetFlag(MODULE_ID, "unlockedRecipes");
        }
        
        debug("CraftPanelUserRecipe edit : this.user", this.user);
        await this.render(true);
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