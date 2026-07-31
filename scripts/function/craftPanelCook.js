import { AsyncFunction, getItemColor, MODULE_ID, debug } from "../utils.js";
import { CraftPanelForge } from "./craftPanelForge.js";
import { FormBuilder } from "./formBuilder.js";
import { CraftPanelCookRecipe } from "./craftPanelCookRecipe.js";

/**
 * 烹饪面板。
 * 继承自 CraftPanelForge，在锻造系统基础上增加了配方保存/恢复功能。
 * 合成成功后会自动保存当前配方到用户 flag 中，方便下次快速填充。
 * @extends CraftPanelForge
 */
export class CraftPanelCook extends CraftPanelForge {
    /**
     * 构造烹饪面板实例。
     * @param {JournalEntry|string} journalEntry 对应的 JournalEntry 或其 UUID
     * @param {"edit"|"craft"} mode 面板模式
     * @param {object} options 额外初始化参数
     */
    constructor(journalEntry, mode = "edit", options = {}) {
        super(journalEntry, mode, options);

        if (game.user.isGM) {
            this.options.actions["config-user-unlocked"] = this.configUserUnlocked.bind(this);
        }
        this.options.window.controls.push({
            icon: "fas fa-list-check",
            action: "recipe",
            label: `${MODULE_ID}.recipes`,
        })
        this.options.actions.recipe = this.fillByRecipe.bind(this);
    }

