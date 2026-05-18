import { AsyncFunction, getItemColor, MODULE_ID, debug } from "../utils.js";
import { CraftPanelForge } from "./craftPanelForge.js";
import { chooseImage } from "../api.js";
import { FormBuilder } from "../function/formBuilder.js";

const DEFAULT_RESULT_DATA = {
    hue: 180,
    shape: "default",
    isNecessary: true,
    position: { unlock: false, x: 0, y: 0 },
}

export class CraftPanelEnchant extends CraftPanelForge {
    constructor(journalEntry, mode = "edit", options = {}) {
        super(journalEntry, mode, options);
        debug(`${this.APP_ID} constructor : journalEntry mode options`, journalEntry, mode, options);

        this.results = [];
        this.resultItems = {};
        this.resultOverrides = {};

        this.options.actions["new-result"] = async (event) => {
            event.preventDefault();
            await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
                {
                    name: game.i18n.localize(`${MODULE_ID}.craft-panel-enchant.new-result`),
                    src: "icons/magic/symbols/runes-etched-steel-blade.webp",
                    "text.content": null,
                    flags: {
                        [MODULE_ID]: {
                            type: "result",
                            images: [{ name: "icons/magic/symbols/runes-etched-steel-blade.webp", src: "icons/magic/symbols/runes-etched-steel-blade.webp" }],
                            size: Math.min(this.panelSizes.results.width, this.panelSizes.results.height) * 0.6,
                            ...DEFAULT_RESULT_DATA,
                        },
                    },
                },
            ]);
            this.needRefresh = true;
            await this.render(true);
        };
    }

    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID],
            window: {
                icon: "fa-solid fa-book-journal-whills",
                controls: [{
                    icon: "fas fa-plus",
                    action: "new-result",
                    label: `${MODULE_ID}.craft-panel-enchant.new-result`,
                }],
            },
        };
    }

    //准备界面所需的各项数据
    async getData(options) {
        debug(`${this.APP_ID} getData`);
        const data = await super.getData(options);
        const defaultShowType = this.journalEntry.getFlag(MODULE_ID, "defaultShowType") ?? "mod1";
        const results = await Promise.all(this.results.map(async (el, i) => {
            let data = { ...el };
            const showType = el.showType ?? "default";
            const actualShowType = showType === "default" ? defaultShowType : showType;
            data.actualShowType = actualShowType;
            if (this.isEdit) {
                data.empty = "empty";
                data.draggable = el.position.unlock;
                data.choosed = "";
            } else {
                data.img = this.resultOverrides[i]?.img ?? this.resultItems[i]?.img ?? el.img;
                data.description = this.resultOverrides[i]?.description ?? this.resultItems[i]?.description ?? el.description;
                data.name = this.resultOverrides[i]?.name ?? this.resultItems[i]?.name ?? el.name;
                let tooltip = await TextEditor.enrichHTML(`<figure><img src='${data.img}'><h2>${data.name}</h2></figure><div class="description">${data.description ?? ""}</div>`);
                let r = this.resultItems[i];
                if (r !== null && r !== undefined) {
                    data.uuid = r.uuid;
                    data.itemColor = r.itemColor;
                    data.empty = "";
                    data.draggable = true;
                    data.choosed = "choosed";
                } else {
                    data.empty = "empty";
                    data.draggable = false;
                    data.choosed = "";
                }
                data.tooltip = tooltip;
            }
            return data;
        }));
        data.results = results;

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

        // html.on("drop", ".craft-results-panel", this._onDropResultPanel.bind(this));
        html.on("drop", ".craft-results-panel .craft-slot", this._onDropResult.bind(this));
        // html.on("click", ".craft-results-panel .craft-slot", this._onClickResult.bind(this));
        // html.on("contextmenu", ".craft-results-panel .craft-slot", this._onContextMenuResult.bind(this));
    }

    /**
     * 处理物品放置在结果槽位中的事件
     * @param {Event} event 
     */
    async _onDropResult(event) {
        debug(`${this.APP_ID} _onDropResult`);
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug(`${this.APP_ID} _onDropResult : data`, data);
        if (data.type !== "Item") return;
        const index = parseInt(event.currentTarget.dataset.index);
        const item = await fromUuid(data.uuid);
        if (item) {
            await this.addResultItem(index, item);
        }
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
        if (type !== "Item" || !item) return;
        if (this.isEdit) {
            await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [{
                name: item.name,
                src: item.img,
                "text.content": foundry.utils.getProperty(item, this.descriptionPath) ?? item?.description ?? null,
                flags: {
                    [MODULE_ID]: {
                        type: "result",
                        images: [{ name: item.img, src: item.img }],
                        size: Math.min(this.panelSizes.results.width, this.panelSizes.results.height) * 0.6,
                        ...DEFAULT_RESULT_DATA,
                    },
                },
            },]);
            this.needRefresh = true;
            await this.render(true);
        } else {
            for (let i = 0; i < this.results.length; i++) {
                if (this.resultItems[i] === null || this.resultItems[i] === undefined) {
                    const item = await fromUuid(data.uuid);
                    await this.addResultItem(i, item);
                }
            }
        }
    }
    async _onClickResult(event) {
        debug(`${this.APP_ID} _onClickResult : isEdit`, this.isEdit);
        event.preventDefault();
        const index = event.currentTarget.dataset.index;
        const uuid = event.currentTarget.dataset.uuid;
        const isEmpty = event.currentTarget.classList.contains("empty");
        if (this.isEdit) {
            await this.editSlot(uuid);
        } else if (!isEmpty) {
            let result = this.resultOverrides[index];
            if (result == undefined) {
                result = {
                    name: this.resultItems[index]?.name ?? this.results[index]?.name ?? "",
                    img: this.resultItems[index]?.img ?? this.results[index]?.img ?? "",
                    description: this.resultItems[index]?.description ?? this.results[index]?.description ?? "",
                    images: this.results[index].images ?? [{ name: this.resultItems[index]?.img ?? "", src: this.resultItems[index]?.img ?? "" }, { name: this.results[index]?.img ?? "", src: this.results[index]?.img ?? "" }],
                }
            }
            const fb = new FormBuilder()
                .title(game.i18n.localize(`${MODULE_ID}.craft-panel-enchant.edit-result`))
                .object(result)
                .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
                .editor({ name: `description`, label: game.i18n.localize(`${MODULE_ID}.description`) })
                .button({
                    label: game.i18n.localize(`${MODULE_ID}.craft-panel-enchant.edit-image`),
                    callback: async () => {
                        //制作模式下，左键点击结果可以选择图片
                        let images = await chooseImage(result.images, this.mode, { choosed: result.img, max: 1 });
                        if (images) {
                            result.img = images[0].src;
                        }
                    },
                    icon: "fas fa-edit",
                })

            const data = await fb.render();
            if (!data) return;
            result.name = data.name;
            result.description = data.description;
            this.resultOverrides[index] = result;
            await this.render(true);
        }
    }
    async _onContextMenuResult(event) {
        debug(`${this.APP_ID} _onContextMenuResult : isEdit`, this.isEdit);
        event.preventDefault();
        const index = event.currentTarget.dataset.index;
        const isEmpty = event.currentTarget.classList.contains("empty");
        const pageUuid = event.currentTarget.dataset.uuid;
        if (this.isEdit) {
            // 编辑模式下，右键点击槽位可以删除槽位
            const page = await fromUuid(pageUuid);
            await page.deleteDialog();
            await this.render(true);
        } else if (!isEmpty) {
            await this.removeResultItem(index);
        }
    }
    //移除结果槽位中的物品
    async removeResultItem(index) {
        debug(`${this.APP_ID} removeResultItem : index`, index);
        let material = this.materials.find(m => m.uuid == this.resultItems[index]?.uuid);
        if (material) {
            material.quantity++;
        }
        this.resultItems[index] = null;
        this.choosedResults.splice(this.choosedResults.indexOf(this.results[index].id), 1);
        await this.refreshResults();
        await this.render(true);
    }
    //添加物品到结果槽位中
    async addResultItem(index, item, options = {}) {
        debug(`${this.APP_ID} addResultItem : index item options`, index, item, options);
        const { skipRender = false, skipRefresh = false } = options;
        if (await this.checkAdd(index, item, "result")) {
            const data = {
                uuid: item.uuid,
                name: item.name,
                img: item.img,
                // elements: item.getFlag(MODULE_ID, "element") ?? [],
                description: foundry.utils.getProperty(item, this.descriptionPath) ?? item.description ?? "",
                itemColor: item ? getItemColor(item) ?? "" : "",
                enchantments: item.getFlag(MODULE_ID, "enchantments") ?? [],
            }
            this.resultItems[index] = data;
            let material = this.materials.find(m => m.uuid == item.uuid);
            if (material) {
                material.quantity--;
            }
            this.choosedResults.push(this.results[index].id);
            if (!options.skipRefresh) {
                await this.refreshResults();
            }
            if (!options.skipRender) {
                await this.render(true);
            }
        }
    }
    //刷新结果数据
    async refreshResults() {
        debug(`${this.APP_ID} refreshResults`);
        await super.refreshResults();
        if (this.needRefresh) {
            //编辑模式下需要重新获取结果页，因为可能被添加/删除了
            this.resultsJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "result");
        }
        this.results = await Promise.all(this.resultsJE.map(async (je, i) => {
            const overrideStyle = (je.getFlag(MODULE_ID, "shape") ?? "default") !== "default";
            const overrideStyleClass = je.getFlag(MODULE_ID, "shape") == "circle" ? "round" : "";
            let tooltip = await TextEditor.enrichHTML(`<figure><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div>`);
            let isLocked = je.getFlag(MODULE_ID, "isLocked") ?? false;
            if (isLocked && !this.isEdit) {
                const script = je.getFlag(MODULE_ID, "unlockCondition");
                if (script && script.trim() != "") {
                    const fn = new AsyncFunction("data", "panel", "actor", "elements", "materials", script);
                    let unlock = false;
                    try {
                        unlock = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.elements, Object.values(this.slotItems));
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                    if (unlock) {
                        isLocked = false;
                    }
                }
            }
            const position = je.getFlag(MODULE_ID, "position") ?? { unlock: false, x: 0, y: 0 };
            const images = je.getFlag(MODULE_ID, "images") ?? [{ name: je.src, src: je.src }];
            return {
                id: je.id,
                name: je.name,
                img: je.src,
                slotIndex: i,
                uuid: je.uuid,
                hue: je.flags[MODULE_ID].hue,
                size: je.flags[MODULE_ID].size,
                lockSize: je.flags[MODULE_ID].size * 0.6,
                overrideStyle,
                overrideStyleClass,
                tooltip,
                isNecessary: je.getFlag(MODULE_ID, "isNecessary") ?? true,
                isLocked,
                position,
                images,
                description: je.text.content ?? "",
            };
        }));
    }

    //检查能否添加该物品到槽位中
    async checkAdd(index, item, type = "slot") {
        debug(`${this.APP_ID} checkAdd : index type`, index, type);
        let slots = this.slots;
        let slotItems = this.slotItems;
        if (type == "result") {
            slots = this.results;
            slotItems = this.resultItems;
            const resultLimit = this.journalEntry.getFlag(MODULE_ID, "resultLimit") ?? 0;
            if (resultLimit > 0 && this.choosedResults.length >= resultLimit) {
                return false;
            }
        }
        return super.checkAdd(index, item, slots, slotItems);
    }
    //检查必需槽位是否已填满
    checkSlot() {
        debug(`${this.APP_ID} checkSlot`);
        let slots = this.slots.filter(slot => slot.isNecessary);
        let results = this.results.filter(result => result.isNecessary);
        return slots.every(slot => this.slotItems[slot.slotIndex] !== null && this.slotItems[slot.slotIndex] !== undefined) && results.every(result => this.resultItems[result.slotIndex] !== null && this.resultItems[result.slotIndex] !== undefined);
    }
    async checkCraft() {
        debug(`${this.APP_ID} checkCraft`);
        if (this.checkNoResult()) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.must-fill-at-least-one-result`));
            return false;
        }
        if (!this.checkSlot()) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.must-fill-necessary-slot`));
            return false;
        };
        return true;
    }
    async preCraft(materials) {
        debug(`${this.APP_ID} preCraft : materials`, materials);
        this.previousResultItems = this.keepMaterials ? foundry.utils.deepClone(this.resultItems) : null;
        return await super.preCraft(materials);
    }
    async getCraftResult(materials, results) {
        debug(`${this.APP_ID} getCraftResult : materials results`, materials, results);
        //获取合成结果
        for (let [index, re] of Object.entries(this.resultItems)) {
            if (!re) continue;
            const item = await fromUuid(re.uuid);
            if (item) {
                results.push({
                    item: item.toObject(),
                    uuid: re.uuid,
                    name: this.resultOverrides[index]?.name ?? re.name,
                    img: this.resultOverrides[index]?.img ?? re.img,
                    description: this.resultOverrides[index]?.description ?? re.description,
                    parent: item.parent,
                })
            } else {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.itemNotFound`) + re.name + " " + re.uuid);
                this.canceled = true;
            }
        }
        results.forEach(r => {
            r.item.name = r.name;
            r.item.img = r.img;

            //添加描述
            if (foundry.utils.getProperty(r.item, this.descriptionPath)) {
                foundry.utils.setProperty(r.item, this.descriptionPath, r.description);
                for (let je of this.selectedModifiers) {
                    foundry.utils.setProperty(r.item, this.descriptionPath, foundry.utils.getProperty(r.item, this.descriptionPath) + `<h2>${je.name}</h2><div class="description">${je.text.content ?? ""}</div>`);
                }
            }
            //保存调整信息
            r.item.flags ??= {};
            r.item.flags[MODULE_ID] ??= {};
            r.item.flags[MODULE_ID].enchantments ??= [];
            r.item.flags[MODULE_ID].enchantments.push(...this.selectedModifiers.map(m => {
                return {
                    uuid: m.uuid,
                    name: m.name,
                    img: m.src,
                    cost: m.getFlag(MODULE_ID, "cost"),
                }
            }));
        });
        //应用调整
        if (this.selectedModifiers.length > 0) {
            await this.applyModifier(this.selectedModifiers, materials, results);
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
        const { updates, toDelete } = await super.finalizeCraftResult(materials, results);
        const products = [];
        results.forEach(re => {
            let item = re.item;
            let parent = re.parent;
            if ((!parent) || (!parent?.isOwner)) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.noOwner`) + re.name + " " + re.uuid);
                this.canceled = true;
            } else {
                updates[parent.id] ??= { parent: parent, items: [] };
                updates[parent.id].items.push(item);
            }
        });
        return { updates, toDelete, products };
    }
    async postCraft(materials, results) {
        debug(`${this.APP_ID} postCraft : canceled`, this.canceled);
        await super.postCraft(materials, results);
        if (this.keepMaterials && !this.canceled && this.previousResultItems) {
            this.resultItems = {};
            for (const [slotIndex, slotData] of Object.entries(this.previousResultItems)) {
                if (!slotData) continue;
                let item = await fromUuid(slotData.uuid);
                if (!item && this.actor) {
                    item = this.actor.items.find((i) => i.name === slotData.name);
                }
                if (item && await this.checkAdd(Number(slotIndex), item, "result")) {
                    await this.addResultItem(Number(slotIndex), item, { skipRender: true, skipRefresh: true });
                }
            }
        } else {
            this.choosedResults = [];
            this.resultItems = {};
            this.resultOverrides = {};
        }
    }
}