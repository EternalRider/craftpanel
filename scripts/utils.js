// import * as CONST from './constants.js'
export const MODULE_ID = 'craftpanel';
export class HandlebarsApplication extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) { };

/**
 * debug输出信息函数
 */
export function debug(...args) {
  if (game.settings.get(MODULE_ID, "debug")) {
    console.log(`---------------${MODULE_ID}--------------`);
    args.forEach(arg => console.log(arg));
    console.log(`---------------${MODULE_ID}--------------`);
  }
}
/**
 * 向当前用户弹出消息提示，类型可以为info、warn或error（默认）
 * @param {"warn" | "info" | "error"} type - 通知类型
 * @param {string} message - 通知内容
 * @returns {string} - 通知内容
 */
export async function notice(type, message) {
  switch (type) {
    case "warn": // 如果通知类型为警告
      ui.notifications.warn(message); // 调用UI组件的警告通知方法
      break;
    case "info": // 如果通知类型为信息
      ui.notifications.info(message); // 调用UI组件的信息通知方法
      break;
    default: // 如果通知类型为错误
      ui.notifications.error(message); // 调用UI组件的错误通知方法
      break;
  }
  return message; // 返回通知内容
}

/**
 * 获得物品的颜色-目前依赖rarity-colors这个mod
 * @param {Item} item 物品
 * @returns {string} 颜色
 */
export function getItemColor(item) {
  return game.modules.get("rarity-colors")?.api?.getColorFromItem(item) ?? "";
}
/**
 * 确认对话框
 * @param {string} title - 标题
 * @param {string} info - 内容
 * @param {string} yes 是的文本
 * @param {string} no 否的文本
 * @returns {Promise<boolean>} - 是否确认
 */
export async function confirmDialog(title, info = "", yes = "yes", no = "no") {
  let result = false;
  const fb = new Portal.FormBuilder()
    .title(game.i18n.localize(title))
    .info(game.i18n.localize(info))
    .submitButton({ enabled: false })
    .button({
      label: game.i18n.localize(yes),
      callback: () => {
        fb.form().close();
        result = true;
      },
    })
    .button({
      label: game.i18n.localize(no),
      callback: () => {
        fb.form().close();
        result = false;
      },
    });
  await fb.render();
  return result;
}