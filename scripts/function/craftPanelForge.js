import { AsyncFunction, getItemColor, MODULE_ID, debug, confirmDialog, buildActiveEffect, _castArray, _castDelta, _applyAdd, _applyMultiply, _applyOverride, _applyUpgrade } from "../utils.js";
import { CraftPanel } from "./craftPanel.js";
import { CraftPanelModifier } from "./craftPanelModifier.js";
import { chooseImage } from "../api.js";
import { FormBuilder } from "../function/formBuilder.js";

export class CraftPanelForge extends CraftPanel {
    constructor(journalEntry, mode = "edit", options = {}) {
        super(journalEntry, mode, options);
        debug(`${this.APP_ID} constructor : journalEntry mode options`, journalEntry, mode, options);

        // this.results = journalEntry.getFlag(MODULE_ID, "results") ? JSON.parse(JSON.stringify(journalEntry.getFlag(MODULE_ID, "results"))) : [];
        const results = journalEntry.getFlag(MODULE_ID, "results");
        this.results = results ? foundry.utils.deepClone(results) : [];
        this.modifiers = [];

        this.scrollPositions.modifiers = 0;
        this.categories.modifiers = [];
        this.category.modifiers = "all";
        this.baseCost = journalEntry.getFlag(MODULE_ID, "baseCost") ?? 0;
        this.cost = {
            value: this.baseCost,
            max: this.baseCost,
            icon: journalEntry.getFlag(MODULE_ID, "costIcon") ?? "",
            element: journalEntry.getFlag(MODULE_ID, "costElement") ?? "",
        }
        this.modifierLimit = journalEntry.getFlag(MODULE_ID, "modifierLimit") ?? 0;
        /**@type {string[]} */
        this.choosedModifiers = [];
        /**@type {string[]} */
        this.choosedResults = [];
        if (this.results.length == 1) {
            this.choosedResults = [this.results[0].uuid];
        }

        if (game.user.isGM) {
            this.options.actions["new-modifier"] = this.newModifier.bind(this);
        }
    }

    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID],
            window: {
                icon: "fa-solid fa-hammer",
                controls: [{
                    icon: "fas fa-plus",
                    action: "new-modifier",
                    label: `${MODULE_ID}.craft-panel-forge.new-modifier`,
                }],
            },
        };
    }

    get DEFAULT_PANEL_SIZES() {
        return {
            modifiers: {
                width: 300,
                height: 470,
            },
            materials: {
                width: 300,
                height: 540,
            },
            slots: {
                width: 600,
                height: 200,
            },
            elements: {
                width: 600,
                height: 75,
            },
            results: {
                width: 600,
                height: 200,
            },
        };
    }

    //准备界面所需的各项数据
    async getData(options) {
        debug(`${this.APP_ID} getData`);
        const data = await super.getData(options);
        await this.refreshModifiers();

        const alterResultsClass = ["craft-panel-enchant"];
        if (!alterResultsClass.includes(this.APP_ID)) {
            const results = await Promise.all(this.results.map(async (el, i) => {
                const item = await fromUuid(el.uuid);
                const itemColor = item ? getItemColor(item) ?? "" : "";
                let tooltip = await TextEditor.enrichHTML(`<figure><img src='${el.img ?? item?.img}'><h2>${el.name ?? item?.name}</h2></figure><div class="description">${el.description ?? item?.system?.description ?? item?.description ?? ""}</div>`);
                const overrideStyle = (el.shape ?? "default") !== "default";
                const overrideStyleClass = el.shape == "circle" ? "round" : "";
                const choosed = this.choosedResults.includes(el.uuid) ? "choosed" : "";
                return {
                    slotIndex: i,
                    uuid: el.uuid,
                    quantity: el.quantity,
                    name: el.name ?? item?.name,
                    img: el.img ?? item?.img,
                    itemColor: itemColor,
                    tooltip,
                    size: el.size ?? Math.min(this.panelSizes.results.width, this.panelSizes.results.height) * 0.6,
                    overrideStyle,
                    overrideStyleClass,
                    choosed,
                };
            }));
            data.results = results;
        }

        let modifiers = this.modifiers;
        this.category.modifiers = this.categories.modifiers.find(c => c.choosed)?.id;
        if (this.category.modifiers != "all") {
            modifiers = modifiers.filter(m => m.category.includes(this.category.modifiers));
        }

        data.modifiers = modifiers;
        data.cost = this.cost;

        return data;
    }

    /**
     * 绑定各项元素的互动效果
     * @returns {}
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        debug(`${this.APP_ID} _onFirstRender : context options`, context, options);
        const html = $(this.element);
        html.on("drop", ".craft-modifiers-panel", this._onDropModifierPanel.bind(this));
        html.on("click", ".craft-modifier", this._onClickModifier.bind(this));
        html.on("contextmenu", ".craft-content.edit .craft-modifier", this._onContextMenuModifier.bind(this));
        html.on("drop", ".craft-results-panel", this._onDropResultPanel.bind(this));
        html.on("drop", ".craft-cost-panel", this._onDropCostPanel.bind(this));
        html.on("change", ".craft-content.edit .craft-cost-panel input[name='cost']", this._onChangeCost.bind(this));
        html.on("click", ".craft-results-panel .craft-slot", this._onClickResult.bind(this));
        html.on("contextmenu", ".craft-results-panel .craft-slot", this._onContextMenuResult.bind(this));
    }

    async _onDropResultPanel(event) {
        debug(`${this.APP_ID} _onDropResultPanel`);
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug(`${this.APP_ID} _onDropResultPanel : data`, data);

        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        if (type !== "Item" && type !== "RollTable") return;
        if (item) {
            let r = this.results.find((r) => r.uuid == item.uuid);
            if (r) {
                r.quantity++;
            } else {
                this.results.push({
                    uuid: item.uuid,
                    quantity: 1,
                    weight: item.system?.weight ?? 0,
                    autoQuantity: false,
                    autoWeight: false,
                    originWeight: true,
                    img: item.img,
                    images: [{ name: item.img, src: item.img }],
                    name: item.name,
                    type: type,
                    description: item?.system?.description ?? item?.description ?? "",
                    size: Math.min(this.panelSizes.results.width, this.panelSizes.results.height) * 0.6,
                    shape: "default",
                });
            }
            this.journalEntry.setFlag(MODULE_ID, "results", this.results);
            await this.render(true);
        }
    }
    async _onDropModifierPanel(event) {
        debug(`${this.APP_ID} _onDropModifierPanel`);
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug(`${this.APP_ID} _onDropModifierPanel : data`, data);

        if (data.type !== "Item" && data.type !== "ActiveEffect") return;
        const item = await fromUuid(data.uuid);
        let changes = [];
        if (data.type === "ActiveEffect") {
            changes = foundry.utils.deepClone(item.changes);
        } else if (data.type === "Item") {
            item.effects.forEach(effect => {
                changes.push(...effect.changes);
            });
        }
        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: item.name,
                src: item.img,
                "text.content": item.system?.description ?? item.description ?? "",
                flags: {
                    [MODULE_ID]: {
                        type: "modifier",
                        changes: changes,
                        ...this.createModifierData(),
                    },
                },
            },
        ]);
        this.needRefresh = true;
        await this.render(true);
    }
    async _onClickModifier(event) {
        debug(`${this.APP_ID} _onClickModifier : isEdit`, this.isEdit);
        event.preventDefault();
        const modifierJEUuid = event.currentTarget.dataset.uuid;
        if (this.isEdit) {
            this.editModifier(modifierJEUuid);
        } else {
            await this.chooseModifier(modifierJEUuid);
        }
    }
    async _onContextMenuModifier(event) {
        debug(`${this.APP_ID} _onContextMenuModifier`);
        event.preventDefault();
        const modifierJEUuid = event.currentTarget.dataset.uuid;
        const modifierJE = await fromUuid(modifierJEUuid);
        await modifierJE.deleteDialog();
        this.needRefresh = true;
        await this.render(true);
    }
    async _onDropCostPanel(event) {
        debug(`${this.APP_ID} _onDropCostPanel`);
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug(`${this.APP_ID} _onDropCostPanel : data`, data);
        if (data.type !== "Item" && data.type !== "CraftElement") return;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        let element = data?.element;
        if (type == "Item") {
            if (item == undefined) return;
            if (item.getFlag(MODULE_ID, "isElement") === true) {
                element = item.getFlag(MODULE_ID, "elementConfig");
                this.cost.element = element.id;
                this.cost.icon = element.img;
                await this.journalEntry.setFlag(MODULE_ID, "costElement", element.id);
                await this.journalEntry.setFlag(MODULE_ID, "costIcon", element.img);
            } else {
                this.cost.icon = item.img;
                await this.journalEntry.setFlag(MODULE_ID, "costIcon", item.img);
            }
        } else if (type == "CraftElement") {
            if (item != undefined && element == undefined) {
                element = item.getFlag(MODULE_ID, "elementConfig");
            }
            if (element == undefined) return;
            this.cost.element = element.id;
            this.cost.icon = element.img;
            await this.journalEntry.setFlag(MODULE_ID, "costElement", element.id);
            await this.journalEntry.setFlag(MODULE_ID, "costIcon", element.img);
        }
        await this.render(true);
    }
    async _onChangeCost(event) {
        debug(`${this.APP_ID} _onChangeCost : name value`, event.target?.name, event.target?.value);
        const value = event.target.value;
        const name = event.target.name;
        if (name === "cost") {
            this.baseCost = Number(value);
            await this.journalEntry.setFlag(MODULE_ID, "baseCost", this.baseCost);
            await this.refreshCost();
            await this.render(true);
        }
    }
    async _onClickResult(event) {
        debug(`${this.APP_ID} _onClickResult : isEdit`, this.isEdit);
        event.preventDefault();
        const index = event.currentTarget.dataset.index;
        const result = this.results[index];
        const resultLimit = this.journalEntry.getFlag(MODULE_ID, "resultLimit") ?? 0;
        if (this.isEdit || this.choosedResults.includes(result.uuid)) {
            const fb = new FormBuilder()
                .title(game.i18n.localize(`${MODULE_ID}.craft-panel-forge.edit-result`))
                .object(result)
                .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
                .editor({ name: "description", label: game.i18n.localize(`${MODULE_ID}.description`) })
                .button({
                    label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.edit-image`),
                    callback: async () => {
                        if (this.isEdit) {
                            //编辑模式下，左键点击结果可以编辑结果
                            let images = await chooseImage(result.images, this.mode);
                            if (images) {
                                result.images = images;
                                result.img = images[0].src;
                            }
                        } else {
                            //制作模式下，左键点击结果可以选择图片
                            let images = await chooseImage(result.images, this.mode, { choosed: result.img, max: 1 });
                            if (images) {
                                result.img = images[0].src;
                            }
                        }
                    },
                    icon: "fas fa-edit",
                })
            if (this.isEdit) {
                fb.number({ name: "quantity", label: game.i18n.localize(`${MODULE_ID}.quantity`), min: 0 });
                fb.number({ name: "weight", label: game.i18n.localize(`${MODULE_ID}.weight`), min: 0 });
                fb.checkbox({ name: "autoQuantity", label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.auto-quantity`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.auto-quantity-hint`) });
                fb.checkbox({ name: "autoWeight", label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.auto-weight`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.auto-weight-hint`) });
                fb.checkbox({ name: "originWeight", label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.origin-weight`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.origin-weight-hint`), value: true });
                fb.number({ name: "size", label: game.i18n.localize(`${MODULE_ID}.size`), value: result.size ?? Math.min(this.panelSizes.results.width, this.panelSizes.results.height) * 0.6 });
                fb.select({ name: `shape`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.craft-panel.default`), ...CraftPanelForge.SHAPE_STYLE } });
            }

            const data = await fb.render();
            if (!data) return;
            result.name = data.name;
            result.description = data.description;
            if (this.isEdit) {
                result.quantity = data.quantity;
                result.weight = data.weight;
                result.autoQuantity = data.autoQuantity;
                result.autoWeight = data.autoWeight;
                result.originWeight = data.originWeight;
                result.size = data.size;
                result.shape = data.shape;
                this.journalEntry.setFlag(MODULE_ID, "results", this.results);
            }
            await this.render(true);
        } else if (resultLimit == 0 || this.choosedResults.length < resultLimit) {
            this.choosedResults.push(result.uuid);
            await this.render(true);
        }
    }
    async _onContextMenuResult(event) {
        debug(`${this.APP_ID} _onContextMenuResult : isEdit`, this.isEdit);
        event.preventDefault();
        const index = event.currentTarget.dataset.index;
        if (this.isEdit) {
            // 编辑模式下，右键点击槽位可以删除槽位
            const confirm = await confirmDialog(`${MODULE_ID}.craft-panel-forge.delete-confirm-title`, `${MODULE_ID}.craft-panel-forge.delete-confirm-info`, `${MODULE_ID}.yes`, `${MODULE_ID}.no`);
            if (confirm) {
                this.results.splice(index, 1);
                this.journalEntry.setFlag(MODULE_ID, "results", this.results);
                await this.render(true);
            }
        } else {
            this.choosedResults = this.choosedResults.filter(r => r !== event.currentTarget.dataset.uuid);
            await this.render(true);
        }
    }
    //刷新可用点数
    async refreshResults() {
        debug(`${this.APP_ID} refreshResults`);
        if (this.needRefresh) {
            this.baseCost = this.journalEntry.getFlag(MODULE_ID, "baseCost") ?? 0;
            this.cost.icon = this.journalEntry.getFlag(MODULE_ID, "costIcon") ?? "";
            this.cost.element = this.journalEntry.getFlag(MODULE_ID, "costElement") ?? "";
            //仅在特定情况下刷新调整
            this.modifiersJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "modifier").sort((a, b) => (a.sort - b.sort));
        }
        let cost = Number(this.baseCost ?? 0);
        let elementCost = 0;
        if (this.cost.element) {
            let element = this.elements.find(e => e.id == this.cost.element);
            if (element) {
                elementCost = Number(element.num ?? 0);
            }
        }
        cost += elementCost;

        const script = this.journalEntry.getFlag(MODULE_ID, "costScript");
        if (script && script.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "modifiers", "elements", "materials", "baseCost", "elementCost", "cost", script);
            let result = false;
            try {
                result = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.modifiers, this.elements, this.materials, this.baseCost, elementCost, this.cost);
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
            if (typeof result === "number") {
                cost = result;
            }
        }

        this.cost.max = cost;
    }
    //刷新调整面板
    async refreshModifiers() {
        debug(`${this.APP_ID} refreshModifiers`);
        this.cost.value = this.cost.max;
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
        this.modifiers = await Promise.all(this.modifiersJE.map(async (je, i) => {
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
            let skipCheck = false;
            let locked = je.getFlag(MODULE_ID, "isLocked") ? "locked" : "";
            const auto = je.getFlag(MODULE_ID, "auto") ?? false;
            const unlockCondition = je.getFlag(MODULE_ID, "unlockCondition");
            if (unlockCondition && unlockCondition.trim() != "") {
                const fn = new AsyncFunction("actor", "game", "modifier", "panel", unlockCondition);
                let result = undefined;
                try {
                    result = await fn(this.actor ?? game?.user?.character, game, je, this.journalEntry);
                } catch (e) {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                    console.error(e);
                }
                if (result === false || result == 'false') {
                    locked = "locked";
                } else if (result === true || result == 'true') {
                    locked = "";
                    skipCheck = true;
                } else if (result == 'unlock') {
                    locked = "";
                }
            }
            //检查是否满足条件，不满足则锁定
            if (!(skipCheck || locked)) {
                const elements = ingredients.filter(el => el.type == "element");
                const materials = ingredients.filter(el => el.type == "material");
                if (!CraftPanelForge.checkCraftElements(slotMaterials, materials) || !CraftPanelForge.checkCraftElements(this.elements, elements)) {
                    locked = "locked";
                }
            }
            const tooltip = await TextEditor.enrichHTML(`<figure><img src='${je.src}'><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div>`);
            let choosed = "";
            const cost = je.getFlag(MODULE_ID, "cost") ?? 0;
            if ((auto || this.choosedModifiers.includes(je.uuid)) && !locked) {
                choosed = "choosed";
                this.cost.value -= cost;
            }
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
                locked,
                auto,
                category: je.getFlag(MODULE_ID, "category") ?? [],
                choosed,
                cost,
                costInfo,
                costClass,
            };
        }));
        this.choosedModifiers = this.modifiers.filter(m => m.choosed).map(m => m.uuid);
        this.modifierLimit = Number(this.modifierLimit) || 0;
        const choosedCount = this.modifiers.filter(m => m.choosed && !m.auto).length;
        if (this.cost.value < 0 || (choosedCount > this.modifierLimit && this.modifierLimit > 0)) {
            this.modifiers.filter(m => m.choosed && !m.auto).forEach(m => {
                m.choosed = "";
                this.cost.value += m.cost;
            });
            this.choosedModifiers = this.modifiers.filter(m => m.choosed).map(m => m.uuid);
        }
    }

    //检查是否未选择结果
    checkNoResult() {
        debug(`${this.APP_ID} checkNoResult`);
        return this.choosedResults.length == 0;
    }
    async checkCraft() {
        debug(`${this.APP_ID} checkCraft`);
        if (this.checkNoResult()) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.must-choose-at-least-one-result`));
            return false;
        }
        if (!this.checkSlot()) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.must-fill-necessary-slot`));
            return false;
        };
        return true;
    }
    createModifierData() {
        debug(`${this.APP_ID} createModifierData`);
        const DEFAULT_MODIFIER_DATA = {
            isLocked: false,
            ingredients: [],
            unlockCondition: "",
            craftScript: "",
            category: [],
            asAE: false,
            cost: 1,
            auto: false,
        }
        const ret = foundry.utils.deepClone(DEFAULT_MODIFIER_DATA);
        const categories = this.categories.modifiers.filter(i => i.choosed && i.id != 'all' && i.id != 'add');
        for (const key in categories) ret.category.push(categories[key].name)
        return ret;
    }

    /**
     * 编辑调整
     */
    async editModifier(modifierJEUuid) {
        debug(`${this.APP_ID} editModifier : modifierJEUuid`, modifierJEUuid);
        const modifierJE = await fromUuid(modifierJEUuid);
        const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelModifier));
        if (openWindow) openWindow.close();
        else {
            let newWindow = new CraftPanelModifier(this.journalEntry, modifierJE, { focusModifierUuid: modifierJE.uuid });
            newWindow.parentPanel = this;
            newWindow.render(true);
        };
    }
    /**
     * 选择调整
     */
    async chooseModifier(modifierJEUuid) {
        debug(`${this.APP_ID} chooseModifier : modifierJEUuid`, modifierJEUuid);
        const modifierJE = await fromUuid(modifierJEUuid);
        const modifier = this.modifiers.find(m => m.uuid === modifierJE.uuid);
        if (modifier.auto) return;
        const cost = modifier.cost ?? modifierJE.getFlag(MODULE_ID, "cost") ?? 0;
        //如果已经选择了，则取消选择
        if (this.choosedModifiers.includes(modifierJE.uuid)) {
            this.choosedModifiers = this.choosedModifiers.filter(m => m !== modifierJE.uuid);
            // this.cost.value += cost;
        } else {
            //检查能否选择
            let choosedCount = this.modifiers.filter(m => m.choosed && !m.auto).length;
            if (modifier.locked || this.cost.value < cost || (choosedCount >= this.modifierLimit && this.modifierLimit > 0)) {
                return;
            }
            let categories = modifierJE.getFlag(MODULE_ID, "category") ?? [];
            if (categories.length > 0) {
                for (let category of categories) {
                    let limit = this.categories.modifiers.find(c => c.id == category)?.limit ?? 0;
                    if (limit > 0) {
                        let choosed = this.choosedModifiers.filter(m => this.modifiers.find(mo => mo.uuid == m).category.includes(category)).length;
                        if (choosed >= limit) {
                            return;
                        }
                    }
                }
            }
            //选择
            this.choosedModifiers.push(modifierJE.uuid);
            // this.cost.value -= cost;
        }
        await this.render(true);
    }

    /**
     * 各个界面用于自定义配置界面的函数的占位符，方便后续添加配置选项时调用
     * @param {Array} configOptions 
     */
    fillConfigOptions() {
        debug(`${this.APP_ID} fillConfigOptions`);
        const configOptions = super.fillConfigOptions();
        configOptions.find(c => c.id == "general")?.options?.push(
            { ftype: "number", name: `flags.${MODULE_ID}.resultLimit`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.result-limit`), min: 0, max: Math.max(this.results.length, 1), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.result-limit-hint`), step: 1 },
            { ftype: "number", name: `flags.${MODULE_ID}.modifierLimit`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.modifier-limit`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.modifier-limit-hint`), min: 0, step: 1 },
        );
        configOptions.splice(1, 0, {
            id: "cost",
            icon: "fa-solid fa-coins",
            label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.configure-cost-tab`),
            options: [
                { ftype: "number", name: `flags.${MODULE_ID}.baseCost`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.base-cost`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.base-cost-hint`) },
                { ftype: "file", name: `flags.${MODULE_ID}.costIcon`, type: "image", label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.cost-icon`) },
                { ftype: "text", name: `flags.${MODULE_ID}.costElement`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.cost-element`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.cost-element-hint`) },
                { ftype: "script", name: `flags.${MODULE_ID}.costScript`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.cost-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.cost-script-hint`) }
            ]
        })

        return configOptions;
    }
    async preCraft(materials) {
        debug(`${this.APP_ID} preCraft : materials`, materials);
        this.selectedModifiers = this.modifiersJE.filter(m => this.choosedModifiers.includes(m.uuid));
        return {
            data: this,
            panel: this.journalEntry,
            actor: this.actor,
            modifiers: this.selectedModifiers,
            elements: this.elements,
            materials: materials,
            canceled: this.canceled,
        }
    }
    async getCraftResult(materials, results) {
        debug(`${this.APP_ID} getCraftResult : materials results`, materials, results);
        //获取合成结果
        for (let id of this.choosedResults) {
            const re = this.results.find(r => r.uuid == id);
            const item = await fromUuid(re.uuid);
            if (item) {
                if (re.type == "Item") {
                    results.push({
                        item: item.toObject(),
                        quantity: re.quantity,
                        weight: re.weight,
                        originWeight: re.originWeight,
                        autoWeight: re.autoWeight,
                        autoQuantity: re.autoQuantity,
                        uuid: re.uuid,
                        name: re.name,
                        img: re.img,
                        description: re.description
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
                                    weight: re.weight,
                                    uuid: uuid,
                                    name: re.name,
                                    img: re.img,
                                    description: re.description,
                                    originWeight: re.originWeight,
                                    autoWeight: re.autoWeight,
                                    autoQuantity: re.autoQuantity
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
        //消耗的材料的总重量（用于自动计算数量和重量）
        let totalWeight = 0;
        for (let m of materials) {
            if (m.item?.system?.weight != undefined && m.isConsumed) {
                totalWeight += Number(m.item.system.weight) * Number(m.quantity);
            }
        }
        //生成的产物的总数量（用于自动计算重量时）
        let totalQuantity = 0;
        for (let r of results) {
            if (r.quantity != undefined) {
                totalQuantity += Number(r.quantity);
            }
        }
        if (totalQuantity == 0) {
            totalQuantity = 1;
        }
        results.forEach(r => {
            if (r.item?.system?.quantity != undefined && r.quantity != undefined) {
                r.item.system.quantity = r.quantity;
                if (r.autoQuantity ?? false) {
                    r.item.system.quantity = Math.floor(totalWeight / ((r.weight ?? 1) == 0 ? 1 : (r.weight ?? 1)));
                    if (r.item.system.quantity < 1) {
                        r.item.system.quantity = 1;
                    }
                }
            }
            if (r.item?.system?.weight != undefined && r.weight != undefined && !r.originWeight) {
                r.item.system.weight = r.weight;
                if (r.autoWeight ?? false) {
                    r.item.system.weight = totalWeight / totalQuantity;
                }
            }
            r.item.name = r.name;
            r.item.img = r.img;

            //添加描述
            if (r.item?.system?.description) {
                r.item.system.description = r.description;
                r.item.system.description += `<h2>${game.i18n.localize(MODULE_ID + ".element")}</h2><p>`;
                for (let el of this.elements) {
                    r.item.system.description += `${el.name} ${el.num}; </div>`;
                }
                r.item.system.description += `</p>`;
                for (let je of this.selectedModifiers) {
                    r.item.system.description += `<h2>${je.name}</h2><div class="description">${je.text.content ?? ""}</div>`;
                }
            }
            //保存调整信息
            r.item.flags ??= {};
            r.item.flags[MODULE_ID] ??= {};
            r.item.flags[MODULE_ID].modifiers = this.selectedModifiers.map(m => {
                return {
                    uuid: m.uuid,
                    name: m.name,
                    img: m.src
                }
            });
        });
        //应用调整
        if (this.selectedModifiers.length > 0) {
            await this.applyModifier(this.selectedModifiers, results);
        }
        return {
            data: this,
            panel: this.journalEntry,
            actor: this.actor,
            modifiers: this.selectedModifiers,
            elements: this.elements,
            materials: materials,
            results: results,
            canceled: this.canceled,
        }
    }
    async finalizeCraftResult(materials, results) {
        debug(`${this.APP_ID} finalizeCraftResult : materials results`, materials, results);
        const { updates, toDelete, products } = await super.finalizeCraftResult(materials, results);
        products.push(...results.map(r => r.item));
        return { updates, toDelete, products };
    }
    async postCraft(materials, results) {
        debug(`${this.APP_ID} postCraft : canceled`, this.canceled);
        this.choosedModifiers = [];
        await super.postCraft(materials, results);

        if (this.keepMaterials && !this.canceled && this.selectedModifiers) {
            //逐一选择相应的调整
            for (let el of this.selectedModifiers) {
                await this.chooseModifier(el.uuid);
            }
        } else if (this.results.length == 1) {
            this.choosedResults = [this.results[0].uuid];
        } else {
            this.choosedResults = [];
        }
    }

    //应用调整
    async applyModifier(selectedModifiers, results) {
        debug(`${this.APP_ID} applyModifier : selectedModifiers results`, selectedModifiers, results);
        for (let modifier of selectedModifiers) {
            //执行调整的脚本
            let craftScript = modifier.getFlag(MODULE_ID, "craftScript");
            if (craftScript && craftScript.trim() != "") {
                const fn = new AsyncFunction("data", "panel", "actor", "modifiers", "elements", "materials", "modifier", "results", "canceled", craftScript);
                try {
                    await fn(this, this.journalEntry, this.actor, selectedModifiers, this.elements, materials, modifier, results, this.canceled);
                } catch (e) {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                    console.error(e);
                }
            }
            await Hooks.call(this.APP_ID + "Modifier", this, this.journalEntry, this.actor, selectedModifiers, this.elements, materials, modifier, results, this.canceled);
            //应用调整的效果
            const changes = modifier.getFlag(MODULE_ID, "changes") ?? [];
            const asAE = modifier.getFlag(MODULE_ID, "asAE") ?? false;
            let aeType = modifier.getFlag(MODULE_ID, "aeType") ?? "default";
            if (aeType == "default") {
                aeType = undefined;
            }
            if (asAE) {
                if (asAE == "merge") {
                    for (let re of results) {
                        let ae = re.item?.effects?.find(e => e.name == re.name && ((!aeType) || (e.type == aeType)));
                        if (ae) {
                            ae.changes = ae.changes.concat(changes);
                        } else {
                            ae = buildActiveEffect(re.name, re.img, changes, 0, 3, undefined, "", undefined, aeType);
                            re.item.effects ??= [];
                            re.item.effects.push(ae);
                        }
                    }
                } else {
                    let aeName = modifier.getFlag(MODULE_ID, "aeName");
                    if (!aeName) {
                        aeName = modifier.name;
                    }
                    let ae = buildActiveEffect(aeName, modifier.src, changes, 0, 3, undefined, modifier.text.content, undefined, aeType);
                    for (let re of results) {
                        re.item.effects ??= [];
                        re.item.effects.push(ae);
                    }
                }
            } else {
                for (let re of results) {
                    for (let change of changes) {
                        if (change.key && /^[a-zA-Z0-9.]+$/.test(change.key)) {
                            CraftPanelForge.applyChange(re.item, change);
                        }
                    }
                }
            }
        }
    }
    //应用调整的效果
    static applyChange(item, change) {
        debug(`${this.APP_ID} applyChange`, item, change);
        const current = foundry.utils.getProperty(item, change.key) ?? null;
        let targetType = foundry.utils.getType(current);
        let updates = {};
        let delta;
        try {
            if (targetType === "Array") {
                const innerType = current.length ? foundry.utils.getType(current[0]) : "string";
                delta = _castArray(change.value, innerType);
            }
            else delta = _castDelta(change.value, targetType);
        } catch (err) {
            console.warn(`Unable to parse active effect change for ${change.key}: "${change.value}"`);
            return;
        }

        const modes = CONST.ACTIVE_EFFECT_MODES;
        switch (change.mode) {
            case modes.ADD:
                _applyAdd(change, current, delta, updates);
                break;
            case modes.MULTIPLY:
                _applyMultiply(change, current, delta, updates);
                break;
            case modes.OVERRIDE:
                _applyOverride(change, current, delta, updates);
                break;
            case modes.UPGRADE:
            case modes.DOWNGRADE:
                _applyUpgrade(change, current, delta, updates);
                break;
            default:
                // _applyCustom(item, change, current, delta, changes);
                break;
        }

        // Apply all changes to the Actor data
        foundry.utils.mergeObject(item, updates);
    }

    async newModifier(event) {
        debug(`${this.APP_ID} newModifier`);
        event.preventDefault();
        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: game.i18n.localize(`${MODULE_ID}.craft-panel-forge.new-modifier`),
                src: "icons/magic/symbols/rune-sigil-green.webp",
                "text.content": "",
                flags: {
                    [MODULE_ID]: {
                        type: "modifier",
                        changes: [],
                        ...this.createModifierData(),
                    },
                },
            },
        ]);
        this.needRefresh = true;
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
 * @property {string} color - 元素的颜色，为对应形状以及边框的颜色。仅用于显示。
 * @property {number} weight - 元素的权重，用于计算匹配度。
 * @property {number} num - 仅成分元素使用，为元素的数量。用于显示作为合成素材时提供的元素数量。
 * @property {boolean} useMin - 仅需求元素使用，为是否使用最小数量。
 * @property {number} min - 仅需求元素使用，为元素的最小数量。用于显示合成时最少需要的元素数量。
 * @property {boolean} useMax - 仅需求元素使用，为是否使用最大数量。
 * @property {number} max - 仅需求元素使用，为元素的最大数量。用于显示合成时最多需要的元素数量。
 * @property {string} shape - 元素的形状，用于显示。默认为圆形circle，还可以配置方形square，以及菱形diamond。
 */