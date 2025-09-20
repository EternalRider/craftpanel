import { HandlebarsApplication, getItemColor, confirmDialog, debug, MODULE_ID } from "../utils.js";
import { FormBuilder } from "./formBuilder.js";

export class CraftPanelElement extends HandlebarsApplication {
    constructor(journalEntry) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        this.journalEntry = journalEntry;
        this.slots = [];
        this.elements = [];
        this.materials = [];
        this.elementItems = [];
        this.needRefresh = true;

        this.descriptionPath = game.settings.get(MODULE_ID, 'descriptionPath');

        this.scrollPositions = {
            elementItems: 0,
            materials: 0,
            elements: 0,
        };

        this.options.actions.edit = this.editMaterialsElement.bind(this);
        this.options.actions.configure = this.configure.bind(this);

        this.panelSizes = {
            elementitems: {
                width: 420,
                height: 420,
            },
            materials: {
                width: 420,
                height: 420,
            },
            slots: {
                width: 300,
                height: 200,
            },
            elements: {
                width: 300,
                height: 170,
            },
        };

        craftPanels ??= [];
        craftPanels.push(this);
        debug("CraftPanelElement constructor : journalEntry", journalEntry);
    }

    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID, "craft"],
            tag: "div",
            window: {
                frame: true,
                positioned: true,
                title: `${MODULE_ID}.${this.APP_ID}.title`,
                icon: "fa-solid fa-sun",
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
        // const elementConfig = game.settings.get(MODULE_ID, 'elementConfig');
        if (this.needRefresh) {
            await this.refreshPanel();
        }

        return {
            elementItems: this.elementItems,
            materials: this.materials,
            slots: this.slots.map((el, i) => { el.slotIndex = i; return el; }),
            elements: this.elements.map((el, i) => { el.slotIndex = i; return el; }),
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
        debug("CraftPanelElement _onRender : context", context);

        // 恢复滚动条位置
        html.querySelector(".craft-elementitems-panel").scrollTop = this.scrollPositions.elementItems;
        html.querySelector(".craft-materials-panel").scrollTop = this.scrollPositions.materials;
        html.querySelector(".craft-elements-panel").scrollTop = this.scrollPositions.elements;

        // html.querySelector("button[name='edit']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     this.editMaterialsElement();
        // });
        // html.querySelector("button[name='configure']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     await this.configure();
        // });
        // html.querySelector("button[name='close']").addEventListener("click", async (event) => {
        //     event.preventDefault();
        //     this.close();
        // });
        html.querySelectorAll(".element-slot.materials").forEach((el) => {
            el.addEventListener("dragstart", (event) => {
                event.dataTransfer.setData(
                    "text/plain",
                    JSON.stringify({
                        type: "Item",
                        uuid: el.dataset.uuid,
                    }),
                );
            });
            el.addEventListener("click", async (event) => {
                event.preventDefault();
                if (el.dataset.inslot == "true") {
                    this.removeMaterial(el.dataset.index);
                } else {
                    const item = await fromUuid(el.dataset.uuid);
                    this.addMaterial(item);
                }
            });
            el.addEventListener("dblclick", async (event) => {
                event.preventDefault();
                const item = await fromUuid(el.dataset.uuid);
                item.sheet.render(true);
            });
            el.addEventListener("contextmenu", (event) => {
                event.preventDefault();
                if (el.dataset.inslot == "true") {
                    this.removeMaterial(el.dataset.index);
                }
            });
        });
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
                    this.editElement(el.dataset.uuid);
                }
            });
            el.addEventListener("contextmenu", async (event) => {
                event.preventDefault();
                if (el.dataset.inslot == "true") {
                    this.removeElement(el.dataset.index);
                } else {
                    const item = await fromUuid(el.dataset.uuid);
                    let confirm = await confirmDialog(`${MODULE_ID}.${this.APP_ID}.delete-confirm-title`, `${MODULE_ID}.${this.APP_ID}.delete-confirm-info`, `${MODULE_ID}.yes`, `${MODULE_ID}.no`);
                    if (confirm) {
                        await item.update({ [`flags.-=${MODULE_ID}.elementConfig`]: null, [`flags.-=${MODULE_ID}.isElement`]: null });
                        await this.render(true);
                    }
                }
            });
        });
        html.querySelector(".craft-elementitems-panel").addEventListener("drop", this._onDropElementPanel.bind(this));
        html.querySelector(".craft-slot-panel").addEventListener("drop", this._onDropSlotPanel.bind(this));
        html.querySelector(".craft-elements-panel").addEventListener("drop", this._onDropSlotPanel.bind(this));
        //滚动事件，记录滚动位置
        html.querySelector(".craft-materials-panel").addEventListener("scrollend", (event) => { this.scrollPositions.materials = event.target.scrollTop; });
        html.querySelector(".craft-elements-panel").addEventListener("scrollend", (event) => { this.scrollPositions.elements = event.target.scrollTop; });
        html.querySelector(".craft-elementitems-panel").addEventListener("scrollend", (event) => { this.scrollPositions.elementItems = event.target.scrollTop; });
        debug("CraftPanelElement _onRender : html", html);
    }

    async configure() {
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(this.journalEntry)
            .title(game.i18n.localize(`${MODULE_ID}.configure`) + ": " + this.journalEntry.name)
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .text({ name: `flags.${MODULE_ID}.defaultClass`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.defaultClass`) })
            .text({ name: `flags.${MODULE_ID}.showClass`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.showClass`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.showClass-hint`) })
            .tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.configure-requirements-tab`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-hint`), options: { ...CraftPanelElement.REQUIREMENTS_TYPE_OPTIONS } })
            .text({ name: `flags.${MODULE_ID}.requirements-folder`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-folder`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-folder-hint`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements-type`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
            .script({ name: `flags.${MODULE_ID}.requirements-script`, label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.requirements-script-hint`) });

        const data = await fb.render();
        debug("CraftPanelElement configure : data", data);
        if (!data) return;
        // await game.settings.set(MODULE_ID, 'elementConfig', data);
        await this.journalEntry.update(data);
        this.needRefresh = true;
        await this.render(true);
    }
    async editElement(uuid) {
        const item = await fromUuid(uuid);
        debug("CraftPanelElement editElement : item", item);
        /** @type {CraftElement} */
        const element = item.getFlag(MODULE_ID, "elementConfig");
        debug("CraftPanelElement editElement : element", element);
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(element)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-element`))
            .text({ name: "id", label: game.i18n.localize(`${MODULE_ID}.id`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "img", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .text({ name: "class", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.class`) })
            .color({ name: "color", label: game.i18n.localize(`${MODULE_ID}.color`) })
            .number({ name: "weight", label: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.weight`) })
            .button({
                label: game.i18n.localize(`Delete`),
                callback: async () => {
                    let confirm = await confirmDialog(`${MODULE_ID}.${this.APP_ID}.delete-confirm-title`, `${MODULE_ID}.${this.APP_ID}.delete-confirm-info`, `${MODULE_ID}.yes`, `${MODULE_ID}.no`);
                    if (confirm) {
                        fb.form().close();
                        await item.update({ [`flags.-=${MODULE_ID}.elementConfig`]: null, [`flags.-=${MODULE_ID}.isElement`]: null });
                        await this.render(true);
                    }
                },
                icon: "fas fa-trash",
            });

        const data = await fb.render();
        debug("CraftPanelElement editElement : data", data);
        if (!data) return;
        await item.setFlag(MODULE_ID, "elementConfig", data);
        await this.render(true);
    }
    async editNum(index) {
        const element = this.elements[index];
        debug("CraftPanelElement editNum : element", element);
        //const fb = new Portal.FormBuilder()
        const fb = new FormBuilder()
            .object(element)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-element`))
            .number({ name: "num", label: game.i18n.localize(`${MODULE_ID}.quantity`) })

        const data = await fb.render();
        debug("CraftPanelElement editNum : data", data);
        if (!data) return;
        this.elements[index].num = data.num;
        this.elements.sort((a, b) => { return b.class != a.class ? b.class.localeCompare(a.class) : b.num - a.num });
        await this.render(true);
    }

    async _onDropElementPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelElement _onDropElementPanel : data", data);
        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        debug("CraftPanelElement _onDropElementPanel : type item", type, item);
        if (type === "Item" && item) {
            const update = {};
            update[`flags.${MODULE_ID}.isElement`] = true;
            /** @type {CraftElement} */
            const element = {
                id: item.id,
                name: item.name,
                img: item.img,
                color: "",
                class: this.journalEntry.getFlag(MODULE_ID, "defaultClass") ?? "",
                weight: 10,
            }
            update[`flags.${MODULE_ID}.elementConfig`] = element;
            debug("CraftPanelElement _onDropElementPanel : update", update);
            await item.update(update);
            this.needRefresh = true;
            await this.render(true);
        };
    }

    async _onDropSlotPanel(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("CraftPanelElement _onDropSlotPanel : data", data);
        const type = data.type;
        const item = (data?.uuid ?? false) ? await fromUuid(data.uuid) : false;
        let element = data?.element;
        debug("CraftPanelElement _onDropSlotPanel : type item element", type, item, element);
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

    async addElement(element, uuid) {
        debug("CraftPanelElement addElement : element uuid", element, uuid);
        if (element == undefined) {
            let item = await fromUuid(uuid);
            element = item.getFlag(MODULE_ID, "elementConfig");
        }
        let el = this.elements.find((el) => el.id == element.id);
        debug("CraftPanelElement addElement : element el", element, el);
        if (el) {
            el.num++;
        } else {
            el = {
                num: 1,
                uuid: uuid,
                ...element,
            };
            this.elements.push(el);
        }
        this.elements.sort((a, b) => { return b.class != a.class ? b.class.localeCompare(a.class) : b.num - a.num });
        debug("CraftPanelElement addElement : this.elements", this.elements);
        await this.render(true);
    }

    async addMaterial(item) {
        debug("CraftPanelElement addMaterial : item", item);
        if (!item) return;
        if (this.slots.find((el) => el.uuid == item.uuid)) return;
        const elements = item.getFlag(MODULE_ID, "element") ?? [];
        const itemColor = item ? getItemColor(item) ?? "" : "";
        debug("CraftPanelElement addMaterial : elements itemColor", elements, itemColor);
        const tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h2>${item.name}</h2></figure><div class="description">${foundry.utils.getProperty(item, this.descriptionPath) ?? item?.system?.description ?? item?.description ?? ""}</div><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
        let el = {
            item: item,
            uuid: item.uuid,
            elements: elements.filter(e => e.color != ""),
            itemColor: itemColor,
            tooltip,
            showElements: Array.isArray(elements) && elements.filter(el => el.color != "").length > 0,
        };
        debug("CraftPanelElement addMaterial : el", el);
        this.slots.push(el);
        //放入第一个时默认放入它的所有元素
        if (this.slots.length == 1) {
            for (const element of elements) {
                this.addElement(element);
            }
        }
        await this.render(true);
    }
    async refreshMaterials() {
        this.slots = await Promise.all(this.slots.map(async (slot, i) => {
            const item = await fromUuid(slot.uuid);
            const elements = item.getFlag(MODULE_ID, "element") ?? [];
            const itemColor = item ? getItemColor(item) ?? "" : "";
            const tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h2>${item.name}</h2></figure><div class="description">${foundry.utils.getProperty(item, this.descriptionPath) ?? item?.system?.description ?? item?.description ?? ""}</div><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
            return {
                slotIndex: i,
                item: item,
                uuid: item.uuid,
                elements: elements.filter(e => e.color != ""),
                itemColor: itemColor,
                tooltip,
                showElements: Array.isArray(elements) && elements.filter(el => el.color != "").length > 0,
            };
        }));
        debug("CraftPanelElement refreshMaterials : this.slots", this.slots);
    }
    async refreshPanel() {
        const requirements = {};
        this.journalEntry.getFlag(MODULE_ID, "requirements").forEach(key => {
            if (key == "folder") {
                requirements.folder = this.journalEntry.getFlag(MODULE_ID, "requirements-folder").replaceAll(/，/g, ",").split(/[,;]/).map((folder) => folder.trim());
            } else if (key == "script") {
                const AsyncFunction = async function () { }.constructor;
                const fn = new AsyncFunction("item", this.journalEntry.getFlag(MODULE_ID, "requirements-script"));
                requirements.script = fn;
            } else {
                requirements[key] = this.journalEntry.getFlag(MODULE_ID, `requirements-${key}`);
            }
        });
        debug("CraftPanelElement _prepareContext : requirements", requirements);
        const elementItems_items = [];
        const materials_items = [];
        let showClasses = this.journalEntry.getFlag(MODULE_ID, "showClass") ?? "";
        showClasses = showClasses.split(/[,;，]/).map((className) => className.trim());
        debug("CraftPanelElement _prepareContext : showClasses", showClasses);
        for (const item of game.items.contents) {
            if (item.getFlag(MODULE_ID, "isElement") === true) {
                elementItems_items.push(item);
            } else if (await checkItemRequirements(item, requirements)) {
                materials_items.push(item);
            }
        }
        debug("CraftPanelElement _prepareContext : elementItems_items materials_items", elementItems_items, materials_items);
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
            };
        });
        if (showClasses[0] != "") {
            this.elementItems = this.elementItems.filter((el) => showClasses.includes(el.class));
        }
        this.elementItems.sort((a, b) => { return b.class != a.class ? b.class.localeCompare(a.class) : b.name.localeCompare(a.name) });
        debug("CraftPanelElement _prepareContext : this.elementItems", this.elementItems);
        this.materials = await Promise.all(materials_items.map(async (item, i) => {
            const elements = item.getFlag(MODULE_ID, "element") ?? [];
            const itemColor = item ? getItemColor(item) ?? "" : "";
            const tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h2>${item.name}</h2></figure><div class="description">${foundry.utils.getProperty(item, this.descriptionPath) ?? item?.system?.description ?? item?.description ?? ""}</div><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
            let totalElements = 0;
            if (showClasses[0] != "") {
                totalElements = elements.filter(el => showClasses.includes(el.class)).reduce((a, b) => a + b.num, 0);
            } else {
                totalElements = elements.reduce((a, b) => a + b.num, 0);
            }
            return {
                // slotIndex: i,
                item: item,
                uuid: item.uuid,
                elements: elements.filter(e => e.color != ""),
                itemColor: itemColor,
                tooltip,
                totalElements,
                showElements: Array.isArray(elements) && elements.filter(el => el.color != "").length > 0,
            };
        }));
        this.materials.sort((a, b) => { return b.totalElements - a.totalElements });
        debug("CraftPanelElement _prepareContext : this.materials", this.materials);
        this.needRefresh = false;
    }

    async removeElement(index) {
        this.elements.splice(index, 1);
        await this.render(true);
    }
    async removeMaterial(index) {
        this.slots.splice(index, 1);
        if (this.slots.length == 0) {
            this.elements = [];
        }
        await this.render(true);
    }

    async editMaterialsElement() {
        let element = this.elements.map((el) => {
            return {
                id: el.id,
                name: el.name,
                img: el.img,
                class: el.class,
                color: el.color,
                num: el.num,
                weight: el.weight,
            }
        });
        debug("CraftPanelElement editMaterialsElement : element", element);
        let materials = this.slots.map((el) => {
            return el.item;
        });
        debug("CraftPanelElement editMaterialsElement : materials", materials);
        await Promise.all(materials.map(async (item) => {
            await item.setFlag(MODULE_ID, "element", element);
        }));
        await this.refreshMaterials();
        this.needRefresh = true;
        await this.render(true);
    }

    static get REQUIREMENTS_TYPE_OPTIONS() {
        return {
            "folder": `${MODULE_ID}.${this.APP_ID}.requirements-folder`,
            "type": `${MODULE_ID}.${this.APP_ID}.requirements-type`,
            "script": `${MODULE_ID}.${this.APP_ID}.requirements-script`,
        };
    }
}

/**
 * 检测物品是否符合要求
 * @param {Item} item - 要检测的物品
 * @param {string[]} requirements.folder - 目录名称检测
 * @param {string[]} requirements.type - 类型检测
 * @param {Function} requirements.script - 脚本检测
 * @returns {Promise<boolean>} - 是否符合要求
 */
async function checkItemRequirements(item, requirements) {
    if (requirements.folder) {
        if (requirements.folder.includes(item?.folder?.name)) return true;
    }
    if (requirements.script) {
        let result = false;
        try {
            result = await requirements.script(item);
        } catch (e) {
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
            console.error(e);
        }
        if (result === true) return true;
    }
    if (requirements.type) {
        if (requirements.type.includes(item?.type)) return true;
    }
    return false;
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