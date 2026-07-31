import { HandlebarsApplication, AsyncFunction, playAudio, MODULE_ID } from "../utils.js";
import { FormBuilder } from "./formBuilder.js";

const FLAG_KEY = "craftHandlers";
const DEFAULT_HANDLER_ICON = "icons/svg/daze.svg";
const DEFAULT_EMPTY_TEXT_KEYS = {
    actors: `${MODULE_ID}.craft-panel-handler.empty-actors-default`,
    handlers: `${MODULE_ID}.craft-panel-handler.empty-handlers-default`,
    templates: `${MODULE_ID}.craft-panel-handler.empty-templates-default`,
};

/**
 * 处理步骤对象。
 * @typedef {Object} HandlerStepData
 * @property {string} id 步骤唯一 ID。
 * @property {"progress"|"roll"} type 步骤类型。
 * @property {string} typeText 步骤类型显示文本。
 * @property {boolean} isProgress 是否为进度步骤。
 * @property {boolean} isRoll 是否为掷骰步骤。
 * @property {string} label 步骤名称。
 * @property {number} target 目标值（进度步骤）。
 * @property {number} current 当前值（进度步骤）。
 * @property {string} formula 掷骰公式（掷骰步骤）。
 * @property {number} dc 难度值（掷骰步骤）。
 * @property {string[]} comparisons 比较运算符列表。
 * @property {string} comparisonsText 比较运算符显示文本。
 * @property {"pending"|"complete"|"failed"} status 步骤状态。
 * @property {string} statusText 步骤状态显示文本。
 * @property {string} statusIcon 步骤状态图标类名。
 * @property {number|null} lastRoll 最近一次掷骰结果。
 * @property {number} index 步骤索引。
 */

/**
 * 处理模板对象（界面渲染用）。
 * @typedef {Object} HandlerTemplateData
 * @property {string} uuid 模板 UUID。
 * @property {string} id 模板 ID。
 * @property {string} name 模板名称。
 * @property {string} img 模板图标。
 * @property {string} description 模板描述（HTML）。
 * @property {string} script 完成脚本。
 * @property {Array<object>} results 结果物品列表。
 * @property {HandlerStepData[]} steps 步骤列表。
 * @property {{total:number,completed:number,failed:number,done:boolean,state:string}} status 汇总状态。
 * @property {string[]} tags 标签列表。
 * @property {{name:string,icon:string}[]} categories 类别列表。
 */

/**
 * 处理对象（角色实例数据）。
 * @typedef {Object} HandlerInstanceData
 * @property {string} id 处理对象 ID。
 * @property {string} panelId 所属面板 ID。
 * @property {string} name 名称。
 * @property {string} img 图标。
 * @property {string} description 描述（HTML）。
 * @property {string[]} tags 标签。
 * @property {{name:string,icon:string}[]} categories 类别。
 * @property {string} templateUuid 来源模板 UUID。
 * @property {string} script 完成脚本。
 * @property {Array<object>} results 结果物品列表。
 * @property {HandlerStepData[]} steps 步骤列表。
 * @property {number} createdAt 创建时间戳。
 * @property {boolean} completed 是否已完成。
 * @property {boolean} failed 是否失败。
 */

export class CraftPanelHandler extends HandlebarsApplication {
    /**
     * 构造处理面板实例并初始化缓存、分类状态与交互动作。
     * @param {JournalEntry|string} journalEntry 对应的 JournalEntry 或其 UUID。
     * @param {"edit"|"use"} mode 面板模式。
     * @param {{actor?: Actor, activeActorId?: string}} options 额外初始化参数。
     */
    constructor(journalEntry, mode = "edit", options = {}) {
        super();
        if (typeof journalEntry === "string") journalEntry = fromUuidSync(journalEntry);
        this.journalEntry = journalEntry;
        this.mode = mode;
        this.actor = options.actor;
        this.activeActorId = options.activeActorId ?? this.actor?.id ?? game.user?.character?.id ?? null;

        this.handlerTemplatesJE = [];
        this.actorHandlers = new Map();
        this.needRefresh = true;

        this.categories = {
            actors: [],
            templates: [],
            handlers: [],
        };
        this.category = {
            actors: "all",
            templates: "all",
            handlers: "all",
        };

        this.scrollPositions = {
            actors: 0,
            handlers: 0,
            templates: 0,
        };

        this.panelSizes = this.journalEntry.getFlag(MODULE_ID, "panelSizes");
        this.audio = this.journalEntry.getFlag(MODULE_ID, "audio") ?? {};

        this.options.actions["add-template"] = this.addTemplate.bind(this);
        this.options.actions["configure-panel"] = this.configure.bind(this);
        this.options.actions["edit-template"] = this.editTemplate.bind(this);
        this.options.actions["delete-template"] = this.deleteTemplate.bind(this);
        this.options.actions["add-step"] = this.addTemplateStep.bind(this);
        this.options.actions["edit-step"] = this.editTemplateStep.bind(this);
        this.options.actions["edit-result"] = this.editResult.bind(this);
        this.options.actions["remove-step"] = this.removeTemplateStep.bind(this);
        this.options.actions["remove-result"] = this.removeTemplateResult.bind(this);
        this.options.actions["create-handler"] = this.createHandlerFromTemplate.bind(this);
        this.options.actions["edit-handler"] = this.editHandler.bind(this);
        this.options.actions["delete-handler"] = this.deleteHandler.bind(this);
        this.options.actions["complete-handler"] = this.completeHandler.bind(this);
        this.options.actions["restore-handler"] = this.restoreHandler.bind(this);
        this.options.actions["reset-handler"] = this.resetHandler.bind(this);
        this.options.actions["progress-inc"] = this.adjustProgress.bind(this);
        this.options.actions["progress-dec"] = this.adjustProgress.bind(this);
        this.options.actions["roll-step"] = this.rollStep.bind(this);
        this.options.actions["mark-step-complete"] = (event, target) => this.markStep(event, target, "complete");
        this.options.actions["mark-step-failed"] = (event, target) => this.markStep(event, target, "failed");
        this.options.actions["remove-handler-result"] = this.removeHandlerResult.bind(this);

        if (game.user.isGM) {
            this.options.actions.edit = this.toggleEdit.bind(this);
        } else {
            this.options.window.controls = [];
        }

        craftPanels ??= [];
        craftPanels.push(this);
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
                icon: "fas fa-briefcase",
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
        return this.journalEntry.name + (this.isEdit ? " - " + game.i18n.localize(`${MODULE_ID}.edit-mode`) : "");
    }

    /**
     * 是否为编辑模式。
     * @returns {boolean}
     */
    get isEdit() {
        return this.mode === "edit";
    }

    /**
     * 三栏默认尺寸。
     * @returns {{actors:{width:number,height:number},handlers:{width:number,height:number},templates:{width:number,height:number}}}
     */
    get DEFAULT_PANEL_SIZES() {
        return {
            actors: { width: 300, height: 540 },
            handlers: { width: 600, height: 540 },
            templates: { width: 300, height: 540 },
        };
    }

    /**
     * 刷新面板级缓存数据（尺寸、音频、模板页、类别）。
     * @returns {Promise<void>}
     */
    async refreshPanel() {
        this.panelSizes = this.journalEntry.getFlag(MODULE_ID, "panelSizes");
        this.audio = this.journalEntry.getFlag(MODULE_ID, "audio") ?? {};
        this.handlerTemplatesJE = this.journalEntry.pages.filter((p) => p.flags[MODULE_ID]?.type === "handler");

        const actorCategories = this.journalEntry.getFlag(MODULE_ID, "handler-actor-categories") ?? [];
        const templateCategories = this.journalEntry.getFlag(MODULE_ID, "handler-template-categories") ?? [];
        this.categories.actors = this.#buildEditableCategories(actorCategories, "actors");
        this.categories.templates = this.#buildEditableCategories(templateCategories, "templates");
    }

