import { CraftPanelBlend } from "./function/craftPanelBlend.js";
import { CraftPanelManager } from "./function/craftPanelManager.js";
import { MODULE_ID, debug } from "./utils.js";

const craftPanelsTypes = ["blend"];
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
    const fb = new Portal.FormBuilder()
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
            const openWindow = craftPanels?.find((w) => (w instanceof CraftPanelBlend));
            if (openWindow) openWindow.close();
            else {
                result = new CraftPanelBlend(options.panel, options?.options ?? "craft", options);
                result.render(true);
            };
        }
    }
    return result;
}