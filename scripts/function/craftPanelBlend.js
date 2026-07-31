import { AsyncFunction, getItemColor, MODULE_ID, debug } from "../utils.js";
import { CraftPanel } from "./craftPanel.js";
import { CraftPanelRecipe } from "./craftPanelRecipe.js";
import { CraftPanelUserRecipe } from "./craftPanelUserRecipe.js";

/**
 * 配方解锁权限等级。
 * @type {{canShow: number, canUse: number, none: number}}
 */
const DEFAULT_OWNERSHIP = {
    "canShow": 2,
    "canUse": 1,
    "none": 0,
}

/**
 * 合成面板。
 * 继承自 CraftPanel，提供基于配方匹配的合成系统。
 * 支持配方解锁、分类筛选、权重随机、结果隐藏等功能。
 * @extends CraftPanel
 */
export class CraftPanelBlend extends CraftPanel {
    /**
     * 构造合成面板实例。
     * @param {JournalEntry|string} journalEntry 对应的 JournalEntry 或其 UUID
     * @param {"edit"|"craft"} mode 面板模式
     * @param {object} options 额外初始化参数
     */
    constructor(journalEntry, mode = "edit", options = {}) {
        super(journalEntry, mode, options);

        this.results = [];
        this.recipes = [];
        this.recipesCanShow = [];

        this.scrollPositions.recipes = 0;
        this.categories.recipes = [];
        this.category.recipes = "all";

        if (game.user.isGM) {
            this.options.actions["new-recipe"] = this.newRecipe.bind(this);
            this.options.actions["config-user-unlocked"] = this.configUserUnlocked.bind(this);
        }
    }

