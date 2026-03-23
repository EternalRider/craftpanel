import { HandlebarsApplication, AsyncFunction, playAudio, getItemColor, MODULE_ID, debug, chatMessage, getFolder, confirmDialog } from "../utils.js";
import { chooseImage } from "../api.js";
import { FormBuilder } from "./formBuilder.js";

export class CraftPanel extends HandlebarsApplication {
    constructor(journalEntry, mode = "edit", options = {}) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        this.journalEntry = journalEntry;
        this.mode = mode;
        this.actor = options.actor;
        /**@type {CraftElement[]} */
        this.elements = [];
        /**@type {CraftElementShow[]} */
        this.elementsShow = [];
        /**@type {CraftElement[]} */
        this.elementsAll = [];
        /**@type {CraftElementConfig[]} */
        this.elementConfigs = this.journalEntry.getFlag(MODULE_ID, "elementConfig") ?? [];
        this.slotItems = {}; //槽位上的物品数据，key为槽位index，value为物品数据（包含name、img、elements等）
        this.results = []; //合成结果数据，每个界面单独定义
        this.slots = []; //槽位数据
        this.materials = [];
        this.needRefresh = true;
        this.panelOptions = options;
        this.keepMaterials = options.keepMaterials ?? (game.user?.getFlag(MODULE_ID, "keepMaterials") ?? false);
        this.bindItems = {}; //绑定物品数据，key为槽位index，value为物品数据（包含name、img、quantity等）

        this.categories = {
            materials: [],
        };
        this.category = {
            materials: "all",
        };

        this.scrollPositions = {
            materials: 0,
        };

        if (game.user.isGM) {
            this.options.actions.edit = this.toggleEdit.bind(this);
        } else {
            this.options.window.controls = [];
        }
        this.options.actions.craft = this.craft.bind(this);
        this.options.actions["configure-panel"] = this.configure.bind(this);
        this.options.actions["new-slot"] = this.newSlot.bind(this);

        this.panelSizes = this.journalEntry.getFlag(MODULE_ID, "panelSizes");
        this.audio = this.journalEntry.getFlag(MODULE_ID, "audio") ?? {};

