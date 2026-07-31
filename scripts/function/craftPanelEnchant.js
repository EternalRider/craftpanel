import { AsyncFunction, getItemColor, MODULE_ID, debug } from "../utils.js";
import { CraftPanelForge } from "./craftPanelForge.js";
import { chooseImage } from "../api.js";
import { FormBuilder } from "./formBuilder.js";

/**
 * 附魔面板的默认结果数据。
 * @type {{hue: number, shape: string, isNecessary: boolean, position: {unlock: boolean, x: number, y: number}}}
 */
const DEFAULT_RESULT_DATA = {
    hue: 180,
    shape: "default",
    isNecessary: true,
    position: { unlock: false, x: 0, y: 0 },
}

/**
 * 附魔面板。
 * 继承自 CraftPanelForge，提供附魔系统特有的结果槽位管理。
 * 支持将物品放置到结果槽位中，并在合成时将附魔信息写入产物。
 * @extends CraftPanelForge
 */
export class CraftPanelEnchant extends CraftPanelForge {
    /**
     * 构造附魔面板实例。
     * @param {JournalEntry|string} journalEntry 对应的 JournalEntry 或其 UUID
     * @param {"edit"|"craft"} mode 面板模式
     * @param {object} options 额外初始化参数
     */
    constructor(journalEntry, mode = "edit", options = {}) {
        super(journalEntry, mode, options);

        this.results = [];
        this.resultItems = {};
        this.resultOverrides = {};
        this.selectedResultIndex = null; // 当前选中的结果槽位索引（用于筛选右侧材料面板），null 表示无选中

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

    /**
     * 默认窗口配置。
     * @returns {object}
     */
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

    /**
     * 组装渲染数据，处理结果槽位的显示状态和覆盖数据。
     * @param {object} options 渲染选项
     * @returns {Promise<object>} 渲染数据
     */
    async getData(options) {
        const data = await super.getData(options);
        const defaultShowType = this.journalEntry.getFlag(MODULE_ID, "defaultShowType") ?? "mod1";
        const results = await Promise.all(this.results.map(async (el, i) => {
            let data = { ...el };
            const showType = el.showType ?? "default";
            const actualShowType = showType === "default" ? defaultShowType : showType;
            data.actualShowType = actualShowType;
            // 标记结果槽位的点击选中状态（用于筛选，区别于choosed的填入状态）
            data.isSelected = (i === this.selectedResultIndex);
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

        // 根据选中的结果槽位筛选右侧材料列表（与材料槽位筛选互斥）
        if (this.selectedResultIndex !== null && !this.isEdit) {
            data.materials = await this._getResultFilteredMaterials(this.selectedResultIndex);
        }

        return data;
    }

    /**
     * 首次渲染时绑定结果面板的拖放事件。
     * @param {object} context 渲染上下文
     * @param {object} options 渲染选项
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
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
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        if (data.type !== "Item") return;
        const index = parseInt(event.currentTarget.dataset.index);
        const item = await fromUuid(data.uuid);
        if (item) {
            await this.addResultItem(index, item);
        }
    }

    /**
     * 处理物品放置在结果面板（非特定槽位）的事件。
     * 编辑模式下创建新结果页，使用模式下自动分配到空槽位。
     * @param {Event} event 拖放事件
     */
    async _onDropResultPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }

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

    /**
     * 处理结果槽位的点击事件。
     * 编辑模式下打开槽位编辑；使用模式下切换结果槽位的选中状态（用于筛选右侧材料面板）。
     * 注意：此选中状态（selectedResultIndex）与填入物品后的 choosed 状态是不同的概念，
     * 二者可以同时存在，显示效果上加以区分。
     * @param {Event} event 点击事件
     */
    async _onClickResult(event) {
        event.preventDefault();
        const index = parseInt(event.currentTarget.dataset.index);
        if (this.isEdit) {
            const uuid = event.currentTarget.dataset.uuid;
            await this.editSlot(uuid);
        } else {
            // 使用模式下，左键点击切换结果槽位选中状态（用于筛选材料面板）
            // 与材料槽位选中互斥
            if (this.selectedResultIndex === index) {
                this.selectedResultIndex = null; // 取消选中
            } else {
                this.selectedResultIndex = index; // 选中该结果槽位
                this.selectedSlotIndex = null; // 互斥：取消材料槽位选中
            }
            await this.render(true);
        }
    }

    /**
     * 处理结果槽位的右键事件。
     * 编辑模式下删除槽位页面；使用模式下，若槽位有物品则弹出编辑对话框，否则移除物品。
     * @param {Event} event 右键事件
     */
    async _onContextMenuResult(event) {
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
            // 使用模式下，右键点击已有物品的结果槽位：弹出编辑/移除选择
            await this._editResultOverride(index);
        }
    }

    /**
     * 弹出结果槽位的编辑对话框（修改名称、描述、图片）或移除物品。
     * 从右键菜单触发，保留原有的编辑功能。
     * @param {number} index 结果槽位索引
     */
    async _editResultOverride(index) {
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
                    let images = await chooseImage(result.images, this.mode, { choosed: result.img, max: 1 });
                    if (images) {
                        result.img = images[0].src;
                    }
                },
                icon: "fas fa-edit",
            })
            .button({
                label: game.i18n.localize(`${MODULE_ID}.craft-panel-enchant.remove-result`),
                callback: async () => {
                    await this.removeResultItem(index);
                    fb.form().close();
                },
                icon: "fas fa-trash",
            })

