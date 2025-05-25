import { confirmDialog, HandlebarsApplication, waitFor, MODULE_ID, debug } from "../utils.js";

export class ChooseImage extends HandlebarsApplication {
    constructor(images, mode = "edit", options = {}) {
        super();
        this.mode = mode;
        this.panelOptions = options;
        /**
         * @type {string[] | {src: string, name: string}[]}
         */
        this.images = images ?? [];
        /**
         * @type {number[]}
         */
        this.choosedImages = [];

        this.cols = options.cols ?? 6;
        this.maxChoose = options.max ?? 1;
        this.cancelled = true;

        if (options.choosed ?? false) {
            let choosed = options.choosed;
            if (!Array.isArray(options.choosed)) {
                choosed = [options.choosed];
            }
            for (let c of choosed) {
                if (typeof c === "number" && this.images[c]) {
                    this.choosedImages.push(c);
                }
                let index = this.images.findIndex(i => i?.src === c);
                if (index === -1) {
                    index = this.images.findIndex(i => i === c);
                }
                if (index === -1) {
                    index = this.images.findIndex(i => i?.name === c);
                }
                if (index !== -1) {
                    this.choosedImages.push(index);
                }
            }
        }

        this.scrollPositions = 0;

        craftPanels ??= [];
        craftPanels.push(this);
        debug("ChooseImage constructor: this images mode options", this, images, mode, options);
    }

    static get DEFAULT_OPTIONS() {
        return {
            classes: [this.APP_ID],
            tag: "div",
            window: {
                frame: true,
                positioned: true,
                title: `${MODULE_ID}.${this.APP_ID}.title`,
                icon: "",
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

    get isEdit() {
        return this.mode === "edit";
    }

    refreshImages() {
        debug("ChooseImage refreshImages: this.images", this.images);
        let images = this.images.map((image, i) => {
            if (typeof image === "string") {
                return {
                    src: image,
                    name: image,
                    index: i,
                };
            } else {
                return {
                    src: image.src,
                    name: image.name,
                    index: i,
                };
            }
        });
        if (this.isEdit) {
            images.push({
                src: "modules/craftpanel/img/svgs/health-normal.svg",
                name: game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.add-image`),
                index: images.length,
            });
        } else {
            images.forEach(image => {
                image.choosed = "";
            });
        }
        this.showImages = images;
        debug("ChooseImage refreshImages: this.showImages", this.showImages);
        return images;
    }

    /**
     * 准备界面所需的各项数据
     * @returns {}
     */
    async _prepareContext(options) {
        let images = this.showImages ?? this.refreshImages();
        debug("ChooseImage _prepareContext: images", images);
        if (!this.isEdit) {
            for (let image of images) {
                image.choosed = this.choosedImages.includes(image.index) ? "selected" : "";
                if (image.name == game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.add-image`)) {
                    image.choosed = "";
                }
            }
        }
        // for (let index of this.choosedImages) {
        //     images[index].choosed = "selected";
        // }

        return {
            images,
            cols: this.cols,
            isEdit: this.isEdit,
        };
    }

    /**
     * 绑定各项元素的互动效果
     * @returns {}
     */
    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        debug("ChooseImage _onRender: context", context);
        // 恢复滚动条位置
        html.querySelector(".choose-image-panel").scrollTop = this.scrollPositions;

        html.querySelector("button[name='cancel']").addEventListener("click", async (event) => {
            event.preventDefault();
            this.close();
        });
        html.querySelector("button[name='confirm']").addEventListener("click", async (event) => {
            event.preventDefault();
            this.confirm();
        });

        html.querySelectorAll(".choose-image-slot").forEach(image => {
            image.addEventListener("click", (event) => {
                this._onClick(event);
            });

            if (this.isEdit) {
                image.addEventListener("contextmenu", (event) => {
                    this._onRightClick(event);
                });
                image.addEventListener("dragstart", (event) => {
                    event.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({
                            type: "ChooseImage",
                            index: image.dataset.index,
                            url: image.dataset.src,
                        }),
                    );
                });
                image.addEventListener("drop", this._onDrop.bind(this));
            }
        });
        if (this.isEdit) {
            html.querySelector(".choose-image-panel").addEventListener("drop", this._onDrop.bind(this));
        }
        //滚动事件，记录滚动位置
        html.querySelector(".choose-image-panel").addEventListener("scrollend", (event) => { this.scrollPositions = event.target.scrollTop; });
        debug("ChooseImage _onRender: html", html);
    }