    /**
     * 组装模板渲染上下文。
     * @param {object} options 渲染选项。
     * @returns {Promise<object>}
     */
    async _prepareContext(options) {
        if (this.needRefresh) {
            await this.refreshPanel();
            this.actorHandlers.clear();
            this.needRefresh = false;
        }

        const actors = (await this.#collectActors()).map((a) => ({
            id: a.id,
            uuid: a.uuid,
            name: a.name,
            img: a.img ?? a.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
            choosed: a.id === this.activeActorId ? "choosed" : "",
            isOwner: !!a.isOwner,
        }));

        if (!actors.some((a) => a.id === this.activeActorId)) {
            this.activeActorId = actors[0]?.id ?? null;
            if (actors[0]) actors[0].choosed = "choosed";
        }

        const activeActor = this.#getActiveActor();

        let handlerTemplates = await Promise.all(
            this.handlerTemplatesJE.sort((a, b) => (a.sort - b.sort)).map(async (page) => {
                const results = await this.#prepareResultsPreview(page.getFlag(MODULE_ID, "results") ?? []);
                const steps = this.#normalizeSteps(page.getFlag(MODULE_ID, "steps") ?? []);
                const status = this.#summarizeSteps(steps);
                const tags = this.#normalizeTags(page.getFlag(MODULE_ID, "tags") ?? []);
                const templateCategories = this.#normalizeTemplateCategories(page.getFlag(MODULE_ID, "categories") ?? []);
                return {
                    uuid: page.uuid,
                    id: page.id,
                    name: page.name,
                    img: page.src ?? this.#getDefaultHandlerIcon(),
                    description: page.getFlag(MODULE_ID, "description") ?? "",
                    script: page.getFlag(MODULE_ID, "completeScript") ?? "",
                    results,
                    steps,
                    status,
                    tags,
                    categories: templateCategories,
                };
            })
        );

        if (this.category.templates !== "all") {
            handlerTemplates = handlerTemplates.filter((tpl) => tpl.categories.some((c) => c.name === this.category.templates));
        }

        let handlers = this.activeActorId ? await this.getActorHandlers(this.activeActorId) : [];
        handlers = handlers.map((h) => {
            const steps = this.#normalizeSteps(h.steps ?? []);
            const status = this.#summarizeSteps(steps);
            const tags = this.#normalizeTags(h.tags ?? []);
            const categories = this.#normalizeTemplateCategories(h.categories ?? []);
            return {
                ...h,
                img: h.img ?? this.#getDefaultHandlerIcon(),
                description: h.description ?? "",
                steps,
                status,
                tags,
                categories,
                isCompleted: !!h.completed,
            };
        });

        this.categories.handlers = this.#buildHandlerCategories(handlers);
        if (!this.categories.handlers.some((c) => c.id === this.category.handlers)) this.category.handlers = "all";
        if (this.category.handlers !== "all") {
            handlers = handlers.filter((h) => h.categories.some((c) => c.name === this.category.handlers));
        }

        const emptyTexts = {
            actors: this.journalEntry.getFlag(MODULE_ID, "handler-empty-text-actors") ?? game.i18n.localize(DEFAULT_EMPTY_TEXT_KEYS.actors),
            handlers: this.journalEntry.getFlag(MODULE_ID, "handler-empty-text-handlers") ?? game.i18n.localize(DEFAULT_EMPTY_TEXT_KEYS.handlers),
            templates: this.journalEntry.getFlag(MODULE_ID, "handler-empty-text-templates") ?? game.i18n.localize(DEFAULT_EMPTY_TEXT_KEYS.templates),
        };

        return {
            isEdit: this.isEdit,
            isGM: game.user.isGM,
            actors,
            handlerTemplates,
            handlers,
            activeActorId: this.activeActorId,
            canEditActive: !!activeActor?.isOwner,
            panelSizes: this.panelSizes ?? this.DEFAULT_PANEL_SIZES,
            categories: this.categories,
            background: `url('${this.journalEntry.getFlag(MODULE_ID, "background") ?? ""}')`,
            emptyTexts,
        };
    }

    /**
     * 构建可编辑类别列表（含“全部/新增”项）。
     * @param {Array<object>} categories 原始类别数据。
     * @param {"actors"|"templates"|"handlers"} type 类别分组类型。
     * @returns {Array<object>}
     */
    #buildEditableCategories(categories, type) {
        const list = [{
            id: "all",
            name: game.i18n.localize(`${MODULE_ID}.all`),
            icon: `modules/${MODULE_ID}/img/svgs/stack.svg`,
            choosed: this.category[type] === "all",
            readonly: true,
        }];

        const rows = (categories ?? []).map((c) => ({
            ...c,
            id: c.name,
            name: c.name,
            icon: c.icon || "icons/svg/daze.svg",
            choosed: this.category[type] === c.name,
        }));
        list.push(...rows);

        if (this.isEdit) {
            list.push({
                id: "add",
                name: game.i18n.localize(`${MODULE_ID}.craft-panel.new-category`),
                icon: `modules/${MODULE_ID}/img/svgs/health-normal.svg`,
                choosed: false,
                isAdd: true,
            });
        }

        if (!list.some((c) => c.choosed)) list[0].choosed = true;
        return list;
    }

    /**
     * 基于处理对象动态构建处理中栏类别列表。
     * @param {HandlerInstanceData[]} handlers 当前处理对象列表。
     * @returns {Array<object>}
     */
    #buildHandlerCategories(handlers) {
        const list = [{
            id: "all",
            name: game.i18n.localize(`${MODULE_ID}.all`),
            icon: `modules/${MODULE_ID}/img/svgs/stack.svg`,
            choosed: this.category.handlers === "all",
            readonly: true,
        }];

        const map = new Map();
        for (const handler of handlers) {
            const categories = this.#normalizeTemplateCategories(handler.categories ?? []);
            for (const c of categories) {
                if (!map.has(c.name)) {
                    map.set(c.name, {
                        id: c.name,
                        name: c.name,
                        icon: c.icon || "icons/svg/daze.svg",
                        choosed: this.category.handlers === c.name,
                    });
                }
            }
        }

        list.push(...Array.from(map.values()));
        if (!list.some((c) => c.choosed)) list[0].choosed = true;
        return list;
    }

    /**
     * 按启用的需求规则收集并排序角色。
     *
     * 顺序规则：名称 -> 玩家角色 -> 脚本 -> UUID；
     * 去重规则：首次出现优先；
     * 最终排序：拥有者在前，分别保持原始顺序。
     * @returns {Promise<Actor[]>}
     */
    async #collectActors() {
        const selectedCategory = this.categories.actors.find((c) => c.choosed);
        const source = selectedCategory && selectedCategory.id !== "all" && selectedCategory.id !== "add"
            ? {
                enabled: Array.from(selectedCategory.requirements ?? []),
                name: selectedCategory["requirements-name"] ?? "",
                uuids: selectedCategory["requirements-uuid"] ?? [],
                script: selectedCategory["requirements-script"] ?? "",
                playerCharacter: !!selectedCategory["requirements-player-character"],
            }
            : this.#getGlobalActorRequirementConfig();

        const order = ["name", "player-character", "script", "uuid"];
        const actorMap = new Map();
        const push = (actor) => {
            if (!this.#isActor(actor)) return;
            if (!actorMap.has(actor.id)) actorMap.set(actor.id, actor);
        };

        for (const mode of order) {
            if (!(source.enabled ?? []).includes(mode)) continue;
            if (mode === "name") {
                const name = String(source.name ?? "").trim();
                if (name) game.actors.contents.filter((a) => a.name === name).forEach(push);
            }
            if (mode === "player-character") {
                if (!source.playerCharacter) continue;
                game.users.contents.filter((u) => !u.isGM).map((u) => u.character).forEach(push);
            }
            if (mode === "script") {
                const script = String(source.script ?? "").trim();
                if (!script) continue;
                try {
                    const fn = new AsyncFunction("data", "panel", "user", script);
                    const result = await fn(this, this.journalEntry, game.user);
                    if (Array.isArray(result)) result.forEach(push);
                    else push(result);
                } catch (e) {
                    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                    console.error(e);
                }
            }
            if (mode === "uuid") {
                const uuidSet = Array.from(source.uuids ?? []);
                for (const uuid of uuidSet) {
                    if (!uuid) continue;
                    const doc = await fromUuid(uuid);
                    push(doc);
                }
            }
        }

        const merged = Array.from(actorMap.values());
        const owned = merged.filter((a) => a.isOwner);
        const notOwned = merged.filter((a) => !a.isOwner);
        return owned.concat(notOwned);
    }

    /**
     * 获取“全部”角色类别时的全局需求配置。
     * @returns {{enabled:string[],name:string,uuids:string[],script:string,playerCharacter:boolean}}
     */
    #getGlobalActorRequirementConfig() {
        return {
            enabled: Array.from(this.journalEntry.getFlag(MODULE_ID, "actor-requirements") ?? []),
            name: this.journalEntry.getFlag(MODULE_ID, "actor-requirements-name") ?? "",
            uuids: this.journalEntry.getFlag(MODULE_ID, "actor-requirements-uuid") ?? [],
            script: this.journalEntry.getFlag(MODULE_ID, "actor-requirements-script") ?? "",
            playerCharacter: !!this.journalEntry.getFlag(MODULE_ID, "actor-requirements-player-character"),
        };
    }

    /**
     * 判断文档是否为 Actor。
     * @param {unknown} doc 待判断对象。
     * @returns {boolean}
     */
    #isActor(doc) {
        return !!doc && doc.documentName === "Actor";
    }

    /**
     * 获取当前选中角色。
     * @returns {Actor|null}
     */
    #getActiveActor() {
        if (!this.activeActorId) return null;
        return game.actors.get(this.activeActorId) ?? null;
    }

    /**
     * 首次渲染后绑定事件。
     * @param {object} context 渲染上下文。
     * @param {object} options 渲染选项。
     */
    _onFirstRender(context, options) {
        super._onFirstRender(context, options);
        const html = $(this.element);

        html.on("click", ".craft-handler-actors .craft-actor", async (event) => {
            event.preventDefault();
            const actorId = event.currentTarget.dataset.id;
            if (!actorId || actorId === this.activeActorId) return;
            this.activeActorId = actorId;
            await this.render(true);
        });

        html.on("click", ".craft-category-icon", this._onClickCategory.bind(this));
        html.on("contextmenu", ".craft-content.edit .craft-category-icon", this._onContextMenuCategory.bind(this));

        html.on("dragover", "[data-drop-target]", (ev) => ev.preventDefault());
        html.on("drop", "[data-action='template-drop-result']", this._onDropTemplateResult.bind(this));
        html.on("drop", "[data-action='handler-drop-result']", this._onDropHandlerResult.bind(this));
        html.on("dragstart", ".craft-handler-handlers .handler-card", this._onDragStartHandlerCard.bind(this));
        html.on("drop", ".craft-handler-handlers .handler-card", this._onDropHandlerCard.bind(this));
        html.on("drop", ".craft-handler-handlers .craft-handlers-panel", this._onDropHandlerCard.bind(this));
        html.on("dragstart", ".craft-content.edit .craft-handler-templates .handler-template", this._onDragStartTemplate.bind(this));
        html.on("drop", ".craft-content.edit .craft-handler-templates .handler-template", this._onDropTemplatesPanel.bind(this));
        html.on("drop", ".craft-content.edit .craft-handler-templates .craft-templates-panel", this._onDropTemplatesPanel.bind(this));
        html.on("click", "[data-action='edit-result']", this.editResult.bind(this));

        html.on("click", ".handler-card .handler-main.toggle-description", this.toggleDescription.bind(this));

        html.on("click", ".craft-content.edit .craft-panel-tittle > i", this.changePanelSize.bind(this));

        if (this.audio?.["open-panel"]) {
            playAudio({ src: this.audio["open-panel"], channel: "interface", volume: (this.audio?.["volume"] ?? 100) / 100 }, true);
        }
    }

    /**
     * 每次渲染后恢复滚动位置。
     * @param {object} context 渲染上下文。
     * @param {object} options 渲染选项。
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        html.querySelectorAll(".craft-handler-handlers .handler-card").forEach((el) => {
            el.setAttribute("draggable", "true");
        });
        for (const panel in this.scrollPositions) {
            const panelEl = html.querySelector(`.scroll-log-panel[data-panel="${panel}"]`);
            if (panelEl) {
                panelEl.scrollTop = this.scrollPositions[panel];
                panelEl.addEventListener("scrollend", this._onScrollLogPanel.bind(this));
            }
        }
    }

    /**
     * 关闭时清理全局面板实例记录。
     * @param {object} options 关闭参数。
     */
    _onClose(options) {
        super._onClose(options);
        craftPanels ??= [];
        craftPanels.splice(craftPanels.indexOf(this), 1);
    }

    /**
     * 记录三栏滚动位置。
     * @param {Event} event 滚动事件。
     * @returns {Promise<void>}
     */
    async _onScrollLogPanel(event) {
        const panel = event.currentTarget.dataset.panel;
        this.scrollPositions[panel] = event.target.scrollTop;
    }

    /**
     * 处理类别左键：新增类别或切换类别。
     * @param {Event} event 点击事件。
     * @returns {Promise<void>}
     */
    async _onClickCategory(event) {
        const category = event.currentTarget.dataset.category;
        const type = event.currentTarget.dataset.type;
        if (!type) return;
        if (this.isEdit && category === "add" && (type === "actors" || type === "templates")) {
            await this.addCategory(type);
            return;
        }
        await this.changeCategory(category, type);
    }

    /**
     * 处理类别右键：编辑类别（仅编辑模式）。
     * @param {Event} event 右键事件。
     * @returns {Promise<void>}
     */
    async _onContextMenuCategory(event) {
        event.preventDefault();
        const category = event.currentTarget.dataset.category;
        const type = event.currentTarget.dataset.type;
        if (!this.isEdit) return;
        if (!(type === "actors" || type === "templates")) return;
        await this.editCategory(category, type);
    }

    /**
     * 修改指定栏位尺寸并保存到面板 flag。
     * @param {Event} event 点击事件。
     * @returns {Promise<void>}
     */
    async changePanelSize(event) {
        const name = event.currentTarget.dataset.name;
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

    /**
     * 打开并提交面板配置表单。
     * @param {Event} event 点击事件。
     * @returns {Promise<void>}
     */
    async configure(event) {
        event?.preventDefault();
        if (!game.user.isGM) return;
        const fb = new FormBuilder()
            .object(this.journalEntry)
            .title(game.i18n.localize(`${MODULE_ID}.configure`) + ": " + this.journalEntry.name)
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: `flags.${MODULE_ID}.background`, type: "image", label: game.i18n.localize(`${MODULE_ID}.craft-panel.background-image`) })
            .file({ name: `flags.${MODULE_ID}.default-handler-icon`, type: "image", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.default-handler-icon`) })
            .number({ name: `flags.${MODULE_ID}.parallelLimit`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.parallel-limit`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.parallel-limit-hint`), value: 0, min: 0, step: 1 })
            .text({ name: `flags.${MODULE_ID}.handler-empty-text-actors`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.empty-actors`) })
            .text({ name: `flags.${MODULE_ID}.handler-empty-text-handlers`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.empty-handlers`) })
            .text({ name: `flags.${MODULE_ID}.handler-empty-text-templates`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.empty-templates`) })
            .tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-requirements-tab`) })
            .multiSelect({
                name: `flags.${MODULE_ID}.actor-requirements`,
                label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements`),
                hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-hint`),
                options: {
                    name: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-name`),
                    uuid: "UUID",
                    "player-character": game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character`),
                    script: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-script`),
                },
            })
            .text({ name: `flags.${MODULE_ID}.actor-requirements-name`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-name-hint`) })
            .uuid({ name: `flags.${MODULE_ID}.actor-requirements-uuid`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-uuid`), type: "Actor", multiple: true, hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-uuid-hint`) })
            .checkbox({ name: `flags.${MODULE_ID}.actor-requirements-player-character`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character-hint`) })
            .script({ name: `flags.${MODULE_ID}.actor-requirements-script`, label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-script-hint`) })
            .tab({ id: "audio", icon: "fas fa-volume-up", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-audio-tab`) })
            .number({ name: `flags.${MODULE_ID}.audio.volume`, label: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-volume`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-volume-hint`), value: 100, min: 0, max: 100, step: 1 })
            .file({ name: `flags.${MODULE_ID}.audio.open-panel`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel.audio-open-panel`) })
            .file({ name: `flags.${MODULE_ID}.audio.progress-handler`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.audio-progress-handler`) })
            .file({ name: `flags.${MODULE_ID}.audio.complete-handler`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.audio-complete-handler`) })
            .file({ name: `flags.${MODULE_ID}.audio.delete-handler`, type: "audio", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.audio-delete-handler`) });

        const data = await fb.render();
        if (!data) return;
        await this.journalEntry.update(data);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 播放指定音效键。
     * @param {string} key 音效键名。
     * @returns {Promise<void>}
     */
    async #playAudio(key) {
        if (!this.audio?.[key]) return;
        await playAudio({ src: this.audio[key], channel: "interface", volume: (this.audio?.["volume"] ?? 100) / 100 }, true);
    }

    /**
     * 获取默认处理图标。
     * @returns {string}
     */
    #getDefaultHandlerIcon() {
        return this.journalEntry.getFlag(MODULE_ID, "default-handler-icon") || DEFAULT_HANDLER_ICON;
    }

    /**
     * 规范化标签数组。
     * @param {string[]|string|unknown} tags 原始标签。
     * @returns {string[]}
     */
    #normalizeTags(tags) {
        if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
        if (typeof tags === "string") return this.#splitTagString(tags);
        return [];
    }

    /**
     * 将中英文逗号分隔文本拆分为标签数组。
     * @param {string} text 标签文本。
     * @returns {string[]}
     */
    #splitTagString(text) {
        return String(text ?? "").split(/[，,]/).map((t) => t.trim()).filter(Boolean);
    }

    /**
     * 规范化类别数据。
     * @param {Array<object>} categories 原始类别数组。
     * @returns {{name:string,icon:string}[]}
     */
    #normalizeTemplateCategories(categories = []) {
        if (!Array.isArray(categories)) return [];
        return categories.map((c) => ({ name: String(c?.name ?? "").trim(), icon: c?.icon || "icons/svg/daze.svg" })).filter((c) => c.name);
    }

    /**
     * 将模板结果数组转换为可渲染预览数据。
     * @param {Array<object>} results 结果物品数据。
     * @returns {Promise<Array<{index:number,name:string,img:string,quantity:number}>>}
     */
    async #prepareResultsPreview(results = []) {
        return await Promise.all(results.map(async (r, i) => {
            let name = r.name;
            let img = r.img;
            const hasQuantity = r.hasQuantity ?? (Object.prototype.hasOwnProperty.call(r, "quantity") || Object.prototype.hasOwnProperty.call(r?.system ?? {}, "quantity"));
            if (r.uuid) {
                const item = await fromUuid(r.uuid);
                name ??= item?.name;
                img ??= item?.img;
            }
            return {
                index: i,
                name: name ?? game.i18n.localize(`${MODULE_ID}.craft-panel.unknown-result`),
                img: img ?? "icons/svg/item-bag.svg",
                quantity: foundry.utils.getProperty(r, this.quantityPath) ?? r.quantity ?? 1,
                hasQuantity,
            };
        }));
    }

    /**
     * 规范化结果物品对象，保留原始数据并补齐展示字段。
     * @param {object} result 原始结果物品。
     * @param {Item|null} item 来源物品。
     * @returns {object}
     */
    #normalizeResultData(result = {}, item = null) {
        const data = foundry.utils.deepClone(result?.toObject?.() ?? result ?? {});
        if (data._id) delete data._id;
        const source = item?.toObject?.() ?? item ?? null;
        const hasQuantity = result?.hasQuantity ?? (Object.prototype.hasOwnProperty.call(data, "quantity") || Object.prototype.hasOwnProperty.call(data?.system ?? {}, "quantity") || Object.prototype.hasOwnProperty.call(source?.system ?? {}, "quantity"));
        const quantity = Number(result?.quantity ?? data?.quantity ?? foundry.utils.getProperty(data, this.quantityPath) ?? foundry.utils.getProperty(source, this.quantityPath) ?? 1);

        data.uuid = result?.uuid ?? source?.uuid ?? data.uuid ?? "";
        data.name = result?.name ?? data.name ?? source?.name ?? game.i18n.localize(`${MODULE_ID}.craft-panel.unknown-result`);
        data.img = result?.img ?? data.img ?? source?.img ?? "icons/svg/item-bag.svg";
        data.hasQuantity = !!hasQuantity;
        if (data.hasQuantity) {
            data.quantity = Number.isFinite(quantity) ? quantity : 1;
            data.system ??= {};
            foundry.utils.setProperty(data, this.quantityPath, data.quantity);
        } else {
            delete data.quantity;
            if (foundry.utils.getProperty(data, this.quantityPath) !== undefined) foundry.utils.setProperty(data, this.quantityPath, undefined);
        }
        return data;
    }

    /**
     * 打开结果物品编辑弹窗。
     * @param {object} result 结果物品对象。
     * @returns {Promise<object|null>}
     */
    async #openResultEditor(result) {
        let needDelete = false;
        const fb = new FormBuilder()
            .object({
                name: result.name ?? "",
                img: result.img ?? "icons/svg/item-bag.svg",
                quantity: result.hasQuantity ? Number(result.quantity ?? 1) : 1,
            })
            .title(result.name ?? game.i18n.localize(`${MODULE_ID}.craft-panel.unknown-result`))
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "img", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .button({
                label: game.i18n.localize("Delete"),
                icon: "fas fa-trash",
                callback: async () => {
                    needDelete = true;
                    fb.form().close();
                },
            });
        if (result.hasQuantity) {
            fb.number({ name: "quantity", label: game.i18n.localize(`${MODULE_ID}.quantity`), min: 0, step: 1 });
        }
        const data = await fb.render();
        if (needDelete) return { _delete: true };
        return data;
    }

    /**
     * 编辑模板或处理对象中的结果物品。
     * @param {Event} event 点击事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async editResult(event, target) {
        event?.preventDefault();
        const scope = target?.dataset?.resultScope;
        const index = Number(target?.dataset?.resultIndex);
        if (!scope || Number.isNaN(index)) return;

        if (scope === "template") {
            if (!game.user.isGM) return;
            const templateUuid = target?.dataset?.templateUuid;
            if (!templateUuid) return;
            const page = await fromUuid(templateUuid);
            if (!page) return;
            const results = foundry.utils.deepClone(page.getFlag(MODULE_ID, "results") ?? []);
            const result = this.#normalizeResultData(results[index] ?? {});
            const data = await this.#openResultEditor(result);
            if (!data) return;
            if (data._delete) {
                results.splice(index, 1);
                await page.setFlag(MODULE_ID, "results", results);
                this.needRefresh = true;
                await this.render(true);
                return;
            }
            results[index] = this.#normalizeResultData({ ...result, ...data, hasQuantity: result.hasQuantity });
            await page.setFlag(MODULE_ID, "results", results);
            this.needRefresh = true;
            await this.render(true);
            return;
        }

        if (scope === "handler") {
            if (!game.user.isGM || !this.isEdit) return;
            const handlerId = target?.dataset?.handlerId;
            if (!handlerId) return;
            const activeActor = this.#getActiveActor();
            if (!activeActor) return;
            const handlers = await this.getActorHandlers(activeActor.id);
            const handler = handlers.find((h) => h.id === handlerId);
            if (!handler) return;
            const results = foundry.utils.deepClone(handler.results ?? []);
            const result = this.#normalizeResultData(results[index] ?? {});
            const data = await this.#openResultEditor(result);
            if (!data) return;
            if (data._delete) {
                results.splice(index, 1);
                handler.results = results;
                await this.saveActorHandlers(activeActor.id, handlers);
                await this.render(true);
                return;
            }
            results[index] = this.#normalizeResultData({ ...result, ...data, hasQuantity: result.hasQuantity });
            handler.results = results;
            await this.saveActorHandlers(activeActor.id, handlers);
            await this.render(true);
        }
    }

    /**
     * 规范化步骤数组并补全展示字段。
     * @param {Array<object>} steps 原始步骤数组。
     * @returns {HandlerStepData[]}
     */
    #normalizeSteps(steps = []) {
        return steps.map((s, i) => {
            const type = s.type ?? "progress";
            const status = s.status ?? "pending";
            const comparisons = Array.isArray(s.comparisons) && s.comparisons.length > 0 ? s.comparisons : ["ge"];
            return {
                id: s.id ?? foundry.utils.randomID(),
                type,
                typeText: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.${type}-step`),
                isProgress: type === "progress",
                isRoll: type === "roll",
                label: s.label ?? game.i18n.localize(`${MODULE_ID}.name`),
                target: Number.isFinite(s.target) ? s.target : (s.target ?? 1),
                current: s.current ?? 0,
                formula: s.formula ?? "1d20",
                dc: s.dc ?? 10,
                comparisons,
                comparisonsText: this.#comparisonText(comparisons),
                status,
                statusText: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.step-status-${status}`),
                statusIcon: status === "complete" ? "fa-check" : status === "failed" ? "fa-times" : "fa-spinner",
                lastRoll: s.lastRoll,
                index: i,
            };
        });
    }

    /**
     * 将比较运算符数组转换为显示文本。
     * @param {string[]} comparisons 运算符数组。
     * @returns {string}
     */
    #comparisonText(comparisons = []) {
        const labels = { gt: ">", ge: ">=", eq: "=", le: "<=", lt: "<" };
        return comparisons.map((c) => labels[c] ?? c).join("/");
    }

    /**
     * 统计步骤总数、完成数、失败数与整体状态。
     * @param {HandlerStepData[]} steps 步骤数组。
     * @returns {{total:number,completed:number,failed:number,done:boolean,state:"pending"|"failed"|"complete"}}
     */
    #summarizeSteps(steps = []) {
        const total = steps.length;
        const completed = steps.filter((s) => s.status === "complete").length;
        const failed = steps.filter((s) => s.status === "failed").length;
        return { total, completed, failed, done: total > 0 && completed === total, state: failed > 0 ? "failed" : completed === total ? "complete" : "pending" };
    }

    /**
     * 读取指定角色在当前面板下的处理对象列表（含缓存）。
     * @param {string} actorId 角色 ID。
     * @returns {Promise<HandlerInstanceData[]>}
     */
    async getActorHandlers(actorId) {
        if (this.actorHandlers.has(actorId)) return foundry.utils.deepClone(this.actorHandlers.get(actorId));
        const actor = game.actors.get(actorId);
        if (!actor) return [];
        const allHandlers = foundry.utils.deepClone(actor.getFlag(MODULE_ID, FLAG_KEY) ?? []);
        const handlers = allHandlers.filter((h) => h.panelId === this.journalEntry.id);
        this.actorHandlers.set(actorId, handlers);
        return foundry.utils.deepClone(handlers);
    }

    /**
     * 保存角色处理对象列表到 flag，并维护本地缓存。
     * @param {string} actorId 角色 ID。
     * @param {HandlerInstanceData[]} handlers 当前面板的处理对象列表。
     * @returns {Promise<void>}
     */
    async saveActorHandlers(actorId, handlers) {
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!actor.isOwner) return ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.permission-denied`));

        const allHandlers = foundry.utils.deepClone(actor.getFlag(MODULE_ID, FLAG_KEY) ?? []);
        const otherPanelHandlers = allHandlers.filter((h) => h.panelId !== this.journalEntry.id);
        const finalHandlers = otherPanelHandlers.concat(foundry.utils.deepClone(handlers));

        this.actorHandlers.set(actorId, foundry.utils.deepClone(handlers));
        if (!finalHandlers || finalHandlers.length === 0) await actor.unsetFlag(MODULE_ID, FLAG_KEY);
        else await actor.setFlag(MODULE_ID, FLAG_KEY, finalHandlers);
    }

    /**
     * 新建处理模板页面。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async addTemplate(event, target) {
        event?.preventDefault();
        if (!game.user.isGM) return;

        const defaultName = game.i18n.localize(`${MODULE_ID}.craft-panel-handler.new-handler-template`) || "New Handler";
        const defaultImg = this.#getDefaultHandlerIcon();
        const templateCategories = this.journalEntry.getFlag(MODULE_ID, "handler-template-categories") ?? [];
        const categoryOptions = {};
        templateCategories.forEach((c) => { categoryOptions[c.name] = c.name; });

        const fb = new FormBuilder()
            .object({ name: defaultName, img: defaultImg, script: "", description: "", tagsText: "" })
            .title(defaultName)
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "img", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .script({ name: "script", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.handler-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.handler-script-hint`) })
            .editor({ name: "description", label: game.i18n.localize(`${MODULE_ID}.description`) })
            .text({ name: "tagsText", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.tags`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.tags-hint`) });
        if (Object.keys(categoryOptions).length > 0) {
            fb.multiSelect({ name: "categoryNames", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.categories`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.categories-hint`), options: categoryOptions, value: new Set() });
        }

        const data = await fb.render();
        if (!data) return;

        const selectedNames = Array.from(data.categoryNames ?? []);
        const categories = selectedNames.map((name) => {
            const matched = templateCategories.find((c) => c.name === name);
            return { name, icon: matched?.icon || "icons/svg/daze.svg" };
        });

        await this.journalEntry.createEmbeddedDocuments("JournalEntryPage", [{
            name: data.name || defaultName,
            src: data.img || defaultImg,
            "text.content": "",
            flags: {
                [MODULE_ID]: {
                    type: "handler",
                    steps: [],
                    results: [],
                    completeScript: data.script ?? "",
                    description: data.description ?? "",
                    tags: this.#splitTagString(data.tagsText),
                    categories,
                },
            },
        }]);

        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 编辑处理模板基础信息。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async editTemplate(event, target) {
        if (!game.user.isGM) return;
        const templateUuid = target?.dataset?.templateUuid;
        if (!templateUuid) return;
        const page = await fromUuid(templateUuid);
        if (!page) return;
        let needDelete = false;

        const templateCategories = this.journalEntry.getFlag(MODULE_ID, "handler-template-categories") ?? [];
        const categoryOptions = {};
        templateCategories.forEach((c) => { categoryOptions[c.name] = c.name; });

        const currentCategories = this.#normalizeTemplateCategories(page.getFlag(MODULE_ID, "categories") ?? []);
        const selectedCategoryNames = new Set(currentCategories.map((c) => c.name));

        const fb = new FormBuilder()
            .object({
                name: page.name,
                img: page.src ?? this.#getDefaultHandlerIcon(),
                script: page.getFlag(MODULE_ID, "completeScript") ?? "",
                description: page.getFlag(MODULE_ID, "description") ?? "",
                tagsText: (page.getFlag(MODULE_ID, "tags") ?? []).join(", "),
            })
            .title(page.name)
            .html(`<div class="form-group"><label>UUID</label><div class="form-fields"><input type="text" value="${page.uuid}" readonly onclick="this.select()" /></div></div>`)
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "img", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .script({ name: "script", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.handler-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.handler-script-hint`) })
            .editor({ name: "description", label: game.i18n.localize(`${MODULE_ID}.description`) })
            .text({ name: "tagsText", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.tags`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.tags-hint`) })
            .button({
                label: game.i18n.localize("Delete"),
                icon: "fas fa-trash",
                callback: async () => {
                    needDelete = true;
                    fb.form().close();
                },
            });
        if (Object.keys(categoryOptions).length > 0) {
            fb.multiSelect({ name: "categoryNames", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.categories`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.categories-hint`), options: categoryOptions, value: selectedCategoryNames });
        }

        const data = await fb.render();
        if (needDelete) {
            await page.deleteDialog();
            await this.#playAudio("delete-handler");
            this.needRefresh = true;
            await this.render(true);
            return;
        }
        if (!data) return;

        const selectedNames = Array.from(data.categoryNames ?? []);
        const categories = selectedNames.map((name) => {
            const matched = templateCategories.find((c) => c.name === name);
            return { name, icon: matched?.icon || "icons/svg/daze.svg" };
        });

        await page.update({ name: data.name, src: data.img || this.#getDefaultHandlerIcon() });
        await page.setFlag(MODULE_ID, "completeScript", data.script ?? "");
        await page.setFlag(MODULE_ID, "description", data.description ?? "");
        await page.setFlag(MODULE_ID, "tags", this.#splitTagString(data.tagsText));
        await page.setFlag(MODULE_ID, "categories", categories);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 删除处理模板页面。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async deleteTemplate(event, target) {
        if (!game.user.isGM) return;
        const templateUuid = target?.dataset?.templateUuid;
        if (!templateUuid) return;
        const page = await fromUuid(templateUuid);
        if (!page) return;
        await page.deleteDialog();
        await this.#playAudio("delete-handler");
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 为模板新增步骤。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async addTemplateStep(event, target) {
        if (!game.user.isGM) return;
        const templateUuid = target?.dataset?.templateUuid;
        if (!templateUuid) return;
        const page = await fromUuid(templateUuid);
        if (!page) return;

        const data = await this.#openStepEditor(page.name, null, 0);
        if (!data) return;

        const steps = this.#normalizeSteps(page.getFlag(MODULE_ID, "steps") ?? []);
        steps.push(this.#toStepData(data));
        await page.setFlag(MODULE_ID, "steps", steps);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 编辑模板中的指定步骤。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async editTemplateStep(event, target) {
        if (!game.user.isGM) return;
        const templateUuid = target?.dataset?.templateUuid;
        const stepIndex = Number(target?.dataset?.stepIndex);
        if (!templateUuid || Number.isNaN(stepIndex)) return;
        const page = await fromUuid(templateUuid);
        if (!page) return;

        const steps = this.#normalizeSteps(page.getFlag(MODULE_ID, "steps") ?? []);
        const step = steps[stepIndex];
        if (!step) return;

        const data = await this.#openStepEditor(page.name, step, stepIndex);
        if (data?._delete) {
            steps.splice(stepIndex, 1);
            await page.setFlag(MODULE_ID, "steps", steps);
            this.needRefresh = true;
            await this.render(true);
            return;
        }
        if (!data) return;

        steps[stepIndex] = { ...step, ...this.#toStepData(data), id: step.id, status: step.status, lastRoll: step.lastRoll };
        await page.setFlag(MODULE_ID, "steps", steps);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 打开步骤编辑表单。
     * @param {string} title 表单标题。
     * @param {HandlerStepData|null} step 当前步骤（为空表示新增）。
     * @param {number} stepIndex 步骤索引。
     * @returns {Promise<object|null>}
     */
    async #openStepEditor(title, step, stepIndex) {
        let needDelete = false;
        const stepOptions = {
            progress: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.progress-step`) || "progress",
            roll: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.roll-step`) || "roll",
        };
        const fb = new FormBuilder()
            .title(title)
            .select({ name: "type", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.step-type`), options: stepOptions, value: step?.type ?? "progress" })
            .text({ name: "label", label: game.i18n.localize(`${MODULE_ID}.name`), value: step?.label ?? (game.i18n.localize(`${MODULE_ID}.craft-panel-handler.step`) + ` ${stepIndex + 1}`) })
            .number({ name: "target", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.target`), value: step?.target ?? 1, min: 1 })
            .number({ name: "current", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.current`) ?? "", value: step?.current ?? 0, min: 0 })
            .text({ name: "formula", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.formula`) ?? "1d20", value: step?.formula ?? "1d20" })
            .number({ name: "dc", label: "DC", value: step?.dc ?? 10 })
            .multiSelect({
                name: "comparisons",
                label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.roll-compare`) ?? "Compare",
                options: { gt: ">", ge: ">=", eq: "=", le: "<=", lt: "<" },
                value: new Set(step?.comparisons ?? ["ge"]),
            });
        if (step) {
            fb.button({
                label: game.i18n.localize("Delete"),
                icon: "fas fa-trash",
                callback: async () => {
                    needDelete = true;
                    fb.form().close();
                },
            });
        }
        const data = await fb.render();
        if (needDelete) return { _delete: true };
        return data;
    }

    /**
     * 将步骤表单返回值转换为持久化结构。
     * @param {object} data 表单数据。
     * @returns {object}
     */
    #toStepData(data) {
        return {
            type: data.type,
            label: data.label,
            target: data.target ?? 1,
            current: data.current ?? 0,
            formula: data.formula ?? "1d20",
            dc: data.dc ?? 10,
            comparisons: Array.from(data.comparisons ?? ["ge"]),
            status: "pending",
        };
    }

    /**
     * 删除模板中的步骤。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async removeTemplateStep(event, target) {
        if (!game.user.isGM) return;
        const templateUuid = target?.dataset?.templateUuid;
        const index = Number(target?.dataset?.stepIndex);
        if (!templateUuid || Number.isNaN(index)) return;
        const page = await fromUuid(templateUuid);
        if (!page) return;
        const steps = this.#normalizeSteps(page.getFlag(MODULE_ID, "steps") ?? []);
        steps.splice(index, 1);
        await page.setFlag(MODULE_ID, "steps", steps);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 处理模板结果槽位的拖拽放置。
     * @param {DragEvent} event 拖拽事件。
     * @returns {Promise<void>}
     */
    async _onDropTemplateResult(event) {
        event.preventDefault();
        if (!game.user.isGM) return;
        const data = this.#readDropData(event);
        if (!data || data.type !== "Item") return;
        const templateUuid = event.currentTarget.dataset.templateUuid;
        const page = await fromUuid(templateUuid);
        if (!page) return;
        const item = await fromUuid(data.uuid);
        if (!item) return;
        const results = page.getFlag(MODULE_ID, "results") ?? [];
        results.push(this.#normalizeResultData({}, item));
        await page.setFlag(MODULE_ID, "results", results);

        const currentIcon = page.src ?? this.#getDefaultHandlerIcon();
        if (results.length === 1 && currentIcon === this.#getDefaultHandlerIcon()) {
            await page.update({ src: item.img || currentIcon });
        }

        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 处理模板拖拽开始，写入模板排序所需数据。
     * @param {DragEvent|Event} event 拖拽事件。
     * @returns {Promise<void>}
     */
    async _onDragStartTemplate(event) {
        if (!game.user.isGM || !this.isEdit) return;
        const templateUuid = event.currentTarget?.dataset?.templateUuid;
        if (!templateUuid) return;
        const dataTransfer = event.originalEvent?.dataTransfer ?? event.dataTransfer;
        if (!dataTransfer) return;
        dataTransfer.setData("text/plain", JSON.stringify({
            type: "CraftHandlerTemplate",
            uuid: templateUuid,
            parent: this.journalEntry.uuid,
        }));
    }

    /**
     * 处理模板排序放置。
     * @param {DragEvent|Event} event 拖拽事件。
     * @returns {Promise<void>}
     */
    async _onDropTemplatesPanel(event) {
        event.stopPropagation();
        if (!game.user.isGM || !this.isEdit) return;

        const data = this.#readDropData(event);
        if (!data || data.type !== "CraftHandlerTemplate") return;
        if (data.parent !== this.journalEntry.uuid) return;

        const page = await fromUuid(data.uuid);
        if (!page) return;

        const targetUuid = event.currentTarget?.dataset?.templateUuid;
        let sortTarget;
        if (targetUuid) {
            sortTarget = await fromUuid(targetUuid);
            // if (!sortTarget || sortTarget.id === page.id) return;
        }
        await page.sortRelative({
            sortKey: "sort",
            target: sortTarget,
            siblings: this.journalEntry.pages.filter(p => p.id !== page.id),
        });

        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 处理对象拖拽开始，写入排序数据。
     * @param {DragEvent|Event} event 拖拽事件。
     * @returns {Promise<void>}
     */
    async _onDragStartHandlerCard(event) {
        const handlerId = event.currentTarget?.dataset?.handlerId;
        if (!handlerId) return;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;

        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler || !this.#canEditHandler(handler, activeActor)) return;

        const dataTransfer = event.originalEvent?.dataTransfer ?? event.dataTransfer;
        if (!dataTransfer) return;
        dataTransfer.setData("text/plain", JSON.stringify({
            type: "CraftHandlerCard",
            handlerId,
            actorId: activeActor.id,
            parent: this.journalEntry.uuid,
        }));
    }

    /**
     * 处理对象排序放置（数组模拟原生排序）。
     * 规则：
     * 1) 拖动元素在目标后面时，排到目标前；
     * 2) 拖动元素在目标前面时，排到目标后；
     * 3) 无目标元素时，排到末尾。
     * @param {DragEvent|Event} event 拖拽事件。
     * @returns {Promise<void>}
     */
    async _onDropHandlerCard(event) {
        event.preventDefault();
        event.stopPropagation();

        const data = this.#readDropData(event);
        if (!data || data.type !== "CraftHandlerCard") return;
        if (data.parent !== this.journalEntry.uuid) return;

        const activeActor = this.#getActiveActor();
        if (!activeActor || data.actorId !== activeActor.id) return;
        const handlers = await this.getActorHandlers(activeActor.id);

        const sourceIndex = handlers.findIndex((h) => h.id === data.handlerId);
        if (sourceIndex < 0) return;

        const targetHandlerId = event.currentTarget?.dataset?.handlerId;
        if (targetHandlerId && targetHandlerId === data.handlerId) return;
        const targetIndex = handlers.findIndex((h) => h.id === targetHandlerId);

        const [moved] = handlers.splice(sourceIndex, 1);
        if (!moved) return;

        if (!targetHandlerId || targetIndex < 0) {
            handlers.push(moved);
        } else {
            handlers.splice(targetIndex, 0, moved);
        }

        await this.saveActorHandlers(activeActor.id, handlers);
        await this.render(true);
    }

    /**
     * 解析拖拽事件中的 JSON 数据。
     * @param {DragEvent|Event} event 事件对象。
     * @returns {object|null}
     */
    #readDropData(event) {
        try {
            return JSON.parse(event.originalEvent?.dataTransfer?.getData("text/plain") ?? event.dataTransfer?.getData("text/plain"));
        } catch (e) {
            return null;
        }
    }

    /**
     * 删除模板中的结果物品。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async removeTemplateResult(event, target) {
        if (!game.user.isGM) return;
        const templateUuid = target?.dataset?.templateUuid;
        const index = Number(target?.dataset?.resultIndex);
        if (!templateUuid || Number.isNaN(index)) return;
        const page = await fromUuid(templateUuid);
        if (!page) return;
        const results = page.getFlag(MODULE_ID, "results") ?? [];
        results.splice(index, 1);
        await page.setFlag(MODULE_ID, "results", results);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 从模板创建新的处理对象并加入当前角色。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async createHandlerFromTemplate(event, target) {
        const templateUuid = target?.dataset?.templateUuid;
        if (!templateUuid) return;
        const template = await fromUuid(templateUuid);
        if (!template) return;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.objectNotFound`) + " : actor");
        if (!activeActor.isOwner) return ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.permission-denied`));

        const steps = this.#normalizeSteps(template.getFlag(MODULE_ID, "steps") ?? []).map((s) => ({ ...s, current: 0, lastRoll: null, status: "pending" }));
        const results = foundry.utils.deepClone(template.getFlag(MODULE_ID, "results") ?? []);

        const handlers = await this.getActorHandlers(activeActor.id);
        const parallelLimit = this.journalEntry.getFlag(MODULE_ID, "parallelLimit") ?? 0;
        if (parallelLimit > 0) {
            const unfinished = handlers.filter((h) => !h.completed).length;
            if (unfinished >= parallelLimit) return ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notification.parallel-limit-reached`));
        }

        handlers.push({
            id: foundry.utils.randomID(),
            panelId: this.journalEntry.id,
            name: template.name,
            img: template.src ?? this.#getDefaultHandlerIcon(),
            description: template.getFlag(MODULE_ID, "description") ?? "",
            tags: this.#normalizeTags(template.getFlag(MODULE_ID, "tags") ?? []),
            categories: this.#normalizeTemplateCategories(template.getFlag(MODULE_ID, "categories") ?? []),
            templateUuid: template.uuid,
            script: template.getFlag(MODULE_ID, "completeScript") ?? "",
            results,
            steps,
            createdAt: Date.now(),
            completed: false,
            failed: false,
        });

        await this.saveActorHandlers(activeActor.id, handlers);
        await this.render(true);
    }

    /**
     * 编辑处理对象（玩家仅可改标签，GM 可改完整信息）。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async editHandler(event, target) {
        const handlerId = target?.dataset?.handlerId;
        if (!handlerId) return;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler) return;
        if (!this.#canEditHandler(handler, activeActor)) return;

        if (!game.user.isGM) {
            const fb = new FormBuilder()
                .object({ tagsText: (handler.tags ?? []).join(", ") })
                .title(handler.name)
                .text({ name: "tagsText", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.tags`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.tags-hint`) });
            const data = await fb.render();
            if (!data) return;
            handler.tags = this.#splitTagString(data.tagsText);
            await this.saveActorHandlers(activeActor.id, handlers);
            await this.render(true);
            return;
        }

        const templateCategories = this.journalEntry.getFlag(MODULE_ID, "handler-template-categories") ?? [];
        const categoryOptions = {};
        templateCategories.forEach((c) => { categoryOptions[c.name] = c.name; });
        const selectedCategoryNames = new Set((handler.categories ?? []).map((c) => c.name));

        const fb = new FormBuilder()
            .object({
                name: handler.name,
                img: handler.img ?? this.#getDefaultHandlerIcon(),
                script: handler.script ?? "",
                description: handler.description ?? "",
                tagsText: (handler.tags ?? []).join(", "),
            })
            .title(handler.name)
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "img", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .script({ name: "script", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.handler-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.handler-script-hint`) })
            .editor({ name: "description", label: game.i18n.localize(`${MODULE_ID}.description`) })
            .text({ name: "tagsText", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.tags`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.tags-hint`) });
        if (Object.keys(categoryOptions).length > 0) {
            fb.multiSelect({ name: "categoryNames", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.categories`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.categories-hint`), options: categoryOptions, value: selectedCategoryNames });
        }

        const data = await fb.render();
        if (!data) return;

        const selectedNames = Array.from(data.categoryNames ?? []);
        const categories = selectedNames.map((name) => {
            const matched = templateCategories.find((c) => c.name === name);
            return { name, icon: matched?.icon || "icons/svg/daze.svg" };
        });

        handler.name = data.name;
        handler.img = data.img || this.#getDefaultHandlerIcon();
        handler.script = data.script ?? "";
        handler.description = data.description ?? "";
        handler.tags = this.#splitTagString(data.tagsText);
        handler.categories = categories;

        await this.saveActorHandlers(activeActor.id, handlers);
        await this.render(true);
    }

    /**
     * 删除处理对象。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async deleteHandler(event, target) {
        const handlerId = target?.dataset?.handlerId;
        if (!handlerId) return;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const idx = handlers.findIndex((h) => h.id === handlerId);
        if (idx < 0) return;
        if (!this.#canEditHandler(handlers[idx], activeActor)) return;
        handlers.splice(idx, 1);
        await this.saveActorHandlers(activeActor.id, handlers);
        await this.#playAudio("delete-handler");
        await this.render(true);
    }

    /**
     * 完成处理对象：发放结果、执行脚本并标记完成。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async completeHandler(event, target) {
        const handlerId = target?.dataset?.handlerId;
        if (!handlerId) return;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler) return;
        if (!this.#canEditHandler(handler, activeActor)) return;
        if (handler.completed) return;
        if (!(handler.steps ?? []).every((s) => s.status === "complete")) return;

        const payload = foundry.utils.deepClone(handler.results ?? []);
        payload.forEach((p) => delete p._id);
        if (payload.length > 0) await activeActor.createEmbeddedDocuments("Item", payload);

        const script = handler.script ?? "";
        if (script.trim() !== "") {
            try {
                const fn = new AsyncFunction("data", "panel", "handler", "actor", "user", script);
                await fn(this, this.journalEntry, handler, activeActor, game.user);
            } catch (e) {
                ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notification.script-error`));
                console.error(e);
            }
        }

        handler.completed = true;
        handler.failed = false;
        await this.saveActorHandlers(activeActor.id, handlers);
        await this.#playAudio("complete-handler");
        await this.render(true);
    }

    /**
     * 恢复已完成处理对象为未完成状态。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async restoreHandler(event, target) {
        if (!game.user.isGM) return;
        const handlerId = target?.dataset?.handlerId;
        if (!handlerId) return;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler) return;
        handler.completed = false;
        await this.saveActorHandlers(activeActor.id, handlers);
        await this.render(true);
    }

    /**
     * 重置处理对象全部步骤与状态。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async resetHandler(event, target) {
        if (!game.user.isGM) return;
        const handlerId = target?.dataset?.handlerId;
        if (!handlerId) return;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler) return;

        handler.steps = this.#normalizeSteps(handler.steps ?? []).map((s) => ({ ...s, current: 0, lastRoll: null, status: "pending" }));
        handler.completed = false;
        handler.failed = false;
        await this.saveActorHandlers(activeActor.id, handlers);
        await this.render(true);
    }

    /**
     * 调整进度步骤当前值。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async adjustProgress(event, target) {
        const handlerId = target?.dataset?.handlerId;
        const index = Number(target?.dataset?.stepIndex);
        const delta = target?.dataset?.action === "progress-inc" ? 1 : -1;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler || !this.#canOperateHandler(handler, activeActor)) return;
        const step = handler.steps?.[index];
        if (!step || step.type !== "progress") return;

        step.current = Math.max(0, (step.current ?? 0) + delta);
        if (step.current >= (step.target ?? 1)) step.status = "complete";
        else if (step.status === "complete") step.status = "pending";

        await this.saveActorHandlers(activeActor.id, handlers);
        await this.#playAudio("progress-handler");
        await this.render(true);
    }

    /**
     * 执行掷骰步骤并按比较规则更新步骤状态。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async rollStep(event, target) {
        const handlerId = target?.dataset?.handlerId;
        const index = Number(target?.dataset?.stepIndex);
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler || !this.#canOperateHandler(handler, activeActor)) return;
        const step = handler.steps?.[index];
        if (!step || step.type !== "roll") return;

        const rollData = activeActor?.getRollData?.() ?? {};
        const roll = await new Roll(step.formula ?? "1d20", rollData).roll({ async: true });
        await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: activeActor }) });
        step.lastRoll = roll.total;
        step.status = this.#evaluateComparison(roll.total, step.dc ?? 10, step.comparisons ?? ["ge"]) ? "complete" : "failed";

        await this.saveActorHandlers(activeActor.id, handlers);
        await this.#playAudio("progress-handler");
        await this.render(true);
    }

    /**
     * GM 手动标记步骤状态。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @param {"complete"|"failed"} state 目标状态。
     * @returns {Promise<void>}
     */
    async markStep(event, target, state) {
        const handlerId = target?.dataset?.handlerId;
        const index = Number(target?.dataset?.stepIndex);
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        if (!game.user.isGM) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler || handler.completed) return;
        const step = handler.steps?.[index];
        if (!step) return;
        step.status = state;
        await this.saveActorHandlers(activeActor.id, handlers);
        await this.#playAudio("progress-handler");
        await this.render(true);
    }

    /**
     * 切换处理对象描述折叠状态。
     * @param {Event} event 触发事件。
     * @returns {Promise<void>}
     */
    async toggleDescription(event) {
        // 仅前端 UI 状态变更，无需持久化
        // 查找 handler-description-wrap 元素并切换其折叠状态
        const trigger = event?.currentTarget;
        const card = trigger?.closest(".handler-card");
        if (!card) return;
        const descriptionWrap = card.querySelector(".handler-description-wrap");
        if (descriptionWrap) {
            descriptionWrap.classList.toggle("collapsed");
        }
    }

    /**
     * 处理对象结果槽位拖拽放置（编辑模式下可用）。
     * @param {DragEvent} event 拖拽事件。
     * @returns {Promise<void>}
     */
    async _onDropHandlerResult(event) {
        event.preventDefault();
        if (!game.user.isGM || !this.isEdit) return;
        const data = this.#readDropData(event);
        if (!data || data.type !== "Item") return;

        const handlerId = event.currentTarget.dataset.handlerId;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;

        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler) return;

        const item = await fromUuid(data.uuid);
        if (!item) return;

        handler.results ??= [];
        handler.results.push(this.#normalizeResultData({}, item));

        if ((handler.results.length === 1) && ((handler.img ?? this.#getDefaultHandlerIcon()) === this.#getDefaultHandlerIcon())) {
            handler.img = item.img || handler.img;
        }
        await this.saveActorHandlers(activeActor.id, handlers);
        await this.render(true);
    }

    /**
     * 删除处理对象中的结果物品。
     * @param {Event} event 触发事件。
     * @param {HTMLElement} target 触发元素。
     * @returns {Promise<void>}
     */
    async removeHandlerResult(event, target) {
        if (!game.user.isGM || !this.isEdit) return;
        const handlerId = target?.dataset?.handlerId;
        const resultIndex = Number(target?.dataset?.resultIndex);
        if (!handlerId || Number.isNaN(resultIndex)) return;
        const activeActor = this.#getActiveActor();
        if (!activeActor) return;
        const handlers = await this.getActorHandlers(activeActor.id);
        const handler = handlers.find((h) => h.id === handlerId);
        if (!handler) return;
        handler.results ??= [];
        handler.results.splice(resultIndex, 1);
        await this.saveActorHandlers(activeActor.id, handlers);
        await this.render(true);
    }

    /**
     * 判断当前用户是否可编辑处理对象。
     * @param {HandlerInstanceData} handler 处理对象。
     * @param {Actor} [actor=this.#getActiveActor()] 当前角色。
     * @returns {boolean}
     */
    #canEditHandler(handler, actor = this.#getActiveActor()) {
        return !!actor?.isOwner;
    }

    /**
     * 判断当前用户是否可推进处理对象。
     * @param {HandlerInstanceData} handler 处理对象。
     * @param {Actor} [actor=this.#getActiveActor()] 当前角色。
     * @returns {boolean}
     */
    #canOperateHandler(handler, actor = this.#getActiveActor()) {
        return !!actor?.isOwner && !handler?.completed;
    }

    /**
     * 按配置的比较运算符判定掷骰是否成功。
     * @param {number} total 掷骰总值。
     * @param {number} dc 目标难度。
     * @param {string[]} [comparisons=[]] 比较运算符数组。
     * @returns {boolean}
     */
    #evaluateComparison(total, dc, comparisons = []) {
        if (!Array.isArray(comparisons) || comparisons.length === 0) comparisons = ["ge"];
        const tests = { gt: (t, d) => t > d, ge: (t, d) => t >= d, eq: (t, d) => t === d, le: (t, d) => t <= d, lt: (t, d) => t < d };
        return comparisons.some((c) => tests[c]?.(total, dc));
    }

    /**
     * 新增类别（角色或模板分类）。
     * @param {"actors"|"templates"} type 分类类型。
     * @returns {Promise<void>}
     */
    async addCategory(type) {
        if (!(type === "actors" || type === "templates")) return;
        const defaultData = {
            name: game.i18n.localize(`${MODULE_ID}.craft-panel.new-category`),
            icon: "icons/svg/barrel.svg",
            requirements: new Set(),
            "requirements-name": "",
            "requirements-script": "",
            "requirements-player-character": false,
            "requirements-uuid": new Set(),
        };

        const fb = new FormBuilder()
            .object(defaultData)
            .title(game.i18n.localize(`${MODULE_ID}.craft-panel.new-category`))
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "icon", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) });

        if (type === "actors") {
            fb.tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-requirements-tab`) })
                .multiSelect({
                    name: "requirements",
                    label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements`),
                    options: {
                        name: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-name`),
                        uuid: "UUID",
                        "player-character": game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character`),
                        script: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-script`),
                    },
                })
                .text({ name: "requirements-name", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-name-hint`) })
                .uuid({ name: "requirements-uuid", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-uuid`), type: "Actor", multiple: true, hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-uuid-hint`) })
                .checkbox({ name: "requirements-player-character", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character-hint`) })
                .script({ name: "requirements-script", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-script-hint`) });
        }

        const data = await fb.render();
        if (!data) return;

        const row = { name: data.name, icon: data.icon || "icons/svg/daze.svg" };
        if (type === "actors") {
            row.requirements = Array.from(data.requirements ?? []);
            row["requirements-name"] = data["requirements-name"] ?? "";
            row["requirements-uuid"] = Array.from(data["requirements-uuid"] ?? []);
            row["requirements-script"] = data["requirements-script"] ?? "";
            row["requirements-player-character"] = !!data["requirements-player-character"];
        }

        const flagKey = type === "actors" ? "handler-actor-categories" : "handler-template-categories";
        const rows = this.journalEntry.getFlag(MODULE_ID, flagKey) ?? [];
        rows.push(row);
        await this.journalEntry.setFlag(MODULE_ID, flagKey, rows);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 编辑指定类别（支持删除）。
     * @param {string} categoryId 类别 ID。
     * @param {"actors"|"templates"} type 分类类型。
     * @returns {Promise<void>}
     */
    async editCategory(categoryId, type) {
        if (categoryId === "all" || categoryId === "add") return;
        const flagKey = type === "actors" ? "handler-actor-categories" : "handler-template-categories";
        const rows = this.journalEntry.getFlag(MODULE_ID, flagKey) ?? [];
        const index = rows.findIndex((r) => r.name === categoryId);
        if (index < 0) return;

        let needDelete = false;
        const row = rows[index];
        const fb = new FormBuilder()
            .object({ ...row, requirements: new Set(row.requirements ?? []), "requirements-uuid": new Set(row["requirements-uuid"] ?? []) })
            .title(game.i18n.localize(`${MODULE_ID}.craft-panel.edit-category`) + ": " + row.name)
            .tab({ id: "general", icon: "fas fa-cog", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-general-tab`) })
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "icon", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })
            .button({
                label: game.i18n.localize("Delete"),
                icon: "fas fa-trash",
                callback: async () => {
                    needDelete = true;
                    fb.form().close();
                },
            });

        if (type === "actors") {
            fb.tab({ id: "requirements", icon: "fas fa-list-check", label: game.i18n.localize(`${MODULE_ID}.craft-panel.configure-requirements-tab`) })
                .multiSelect({
                    name: "requirements",
                    label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements`),
                    options: {
                        name: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-name`),
                        uuid: "UUID",
                        "player-character": game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character`),
                        script: game.i18n.localize(`${MODULE_ID}.craft-panel.requirements-script`),
                    },
                })
                .text({ name: "requirements-name", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-name`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-name-hint`) })
                .uuid({ name: "requirements-uuid", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-uuid`), type: "Actor", multiple: true, hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-uuid-hint`) })
                .checkbox({ name: "requirements-player-character", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-player-character-hint`) })
                .script({ name: "requirements-script", label: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-script`), hint: game.i18n.localize(`${MODULE_ID}.craft-panel-handler.actor-requirements-script-hint`) });
        }

        const data = await fb.render();
        if (needDelete) {
            rows.splice(index, 1);
            await this.journalEntry.setFlag(MODULE_ID, flagKey, rows);
            this.needRefresh = true;
            await this.render(true);
            return;
        }
        if (!data) return;

        const updated = { name: data.name, icon: data.icon || "icons/svg/daze.svg" };
        if (type === "actors") {
            updated.requirements = Array.from(data.requirements ?? []);
            updated["requirements-name"] = data["requirements-name"] ?? "";
            updated["requirements-uuid"] = Array.from(data["requirements-uuid"] ?? []);
            updated["requirements-script"] = data["requirements-script"] ?? "";
            updated["requirements-player-character"] = !!data["requirements-player-character"];
        }

        rows[index] = updated;
        await this.journalEntry.setFlag(MODULE_ID, flagKey, rows);
        this.needRefresh = true;
        await this.render(true);
    }

    /**
     * 切换当前选中类别。
     * @param {string} categoryId 类别 ID。
     * @param {"actors"|"handlers"|"templates"} type 分类类型。
     * @returns {Promise<void>}
     */
    async changeCategory(categoryId, type) {
        if (!this.categories[type]) return;
        this.category[type] = categoryId;
        this.categories[type].forEach((c) => { c.choosed = c.id === categoryId; });
        this.needRefresh = type !== "handlers";
        await this.render(true);
    }

    /**
     * 切换编辑/使用模式（仅 GM）。
     * @param {Event} event 触发事件。
     * @returns {Promise<void>}
     */
    async toggleEdit(event) {
        event.preventDefault();
        if (!game.user.isGM) return;
        this.mode = this.isEdit ? "use" : "edit";
        this.window.title.textContent = this.title;
        this.needRefresh = true;
        await this.render(true);
    }
}