        const data = await fb.render();
        if (!data) return;
        result.name = data.name;
        result.description = data.description;
        this.resultOverrides[index] = result;
        await this.render(true);
    }

    /**
     * 重写材料槽位点击事件：选中材料槽位时取消结果槽位选中（互斥）。
     * @param {Event} event 点击事件
     */
    async _onClickSlot(event) {
        // 互斥：选中材料槽位时取消结果槽位选中
        if (!this.isEdit) {
            this.selectedResultIndex = null;
        }
        await super._onClickSlot(event);
    }

    /**
     * 重写材料点击事件：如果有选中的结果槽位，将材料放入该结果槽位。
     * @param {Event} event 点击事件
     */
    async _onClickMaterials(event) {
        event.preventDefault();
        // 如果有选中的结果槽位，将材料放入该结果槽位
        if (this.selectedResultIndex !== null && !this.isEdit) {
            const uuid = event.currentTarget.dataset.uuid;
            const item = await fromUuid(uuid);
            if (!item) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.objectNotFound`));
                return;
            }
            const idx = this.selectedResultIndex;
            if (await this.checkAdd(idx, item, "result")) {
                await this.addResultItem(idx, item);
            }
            return;
        }
        // 无选中结果槽位时，走父类逻辑（放入材料槽位）
        await super._onClickMaterials(event);
    }

    /**
     * 根据选中的结果槽位筛选可放入的材料列表。
     * 遍历所有材料，检查是否可以添加到指定结果槽位中。
     * @param {number} resultIndex 结果槽位索引
     * @returns {Promise<Array>} 筛选后的材料列表
     */
    async _getResultFilteredMaterials(resultIndex) {
        const result = this.results[resultIndex];
        if (!result) return this.materials;
        // 筛选可以添加到该结果槽位的材料
        const filtered = [];
        for (const m of this.materials) {
            if (!m.item) continue;
            if (await this.checkAdd(resultIndex, m.item, "result")) {
                filtered.push(m);
            }
        }
        return filtered;
    }

    /**
     * 移除结果槽位中的物品，恢复对应材料的数量。
     * @param {number} index 结果槽位索引
     */
    async removeResultItem(index) {
        let material = this.materials.find(m => m.uuid == this.resultItems[index]?.uuid);
        if (material) {
            material.quantity++;
        }
        this.resultItems[index] = null;
        this.choosedResults.splice(this.choosedResults.indexOf(this.results[index].id), 1);
        await this.refreshResults();
        await this.render(true);
    }
    /**
     * 添加物品到结果槽位中，消耗对应材料。
     * @param {number} index 结果槽位索引
     * @param {Item} item 要添加的物品
     * @param {object} options 选项
     * @param {boolean} [options.skipRender=false] 是否跳过重新渲染
     * @param {boolean} [options.skipRefresh=false] 是否跳过刷新结果
     */
    async addResultItem(index, item, options = {}) {
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
    /**
     * 刷新结果数据，重新解析结果页面并计算锁定状态。
     */
    async refreshResults() {
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

    /**
     * 检查能否添加该物品到槽位中。
     * 当 type 为 "result" 时检查结果槽位的数量限制。
     * @param {number} index 槽位索引
     * @param {Item} item 要检查的物品
     * @param {string} [type="slot"] 槽位类型（"slot" 或 "result"）
     * @returns {Promise<boolean>} 是否可以添加
     */
    async checkAdd(index, item, type = "slot") {
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
    /**
     * 检查所有标记为必需的槽位和结果槽位是否已填满。
     * @returns {boolean} 是否全部填满
     */
    checkSlot() {
        let slots = this.slots.filter(slot => slot.isNecessary);
        let results = this.results.filter(result => result.isNecessary);
        return slots.every(slot => this.slotItems[slot.slotIndex] !== null && this.slotItems[slot.slotIndex] !== undefined) && results.every(result => this.resultItems[result.slotIndex] !== null && this.resultItems[result.slotIndex] !== undefined);
    }

    /**
     * 合成前校验：检查是否选择了结果、必需槽位是否填满。
     * @returns {Promise<boolean>} 是否通过校验
     */
    async checkCraft() {
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

    /**
     * 合成前准备：保存当前结果槽位状态（如果启用了保留材料）。
     * @param {Array} materials 材料列表
     * @returns {Promise<object>} 合成前数据
     */
    async preCraft(materials) {
        this.previousResultItems = this.keepMaterials ? foundry.utils.deepClone(this.resultItems) : null;
        return await super.preCraft(materials);
    }

    /**
     * 获取合成结果：收集结果槽位中的物品，附加附魔信息并应用调整效果。
     * @param {Array} materials 材料列表
     * @param {Array} results 结果列表（会被填充）
     * @returns {Promise<object|false>} 合成结果数据，失败返回 false
     */
    async getCraftResult(materials, results) {
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
                    foundry.utils.setProperty(r.item, this.descriptionPath, (foundry.utils.getProperty(r.item, this.descriptionPath) ?? "") + `<h2>${je.name}</h2><div class="description">${je.text.content ?? ""}</div>`;
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

    /**
     * 最终确定合成结果：将产物添加到对应父容器的更新队列中。
     * @param {Array} materials 材料列表
     * @param {Array} results 结果列表
     * @returns {Promise<{updates: object, toDelete: Array, products: Array}>}
     */
    async finalizeCraftResult(materials, results) {
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

    /**
     * 合成后处理：根据配置恢复结果槽位或清空。
     * @param {Array} materials 材料列表
     * @param {Array} results 结果列表
     */
    async postCraft(materials, results) {
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