    async _onClick(event) {
        const slot = event.currentTarget;
        const index = parseInt(slot.dataset.index);
        //const src = slot.dataset.src;
        debug("ChooseImage _onClick: index slot", index, slot);
        if (this.isEdit) {
            if (index == this.showImages.length - 1) {
                this.addImage();
            } else {
                this.editImage(index);
            }
        } else {
            if (this.choosedImages.includes(index)) {
                this.choosedImages.splice(this.choosedImages.indexOf(index), 1);
            } else if (this.choosedImages.length < this.maxChoose) {
                this.choosedImages.push(index);
            } else if (this.maxChoose === 1) {
                this.choosedImages = [index];
            } else {
                return;
            }
            this.render();
        }
    }
    async _onRightClick(event) {
        const slot = event.currentTarget;
        const index = parseInt(slot.dataset.index);
        debug("ChooseImage _onRightClick: index slot", index, slot);
        let confirm = await confirmDialog(`${MODULE_ID}.${this.APP_ID}.delete-confirm-title`, `${MODULE_ID}.${this.APP_ID}.delete-confirm-info`, `${MODULE_ID}.yes`, `${MODULE_ID}.no`);
        if (confirm) {
            this.showImages.splice(index, 1);
            this.render();
        }
    }
    async _onDrop(event) {
        event.stopPropagation();
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch (e) {
            return;
        }
        debug("ChooseImage _onDrop: data", data);
        if (data.type !== "ChooseImage") return;
        if (this.showImages.length <= 2) return;
        let targetData = event.currentTarget?.dataset ?? {};
        const dragIndex = data.index;
        const dropIndex = targetData.index;
        if (this.showImages[dragIndex] === undefined || this.showImages[dragIndex].name == game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.add-image`)) {
            return;
        }
        if (dragIndex !== dropIndex) {
            if (dropIndex === undefined) {
                if (dragIndex >= this.showImages.length - 2) {
                    let arr = this.showImages.splice(dragIndex, 1);
                    this.showImages.unshift(...arr);
                } else {
                    let arr = this.showImages.splice(dragIndex, 1);
                    let add = this.showImages.pop();
                    this.showImages.push(...arr);
                    this.showImages.push(add);
                }
            } else {
                if (dragIndex > dropIndex) {
                    let arr = this.showImages.splice(dragIndex, 1);
                    this.showImages.splice(dropIndex, 0, ...arr);
                } else if (dropIndex == this.showImages.length - 1) {
                    let arr = this.showImages.splice(dragIndex, 1);
                    let add = this.showImages.pop();
                    this.showImages.push(...arr);
                    this.showImages.push(add);
                } else {
                    let arr = this.showImages.splice(dragIndex, 1);
                    this.showImages.splice(dropIndex, 0, ...arr);
                }
            }
            this.showImages.forEach((image, index) => {
                image.index = index;
            });
            this.render();
        }
    }

    async addImage() {
        const fb = new Portal.FormBuilder()
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.add-image`))
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "src", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })

        const data = await fb.render();
        if (!data) return;
        let add = this.showImages.pop();
        data.index = this.showImages.length;
        this.showImages.push(data);
        add.index = this.showImages.length;
        this.showImages.push(add);
        this.render();
    }
    async editImage(index) {
        const image = this.showImages[index];
        const fb = new Portal.FormBuilder()
            .object(image)
            .title(game.i18n.localize(`${MODULE_ID}.${this.APP_ID}.edit-image`))
            .text({ name: "name", label: game.i18n.localize(`${MODULE_ID}.name`) })
            .file({ name: "src", type: "image", label: game.i18n.localize(`${MODULE_ID}.image`) })

        const data = await fb.render();
        if (!data) return;
        this.showImages[index] = data;
        this.render();
    }

    _onClose(options) {
        this.inFlight = false;
        super._onClose(options);
        craftPanels ??= [];
        craftPanels.splice(craftPanels.indexOf(this), 1);
    }

    confirm() {
        this.cancelled = false;
        this.close();
    }
    async drawPreview() {
        this.inFlight = true;
        await this.render(true);
        await waitFor(() => !this.inFlight, -1);

        let result;
        if (this.cancelled) {
            result = false;
        } else if (this.isEdit) {
            result = this.showImages.filter((image, i) => (i < this.showImages.length - 1)).map(image => {
                delete image.index;
                return image;
            });
        } else {
            result = this.images.filter((image, i) => {
                return this.choosedImages.includes(i);
            });
        }
        return result;
    }
}