        craftPanels ??= [];
        craftPanels.push(this);
        debug(`${this.APP_ID} constructor : this journalEntry mode options craftPanels`, this, journalEntry, mode, options, craftPanels);
    }

    static async registerPartial() {
        const templates = [
            "craft-panel-tittle", "craft-category-panel",
            "craft-slot-panel", "craft-elements-panel", "craft-results-panel", "craft-materials-panel", "craft-elementitems-panel", "craft-ingredients-panel",
            "craft-recipes-panel", "craft-modifiers-panel"
        ];
        const loadedTemplates = await loadTemplates(templates.map(t => `modules/${MODULE_ID}/templates/partials/${t}.hbs`));
        debug(`${this.APP_ID} registerPartial : templates loaded`, templates);
        for (let i = 0; i < templates.length; i++) {
            Handlebars.registerPartial(templates[i], loadedTemplates[i]);
        }
    }

    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID, "craft"],
            tag: "div",
            window: {
                frame: true,
                positioned: true,
                title: `${MODULE_ID}.${this.APP_ID}.title`,
                icon: "fa-regular fa-flask-round-potion",
                controls: [{
                    icon: "fas fa-edit",
                    action: "edit",
                    label: `${MODULE_ID}.edit-mode`,
                }],
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
        };
    }

    static get PARTS() {
        return {
            content: {
                template: `modules/${MODULE_ID}/templates/${this.APP_ID}.hbs`,
                classes: [],
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
        return this.journalEntry.name + (this.isEdit ? " - " + game.i18n.localize(`${MODULE_ID}.edit-mode`) : "");
    }

    get isEdit() {
        return this.mode === "edit";
    }

    get DEFAULT_PANEL_SIZES() {
        return {
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
     * @typedef {Object} DefaultContext
     * @property {boolean} isEdit - 是否为编辑模式
     * @property {Array} slots - 槽位数据
     * @property {Array} materials - 材料数据
     * @property {Array} elements - 元素数据
     * @property {Array|Object} results - 结果数据
     * @property {Object} categories - 分类数据
     * @property {Object} panelSizes - 面板尺寸数据
     * @property {string} background - 背景图像数据
     * @property {boolean} keepMaterials - 是否保留材料数据
     */
    /**
     * 准备界面所需的各项数据(用于覆盖父类方法)，在渲染前会调用此方法来获取数据并传递给模板
     * @returns {Promise<DefaultContext>}
     */
    async getData(options) {
        if (this.needRefresh) {
            await this.refreshPanel();
            await this.refreshElements();
            await this.refreshResults();
            this.audio = this.journalEntry.getFlag(MODULE_ID, "audio") ?? {};
            this.needRefresh = false;
        }
        const defaultShowType = this.journalEntry.getFlag(MODULE_ID, "defaultShowType") ?? "mod1";
        const slotsJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "slot");
        debug(`${this.APP_ID} getData : slotsJE defaultShowType`, this, slotsJE, defaultShowType);
        this.slots = await Promise.all(slotsJE.map(async (je, i) => {
            const overrideStyle = (je.getFlag(MODULE_ID, "shape") ?? "default") !== "default";
            const overrideStyleClass = je.getFlag(MODULE_ID, "shape") == "circle" ? "round" : "";
            const tooltip = await TextEditor.enrichHTML(`<figure><h2>${je.name}</h2></figure><div class="description">${je.text.content ?? ""}</div>`);
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
            let isNecessary = je.getFlag(MODULE_ID, "isNecessary") ?? false;
            let isConsumed = je.getFlag(MODULE_ID, "isConsumed") ?? true;
            if (!this.isEdit) {
                const script = je.getFlag(MODULE_ID, "slotScript");
                if (script && script.trim() != "") {
                    const fn = new AsyncFunction("data", "panel", "actor", "elements", "materials", "slotItem", script);
                    let result;
                    try {
                        result = await fn(this, this.journalEntry, this.actor ?? game?.user?.character, this.elements, Object.values(this.slotItems), this.slotItems[i]);
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                    if (result) {
                        isNecessary = result?.isNecessary ?? isNecessary;
                        isConsumed = result?.isConsumed ?? isConsumed;
                    }
                }
            }
            const position = je.getFlag(MODULE_ID, "position") ?? { unlock: false, x: 0, y: 0 };
            const showType = je.getFlag(MODULE_ID, "showType") ?? "default";
            const actualShowType = showType === "default" ? defaultShowType : showType;
            const showQuantity = je.getFlag(MODULE_ID, "showQuantity") ?? "default";
            const bindItem = je.getFlag(MODULE_ID, "bindItem");

            return {
                id: je.id,
                name: je.name,
                image: je.src,
                slotIndex: i,
                uuid: je.uuid,
                hue: je.flags[MODULE_ID].hue,
                size: je.flags[MODULE_ID].size,
                lockSize: je.flags[MODULE_ID].size * 0.6,
                overrideStyle,
                overrideStyleClass,
                tooltip,
                elements: [],
                isNecessary: isNecessary,
                isConsumed: isConsumed,
                showQuantity,
                bindItem,
                quantity: 0,
                isLocked,
                position,
                actualShowType,
            };
        }));
        if (this.isEdit) {
            this.slots.map(slot => {
                slot.empty = "empty";
                slot.draggable = slot.position.unlock;
                if (slot.showQuantity == "false" || (slot.showQuantity == "default" && !slot.bindItem)) {
                    slot.showQuantity = "";
                }
            });
        } else {
            this.refreshBindItems();
            debug(`${this.APP_ID} getData : slots bindItems`, this.slots, this.bindItems);
            this.slots.map((slot, i) => {
                let r = this.slotItems[i];
                if (r !== null && r !== undefined) {
                    slot.image = r.img;
                    slot.name = r.name;
                    slot.elements = r.elements.filter(e => e.color != "");
                    slot.uuid = r.uuid;
                    slot.itemColor = r.itemColor;
                    slot.empty = "";
                    slot.draggable = true;
                    slot.tooltip = r.tooltip;
                    slot.quantity = r.quantity;
                    if (slot.showQuantity == "false" || slot.quantity === undefined || (slot.showQuantity == "default" && !(slot.bindItem || r.ingredientSettings))) {
                        slot.showQuantity = "";
                    } else if (slot.bindItem && this.bindItems[i]) {
                        slot.quantity = `${this.bindItems[i].allQuantity}/${slot.quantity}`;
                    }
                } else {
                    slot.empty = "empty";
                    slot.draggable = false;
                    if (slot.showQuantity == "false" || (slot.showQuantity == "default" && !slot.bindItem)) {
                        slot.showQuantity = "";
                    }
                }
            });
        }
        debug(`${this.APP_ID} getData : slots`, this.slots);

        return {
            isEdit: this.isEdit,
            slots: this.slots,  //中间显示的槽位
            materials: this.materials, //右侧显示的材料
            elements: this.elementsShow,
            results: this.results,
            categories: this.categories,
            panelSizes: this.panelSizes ?? this.DEFAULT_PANEL_SIZES,
            background: `url('${this.journalEntry.getFlag(MODULE_ID, "background") ?? ""}')`,
            keepMaterials: this.keepMaterials,
        };
    }
    /**
     * 准备界面所需的各项数据(用于覆盖父类方法)，在渲染前会调用此方法来获取数据并传递给模板
     * @returns {Promise<DefaultContext>}
     */
    async _prepareContext(options) {
        const data = await this.getData(options);
        debug(`${this.APP_ID} _prepareContext : data`, this, data);
        const refreshScript = this.journalEntry.getFlag(MODULE_ID, "refresh-script");
        if (refreshScript && refreshScript.trim() != "") {
            const fn = new AsyncFunction("data", "panel", "actor", "elements", "materials", refreshScript);
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

        return data;
    }

    /**
     * 绑定各项元素的互动效果
     * @returns {}
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        debug(`${this.APP_ID} _onRender : context options`, this, context, options);
        // 恢复滚动条位置
        for (const panel in this.scrollPositions) {
            const panelEl = html.querySelector(`.scroll-log-panel[data-panel="${panel}"]`);
            if (panelEl) {
                panelEl.scrollTop = this.scrollPositions[panel];
            }
        }

        // 设置背景图像
        // const windowContent = html.querySelector('.window-content');
        // if (typeof context.background == "string" && windowContent.style.getPropertyValue("background-image") != context.background) {
        //     windowContent.style.setProperty("background-image", context.background);
        // }

        // 元素面板：在首次渲染时绑定拖拽事件；此处仅处理溢出状态与观察器
        this._setupElementsPanelOverflow(html);
    }

    /**
     * 绑定各项元素的互动效果
     * @returns {}
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        debug(`${this.APP_ID} _onFirstRender : context options`, this, context, options);
        const html = $(this.element);
        this._bindElementsPanelEvents(html);
        // 绑定分类图标的点击事件
        html.on("click", ".craft-category-icon", this._onClickCategory.bind(this));
        //滚动事件，记录滚动位置
        html.on("scrollend", ".scroll-log-panel", this._onScrollLogPanel.bind(this));
        // 绑定保留材料的切换事件
        html.on("change", "input[name='keep-materials']", this._onToggleKeepMaterials.bind(this));
        // 绑定槽位面板和槽位的事件
        html.on("drop", ".craft-slot-panel", this._onDropSlotPanel.bind(this));
        html.on("drop", ".craft-slot-panel .craft-slot", this._onDropSlot.bind(this));
        html.on("click", ".craft-slot-panel .craft-slot", this._onClickSlot.bind(this));
        html.on("contextmenu", ".craft-slot-panel .craft-slot", this._onContextMenuSlot.bind(this));
        html.on("dragstart", ".craft-slot-panel .craft-slot:not(.empty)", this._onDragStartSlot.bind(this));
        html.on("dragstart", ".craft-content.edit .craft-slot-panel .craft-slot", this._onDragStartSlotEdit.bind(this));

        // 绑定编辑模式下的各个事件
        html.on("click", ".craft-content.edit .craft-panel-tittle > i", this.changePanelSize.bind(this));
        html.on("drop", ".craft-content.edit .craft-elements-panel", this._onDropElementPanel.bind(this));
        html.on("contextmenu", ".craft-content.edit .craft-category-icon", this._onContextMenuCategory.bind(this));
        html.on("click", ".craft-content.edit .element-slot.elements", this._onClickElement.bind(this));
        html.on("dragstart", ".craft-content.edit .element-slot.elements", this._onDragStartElement.bind(this));
        html.on("drop", ".craft-content.edit .element-slot.elements", this._onDropElementPanel.bind(this));

        // 绑定材料面板的各个事件
        html.on("click", ".craft-content .element-slot.materials", this._onClickMaterials.bind(this));
        html.on("contextmenu", ".craft-content .element-slot.materials", this._onContextMenuMaterials.bind(this));
        html.on("dragstart", ".craft-content:not(.edit) .element-slot.materials", this._onDragStartMaterials.bind(this));

        // 播放打开界面的音效
        if (this.audio?.["open-panel"]) {
            playAudio({ src: this.audio["open-panel"], channel: "interface", volume: (this.audio?.["volume"] ?? 100) / 100 }, true);
        }
    }

    /**
     * 绑定元素面板的拖拽与触摸事件（仅首次渲染）
     * @param {JQuery} html
     */
    _bindElementsPanelEvents(html) {
        debug(`${this.APP_ID} _bindElementsPanelEvents : bound?`, this._elementsEventsBound);
        if (this._elementsEventsBound) return;
        const ns = ".craftElementsPanel";
        const state = {
            isDown: false,
            startX: 0,
            scrollLeftStart: 0,
            panel: null,
        };

        const startDrag = (ev, point) => {
            const panel = ev.currentTarget;
            if (!panel) return;
            if (this.isEdit && ev.target?.closest('.element-slot')) return;
            state.isDown = true;
            state.panel = panel;
            const rect = panel.getBoundingClientRect();
            state.startX = point.pageX - rect.left;
            state.scrollLeftStart = panel.scrollLeft;
            panel.classList.add('dragging');
            ev.preventDefault();
        };

        const moveDrag = (pageX) => {
            if (!state.isDown || !state.panel) return;
            const panel = state.panel;
            if (!panel.isConnected) {
                state.isDown = false;
                state.panel = null;
                return;
            }
            const rect = panel.getBoundingClientRect();
            const x = pageX - rect.left;
            const walk = (x - state.startX) * 1.5;
            panel.scrollLeft = state.scrollLeftStart - walk;
        };

        const endDrag = () => {
            if (!state.isDown) return;
            if (state.panel) state.panel.classList.remove('dragging');
            state.isDown = false;
            state.panel = null;
        };

        html.on(`mousedown${ns}`, '.craft-elements-panel', (ev) => {
            if (ev.button !== 0) return;
            startDrag(ev, ev);
        });

        $(document).on(`mousemove${ns}`, (ev) => {
            if (!state.isDown) return;
            ev.preventDefault();
            moveDrag(ev.pageX);
        });

        $(document).on(`mouseup${ns}`, () => endDrag());

        html.on(`touchstart${ns}`, '.craft-elements-panel', (ev) => {
            const touch = ev.originalEvent?.touches?.[0];
            if (!touch) return;
            startDrag(ev, touch);
        });

        $(document).on(`touchmove${ns}`, (ev) => {
            if (!state.isDown) return;
            const touch = ev.originalEvent?.touches?.[0];
            if (!touch) return;
            moveDrag(touch.pageX);
            ev.preventDefault();
        });

        $(document).on(`touchend${ns}`, () => endDrag());

        this._elementsEventsBound = true;
        this._elementsDragState = state;
    }
    /**
     * 解除元素面板事件绑定
     */
    _unbindElementsPanelEvents() {
        debug(`${this.APP_ID} _unbindElementsPanelEvents`);
        const ns = ".craftElementsPanel";
        $(document).off(ns);
        if (this.element) $(this.element).off(ns);
        this._elementsEventsBound = false;
        this._elementsDragState = undefined;
    }
    /**
     * 根据当前元素面板宽度处理溢出类名并设置观察器
     * @param {HTMLElement} root
     */
    _setupElementsPanelOverflow(root) {
        debug(`${this.APP_ID} _setupElementsPanelOverflow`);
        try {
            const elementsPanel = root.querySelector('.craft-elements-panel');
            if (!elementsPanel) {
                if (this._elementsResizeObserver) {
                    this._elementsResizeObserver.disconnect();
                    this._elementsResizeObserver = undefined;
                }
                return;
            }

            if (elementsPanel.scrollLeft !== 0) elementsPanel.scrollLeft = 0;

            const updateOverflowClass = () => this._updateElementsOverflowClass(elementsPanel);
            updateOverflowClass();

            if (this._elementsResizeObserver) {
                this._elementsResizeObserver.disconnect();
            }
            const ro = new ResizeObserver(() => { updateOverflowClass(); });
            ro.observe(elementsPanel);
            Array.from(elementsPanel.children).forEach(c => ro.observe(c));
            this._elementsResizeObserver = ro;
            this._elementsPanelEl = elementsPanel;
        } catch (e) {
            console.warn('craftpanel: elements panel overflow setup failed', e);
        }
    }
    /**
     * 更新元素面板的溢出状态类名
     * @param {HTMLElement} elementsPanel
     */
    _updateElementsOverflowClass(elementsPanel) {
        debug(`${this.APP_ID} _updateElementsOverflowClass`, elementsPanel?.scrollWidth, elementsPanel?.clientWidth);
        if (!elementsPanel) return;
        if (elementsPanel.scrollWidth <= elementsPanel.clientWidth) {
            elementsPanel.classList.add('no-overflow');
            elementsPanel.classList.remove('overflowing');
        } else {
            elementsPanel.classList.remove('no-overflow');
            elementsPanel.classList.add('overflowing');
        }
    }
    _onClose(options) {
        debug(`${this.APP_ID} _onClose : options`, options);
        super._onClose(options);
        // 移除绑定的元素面板事件与观察器
        try {
            this._unbindElementsPanelEvents();
            if (this._elementsResizeObserver) {
                this._elementsResizeObserver.disconnect();
            }
            if (this._elementsPanelEl) this._elementsPanelEl.classList.remove('dragging', 'no-overflow', 'overflowing');
        } catch (e) { /* ignore */ }
        this._elementsPanelEl = undefined;
        this._elementsResizeObserver = undefined;

        craftPanels ??= [];
        craftPanels.splice(craftPanels.indexOf(this), 1);
    }

    /**
     * 处理物品放置在槽位中的事件
     * @param {Event} event 
     */
    async _onDropSlot(event) {
        debug(`${this.APP_ID} _onDropSlot : event`, event);
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
            if (this.isEdit) {
                //编辑模式下放置物品会提示确认是否绑定到槽位
                const confirm = await confirmDialog(`${MODULE_ID}.craft-panel.bind-confirm-title`, `${MODULE_ID}.craft-panel.bind-confirm-info`, `${MODULE_ID}.yes`, `${MODULE_ID}.no`);
                if (confirm) {
                    await this.bindItemToSlot(index, item);
                    this.needRefresh = true;
                    await this.render(true);
                }
            } else {
                await this.addIngredient(index, item);
            }
        }
    }
    /**
     * 处理物品放置在槽位面板中的事件
     * @param {Event} event
     */
    async _onDropSlotPanel(event) {
        debug(`${this.APP_ID} _onDropSlotPanel : event`, event);
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        if ((data.type == "CraftSlot") && this.isEdit) {
            const position = { unlock: true, x: event.offsetX, y: event.offsetY };
            const slotUuid = this.slots[data.index].uuid;
            const slot = await fromUuid(slotUuid);
            const size = slot.getFlag(MODULE_ID, "size");
            position.x -= size / 2;
            position.y -= size / 2;
            await slot.setFlag(MODULE_ID, "position", position);
            await this.render(true);
        } else if ((data.type == "Item") && !this.isEdit) {
            for (let i = 0; i < this.slots.length; i++) {
                if (!this.slots[i].isLocked && (this.slotItems[i] === null || this.slotItems[i] === undefined)) {
                    const item = await fromUuid(data.uuid);
                    await this.addIngredient(i, item);
                }
            }
        }
    }
    /**
     * 处理单击槽位中的物品事件
     * @param {Event} event 
     */
    async _onClickSlot(event) {
        debug(`${this.APP_ID} _onClickSlot : isEdit`, this.isEdit);
        event.preventDefault();
        const index = parseInt(event.currentTarget.dataset.index);
        if (this.isEdit) {
            const slotJEUuid = this.slots[index].uuid;
            await this.editSlot(slotJEUuid);
            await this.render(true);
        } else {
            const isEmpty = event.currentTarget.classList.contains("empty");
            if (isEmpty) {
                return;
            } else {
                await this.removeIngredient(index);
            }
        }
    }
    /**
     * 处理右键点击槽位事件
     * @param {Event} event 
     * @returns 
     */
    async _onContextMenuSlot(event) {
        debug(`${this.APP_ID} _onContextMenuSlot : isEdit`, this.isEdit);
        event.preventDefault();
        const index = parseInt(event.currentTarget.dataset.index);
        if (this.isEdit) {
            const slotJEUuid = this.slots[index].uuid;
            const page = await fromUuid(slotJEUuid);
            await page.deleteDialog();
            await this.render(true);
        } else {
            const isEmpty = event.currentTarget.classList.contains("empty");
            if (isEmpty) {
                return;
            } else {
                await this.removeIngredient(index);
            }
        }
    }
    /**
     * 处理拖拽槽位事件
     * @param {Event} event 
     */
    async _onDragStartSlot(event) {
        debug(`${this.APP_ID} _onDragStartSlot`);
        const uuid = event.currentTarget.dataset.uuid;
        event.originalEvent.dataTransfer.setData(
            "text/plain",
            JSON.stringify({
                type: "Item",
                uuid: uuid,
            }),
        );
        game.tooltip.deactivate();
    }
    /**
     * 处理拖拽槽位事件(编辑模式)
     * @param {Event} event 
     */
    async _onDragStartSlotEdit(event) {
        debug(`${this.APP_ID} _onDragStartSlotEdit`);
        const index = event.currentTarget.dataset.index;
        event.originalEvent.dataTransfer.setData(
            "text/plain",
            JSON.stringify({
                type: "CraftSlot",
                index: index,
            }),
        );
        game.tooltip.deactivate();
    }
    /**
     * 处理单击分类图标事件
     * @param {Event} event 
     */
    async _onClickCategory(event) {
        debug(`${this.APP_ID} _onClickCategory : isEdit category type`, this.isEdit, event.currentTarget.dataset.category, event.currentTarget.dataset.type);
        const category = event.currentTarget.dataset.category;
        const type = event.currentTarget.dataset.type;

        if (this.isEdit && category === "add") {
            await this.addCategory(type);
        } else {
            await this.changeCategory(category, type);
        }
    }
    /**
     * 处理右键点击分类图标事件
     * @param {Event} event 
     */
    async _onContextMenuCategory(event) {
        debug(`${this.APP_ID} _onContextMenuCategory`);
        event.preventDefault();
        const category = event.currentTarget.dataset.category;
        const type = event.currentTarget.dataset.type;
        this.editCategory(category, type);
    }
    /**
     * 处理单击元素事件
     * @param {Event} event 
     */
    async _onClickElement(event) {
        debug(`${this.APP_ID} _onClickElement`);
        event.preventDefault();
        this.editElementConfig(event.currentTarget.dataset.index);
    }
    /**
     * 处理拖拽元素事件
     * @param {Event} event 
     */
    async _onDragStartElement(event) {
        debug(`${this.APP_ID} _onDragStartElement`);
        event.originalEvent.dataTransfer.setData(
            "text/plain",
            JSON.stringify({
                type: "CraftElementConfig",
                parent: this.journalEntry.uuid,
                elementConfig: this.elementConfigs[event.currentTarget.dataset.index],
                index: event.currentTarget.dataset.index,
            }),
        );
    }
    /**
     * 处理物品或元素放置在元素或元素面板中的事件
     * @param {Event} event 
     */
    async _onDropElementPanel(event) {
        debug(`${this.APP_ID} _onDropElementPanel : target`, event.currentTarget.dataset.index);
        event.preventDefault();
        let data;
        try {
            data = JSON.parse(event.originalEvent.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug(`${this.APP_ID} _onDropElementPanel : data`, data);
        if (data.type !== "Item" && data.type !== "CraftElement" && data.type !== "CraftElementConfig") return;
        const targetIndex = event.currentTarget.dataset.index;
        if (data.type === "CraftElementConfig") {
            /**
             * 如果来源为相同的界面，则调整位置。
             * 如果来源为不同的界面，则新增元素配置。
             */
            if (data.parent === this.journalEntry.uuid) {
                const sourceIndex = data.index;
                /**
                 * 如果没有目标索引，说明是拖拽到空白区域，则放到最后。
                 * 如果目标索引小于来源索引，说明是向前移动，则插入到目标索引位置。
                 * 如果目标索引大于来源索引，说明是向后移动，则插入到目标索引+1位置。
                 */
                if (targetIndex === undefined && (sourceIndex < this.elementConfigs.length - 1)) {
                    const elementConfig = this.elementConfigs.splice(sourceIndex, 1)[0];
                    this.elementConfigs.push(elementConfig);
                } else if (targetIndex < sourceIndex) {
                    const elementConfig = this.elementConfigs.splice(sourceIndex, 1)[0];
                    this.elementConfigs.splice(targetIndex, 0, elementConfig);
                } else if (targetIndex > sourceIndex) {
                    const elementConfig = this.elementConfigs.splice(sourceIndex, 1)[0];
                    this.elementConfigs.splice(targetIndex + 1, 0, elementConfig);
                }
            } else {
                this.elementConfigs.push(foundry.utils.deepClone(data.elementConfig));
            }
            //保存当前的元素配置。
            this.journalEntry.setFlag(MODULE_ID, "elementConfig", this.elementConfigs);
        } else {
            const item = await fromUuid(data.uuid);
            if (item) {
                const element = item.getFlag(MODULE_ID, "elementConfig");
                if (element) {
                    /**@type {CraftElementConfig} */
                    const elementConfig = {
                        ids: [element.id],
                        name: element.name,
                        img: element.img,
                        color: element.color,
                        size: 60,
                        shape: "circle",
                        multiShow: "max",
                        multiValue: "only-max",
                        plusElements: "",
                        minusElements: "",
                        visible: true,
                        value: 1,
                        useMin: false,
                        min: 0,
                        useMax: false,
                        max: 0,
                    }
                    /**
                     * 如果存在同id的元素配置，则覆盖配置。
                     * 如果不存在，则新增元素配置。
                     */
                    const index = this.elementConfigs.findIndex(elc => elc.ids.includes(element.id));
                    if (index >= 0) {
                        elementConfig.ids = [...this.elementConfigs[index].ids];
                        this.elementConfigs[index] = elementConfig;
                    } else {
                        this.elementConfigs.push(elementConfig);
                    }

                    //保存当前的元素配置。
                    this.journalEntry.setFlag(MODULE_ID, "elementConfig", this.elementConfigs);
                }
            }
        }
        this.needRefresh = true;
        await this.render(true);
    }
    async _onClickMaterials(event) {
        debug(`${this.APP_ID} _onClickMaterials : isEdit`, this.isEdit);
        event.preventDefault();
        const uuid = event.currentTarget.dataset.uuid;
        const item = await fromUuid(uuid);
        if (!item) {
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.objectNotFound`));
            return;
        }
        if (this.isEdit) {
            await this.editMaterial(item);
        } else {
            for (let i = 0; i < this.slots.length; i++) {
                if (!this.slots[i].isLocked && (this.slotItems[i] === null || this.slotItems[i] === undefined)) {
                    if (await this.checkAdd(i, item)) {
                        await this.addIngredient(i, item);
                        return;
                    }
                }
            }
        }
    }
    async _onContextMenuMaterials(event) {
        debug(`${this.APP_ID} _onContextMenuMaterials : isEdit`, this.isEdit);
        event.preventDefault();
        const uuid = event.currentTarget.dataset.uuid;
        const item = await fromUuid(uuid);
        if (!item) {
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.objectNotFound`));
            return;
        }
        if (this.isEdit) {
            item.sheet.render(true);
        } else {
            let index = -1;
            for (let i = this.slots.length - 1; i >= 0; i--) {
                if (this.slotItems[i]?.uuid === uuid) {
                    index = i;
                    break;
                }
            }
            if (index >= 0) {
                await this.removeIngredient(index);
            } else {
                item.sheet.render(true);
            }
        }
    }
    async _onDragStartMaterials(event) {
        debug(`${this.APP_ID} _onDragStartMaterials`);
        event.originalEvent.dataTransfer.setData(
            "text/plain",
            JSON.stringify({
                type: "Item",
                uuid: event.currentTarget.dataset.uuid,
            }),
        );
        game.tooltip.deactivate();
    }
    /**
     * 处理可能存在的多个滚动面板的滚动事件，记录各自的滚动位置
     * @param {Event} event 
     */
    async _onScrollLogPanel(event) {
        debug(`${this.APP_ID} _onScrollLogPanel : panel`, event.currentTarget.dataset.panel);
        const panel = event.currentTarget.dataset.panel;
        this.scrollPositions[panel] = event.target.scrollTop;
    }
    /**
     * 处理切换保留材料选项事件
     * @param {Event} event 
     */
    async _onToggleKeepMaterials(event) {
        debug(`${this.APP_ID} _onToggleKeepMaterials : checked`, event.currentTarget.checked);
        this.keepMaterials = event.currentTarget.checked;
        await game.user?.setFlag(MODULE_ID, "keepMaterials", this.keepMaterials);
    }
    //处理修改面板大小事件
    async changePanelSize(event) {
        debug(`${this.APP_ID} changePanelSize : name`, event.currentTarget.dataset.name);
        const name = event.currentTarget.dataset.name;
        // 确保存在 panelSizes 对象
        this.panelSizes ??= this.DEFAULT_PANEL_SIZES;
        this.panelSizes[name] = this.panelSizes[name] ?? this.DEFAULT_PANEL_SIZES[name];

        const fb = new FormBuilder()
            .object(this.panelSizes[name])
            .title(game.i18n.localize(`${MODULE_ID}.change-panel-size`))
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`), value: this.panelSizes[name]?.name ?? game.i18n.localize(`${MODULE_ID}.${name}`) })
            .number({ name: "width", label: game.i18n.localize(`${MODULE_ID}.width`), min: 0 })
            .number({ name: "height", label: game.i18n.localize(`${MODULE_ID}.height`), min: 0 });
        const data = await fb.render();
        if (!data) return;
        this.panelSizes[name] = data;
        await this.journalEntry.setFlag(MODULE_ID, "panelSizes", this.panelSizes);
        this.needRefresh = true;
        await this.render(true);
    }
    //移除槽位中的物品
    async removeIngredient(index) {
        debug(`${this.APP_ID} removeIngredient : index`, index);
        if (this.slotItems[index] === null || this.slotItems[index] === undefined || this.slots[index]?.isLocked || this.slotItems[index]?.bindItem) {
            return;
        }
        const ingredientSettings = this.slotItems[index].ingredientSettings;
        let quantity = this.slotItems[index].quantity ?? 1;
        if (ingredientSettings?.multiQuantity) {
            if (ingredientSettings.min > 0 && quantity - 1 < ingredientSettings.min) {
                this.slotItems[index] = null;
            } else {
                quantity = 1;
                this.slotItems[index].quantity -= 1;
                if (ingredientSettings.elementByQuantity ?? false) {
                    const item = await fromUuid(this.slotItems[index].uuid);
                    const elements = item.getFlag(MODULE_ID, "element") ?? [];
                    elements.forEach(el => {
                        el.num = el.num - (el.num / (this.slotItems[index].quantity + 1)) * ingredientSettings.elementPerQuantity;
                    });
                }
            }
        } else {
            this.slotItems[index] = null;
        }

        let material = this.materials.find(m => m.uuid == this.slotItems[index]?.uuid);
        if (material) {
            material.quantity += quantity;
        }
        //播放音效
        if (this.audio?.["remove-ingredient"]) {
            playAudio({ src: this.audio["remove-ingredient"], channel: "interface", volume: (this.audio?.["volume"] ?? 100) / 100 }, true);
        }
        //移除完成，刷新界面
        await this.refreshElements();
        await this.refreshResults();
        await this.render(true);
    }
    //添加物品到槽位中
    async addIngredient(index, item, options = {}) {
        debug(`${this.APP_ID} addIngredient : index item options`, index, item, options);
        const { skipRender = false, skipRefresh = false } = options;
        if (await this.checkAdd(index, item)) {
            const ingredientSettings = item.getFlag(MODULE_ID, "ingredientSettings") ?? undefined;
            let quantity = 1;
            //检查材料自定义设置
            if (ingredientSettings && ingredientSettings?.multiQuantity && this.slotItems[index].uuid == item.uuid) {
                this.slotItems[index].quantity += 1;
                if (ingredientSettings.elementByQuantity ?? false) {
                    this.slotItems[index].elements.forEach(el => {
                        el.num = el.num + (el.num / this.slotItems[index].quantity) * (ingredientSettings.elementPerQuantity - 1);
                    });
                }
            } else {
                const elements = item.getFlag(MODULE_ID, "element") ?? [];
                const tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h2>${item.name}</h2></figure><div class="description">${item?.system?.description ?? item?.description ?? ""}</div><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
                if (ingredientSettings?.multiQuantity && ingredientSettings.min > 0) {
                    quantity = ingredientSettings.min;
                    if (ingredientSettings.elementByQuantity ?? false) {
                        elements.forEach(el => {
                            el.num = el.num * quantity * ingredientSettings.elementPerQuantity;
                        });
                    }
                }
                const data = {
                    uuid: item.uuid,
                    name: item.name,
                    img: item.img,
                    elements: elements,
                    itemColor: item ? getItemColor(item) ?? "" : "",
                    tooltip: tooltip,
                    quantity: quantity,
                    ingredientSettings: ingredientSettings,
                }
                this.slotItems[index] = data;
            }
            let material = this.materials.find(m => m.uuid == item.uuid);
            if (material) {
                material.quantity -= quantity;
            }
            //播放音效
            if (this.audio?.["add-ingredient"]) {
                playAudio({ src: this.audio["add-ingredient"], channel: "interface", volume: (this.audio?.["volume"] ?? 100) / 100 }, true);
            }

            //添加完成，刷新界面
            if (!skipRefresh) {
                await this.refreshElements();
                await this.refreshResults();
            }
            if (!skipRender) {
                await this.render(true);
            }
        }
    }
    //绑定物品到槽位中（编辑模式）
    async bindItemToSlot(index, item) {
        debug(`${this.APP_ID} bindItemToSlot : index item`, index, item);
        const slotJEUuid = this.slots[index].uuid;
        const slotJE = await fromUuid(slotJEUuid);
        const update = {
            [`flags.${MODULE_ID}.bindItem`]: item.name,
            name: item.name,
            src: item.img,
        };
        await slotJE.update(update);
    }
    /**
     * 刷新绑定物品显示数据，根据当前槽位中的物品和绑定配置计算出需要显示的绑定物品数据，并保存到 this.bindItems 和 this.slotItems 中
     */
    refreshBindItems() {
        debug(`${this.APP_ID} refreshBindItems : bindItems`, this.bindItems);
        Object.entries(this.bindItems).forEach(([index, b]) => {
            if (b.materials?.length > 0) {
                //当能够找到对应的绑定物品时，才显示绑定物品数据，否则清空绑定物品数据
                const m = b.materials[0];
                const item = m.item;
                //绑定物品的总数
                let allQuantity = 0;
                if (m.materials?.some(mat => mat?.quantity > 0)) {
                    allQuantity = m.materials.map(m => m.quantity ?? 0).reduce((prev, current) => prev + current, 0);
                } else if (m.materials?.every(mat => mat?.quantity === undefined)) {
                    allQuantity = undefined;
                }
                const data = {
                    uuid: item.uuid,
                    name: b.name,
                    img: item.img,
                    elements: item.getFlag(MODULE_ID, "element") ?? [],
                    itemColor: m.itemColor,
                    tooltip: m.tooltip,
                    quantity: typeof allQuantity === "number" ? b.quantity : undefined,
                    ingredientSettings: item.getFlag(MODULE_ID, "ingredientSettings") ?? undefined,
                }
                //若配置为0，则消耗所有材料；否则消耗固定数量的材料
                if (b.quantity == 0 && typeof allQuantity === "number") {
                    data.quantity = allQuantity;
                }
                if (typeof b.elementPerQuantity === "number" && typeof allQuantity === "number") {
                    data.elements.forEach(el => {
                        el.num = el.num * (b.elementPerQuantity ?? 1) * (data.quantity ?? 1);
                    });
                }
                this.slotItems[index] = data;
                this.bindItems[index].data = data;
                this.bindItems[index].allQuantity = allQuantity;
            } else {
                this.slotItems[index] = null;
            }
        });
    }
    /**
     * 刷新元素显示数据，根据当前槽位中的物品和元素配置计算出需要显示的元素数据，并保存到 this.elementsShow 中
     */
    async refreshElements() {
        debug(`${this.APP_ID} refreshElements`);
        this.elements = [];
        this.elementsAll = [];
        this.elementsShow = [];
        /**@type {CraftElementConfig[]} */
        let elementConfigs = this.elementConfigs;
        Object.entries(this.slotItems).forEach(([index, data]) => {
            if (data) {
                let elements = data.elements;
                for (let el of elements) {
                    let element = this.elementsAll.find(e => e.id == el.id);
                    if (element) {
                        element.num += el.num;
                    } else {
                        this.elementsAll.push(foundry.utils.deepClone(el));
                    }
                }
            }
        });
        if (elementConfigs.length > 0) {
            elementConfigs.forEach((elc) => {
                const ids = elc.ids.map(id => id.trim()).filter(id => id != "");
                const elements = this.elementsAll.filter(el => ids.includes(el.id));
                const plusElements = this.elementsAll.filter(el => elc.plusElements.replaceAll(/，/g, ",").split(",").includes(el.id));
                const minusElements = this.elementsAll.filter(el => elc.minusElements.replaceAll(/，/g, ",").split(",").includes(el.id));
                const mod = plusElements.map(el => el.num).reduce((prev, current) => prev + current, 0) - minusElements.map(el => el.num).reduce((prev, current) => prev + current, 0);
                const visible = elc.visible == true || elc.visible == "true";
                /**@type {CraftElement} */
                let elementShow = {};
                if (elements.length > 0) {
                    /**@type {CraftElement} */
                    let element = {};
                    if (elements.length == 1) {
                        element = foundry.utils.deepClone(elements[0]);
                        elementShow = foundry.utils.deepClone(elements[0]);
                        elementShow.shapeClass = elc.shape == "square" ? "" : "round";
                        elementShow.size = elc.size;
                    } else {
                        let maxElement = elements.reduce((prev, current) => (prev.num > current.num) ? prev : current);
                        let minElement = elements.reduce((prev, current) => (prev.num < current.num) ? prev : current);
                        if (elc.multiShow == "max") {
                            elementShow = foundry.utils.deepClone(maxElement);
                        } else if (elc.multiShow == "min") {
                            elementShow = foundry.utils.deepClone(minElement);
                        } else {
                            elementShow.id = ids[0];
                            elementShow.img = elc.img;
                            elementShow.name = elc.name;
                            elementShow.color = elc.color;
                        }
                        if (elc.multiValue == "only-max") {
                            element = foundry.utils.deepClone(maxElement);
                        } else if (elc.multiValue == "only-min") {
                            element = foundry.utils.deepClone(minElement);
                        } else if (elc.multiValue == "max-plus") {
                            element = foundry.utils.deepClone(maxElement);
                            let value = elements.filter(el => el.id != element.id).map(el => el.num).reduce((prev, current) => prev + current, 0);
                            element.num = element.num + value;
                        } else if (elc.multiValue == "max-minus") {
                            element = foundry.utils.deepClone(maxElement);
                            let value = elements.filter(el => el.id != element.id).map(el => el.num).reduce((prev, current) => prev + current, 0);
                            element.num = element.num - value;
                        } else if (elc.multiValue == "min-plus") {
                            element = foundry.utils.deepClone(minElement);
                            let value = elements.filter(el => el.id != element.id).map(el => el.num).reduce((prev, current) => prev + current, 0);
                            element.num = element.num + value;
                        } else if (elc.multiValue == "min-minus") {
                            element = foundry.utils.deepClone(minElement);
                            let value = elements.filter(el => el.id != element.id).map(el => el.num).reduce((prev, current) => prev + current, 0);
                            element.num = element.num - value;
                        }
                    }
                    if (elc.multiValue == "all") {
                        /**@type {CraftElement[]} */
                        let els = elements.map(el => foundry.utils.deepClone(el));
                        els.forEach(el => {
                            if (el.num > 0) el.num += mod;
                            if ((elc.useMax ?? false) && (el.num > elc.max)) {
                                el.num = elc.max;
                            } else if ((elc.useMin ?? false) && (el.num < elc.min)) {
                                el.num = elc.min;
                            }
                        });
                        let value = els.map(el => el.num).reduce((prev, current) => prev + current, 0);
                        elementShow.num = value; //显示数量
                        if (visible || (elementShow.num > 0 && elc.visible == "visibleWhenUp0") || (elementShow.num < 0 && elc.visible == "visibleWhenDown0")) {
                            elementShow.shapeClass = elc.shape == "square" ? "" : "round";
                            elementShow.size = elc.size;
                            this.elementsShow.push(elementShow);
                        }
                        this.elements.push(...els);
                    } else {
                        if (element.num > 0) element.num += mod;
                        if ((elc.useMax ?? false) && (element.num > elc.max)) {
                            element.num = elc.max;
                        } else if ((elc.useMin ?? false) && (element.num < elc.min)) {
                            element.num = elc.min;
                        }
                        elementShow.num = element.num; //显示数量
                        if (visible || (elementShow.num > 0 && elc.visible == "visibleWhenUp0") || (elementShow.num < 0 && elc.visible == "visibleWhenDown0")) {
                            elementShow.shapeClass = elc.shape == "square" ? "" : "round";
                            elementShow.size = elc.size;
                            this.elementsShow.push(elementShow);
                        }
                        this.elements.push(element);
                    }
                } else if (this.isEdit || visible) {
                    elementShow.id = ids[0];
                    elementShow.img = elc.img;
                    elementShow.name = elc.name;
                    elementShow.num = 0;
                    elementShow.color = elc.color;
                    elementShow.shapeClass = elc.shape == "square" ? "" : "round";
                    elementShow.size = elc.size;
                    this.elementsShow.push(elementShow);
                }
            });
        } else {
            this.elements = this.elementsAll;
            this.elementsShow = this.elementsAll.map((e) => {
                return {
                    shapeClass: "round",
                    ...e,
                }
            });
            this.elementsShow.sort((a, b) => b.num - a.num);
        }
        //按元素数量排序
        this.elements.sort((a, b) => b.num - a.num);
        this.elementsShow.map((el, i) => el.index = i);
    }
    /**
     * 刷新结果
     */
    async refreshResults() {
        debug(`${this.APP_ID} refreshResults`);
    }
    //刷新材料面板
    async refreshPanel() {
        debug(`${this.APP_ID} refreshPanel : categories`, this.categories);
        //刷新分类
        for (let type in this.categories) {
            //记录之前选中的分类
            this.category[type] = this.categories[type].find(c => c.choosed)?.id;

            //刷新分类
            this.categories[type] = JSON.parse(JSON.stringify(this.journalEntry.getFlag(MODULE_ID, type + "-categories") ?? []));
            this.categories[type].unshift({
                id: "all",
                name: game.i18n.localize(`${MODULE_ID}.all`),
                icon: "modules/craftpanel/img/svgs/stack.svg",
                choosed: true,
            });

            if (this.isEdit) {
                //在编辑模式下，将新增按钮添加到最后
                this.categories[type].push({
                    id: "add",
                    name: game.i18n.localize(`${MODULE_ID}.craft-panel.new-category`),
                    icon: "modules/craftpanel/img/svgs/health-normal.svg",
                    choosed: false,
                });
            }

            //恢复之前选中的分类
            if (this.category[type] && this.categories[type].find(c => c.id == this.category[type])) {
                this.categories[type].map(c => c.choosed = false);
                this.categories[type].find(c => c.id == this.category[type]).choosed = true;
            }

            //记录当前选中的分类
            this.category[type] = this.categories[type].find(c => c.choosed)?.id;
        }
        //初始化绑定物品
        this.bindItems = {};
        const slotsJE = this.journalEntry.pages.filter(p => p.flags[MODULE_ID]?.type === "slot");
        slotsJE.forEach((slot, i) => {
            if (slot.getFlag(MODULE_ID, "bindItem")) {
                this.bindItems[i] = {
                    name: slot.getFlag(MODULE_ID, "bindItem"),
                    quantity: slot.getFlag(MODULE_ID, "bindItemQuantity") ?? undefined,
                    elementPerQuantity: slot.getFlag(MODULE_ID, "bindItemElementByQuantity") ? slot.getFlag(MODULE_ID, "bindItemElementPerQuantity") ?? 1 : false,
                    allQuantity: 0,
                    materials: []
                };
            }
        });
        const bindItemNames = Object.values(this.bindItems).map(b => b.name);
        //刷新材料
        let materials_items = [];
        const requirements = {};
        this.journalEntry.getFlag(MODULE_ID, "requirements").forEach(key => {
            if (key == "script") {
                const script = this.journalEntry.getFlag(MODULE_ID, "requirements-script");
                if (script && script.trim() != "") {
                    const fn = new AsyncFunction("item", script);
                    requirements.script = fn;
                }
            } else {
                requirements[key] = this.journalEntry.getFlag(MODULE_ID, `requirements-${key}`);
            }
        });
        const categoryRequirements = {};
        if (this.category.materials != "all") {
            this.categories.materials.find(c => c.id == this.category.materials)?.requirements?.forEach(key => {
                if (key == "script") {
                    const script = this.categories.materials.find(c => c.id == this.category.materials)?.["requirements-script"];
                    if (script && script.trim() != "") {
                        const fn = new AsyncFunction("item", script);
                        categoryRequirements.script = fn;
                    }
                } else {
                    categoryRequirements[key] = this.categories.materials.find(c => c.id == this.category.materials)?.["requirements-" + key];
                }
            });
        }
        if (this.actor) {
            materials_items = this.actor.items.contents;
        } else {
            materials_items = game.items.contents;
        }
        this.materials = [];
        for (let i = 0; i < materials_items.length; i++) {
            const item = materials_items[i];
            if (await CraftPanel.checkItemRequirements(item, requirements) && (this.category.materials == "all" || await CraftPanel.checkItemRequirements(item, categoryRequirements))) {
                /** @type {CraftElement[]} */
                const elements = item.getFlag(MODULE_ID, "element") ?? [];
                const itemColor = item ? getItemColor(item) ?? "" : "";
                const tooltip = await TextEditor.enrichHTML(`<figure><img src='${item.img}'><h2>${item.name}</h2></figure><div class="description">${item?.system?.description ?? item?.description ?? ""}</div><div class="tooltip-elements">${elements.map(el => { return `<div class="tooltip-element" style="background-image: url('${el.img}');"><div class="tooltip-element-num">${el.num}</div></div>` }).join('')}</div>`);
                // const quantity = this.countQuantity(item);
                const showQuantity = (this.actor ?? false) && (typeof quantity === "number");
                let totalElements = 0;
                // 根据elementConfigs中的value配置来计算总元素数量
                if (this.elementConfigs.length > 0) {
                    this.elementConfigs.forEach((elc) => {
                        const ids = elc.ids.map(id => id.trim()).filter(id => id != "");
                        const els = elements.filter(el => ids.includes(el.id));
                        if (els.length > 0) {
                            totalElements += els.map(el => (el.num * elc.value)).reduce((prev, current) => prev + current, 0);
                        }
                    });
                } else {
                    // 计算总元素数量，有颜色的元素数量之和，如果没有颜色的元素，则计算所有元素数量之和
                    if (elements.filter(e => e.color != "").length > 0) {
                        totalElements = elements.filter(e => e.color != "").reduce((a, b) => a + b.num, 0);
                    } else {
                        totalElements = elements.reduce((a, b) => a + b.num, 0);
                    }
                }
                const material = {
                    // slotIndex: i,
                    item: item,
                    uuid: item.uuid,
                    elements: elements.filter(e => e.color != ""),
                    itemColor: itemColor,
                    tooltip,
                    showQuantity,
                    // quantity,
                    totalElements,
                    showElements: Array.isArray(elements) && elements.filter(el => el.color != "").length > 0,
                }
                if (bindItemNames.includes(item.name)) {
                    //如果该物品是绑定物品，则不会显示在材料列表中，而是显示在对应的绑定物品槽位中
                    Object.values(this.bindItems).forEach(bindItem => {
                        if (bindItem.name == item.name) {
                            material.quantity = this.countQuantity(item, true);
                            bindItem.materials.push(material);
                        }
                    });
                } else {
                    material.quantity = this.countQuantity(item);
                    this.materials.push(material);
                }
            }
        }
        this.materials.sort((a, b) => b.totalElements - a.totalElements);
    }
    //检查能否添加该物品到槽位中
    async checkAdd(index, item, slots = this.slots, slotItems = this.slotItems) {
        debug(`${this.APP_ID} checkAdd : index item`, index, item);
        if (!item) return false;
        if (slots[index]?.isLocked || slotItems[index]?.bindItem) return false;
        const ingredientSettings = item.getFlag(MODULE_ID, "ingredientSettings");
        if (this.actor) {
            //检查数量
            let quantity = this.countQuantity(item);
            if (quantity === undefined) {
                if (Object.values(slotItems).some(data => data.uuid === item.uuid)) {
                    return false;
                }
            } else if (quantity <= 0) {
                return false;
            }
            //检查材料自定义设置
            if (ingredientSettings && ingredientSettings?.multiQuantity) {
                //若最大数不为0，则检查是否已达到最大数
                if (ingredientSettings?.max && ingredientSettings.max > 0) {
                    const currentQuantity = slotItems[index]?.quantity ?? 0;
                    if (currentQuantity >= ingredientSettings.max) {
                        return false;
                    }
                }
                //若最小数不为0，则检查剩余数量是否足够达到最小数
                if (ingredientSettings?.min && ingredientSettings.min > 0) {
                    if (quantity < ingredientSettings.min) {
                        return false;
                    }
                }
            }
        }
        //检查同名数量限制
        const sameNameLimit = ingredientSettings?.ingredientLimit ?? this.journalEntry.getFlag(MODULE_ID, "ingredientLimit") ?? 0;
        if (sameNameLimit > 0) {
            const sameNameCount = Object.values(slotItems).filter(data => data?.name === item.name).length;
            if (sameNameCount >= sameNameLimit) {
                return false;
            }
        }

        //检查槽位要求
        const slotJE = this.journalEntry.pages.find(p => p.id == slots[index].id);
        const config = slotJE.getFlag(MODULE_ID, "requirements") ?? [];
        if (config.length > 0) {
            const requirements = {};
            config.forEach(key => {
                if (key == "script") {
                    const script = slotJE.getFlag(MODULE_ID, "requirements-script");
                    if (script && script.trim() !== "") {
                        const fn = new AsyncFunction("item", script);
                        requirements.script = fn;
                    }
                } else {
                    requirements[key] = slotJE.getFlag(MODULE_ID, `requirements-${key}`);
                }
            });
            return await CraftPanel.checkItemRequirements(item, requirements);
        }
        return true;
    }
    //检查必需槽位是否已填满
    checkSlot() {
        debug(`${this.APP_ID} checkSlot`);
        let slots = this.slots.filter(slot => slot.isNecessary);
        //必需槽位必须全部填满才返回true，否则返回false
        let result = slots.every(slot => this.slotItems[slot.slotIndex] !== null && this.slotItems[slot.slotIndex] !== undefined);
        //对于绑定物品的槽位，还需要检查槽位中的物品是否满足数量要求
        Object.entries(this.bindItems).forEach(([index, b]) => {
            if (b.quantity > 0 && slots.find(s => s.slotIndex == index)) {
                if (this.slotItems[index] === null || this.slotItems[index] === undefined || this.slotItems[index].quantity === undefined || this.slotItems[index].quantity < b.quantity) {
                    result = false;
                }
            }
        });
        return result;
    }
    countQuantity(item, bindItem = false) {
        debug(`${this.APP_ID} countQuantity : bindItem`, bindItem);
        let quantity = item?.system?.quantity;
        if (quantity === undefined) {
            return undefined;
        }
        if (typeof quantity === "string") {
            quantity = parseFloat(quantity);
        }
        if (!bindItem) {
            Object.entries(this.slotItems).forEach(([index, data]) => {
                if (data) {
                    if (data.uuid === item.uuid) {
                        quantity -= data.quantity ?? 1;
                    }
                }
            });
        }
        return quantity;
    }

    /**
     * 编辑材料（编辑模式）
     * @param {Item} item 物品对象
     */
    async editMaterial(item) {
        debug(`${this.APP_ID} editMaterial : item`, item);
        const fb = new FormBuilder()
            .object(item)
            .title(game.i18n.localize(`${MODULE_ID}.craft-panel.edit-material`) + ": " + item.name)
            .number({ name: `flags.${MODULE_ID}.ingredientSettings.ingredientLimit`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-limit`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-limit-hint`), value: 0, min: 0, step: 1 })
            .checkbox({ name: `flags.${MODULE_ID}.ingredientSettings.multiQuantity`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-multi-quantity`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-multi-quantity-hint`) })
            .number({ name: `flags.${MODULE_ID}.ingredientSettings.min`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-min`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-min-hint`), value: 0, min: 0, step: 1 })
            .number({ name: `flags.${MODULE_ID}.ingredientSettings.max`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-max`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-max-hint`), value: 0, min: 0, step: 1 })
            .checkbox({ name: `flags.${MODULE_ID}.ingredientSettings.elementByQuantity`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-element-by-quantity`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-element-by-quantity-hint`) })
            .number({ name: `flags.${MODULE_ID}.ingredientSettings.elementPerQuantity`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-element-per-quantity`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-settings-element-per-quantity-hint`), value: 1 });

        const data = await fb.render();
        if (!data) return;
        await item.update(data);
    }
    /**
     * 编辑槽位
     */
    async editSlot(slotJEUuid) {
        debug(`${this.APP_ID} editSlot : slotJEUuid`, slotJEUuid);
        const slotJE = await fromUuid(slotJEUuid);
        const showTypeOptions = {
            default: game.i18n.localize(`${MODULE_ID}.default`),
            mod1: game.i18n.localize(`${MODULE_ID}.show-type.mod1`),
            mod2: game.i18n.localize(`${MODULE_ID}.show-type.mod2`),
            mod3: game.i18n.localize(`${MODULE_ID}.show-type.mod3`),
            mod4: game.i18n.localize(`${MODULE_ID}.show-type.mod4`),
        };
        const fb = new FormBuilder()
            .object(slotJE)
            .title(game.i18n.localize(`${MODULE_ID}.craft-panel.edit-slot`) + ": " + slotJE.name)
            .tab({ id: "aspect", icon: "fas fa-image", label: game.i18n.localize(`${MODULE_ID}.craft-panel.edit-slot-aspect-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: `src`, type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .number({ name: `flags.${MODULE_ID}.size`, label: game.i18n.localize(`${MODULE_ID}.size`), min: 40, max: 160, step: 5 })
            .select({ name: `flags.${MODULE_ID}.shape`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.default`), ...CraftPanel.SHAPE_STYLE } })
            .number({ name: `flags.${MODULE_ID}.hue`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.hue`), min: 0, max: 360, step: 1 })
            .select({ name: `flags.${MODULE_ID}.showType`, label: game.i18n.localize(`${MODULE_ID}.show-type.show-type`), options: showTypeOptions })
            .tab({ id: "behavior", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.craft-panel.edit-slot-behavior-tab`) })
            .checkbox({ name: `flags.${MODULE_ID}.isNecessary`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.is-necessary`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.is-necessary-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.isConsumed`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.is-consumed`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.is-consumed-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.isLocked`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.is-locked`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.is-locked-hint`) })
            .script({ name: `flags.${MODULE_ID}.unlockCondition`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.unlock-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.unlock-script-hint`) })
            .script({ name: `flags.${MODULE_ID}.slotScript`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.slot-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.slot-script-hint`) })
            .tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.craft-panel.edit-slot-requirements-tab`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.slot-requirements`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.slot-requirements-hint`), options: { ...CraftPanel.REQUIREMENTS_TYPE_OPTIONS } })
            .text({ name: `flags.${MODULE_ID}.requirements-name`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.slot-requirements-name-hint`) })
            .multiSelect({ name: `flags.${MODULE_ID}.requirements-type`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.slot-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
            .script({ name: `flags.${MODULE_ID}.requirements-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.slot-requirements-script-hint`) })
            .tab({ id: "position", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.craft-panel.edit-slot-position-tab`) })
            .checkbox({ name: `flags.${MODULE_ID}.position.unlock`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.position-unlock`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.position-unlock-hint`) })
            .number({ name: `flags.${MODULE_ID}.position.x`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.position-x`) })
            .number({ name: `flags.${MODULE_ID}.position.y`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.position-y`) });

        //如果是附魔界面，并且是结果槽位，添加编辑结果图标按钮
        if (this.APP_ID == "craft-panel-enchant" && slotJE.getFlag(MODULE_ID, "type") == "result") {
            fb.button({
                label: game.i18n.localize(`${MODULE_ID}.craft-panel-enchant.edit-image`),
                callback: async () => {
                    //编辑模式下，左键点击结果可以编辑结果
                    let images = await chooseImage(slotJE.getFlag(MODULE_ID, "images"), this.mode);
                    if (images) {
                        await slotJE.update({
                            [`flags.${MODULE_ID}.images`]: images,
                            src: images[0].src,
                        });
                        await this.render(true);
                    }
                },
                icon: "fas fa-edit",
            })
        } else {
            //如果是普通材料槽位，添加不显示材料数量、槽位绑定特定物品等特殊配置
            fb.tab({ id: "special", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.craft-panel.edit-slot-special-tab`) })
            fb.select({ name: `flags.${MODULE_ID}.hideQuantity`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.hide-quantity`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.hide-quantity-hint`), options: { "default": game.i18n.localize(`${MODULE_ID}.default`), "true": game.i18n.localize(`${MODULE_ID}.yes`), "false": game.i18n.localize(`${MODULE_ID}.no`) } })
            fb.text({ name: `flags.${MODULE_ID}.bindItem`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.bind-item`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.bind-item-hint`) })
            fb.number({ name: `flags.${MODULE_ID}.bindItemQuantity`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.bind-item-quantity`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.bind-item-quantity-hint`), value: 1, min: 0, step: 1 });
            fb.checkbox({ name: `flags.${MODULE_ID}.bindItemElementByQuantity`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.bind-item-element-by-quantity`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.bind-item-element-by-quantity-hint`) })
            fb.number({ name: `flags.${MODULE_ID}.bindItemElementPerQuantity`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.bind-item-element-per-quantity`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.bind-item-element-per-quantity-hint`), value: 1, min: 0 });
        }

        fb.button({
            label: game.i18n.localize(`${MODULE_ID}.craft-panel.edit-slot-tooltip-button`),
            callback: async () => {
                slotJE.sheet?.render(true);
            },
            icon: "fas fa-edit",
        }).button({
            label: game.i18n.localize(`Delete`),
            callback: async () => {
                fb.form().close();
                await slotJE.deleteDialog();
                await this.render(true);
            },
            icon: "fas fa-trash",
        });
        const data = await fb.render();
        if (!data) return;
        await slotJE.update(data);
        this.needRefresh = true;
        await this.render(true);
    }
    /**
     * 编辑元素配置
     */
    async editElementConfig(index) {
        debug(`${this.APP_ID} editElementConfig : index`, index);
        const multiShowOptions = {
            "max": `${MODULE_ID}.edit-element-config.multi-show-max`,
            "min": `${MODULE_ID}.edit-element-config.multi-show-min`,
            "default": `${MODULE_ID}.edit-element-config.multi-show-default`,
        };
        const multiValueOptions = {
            "only-max": `${MODULE_ID}.edit-element-config.multi-value-only-max`,
            "only-min": `${MODULE_ID}.edit-element-config.multi-value-only-min`,
            "max-plus": `${MODULE_ID}.edit-element-config.multi-value-max-plus`,
            "max-minus": `${MODULE_ID}.edit-element-config.multi-value-max-minus`,
            "min-plus": `${MODULE_ID}.edit-element-config.multi-value-min-plus`,
            "min-minus": `${MODULE_ID}.edit-element-config.multi-value-min-minus`,
            "all": `${MODULE_ID}.edit-element-config.multi-value-all`
        };
        const elementConfig = this.elementConfigs[index];
        const text = "edit-element-config";
        const fb = new FormBuilder()
            .object(elementConfig)
            .title(game.i18n.localize(`${MODULE_ID}.${text}.title`) + ": " + elementConfig.name)
            .tab({ id: "aspect", icon: "fas fa-image", label: game.i18n.localize(`${MODULE_ID}.${text}.aspect-tab`) })
            .text({ name: "ids", label: game.i18n.localize(`${MODULE_ID}.id`), value: elementConfig.ids.join(","), hint: game.i18n.localize(`${MODULE_ID}.${text}.ids-hint`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`), hint: game.i18n.localize(`${MODULE_ID}.${text}.name-hint`) })
            .file({ name: "img", type: "image", label: game.i18n.localize(`${MODULE_ID}.${text}.img`), hint: game.i18n.localize(`${MODULE_ID}.${text}.img-hint`) })
            .color({ name: "color", label: game.i18n.localize(`${MODULE_ID}.${text}.color`), hint: game.i18n.localize(`${MODULE_ID}.${text}.color-hint`) })
            .number({ name: "size", label: game.i18n.localize(`${MODULE_ID}.size`), min: 40, max: 160, step: 5 })
            .select({ name: "shape", label: game.i18n.localize(`${MODULE_ID}.${text}.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.default`), ...CraftPanel.SHAPE_STYLE } })
            .select({ name: "visible", label: game.i18n.localize(`${MODULE_ID}.${text}.visible`), options: { "true": game.i18n.localize(`${MODULE_ID}.${text}.visible-always-show`), "false": game.i18n.localize(`${MODULE_ID}.${text}.visible-always-not-show`), "visibleWhenUp0": game.i18n.localize(`${MODULE_ID}.${text}.visible-when-up-0`), "visibleWhenDown0": game.i18n.localize(`${MODULE_ID}.${text}.visible-when-down-0`) } })
            .tab({ id: "behavior", icon: "fas fa-cogs", label: game.i18n.localize(`${MODULE_ID}.${text}.behavior-tab`) })
            .number({ name: "value", label: game.i18n.localize(`${MODULE_ID}.${text}.value`), hint: game.i18n.localize(`${MODULE_ID}.${text}.value-hint`) })
            .checkbox({ name: "useMin", label: game.i18n.localize(`${MODULE_ID}.${text}.use-min`), hint: game.i18n.localize(`${MODULE_ID}.${text}.use-min-hint`) })
            .number({ name: "min", label: game.i18n.localize(`${MODULE_ID}.${text}.min`), hint: game.i18n.localize(`${MODULE_ID}.${text}.min-hint`) })
            .checkbox({ name: "useMax", label: game.i18n.localize(`${MODULE_ID}.${text}.use-max`), hint: game.i18n.localize(`${MODULE_ID}.${text}.use-max-hint`) })
            .number({ name: "max", label: game.i18n.localize(`${MODULE_ID}.${text}.max`), hint: game.i18n.localize(`${MODULE_ID}.${text}.max-hint`) })
            .select({ name: "multiShow", label: game.i18n.localize(`${MODULE_ID}.${text}.multi-show`), options: multiShowOptions, hint: game.i18n.localize(`${MODULE_ID}.${text}.multi-show-hint`) })
            .select({ name: "multiValue", label: game.i18n.localize(`${MODULE_ID}.${text}.multi-value`), options: multiValueOptions, hint: game.i18n.localize(`${MODULE_ID}.${text}.multi-value-hint`) })
            .text({ name: "plusElements", label: game.i18n.localize(`${MODULE_ID}.${text}.plus-elements`), hint: game.i18n.localize(`${MODULE_ID}.${text}.plus-elements-hint`) })
            .text({ name: "minusElements", label: game.i18n.localize(`${MODULE_ID}.${text}.minus-elements`), hint: game.i18n.localize(`${MODULE_ID}.${text}.minus-elements-hint`) })
            .button({
                label: game.i18n.localize(`Delete`),
                callback: async () => {
                    fb.form().close();
                    this.elementConfigs.splice(index, 1);
                    await this.journalEntry.setFlag(MODULE_ID, "elementConfig", this.elementConfigs);
                    this.needRefresh = true;
                    await this.render(true);
                },
                icon: "fas fa-trash",
            });
        const data = await fb.render();
        if (!data) return;
        Object.keys(elementConfig).forEach(key => {
            if (key == "ids") {
                elementConfig[key] = data[key].split(",").map(id => id.trim()).filter(id => id != "");
            } else if (key == "visible") {
                elementConfig[key] = data[key] == "true" ? true : (data[key] == "false" ? false : data[key]);
            } else {
                elementConfig[key] = data[key] ?? elementConfig[key];
            }
        });
        await this.journalEntry.setFlag(MODULE_ID, "elementConfig", this.elementConfigs);
        this.needRefresh = true;
        await this.render(true);
    }
    /**
     * 新增槽位
     */
    async newSlot() {
        debug(`${this.APP_ID} newSlot`);
        const DEFAULT_SLOT_DATA = {
            hue: 180,
            shape: "default",
            isNecessary: false,
            isConsumed: true,
            size: 80,
            position: { unlock: false, x: 0, y: 0 },
            showType: "default",
        }

        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [
            {
                name: game.i18n.localize(`${MODULE_ID}.craft-panel.new-slot`),
                src: "icons/commodities/materials/bowl-powder-pink.webp",
                "text.content": null,
                flags: {
                    [MODULE_ID]: {
                        type: "slot",
                        ...DEFAULT_SLOT_DATA,
                    },
                },
            },
        ]);
        await this.render(true);
    }
    /**
     * 新增类别配置
     */
    async addCategory(type) {
        debug(`${this.APP_ID} addCategory : type`, type);
        const defaultData = {
            id: game.i18n.localize(`${MODULE_ID}.craft-panel.new-category`),
            name: game.i18n.localize(`${MODULE_ID}.craft-panel.new-category`),
            icon: "icons/svg/barrel.svg",
        }
        const fb = new FormBuilder()
            .object(defaultData)
            .title(game.i18n.localize(`${MODULE_ID}.craft-panel.new-category`))
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "icon", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })

        if (type == "materials") {
            fb.tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-requirements-tab`) })
                .multiSelect({ name: `requirements`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements-hint`), options: { ...CraftPanel.REQUIREMENTS_TYPE_OPTIONS } })
                .text({ name: `requirements-name`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements-name-hint`) })
                .multiSelect({ name: `requirements-type`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
                .script({ name: `requirements-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements-script-hint`) })
        } else if (type == "modifier") {
            fb.number({ name: "limit", label: game.i18n.localize(`${MODULE_ID}.craft-panel.limit-num`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.limit-num-hint`), min: 0 });
        }
        const data = await fb.render();
        if (!data) return;
        data.id = data.name;
        let categories = this.journalEntry.getFlag(MODULE_ID, type + "-categories") ?? [];
        categories.push(data);
        await this.journalEntry.setFlag(MODULE_ID, type + "-categories", categories);
        this.needRefresh = true;
        await this.render(true);
    }
    async changeCategory(category, type) {
        debug(`${this.APP_ID} changeCategory`, category, type);
        let index = this.categories[type]?.findIndex(el => el.id == category);
        if (index >= 0) {
            if (!this.categories[type][index].choosed) {
                this.categories[type].forEach(el => el.choosed = false);
                this.categories[type][index].choosed = true;
                this.needRefresh = true;
                await this.render(true);
            }
        }
    }
    async editCategory(category, type) {
        debug(`${this.APP_ID} editCategory : category type`, category, type);
        if (category == "all" || category == "add") return;
        let categories = this.journalEntry.getFlag(MODULE_ID, type + "-categories") ?? [];
        let index = categories.findIndex(el => el.id == category);
        if (!categories[index]) {
            ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.objectNotFound`) + " : " + category);
            return;
        }
        let needDelete = false;
        const fb = new FormBuilder()
            .object(categories[index])
            .title(game.i18n.localize(`${MODULE_ID}.craft-panel.edit-category`) + ": " + category)
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "icon", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .button({
                label: game.i18n.localize(`Delete`),
                callback: async () => {
                    needDelete = true;
                    fb.form().close();
                },
                icon: "fas fa-trash",
            });
        if (type == "material") {
            fb.tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-requirements-tab`) })
                .multiSelect({ name: `requirements`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements-hint`), options: { ...CraftPanel.REQUIREMENTS_TYPE_OPTIONS } })
                .text({ name: `requirements-name`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements-name-hint`) })
                .multiSelect({ name: `requirements-type`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } })
                .script({ name: `requirements-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.category-requirements-script-hint`) })
        } else if (type == "modifier") {
            fb.number({ name: "limit", label: game.i18n.localize(`${MODULE_ID}.craft-panel.limit-num`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.limit-num-hint`), min: 0 });
        }
        const data = await fb.render();
        if (needDelete) {
            categories.splice(index, 1);
            await this.journalEntry.setFlag(MODULE_ID, type + "-categories", categories);
            this.needRefresh = true;
            await this.render(true);
            return;
        }
        if (!data) return;
        data.id = data.name;

        categories[index] = data;
        await this.journalEntry.setFlag(MODULE_ID, type + "-categories", categories);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 配置界面
     */
    async configure() {
        debug(`${this.APP_ID} configure`);
        const configOptions = this.fillConfigOptions();

        const fb = new FormBuilder()
            .object(this.journalEntry)
            .title(game.i18n.localize(`${MODULE_ID}.configure`) + ": " + this.journalEntry.name)

        configOptions.forEach(tab => {
            fb.tab({ id: tab.id, icon: tab.icon, label: tab.label });
            tab.options.forEach(option => {
                fb[option.ftype]({ ...option });
            })
        })

        const data = await fb.render();
        if (!data) return;
        await this.journalEntry.update(data);
        this.needRefresh = true;
        await this.render(true);
    }
    /**
     * 获取配置界面的自定义选项，方便后续扩展
     */
    fillConfigOptions() {
        debug(`${this.APP_ID} fillConfigOptions`);
        const showTypeOptions = {
            mod1: game.i18n.localize(`${MODULE_ID}.show-type.mod1`),
            mod2: game.i18n.localize(`${MODULE_ID}.show-type.mod2`),
            mod3: game.i18n.localize(`${MODULE_ID}.show-type.mod3`),
            mod4: game.i18n.localize(`${MODULE_ID}.show-type.mod4`),
        };
        const configOptions = [
            {
                id: "general",
                icon: "fas fa-cog",
                label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-general-tab`),
                options: [
                    { ftype: "text", name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) },
                    { ftype: "select", name: `flags.${MODULE_ID}.shape`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.shape`), options: { "default": game.i18n.localize(`${MODULE_ID}.default`), ...CraftPanel.SHAPE_STYLE } },
                    { ftype: "select", name: `flags.${MODULE_ID}.defaultShowType`, label: game.i18n.localize(`${MODULE_ID}.show-type.default-show-type`), options: showTypeOptions },
                    { ftype: "file", name: `flags.${MODULE_ID}.background`, type: "image", label: game.i18n.localize(`${MODULE_ID}.craft-panel.background-image`) },
                    { ftype: "number", name: `flags.${MODULE_ID}.ingredientLimit`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-limit`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.ingredient-limit-hint`), value: 0, min: 0, step: 1 },
                ]
            },
            {
                id: "requirements",
                icon: "fas fa-list-check",
                label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-requirements-tab`),
                options: [
                    { ftype: "multiSelect", name: `flags.${MODULE_ID}.requirements`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.panel-requirements`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.panel-requirements-hint`), options: { ...CraftPanel.REQUIREMENTS_TYPE_OPTIONS } },
                    { ftype: "text", name: `flags.${MODULE_ID}.requirements-name`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.panel-requirements-name-hint`) },
                    { ftype: "multiSelect", name: `flags.${MODULE_ID}.requirements-type`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-type`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.panel-requirements-type-hint`), options: { ...CONFIG.Item.typeLabels } },
                    { ftype: "script", name: `flags.${MODULE_ID}.requirements-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.panel-requirements-script-hint`) },
                    { ftype: "script", name: `flags.${MODULE_ID}.owner-check`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.owner-check`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.owner-check-hint`) },
                ]
            },
            {
                id: "audio",
                icon: "fas fa-volume-up",
                label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-audio-tab`),
                options: [
                    { ftype: "number", name: `flags.${MODULE_ID}.audio.volume`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-volume`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-volume-hint`), value: 100, min: 0, max: 100, step: 1 },
                    { ftype: "file", name: `flags.${MODULE_ID}.audio.open-panel`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-open-panel`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-open-panel-hint`) },
                    { ftype: "file", name: `flags.${MODULE_ID}.audio.add-ingredient`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-add-ingredient`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-add-ingredient-hint`) },
                    { ftype: "file", name: `flags.${MODULE_ID}.audio.remove-ingredient`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-remove-ingredient`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-remove-ingredient-hint`) },
                    { ftype: "file", name: `flags.${MODULE_ID}.audio.craft-complete`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-craft-complete`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-craft-complete-hint`) },
                    { ftype: "file", name: `flags.${MODULE_ID}.audio.craft-canceled`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-craft-canceled`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-craft-canceled-hint`) },
                ]
            },
            {
                id: "scripts",
                icon: "fa-solid fa-code",
                label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-scripts-tab`),
                options: [
                    { ftype: "script", name: `flags.${MODULE_ID}.refresh-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.refresh-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.refresh-script-hint`) },
                    { ftype: "script", name: `flags.${MODULE_ID}.craft-pre-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.craft-pre-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.craft-pre-script-hint`) },
                    { ftype: "script", name: `flags.${MODULE_ID}.craft-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.craft-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.craft-script-hint`) },
                    { ftype: "script", name: `flags.${MODULE_ID}.craft-post-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.craft-post-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.craft-post-script-hint`) }
                ]
            },
        ]

        return configOptions;
    }

    /**
     * 各个界面用于自定义合成检查条件和提示内容的函数，方便后续调整合成流程时调用，返回值如果为false则阻止合成
     */
    async checkCraft() {
        debug(`${this.APP_ID} checkCraft`);
        if (!this.checkSlot()) {
            ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.must-fill-necessary-slot`));
            return false;
        };
        return true;
    }
    //各个界面用于自定义合成结果的占位符，方便后续调整合成流程时调用
    /**
     * 合成前函数，返回的是预处理脚本的参数对象，可以在预处理脚本中修改这个对象来传递参数到后续的脚本和钩子中
     */
    async preCraft(materials) {
        debug(`${this.APP_ID} preCraft : materials`, materials);
    }
    /**
     * 获取合成结果的函数，返回的是合成脚本和后处理脚本的参数对象，可以在合成脚本和后处理脚本中修改这个对象来传递参数到后续的脚本和钩子中
     */
    async getCraftResult(materials, results) {
        debug(`${this.APP_ID} getCraftResult : materials results`, materials, results);
    }
    /**
     * 最终合成结果函数，将材料和合成结果整理为 updates toDelete 和 products 三个对象，方便后续统一处理合成结果，updates 是需要更新的物品数据，toDelete 是需要删除的物品id，products 是需要创建的物品数据
     */
    async finalizeCraftResult(materials, results) {
        debug(`${this.APP_ID} finalizeCraftResult : materials results`, materials, results);
        const updates = {};
        const toDelete = {};
        const products = [];

        await Promise.all(materials.map(async (m) => {
            const item = m.item;
            const quantity = m.quantity;
            const parent = item.parent;
            if (!item) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.itemNotFound`) + item.name + " " + item.uuid);
                this.canceled = true;
            } else if ((!parent) || (!parent?.isOwner)) {
                //如果物品没有父级，或者父级不是当前用户拥有的实体，则检查owner-check配置的脚本，如果脚本返回false，则提示错误并阻止合成
                //使用脚本进行判断可以实现诸如材料在特定容器中、材料为合集包的物品链接而非角色身上的物品等复杂的条件判断
                const ownerCheckScript = this.journalEntry.getFlag(MODULE_ID, "owner-check");
                if (ownerCheckScript && ownerCheckScript.trim() != "") {
                    const fn = new AsyncFunction("data", "panel", "item", "actor", ownerCheckScript);
                    let result = false;
                    try {
                        result = await fn(this, this.journalEntry, item, this.actor);
                    } catch (e) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                        console.error(e);
                    }
                    if (!result) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.noOwner`) + item.name + " " + item.uuid);
                        this.canceled = true;
                    }
                } else {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.noOwner`) + item.name + " " + item.uuid);
                    this.canceled = true;
                }

            } else if (m.isConsumed) {
                if (item?.system?.quantity === undefined) {
                    toDelete[parent.id] ??= { parent: parent, items: [] };
                    toDelete[parent.id].items.push(item.id);
                    // toDelete.push({ _id: item.id, parent: item.parent });
                } else {
                    let newQuantity = parseFloat(item?.system?.quantity) - quantity;
                    let findItem = false;
                    //处理当合成结果既是材料又是产品，同时还开启了合并名称时的特殊情况
                    if (this.mergeByName && updates[this.actor.id] && (parent.id == this.actor.id)) {
                        findItem = updates[this.actor.id].items.find(i => i._id == item.id);
                        if (findItem) {
                            newQuantity = parseFloat(findItem[`system.quantity`]) - quantity;
                        }
                    }
                    if (newQuantity < 0) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.notEnoughMaterial`) + item.name);
                        this.canceled = true;
                    } else if (newQuantity == 0) {
                        // toDelete.push({ _id: item.id, parent: item.parent });
                        toDelete[parent.id] ??= { parent: parent, items: [] };
                        toDelete[parent.id].items.push(item.id);
                        if (findItem) {
                            updates[parent.id].items = updates[parent.id].items.filter(i => i._id != item.id);
                        }
                    } else {
                        if (findItem) {
                            findItem[`system.quantity`] = newQuantity;
                        } else {
                            updates[parent.id] ??= { parent: parent, items: [] };
                            updates[parent.id].items.push({
                                _id: item.id,
                                [`system.quantity`]: newQuantity
                            });
                        }
                    }
                }

            }
            return;
        }));

        return { updates, toDelete, products };
    }
    /**
     * 合成后函数，不需要返回值，可以在这个函数中处理合成结果，比如扣除材料、添加产物等，或者在后处理脚本中处理
     * 默认实现是在合成后根据是否保留材料，为材料栏重新填充材料，或是清空材料栏
     */
    async postCraft(materials, results) {
        debug(`${this.APP_ID} postCraft : keepMaterials canceled`, this.keepMaterials, this.canceled);
        this.elements = [];
        if (this.keepMaterials && !this.canceled && this.previousSlotItems) {
            this.slotItems = {};
            for (const [slotIndex, slotData] of Object.entries(this.previousSlotItems)) {
                if (!slotData) continue;
                let item = await fromUuid(slotData.uuid);
                if (!item && this.actor) {
                    item = this.actor.items.find((i) => i.name === slotData.name);
                }
                if (item && await this.checkAdd(Number(slotIndex), item)) {
                    await this.addIngredient(Number(slotIndex), item, { skipRender: true, skipRefresh: true });
                    while (this.slotItems[index].quantity < slotData.quantity && await this.checkAdd(Number(slotIndex), item)) {
                        await this.addIngredient(Number(slotIndex), item, { skipRender: true, skipRefresh: true });
                    }
                }
            }
        } else {
            this.slotItems = {};
        }
    }
    /**
     * 合成物品的函数
     */
    async craft() {
        debug(`${this.APP_ID} craft : mode isEdit`, this.mode, this.isEdit);
        this.canceled = false;
        if (!await this.checkCraft()) {
            return false;
        }
        const preScript = this.journalEntry.getFlag(MODULE_ID, "craft-pre-script");
        const craftScript = this.journalEntry.getFlag(MODULE_ID, "craft-script");
        const postScript = this.journalEntry.getFlag(MODULE_ID, "craft-post-script");
        const materials = [];
        const results = [];
        this.previousSlotItems = this.keepMaterials ? foundry.utils.deepClone(this.slotItems) : null;
        //整理所有的材料
        for (let slot of this.slots) {
            let slotItem = this.slotItems[slot.slotIndex];
            if (slotItem) {
                let material = materials.find(m => (m.item.uuid == slotItem.uuid) && (m.isConsumed == slot.isConsumed));
                if (material) {
                    material.quantity += slot.quantity;
                } else {
                    let item = await fromUuid(slotItem.uuid);
                    if (!item) {
                        ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.itemNotFound`) + slotItem.uuid);
                        this.canceled = true;
                        continue;
                    }
                    materials.push({
                        item: item,
                        isConsumed: slot.isConsumed,
                        quantity: slot.quantity,
                    });
                }
            }
        }
        const preScriptParameter = await this.preCraft(materials) ?? {
            data: this,
            panel: this.journalEntry,
            actor: this.actor,
            elements: this.elements,
            materials: materials,
            canceled: this.canceled,
        };
        //执行预处理脚本
        if (preScript && preScript.trim() != "") {
            const fn = new AsyncFunction(...Object.keys(preScriptParameter), preScript);
            try {
                await fn(...Object.values(preScriptParameter));
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }
        await Hooks.call(this.APP_ID + "Pre", ...Object.values(preScriptParameter));
        //获取合成结果
        const craftScriptParameter = await this.getCraftResult(materials, results) ?? {
            data: this,
            panel: this.journalEntry,
            actor: this.actor,
            elements: this.elements,
            materials: materials,
            results: results,
            canceled: this.canceled,
        };
        //执行创建物品前最后的脚本
        if (craftScript && craftScript.trim() != "") {
            const fn = new AsyncFunction(...Object.keys(craftScriptParameter), craftScript);
            try {
                await fn(...Object.values(craftScriptParameter));
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }
        await Hooks.call(this.APP_ID + "Craft", ...Object.values(craftScriptParameter));
        //结算结果
        if (this.actor) {
            // const updates = {};
            // const toDelete = {};
            // const products = [];
            const { updates, toDelete, products } = await this.finalizeCraftResult(materials, results);

            if (!this.canceled) {
                await this.actor.createEmbeddedDocuments("Item", products);
                await Promise.all(Object.values(updates).map(async el => {
                    await el.parent.updateEmbeddedDocuments("Item", el.items);
                }));
                await Promise.all(Object.values(toDelete).map(async el => {
                    await el.parent.deleteEmbeddedDocuments("Item", el.items);
                }));

                //输出合成结果信息
                let message = "<ul>";
                if (materials.filter(el => (el.isConsumed == false)).length > 0) {
                    message += `<li><b>${game.i18n.localize(`${MODULE_ID}.craft-panel.craft-materials-unconsumed`)}: </b><ul>`;
                    materials.filter(el => (el.isConsumed == false)).forEach(el => {
                        message += `<li><img src="${el.item.img}" style="vertical-align:middle" width="24" height="24"> ${el.item.name} x${el.quantity}</li>`;
                    });
                    message += "</ul></li>";
                }
                if (materials.filter(el => (el.isConsumed == true)).length > 0) {
                    message += `<li><b>${game.i18n.localize(`${MODULE_ID}.craft-panel.craft-materials-consumed`)}: </b><ul>`;
                    materials.filter(el => (el.isConsumed == true)).forEach(el => {
                        message += `<li><img src="${el.item.img}" style="vertical-align:middle" width="24" height="24"> ${el.item.name} x${el.quantity}</li>`;
                    });
                    message += "</ul></li>";
                }
                message += `<li><b>${game.i18n.localize(`${MODULE_ID}.craft-panel.craft-results`)}: </b><ul>`;
                results.forEach(el => {
                    message += `<li><img src="${el.item.img}" style="vertical-align:middle" width="24" height="24"> ${el.item.name} x${el.quantity}</li>`;
                });
                message += "</ul></li></ul>";
                await chatMessage(message, { img: this.journalEntry.src, title: `${this.journalEntry.name} - ${game.i18n.localize(`${MODULE_ID}.craft-panel.craft-results`)}`, speaker: this.actor });
            }
        } else if (!this.canceled) {
            const folder = await getFolder(this.journalEntry.name, 'Item');
            await Item.createDocuments(results.map(r => {
                r.item.folder = folder;
                return r.item;
            }));
        }
        //播放音效
        if (!this.canceled && this.audio?.["craft-complete"]) {
            playAudio({ src: this.audio["craft-complete"], channel: "interface", volume: (this.audio?.["volume"] ?? 100) / 100 }, true);
        } else if (this.canceled && this.audio?.["craft-canceled"]) {
            playAudio({ src: this.audio["craft-canceled"], channel: "interface", volume: (this.audio?.["volume"] ?? 100) / 100 }, true);
        }
        //执行后处理脚本
        if (postScript && postScript.trim() != "") {
            const fn = new AsyncFunction(...Object.keys(craftScriptParameter), postScript);
            try {
                await fn(...Object.values(craftScriptParameter));
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }
        await Hooks.call(this.APP_ID + "Post", ...Object.values(craftScriptParameter));
        await this.postCraft(materials, results);
        this.needRefresh = true;
        await this.render(true);
        return results;
    }

    /**
     * 检测物品是否符合要求
     * @param {Item} item - 要检测的物品
     * @param {Object} requirements - 要求的条件
     * @param {string} requirements.name - 名称检测
     * @param {string[]} requirements.type - 类型检测
     * @param {Function} requirements.script - 脚本检测
     * @returns {Promise<boolean>} - 是否符合要求
     */
    static async checkItemRequirements(item, requirements) {
        debug(`${this.APP_ID} checkItemRequirements`, item, requirements);
        if (requirements.name) {
            if (item?.name == requirements.name) return true;
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
     * 检查当前元素是否满足配方的元素需求
     * @param {CraftElement[]} elements 当前元素
     * @param {CraftElement[]} craftElements 配方元素需求
     * @returns {boolean} 是否满足条件
     */
    static checkCraftElements(elements, craftElements) {
        debug(`${this.APP_ID} checkCraftElements`, elements, craftElements);
        return !(craftElements.some((el) => {
            let el2 = elements.find((el3) => el3.id === el.id);
            // return !el2 || el2.num < el.min || el2.num > el.max;
            return (el.useMin && (el2?.num ?? 0) < el.min) || (el.useMax && (el2?.num ?? 0) > el.max);
        }));
    }


    async toggleEdit(event) {
        debug(`${this.APP_ID} toggleEdit : isGM isEdit`, game.user.isGM, this.isEdit);
        event.preventDefault();
        //切换编辑模式
        if (!game.user.isGM) return;
        this.mode = this.isEdit ? "use" : "edit";
        this.window.title.textContent = this.title;
        this.needRefresh = true;
        await this.render(true);
    }

    static get SHAPE_STYLE() {
        return {
            square: `${MODULE_ID}.craft-panel.shape-square`,
            circle: `${MODULE_ID}.craft-panel.shape-circle`,
        };
    }
    static get REQUIREMENTS_TYPE_OPTIONS() {
        return {
            "name": `${MODULE_ID}.craft-panel.requirements-name`,
            "type": `${MODULE_ID}.craft-panel.requirements-type`,
            "script": `${MODULE_ID}.craft-panel.requirements-script`,
        };
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
/**
 * @typedef {Object} CraftElementConfig
 * @property {string[]} ids - 显示元素的id。配置时通过逗号分隔以支持多个元素。
 * @property {string} name - 数量为0时显示的默认名称。
 * @property {string} img - 数量为0时显示的默认图标。
 * @property {boolean} useMin - 是否限制最小数量。
 * @property {number} min - 当实际元素少于最小数量时，实际数量为最小数量。
 * @property {boolean} useMax - 是否限制最大数量。
 * @property {number} max - 当实际元素多于最大数量时，实际数量为最大数量。
 * @property {"default" | "max" | "min"} multiShow - 多个元素时的图标和名称显示方式。default: 只显示默认名称和图标，max: 显示最多元素的名称和图标，min: 显示最少元素的名称和图标。
 * @property {"all" | "only-max" | "only-min" | "max-plus" | "max-minus" | "min-plus" | "min-minus"} multiValue - 多个元素时的实际使用的元素数据。all：包含的元素都会被使用（显示总和数量），only-max：只使用最多数量的元素，only-min：只使用最少数量的元素，max-plus：选择数量最多的元素然后其数量加上其他元素，max-minus：选择数量最多的元素然后其数量减去其他元素，min-plus：选择数量最少的元素然后其数量加上其他元素，min-minus：选择数量最少的元素然后其数量减去其他元素。
 * @property {string} plusElements - 配置元素的id（逗号分隔），这些元素不参与multiShow和multiValue的判断，但会在原值不为0时将数量加在最终结果中。
 * @property {string} minusElements - 配置元素的id（逗号分隔），这些元素不参与multiShow和multiValue的判断，但会在原值不为0时将数量减在最终结果中。
 * @property {string} shape - 元素的形状，用于显示。默认为圆形circle，与slot的shape配置相同，可用选项使用CraftPanel.SHAPE_STYLE。
 * @property {boolean | "visibleWhenUp0" | "visibleWhenDown0"} visible - 元素的显示条件。true: 总是显示，false: 总是不显示，visibleWhenUp0: 仅当元素数量大于0时显示，visibleWhenDown0: 仅当元素数量小于等于0时显示。默认为true。
 * @property {number} value - 元素的价值，仅用于右侧材料面板计算元素数量时的参考价值。默认为1。未配置CraftElementConfig的元素价值为0。
 * @property {number} size - 元素的尺寸，仅用于显示时的图标大小。默认为60。
 * @property {string} color - 元素的颜色，边框的默认颜色。仅用于显示。
 */
/**
 * @typedef {Object} CraftElementShow
 * @property {string} id - 元素的id，为对应物品的id（非uuid）。用于检测是否为同一元素，可以通过名称与图标相同但id不同的元素实现“虚假”属性。
 * @property {string} name - 元素的名称，为对应物品的名称。仅用于显示。
 * @property {string} img - 元素的图标，为对应物品的图标。仅用于显示。
 * @property {string} type - 需求原料的类型，仅用于配方保存的需求。
 * @property {string} color - 元素的颜色，为对应形状以及边框的颜色。仅用于显示。
 * @property {number} weight - 元素的权重，用于计算匹配度。
 * @property {number} num - 仅成分元素使用，为元素的数量。用于显示作为合成素材时提供的元素数量。
 * @property {string} shapeClass - 元素的形状，用于显示。默认为圆形circle，与slot的shape配置相同，可用选项使用CraftPanel.SHAPE_STYLE。
 * @property {number} size - 元素的尺寸，仅用于显示时的图标大小。默认为60。
 * @property {number} index - 元素的索引，用于事件绑定时获取指定的元素。
 */