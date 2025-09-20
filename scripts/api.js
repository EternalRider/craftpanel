import { CraftPanelBlend } from "./function/craftPanelBlend.js";
import { CraftPanelManager } from "./function/craftPanelManager.js";
import { MODULE_ID, debug } from "./utils.js";
import { ChooseImage } from "./function/choose-image.js";
import { CraftPanelCook } from "./function/craftPanelCook.js";
import { CraftPanelForge } from "./function/craftPanelForge.js";
import { CraftPanelEnchant } from "./function/craftPanelEnchant.js";
import { FormBuilder } from "./function/formBuilder.js";

const craftPanelsTypes = ["blend", "cook", "forge", "enchant"];
/**
 * 打开编辑所有制造面板的界面
 */
export async function openCraftPanelManager() {
    const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelManager));
    if (openWindow) openWindow.close();
    else new CraftPanelManager().render(true);
}

/**
 * 显示并选择所有具有权限的制造面板
 */
export async function selectCraftPanel() {
    const craftPanels = game.journal.filter(j => j.getFlag(MODULE_ID, "isCraftPanel") && (j?.ownership[game.user.id] >= 2 && craftPanelsTypes.includes(j.getFlag(MODULE_ID, "type")))).sort((a, b) => a.sort - b.sort);
    const selectOptions = {};
    craftPanels.forEach(j => {
        selectOptions[j.uuid] = j.name;
    });
    //const fb = new Portal.FormBuilder()
    const fb = new FormBuilder()
        .title(game.i18n.localize(`${MODULE_ID}.select-craft-panel`))
        .select({ name: "craftPanel", label: game.i18n.localize(`${MODULE_ID}.craft-panel`), options: selectOptions });
    const data = await fb.render();
    if (!data) return;
    let craftPanel = await fromUuid(data.craftPanel);
    let actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
    let options = {
        panel: craftPanel,
        actor: actor,
        mode: "craft"
    }
    return openCraftPanel(options);
}

/**
 * 打开制造面板界面
 * @param {Object} options - 选项
 * @param {JournalEntry} options.panel - 制造面板
 * @param {string} options.mode - 打开模式，craft为制造，edit为编辑
 * @param {Actor} options.actor - 使用制造面板的角色
 * @returns {CraftPanelBlend} - 制造面板
 */
export function openCraftPanel(options = {}) {
    let result;
    if (options.panel) {
        if (options.panel.getFlag(MODULE_ID, "type") === "blend") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelBlend) && (w.journalEntry.id === options.panel.id));
            if (openWindow) openWindow.close();
            else {
                result = new CraftPanelBlend(options.panel, options?.options ?? "craft", options);
                result.render(true);
            };
        } else if (options.panel.getFlag(MODULE_ID, "type") === "cook") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelCook) && (w.journalEntry.id === options.panel.id));
            if (openWindow) openWindow.close();
            else {
                result = new CraftPanelCook(options.panel, options?.options ?? "craft", options);
                result.render(true);
            };
        } else if (options.panel.getFlag(MODULE_ID, "type") === "forge") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelForge) && (w.journalEntry.id === options.panel.id));
            if (openWindow) openWindow.close();
            else {
                result = new CraftPanelForge(options.panel, options?.options ?? "craft", options);
                result.render(true);
            };
        } else if (options.panel.getFlag(MODULE_ID, "type") === "enchant") {
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelEnchant) && (w.journalEntry.id === options.panel.id));
            if (openWindow) openWindow.close();
            else {
                result = new CraftPanelEnchant(options.panel, options?.options ?? "craft", options);
                result.render(true);
            };
        };
    }
    return result;
}

/**
 * 选择图片
 * @param {string[] | {src: string, name: string}[]} images 选择的图片
 * @param {"edit" | "choose"} mode 模式
 * @param {Object} options 其他选项
 * @returns {Promise<string[] | {src: string, name: string}[] | false>}
 */
export async function chooseImage(images = [], mode = "choose", options = {}) {
    let app = new ChooseImage(images, mode, options);
    let result = await app.drawPreview(true);
    debug("chooseImage", result, app);
    return result;
}