    /**
     * 默认窗口配置。
     * @returns {object}
     */
    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID],
            window: {
                icon: "fa-regular fa-flask-round-potion",
                controls: [{
                    icon: "fas fa-user-lock",
                    action: "config-user-unlocked",
                    label: `${MODULE_ID}.${this.APP_ID}.unlock-recipe`,
                }, {
                    icon: "fas fa-plus",
                    action: "new-recipe",
                    label: `${MODULE_ID}.${this.APP_ID}.new-recipe`,
                }],
            },
        };
    }

    /**
     * 默认面板尺寸配置。
     * @returns {object}
     */
    get DEFAULT_PANEL_SIZES() {
        return {
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
                height: 75,
            },
            results: {
                width: 600,
                height: 100,
            },
        };
    }

    /**
     * 组装渲染数据，附加配方列表到渲染上下文。
     * @param {object} options 渲染选项
     * @returns {Promise<object>} 渲染数据
     */
    async getData(options) {
        const data = await super.getData(options);
        data.recipes = this.recipes; //左侧显示的配方

        return data;
    }

    /**
     * 首次渲染时绑定配方面板的拖放、点击和右键事件。
     * @param {object} context 渲染上下文
     * @param {object} options 渲染选项
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        const html = $(this.element);
        html.on("drop", ".craft-content.edit .craft-recipes-panel", this._onDropRecipesPanel.bind(this));
        html.on("click", ".craft-content.edit .craft-recipe", this._onClickRecipe.bind(this));
        html.on("contextmenu", ".craft-content.edit .craft-recipe", this._onContextMenuRecipe.bind(this));
    }

    /**
     * 处理配方的点击事件，打开配方编辑面板。
     * @param {Event} event 点击事件
     */
    _onClickRecipe(event) {
        event.preventDefault();
        const recipeJEUuid = event.currentTarget.dataset.uuid;
        this.editRecipe(recipeJEUuid);
    }

    /**
     * 处理配方的右键事件，弹出删除确认对话框。
     * @param {Event} event 右键事件
     */
    async _onContextMenuRecipe(event) {
        event.preventDefault();
        const recipeJEUuid = event.currentTarget.dataset.uuid;
        const recipeJE = await fromUuid(recipeJEUuid);
        await recipeJE.deleteDialog();
        this.needRefresh = true;
        await this.render(true);
    }
    /**
     * 处理物品或随机表放置在配方面板中的事件
     * @param {Event} event
     */
    async _onDropRecipesPanel(event) {
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        if (data.type !== "Item" && data.type !== "RollTable") return;
        const item = await fromUuid(data.uuid);
        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: item.name,
                src: item.img,
                "text.content": foundry.utils.getProperty(item, this.descriptionPath) ?? item.description ?? "",
                flags: {
                    [MODULE_ID]: {
                        type: "recipe",
                        results: [{ uuid: item.uuid, quantity: 1, img: item.img, name: item.name, type: data.type }],
                        ...this.createRecipeData(),
                    },
                },
            },
        ]);
        this.needRefresh = true;
        await this.render(true);
    }
    /**
     * 刷新结果
     */
    async refreshResults() {
        this.results = [];
        // debug("CraftPanelBlend.refreshResults", this.elements.map(el => el.num), this.slotItems);
        const showResult = this.journalEntry.getFlag(MODULE_ID, "showResult");
        if ((showResult === "show" || showResult === "question mark" || showResult == "by unlock") && this.checkSlot()) {
            let recipes = await this.matchRecipe();
            // debug("CraftPanelBlend.refreshResults", recipes);
            if (recipes.length > 0) {
                if ((recipes.length > 1) || (showResult === "question mark") || (showResult === "by unlock" && (this.recipesCanShow.find(r => r.id == recipes[0].id) === undefined))) {
                    this.results.push({
                        name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unknown-result`),
                        img: "icons/magic/symbols/question-stone-yellow.webp",
                        empty: "empty",
                        tooltip: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unknown-result`),
                        slotIndex: 0,
                        size: this.panelSizes.results.height * 0.6,
                    });
                } else {
                    await Promise.all((recipes[0].getFlag(MODULE_ID, "results") ?? []).map(async (re, i) => {
                        const item = await fromUuid(re.uuid);
                        const itemColor = re.type == "Item" ? getItemColor(item) ?? "" : "";
                        const elements = item.getFlag(MODULE_ID, "element") ?? [];
                        const tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h2>${item.name}</h2></figure><div class="description">${foundry.utils.getProperty(item, this.descriptionPath) ?? item?.description ?? ""}</div><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
                        this.results.push({
                            name: item?.name ?? re.name,
                            img: item?.img ?? re.img,
                            quantity: re.quantity,
                            uuid: re.uuid,
                            empty: "",
                            itemColor,
                            slotIndex: i,
                            tooltip,
                            size: this.panelSizes.results.height * 0.6,
                        });
                    }));
                }
            }
        }
        // debug("CraftPanelBlend.refreshResults", this.results[0]);
    }
    /**
     * 刷新材料面板：重新获取配方列表，处理解锁权限、分类筛选和显示控制。
     */
    async refreshPanel() {
        await super.refreshPanel();
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
                    if (unlockConfig.ownership == DEFAULT_OWNERSHIP["canShow"]) {
                        canShow = true;
                    } else if (unlockConfig.ownership == DEFAULT_OWNERSHIP["canUse"]) {
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
        this.recipesCanShow = recipesJE;
        if (this.category.recipes != "all") {
            recipesJE = recipesJE.filter(r => (r.getFlag(MODULE_ID, "category") ?? []).includes(this.category.recipes));
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
            let showResult = je.getFlag(MODULE_ID, "showResult") ?? "yes";
            let resultToolTip = "";
            if (showResult != "no") {
                let results = je.getFlag(MODULE_ID, "results") ? JSON.parse(JSON.stringify(je.getFlag(MODULE_ID, "results"))) : [];
                if (results.length > 0) {
                    resultToolTip = `<div class="tooltip-elements">${results.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.quantity}</div></div>` }).join('')}</div>`;
                }
            }
            let tooltip = await TextEditor.enrichHTML(`<figure><img src='${je.src}'><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div>${resultToolTip}`);
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
    }

    /**
     * 创建新配方的默认数据，包含当前选中的分类。
     * @returns {object} 默认配方数据
     */
    createRecipeData() {
        const DEFAULT_RECIPE_DATA = {
            isLocked: false,
            ingredients: [],
            weight: 100,
            unlockCondition: "",
            craftScript: "",
            category: [],
        }
        const ret = foundry.utils.deepClone(DEFAULT_RECIPE_DATA);
        const categories = this.categories.recipes.filter(i => i.choosed && i.id != 'all' && i.id != 'add');
        for (const key in categories) ret.category.push(categories[key].name)
        return ret;
    }
    /**
     * 编辑配方
     */
    async editRecipe(recipeJEUuid) {
        const recipeJE = await fromUuid(recipeJEUuid);
        const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelRecipe));
        if (openWindow) openWindow.close();
        else {
            // pass the recipe uuid to the recipe panel so it can scroll to the chosen recipe
            let newWindow = new CraftPanelRecipe(this.journalEntry, recipeJE, { focusRecipeUuid: recipeJE.uuid });
            newWindow.parentPanel = this;
            newWindow.render(true);
        };
    }
    /**
     * 匹配配方：根据当前槽位中的元素和材料，匹配所有符合条件的配方并按匹配度排序。
     * @returns {Promise<JournalEntryPage[]>} 匹配到的配方列表
     */
    async matchRecipe() {
        let recipes = [];
        const slotMaterials = [];
        //将材料整理成类似元素的格式
        Object.values(this.slotItems).forEach(data => {
            if (data) {
                if (slotMaterials.some(el => el.id == data.name)) {
                    slotMaterials.find(el => el.id == data.name).num++;
                } else {
                    slotMaterials.push({
                        num: 1,
                        id: data.name,
                    });
                }
            }
        });
        this.recipesJE.forEach(recipe => {
            let ingredients = recipe.getFlag(MODULE_ID, "ingredients") ?? [];
            let elements = ingredients.filter(el => el.type == "element");
            let materials = ingredients.filter(el => el.type == "material");

            //只有元素和材料需求都匹配时才能匹配到配方
            if (CraftPanel.checkCraftElements(this.elements, elements) && CraftPanel.checkCraftElements(slotMaterials, materials)) {
                //计算匹配度
                let match = 0;
                if (elements.length > 0) {
                    match = CraftPanelBlend.checkCraftElementsMatch(this.elements, elements) * 10;
                    //取元素成分最大的元素为主元素，增加额外的匹配度
                    let mainElement = this.elements.filter(el => el.num == this.elements[0].num);
                    match += CraftPanelBlend.checkCraftElementsMatch(mainElement, elements);
                }
                //材料的匹配度效力更大
                if (materials.length > 0) {
                    let num = CraftPanelBlend.checkCraftElementsMatch(slotMaterials, materials);
                    if (num > 0) {
                        match += num * 100;
                    }
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
        //按匹配度排序，取最高匹配度的配方
        recipes.sort((a, b) => b.match - a.match);
        recipes = recipes.filter(el => el.match == recipes[0].match);
        recipes = recipes.map(el => el.recipe);
        return recipes;
    }

    /**
     * 各个界面用于自定义配置界面的函数的占位符，方便后续添加配置选项时调用
     * @param {Array} configOptions 
     */
    fillConfigOptions() {
        const showResultOptions = {
            "none": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.not-show`),
            "show": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.show`),
            "question mark": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.question-mark`),
            "by unlock": game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.by-unlock`),
        };
        const configOptions = super.fillConfigOptions();
        configOptions.find(c => c.id == "general")?.options?.push(
            { ftype: "checkbox", name: `flags.${MODULE_ID}.unlockRecipe`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-recipe`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.unlock-recipe-hint`) },
            { ftype: "checkbox", name: `flags.${MODULE_ID}.mergeByName`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.merge-by-name`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.merge-by-name-hint`) },
            { ftype: "select", name: `flags.${MODULE_ID}.showResult`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.show-result`), options: showResultOptions, hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.show-result-hint`) },
        );
        return configOptions;
    }

    /**
     * 合成前准备：重置选中配方，返回面板状态数据。
     * @param {Array} materials 材料列表
     * @returns {Promise<object>} 合成前数据
     */
    async preCraft(materials) {
        this.selectedRecipe = undefined;
        return {
            data: this,
            panel: this.journalEntry,
            actor: this.actor,
            recipes: this.recipesJE,
            elements: this.elements,
            materials: materials,
            canceled: this.canceled,
        }
    }

    /**
     * 获取合成结果：匹配配方后收集结果，处理随机表、执行配方脚本并触发 Hook。
     * @param {Array} materials 材料列表
     * @param {Array} results 结果列表（会被填充）
     * @returns {Promise<object|false>} 合成结果数据，失败返回 false
     */
    async getCraftResult(materials, results) {
        //匹配配方
        const recipes = await this.matchRecipe();
        if (recipes.length > 0) {
            if (recipes.length == 1) {
                this.selectedRecipe = recipes[0];
            } else {
                //根据权重随机选择一个配方
                let weights = recipes.map(recipe => recipe.getFlag(MODULE_ID, "weight") ?? 100);
                let totalWeight = weights.reduce((a, b) => a + b, 0);
                let randomWeight = Math.random() * totalWeight;
                let cumulativeWeight = 0;

                for (let i = 0; i < recipes.length; i++) {
                    cumulativeWeight += weights[i];
                    if (randomWeight < cumulativeWeight) {
                        this.selectedRecipe = recipes[i];
                        break;
                    }
                }
            }
            //获取配方结果
            let jeResults = this.selectedRecipe.getFlag(MODULE_ID, "results") ?? [];
            for (let re of jeResults) {
                const item = await fromUuid(re.uuid);
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
                            for (const r of object.results) {
                                let uuid = r.documentCollection + "." + r.documentId;
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
                                if (!resultItem) {
                                    // @ts-ignore
                                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.tableItemNotFound`) + r.name);
                                    this.canceled = true;
                                    return false;
                                }
                                let result = results.find(r => r.uuid == uuid);
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
            //获取配方的handler配置
            let craftAsHandler = this.selectedRecipe.getFlag(MODULE_ID, "craftAsHandler");
            let handlerTemplate = this.selectedRecipe.getFlag(MODULE_ID, "handlerTemplate");
            if (handlerTemplate) this.handlerTemplate = handlerTemplate;
            if (craftAsHandler == 'yes') {
                this.craftAsHandler = true;
            } else if (craftAsHandler == 'no') {
                this.craftAsHandler = false;
            }
            //执行配方的脚本
            const craftScript = this.selectedRecipe.getFlag(MODULE_ID, "craftScript");
            if (craftScript && craftScript.trim() != "") {
                const fn = new AsyncFunction("data", "panel", "actor", "recipes", "elements", "materials", "recipe", "results", "canceled", craftScript);
                try {
                    await fn(this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, this.selectedRecipe, results, this.canceled);
                } catch (e) {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                    console.error(e);
                }
            }
            await Hooks.call(this.APP_ID + "Recipe", this, this.journalEntry, this.actor, this.recipesJE, this.elements, materials, this.selectedRecipe, results, this.canceled);
        }

        return {
            data: this,
            panel: this.journalEntry,
            actor: this.actor,
            recipes: this.recipesJE,
            elements: this.elements,
            materials: materials,
            recipe: this.selectedRecipe,
            results: results,
            canceled: this.canceled,
        }
    }

    /**
     * 最终确定合成结果：处理按名称合并逻辑，将产物添加到更新队列。
     * @param {Array} materials 材料列表
     * @param {Array} results 结果列表
     * @returns {Promise<{updates: object, toDelete: Array, products: Array}>}
     */
    async finalizeCraftResult(materials, results) {
        this.mergeByName = this.journalEntry.getFlag(MODULE_ID, "mergeByName") ?? false;
        if (this.selectedRecipe && this.selectedRecipe.getFlag(MODULE_ID, "mergeByName") != undefined) {
            if (this.selectedRecipe.getFlag(MODULE_ID, "mergeByName") == "yes") {
                this.mergeByName = true;
            } else if (this.selectedRecipe.getFlag(MODULE_ID, "mergeByName") == "no") {
                this.mergeByName = false;
            }
        }
        const { updates, toDelete, products } = await super.finalizeCraftResult(materials, results);
        if (this.mergeByName) {
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
                    if (r.foundry.utils.getProperty(item, this.quantityPath) != undefined) {
                        r.foundry.utils.getProperty(item, this.quantityPath) = r.quantity;
                    }
                    products.push(r.item);
                }
            });
        } else {
            results.forEach(r => {
                if (r.foundry.utils.getProperty(item, this.quantityPath) != undefined) {
                    r.foundry.utils.getProperty(item, this.quantityPath) = r.quantity;
                }
                products.push(r.item);
            });
        }
        return { updates, toDelete, products };
    }

    /**
     * 合成后处理：如果启用了自动解锁，将合成成功的配方添加到用户的已解锁列表。
     * @param {Array} materials 材料列表
     * @param {Array} results 结果列表
     */
    async postCraft(materials, results) {
        //解锁配方
        if (this.selectedRecipe && !this.canceled && !game.user.isGM && this.journalEntry.getFlag(MODULE_ID, "unlockRecipe")) {
            const unlockedRecipes = game.user.getFlag(MODULE_ID, "unlockedRecipes") ?? [];
            if (!unlockedRecipes.some(el => el.id == this.selectedRecipe.id)) {
                unlockedRecipes.push({ id: this.selectedRecipe.id, name: this.selectedRecipe.name, img: this.selectedRecipe.src, ownership: DEFAULT_OWNERSHIP["canShow"] });
                await game.user.setFlag(MODULE_ID, "unlockedRecipes", unlockedRecipes);
            }
        }
        await super.postCraft(materials, results);
    }

    /**
     * 创建新配方页面并刷新面板。
     * @param {Event} event 点击事件
     */
    async newRecipe(event) {
        event.preventDefault();
        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.new-recipe`),
                src: "icons/sundries/documents/document-torn-diagram-tan.webp",
                "text.content": "",
                flags: {
                    [MODULE_ID]: {
                        type: "recipe",
                        results: [],
                        ...this.createRecipeData(),
                    },
                },
            },
        ]);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 打开或关闭用户配方解锁管理面板（GM 专用）。
     * @param {Event} event 点击事件
     */
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

    /**
     * 检查当前元素与需求元素的匹配程度
     * 实际为检查当前元素中相比于需求元素多出来的元素种类和数量
     * 当前元素中每比需求元素多一种元素，匹配程度-1
     * 对于有最小值要求的元素，匹配度为最小值乘以10
     * 对于仅有最大值要求的元素，每有一个，匹配程度-1
     * @param {CraftElement[]} elements 当前元素
     * @param {CraftElement[]} craftElements 需求元素
     * @returns {number} 匹配程度
     */
    static checkCraftElementsMatch(elements, craftElements) {
        let match = 0;
        for (let el of elements) {
            let el2 = craftElements.find((el3) => el3.id === el.id);
            if (!el2) match -= (el.weight ?? 10) * 0.1;
            if (el2?.useMin) match += el2.min * (el2.weight ?? 10);
            if (el2?.useMax && !el.useMin) match -= el.num;
        }
        return match;
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