    /**
     * 默认窗口配置。
     * @returns {object}
     */
    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID],
            window: {
                icon: "fa-solid fa-utensils",
                controls: [{
                    icon: "fas fa-user-lock",
                    action: "config-user-unlocked",
                    label: `${MODULE_ID}.craft-panel-cook.edit-recipe`,
                }],
            },
        };
    }

    /**
     * 合成后处理：将本次合成的配方保存到用户 flag 中。
     * 如果存在相同面板且产物相同的配方则覆盖，否则追加。
     * @param {Array} materials 材料列表
     * @param {Array} results 结果列表
     */
    async postCraft(materials, results) {
        if (!this.canceled) {
            //保存的配方
            /**@type {Recipe} */
            const recipe = {
                panelUuid: this.journalEntry.uuid,
                products: results.map(re => {
                    return {
                        name: re.name,
                        img: re.img,
                        quantity: foundry.utils.getProperty(re.item, this.quantityPath) ?? re.item?.quantity ?? 1,
                        description: re.description
                    }
                }),
                materials: materials.map(m => {
                    return {
                        name: m.item.name,
                        img: m.item.img,
                        quantity: m.quantity
                    }
                }),
                selectedModifiers: this.selectedModifiers?.map(m => {
                    return {
                        uuid: m.uuid,
                        name: m.name,
                        img: m.src
                    }
                }) ?? [],
                slotItems: Object.entries(this.slotItems).map(([k, v]) => { return { key: k, name: v.name, quantity: v.quantity } }),
                elements: this.elements,
            };
            //获取所有保存的配方，如果存在相同的配方则替换，不存在则添加
            /**@type {Recipe[]} */
            const storedRecipe = game.user.getFlag(MODULE_ID, "storedRecipe") ?? [];
            //查找是否存在相同的配方
            let findSameRecipe = storedRecipe.find(el => {
                /**
                 * 判断配方是否相同的条件：
                 * 1. 面板uuid相同，确保是同一个面板的配方。
                 * 2. 产物存在且产物大体相同，确保配方的结果相同。这里仅比较了名称、图标和描述。
                 * 3. 产物的名称、图标和描述均相同即认为是同一配方，允许材料和调整的不同。因为同一配方可能正是需要优化材料和调整来修改配方。
                 */
                if (recipe.panelUuid !== el.panelUuid) return false;
                if (!el.products || !recipe.products) return false;
                let result = true;
                for (let product of recipe.products) {
                    let findProduct = el.products.find(p => p.name == product.name);
                    if (!findProduct || findProduct.img != product.img || findProduct.description != product.description) {
                        result = false;
                        break;
                    }
                }
                return result;
            });
            if (!findSameRecipe) {
                storedRecipe.push(recipe);
            } else {
                storedRecipe.splice(storedRecipe.indexOf(findSameRecipe), 1, recipe);
            }
            await game.user.setFlag(MODULE_ID, "storedRecipe", storedRecipe);
        }
        await super.postCraft(materials, results);
    }

    /**
     * 打开配方选择子面板（当前用户）。
     * @param {Event} event 点击事件
     */
    async fillByRecipe(event) {
        event.preventDefault();
        //配置用户解锁的配方
        const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelCookRecipe));
        if (openWindow) openWindow.close();
        else {
            let storedRecipe = game.user.getFlag(MODULE_ID, "storedRecipe") ?? [];
            let newWindow = new CraftPanelCookRecipe(this.journalEntry, storedRecipe.filter(r => r.panelUuid == this.journalEntry.uuid));
            newWindow.parentPanel = this;
            newWindow.render(true);
        };
    }

    /**
     * GM 配置指定玩家的已保存配方。
     * 弹出用户选择对话框，然后打开该用户的配方子面板。
     * @param {Event} event 点击事件
     */
    async configUserUnlocked(event) {
        event.preventDefault();
        //GM配置玩家解锁的配方
        //弹窗选择用户
        const userOptions = {};
        game.users.forEach(u => {
            userOptions[u.id] = u.name + (u.isGM ? ` (${game.i18n.localize(`USER.GM`)})` : "");
        });
        const fb = new FormBuilder()
            .title(game.i18n.localize(`${MODULE_ID}.craft-panel-cook.choose-user`))
            .select({ name: "user", label: game.i18n.localize(`${MODULE_ID}.craft-panel-cook.choose-user`), options: userOptions });
        const data = await fb.render();
        if (!data || !data.user) return;
        const user = game.users.get(data.user);
        //配置用户解锁的配方
        const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelCookRecipe));
        if (openWindow) openWindow.close();
        else {
            let storedRecipe = user.getFlag(MODULE_ID, "storedRecipe") ?? [];
            let newWindow = new CraftPanelCookRecipe(this.journalEntry, storedRecipe.filter(r => r.panelUuid == this.journalEntry.uuid), this.mode);
            newWindow.parentPanel = this;
            newWindow.render(true);
        };
    }

    /**
     * 配方子页面选择了配方后返回函数，将配方的内容进行填充。
     * 依次填充结果、材料和调整项。
     * @param {Recipe} recipe 填充的配方数据
     */
    async fillByRecipe_Back(recipe) {
        //清空槽位
        this.slotItems = {};
        //清空选择的调整
        this.choosedModifiers = [];
        //修改结果物品的图标、名称和描述
        recipe.products.map((re, index) => {
            let result = this.results[index];
            result.name = re.name;
            result.img = re.img;
            result.description = re.description;
        });
        //逐一将材料添加至槽位中
        for (let el of recipe.slotItems) {
            let materials = this.materials.filter(m => m.item.name == el.name);
            if (materials.length <= 0) {
                ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.notEnoughMaterial`) + ":" + el.name);
                continue;//继续添加剩余的材料，允许部分材料不足但仍然可以添加配方
            }
            let canAdd = false;
            for (let material of materials) {
                canAdd = await this.checkAdd(el.key, material.item);
                if (canAdd) {
                    await this.addIngredient(el.key, material.item, { skipRender: true, skipRefresh: true });
                    while (this.slotItems[el.key].quantity < el.quantity && await this.checkAdd(el.key, material.item)) {
                        await this.addIngredient(el.key, material.item, { skipRender: true, skipRefresh: true });
                    }
                    break; //找到一个可以添加的材料就添加完毕后跳出循环，进行下一个材料的添加
                }
            }
            if (!canAdd) {
                ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.noCanAddMaterial`) + ":" + el.name);
                continue;//继续添加剩余的材料，允许部分材料无法添加但仍然可以添加配方
            }
        }
        //逐一选择相应的调整
        for (let el of recipe.selectedModifiers) {
            const modifierJE = await fromUuid(el.uuid);
            if (modifierJE) {
                await this.chooseModifier(el.uuid, true);
            } else {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.modifierNotFound`) + ":" + el.name);
                return; //调整不存在则停止填充，调整是合成界面的重要部分，无法找到调整说明合成界面异常，停止填充以避免错误发生
            }
        }
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
