// import * as CONST from './constants.js'
export const MODULE_ID = 'craftpanel';
export class HandlebarsApplication extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) { };
import { FormBuilder } from "./function/formBuilder.js";

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
 * 获得物品的颜色-支持用户自定义脚本
 * @param {Item} item 物品
 * @returns {string} 颜色，如"#ff0000"
 */
export function getItemColor(item) {
  // 获取用户自定义脚本
  const script = game.settings.get(MODULE_ID, "customItemColorScript");
  if (script && typeof script === "string" && script.trim().length > 0) {
    try {
      // 构造函数，item为参数
      const fn = new Function("item", script);
      const result = fn(item);
      if (typeof result === "string") return result;
    } catch (e) {
      debug("自定义物品颜色脚本执行出错：", e);
    }
  }
  return "";
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
  //const fb = new Portal.FormBuilder()
  const fb = new FormBuilder()
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

/**
 * 输出内容到聊天窗
 * @param {string} content 输出内容
 * @param {object} options 输出选项
 * @param {string} options.img 图片
 * @param {string} options.title 标题
 * @param {string} options.flavor 描述
 * @param {Roll | Roll[]} options.rolls 投骰结果
 * @param {string | object} options.speaker 聊天窗发言者
 * @param {object} options.user 聊天发出者
 * @param {string} options.language 语言
 * @param {string | string[]} options.content 其他内容，可分段
 * @param {object} others 其他选项
 * @returns {Promise<ChatMessage>}
 */
export async function chatMessage(content, options = {}, others = {}) {
  let message = "";
  let chatData = {};
  if ((options.img ?? false) && (options.title ?? false)) {
    message += `<h2><img style="vertical-align:middle" src=${options.img} width="28" height="28"> ${options.title} </h2>`;
  } else if (options.img ?? false) {
    message += `<h2><img style="vertical-align:middle" src=${options.img} width="28" height="28"></h2>`;
  } else if (options.title ?? false) {
    message += `<h2> ${options.title} </h2>`;
  }
  // if (options.item ?? false) {
  //   message += await getItemCard(options.item);
  // }
  if (content ?? false) {
    if (typeof content == "string") {
      message += content;
    } else if (Array.isArray(content)) {
      for (let i = 0; i < content.length; i++) {
        message = message + "<p>" + content[i] + "</p>";
      }
    }
  }
  if (options.content ?? false) {
    if (typeof options.content == "string") {
      message += options.content;
    } else if (Array.isArray(options.content)) {
      for (let i = 0; i < options.content.length; i++) {
        message = message + "<p>" + options.content[i] + "</p>";
      }
    }
  }
  if (options.rolls ?? false) {
    if (Array.isArray(options.rolls)) {
      chatData.rolls = options.rolls;
    } else {
      chatData.rolls = [options.rolls];
    }
    chatData.type = CONST.CHAT_MESSAGE_TYPES.ROLL;
  }
  if (options.user ?? false) {
    chatData.user = options.user;
  }
  if (options.flavor ?? false) {
    chatData.flavor = options.flavor;
  }
  if (options.speaker ?? false) {
    if (typeof options.speaker == "string") {
      chatData.speaker.alias = options.user;
    } else if (options.speaker == undefined) {
      chatData.speaker.token = options.speaker;
    } else {
      options.speaker.actor = options.speaker;
    }
  }
  if (options.language ?? false) {
    chatData.flags = { polyglot: { language: options.language } };
  }
  chatData.content = message;
  foundry.utils.mergeObject(chatData, others);
  return await ChatMessage.create(chatData, {});
}

/**
 * 异步获取或创建指定名称和类型的文件夹
 * 
 * 该函数首先会检查游戏中的文件夹是否已经存在指定名称和类型的文件夹如果存在，则直接返回该文件夹
 * 如果不存在，则创建一个新的文件夹，并返回新创建的文件夹对象
 * 
 * @param {string} folderName - 文件夹的名称
 * @param {string} folderType - 文件夹的类型
 * @returns {Promise<Object>} 返回一个Promise，解析为指定名称和类型的文件夹对象
 */
export async function getFolder(folderName, folderType) {
  let folder;
  // 检查指定类型的文件夹中是否存在指定名称的文件夹
  if (game.folders.filter(f => f.type === folderType).find(f => f.name === folderName) === undefined) {
    // 如果不存在，则创建新的文件夹
    folder = await Folder.create({
      name: folderName,
      type: folderType
    });
  } else {
    // 如果存在，则直接获取文件夹
    folder = game.folders.find(f => f.name === folderName);
  }
  return folder;
}
/**
 * 获取第一个活跃GM的id
 * @returns {string} - GM的id
 */
export function getActiveGM() {
  let gm = Array.from(game.users).find(u => u.isGM && u.active);
  if (gm) return gm._id;
}

/**
 * 等待直到给定的函数返回true，或者达到最大迭代次数
 * @param {() => boolean} fn 要等待的函数，返回true时停止等待
 * @param {number} maxIter 最大迭代次数
 * @param {number} iterWaitTime 每次迭代的等待时间
 * @param {number} i 迭代次数
 * @returns {Promise<boolean>} 是否等待成功
 */
export async function waitFor(fn, maxIter = 600, iterWaitTime = 100, i = 0) {
  const continueWait = (current, max) => {
    // 负的最大迭代次数表示无限等待
    if (maxIter < 0) return true;
    return current < max;
  }
  while (!fn(i, ((i * iterWaitTime) / 100)) && continueWait(i, maxIter)) {
    // 当函数返回false，并且还未达到最大迭代次数时，执行以下操作
    i++;
    await wait(iterWaitTime);
  }
  // 如果达到最大迭代次数，则返回false，否则返回true
  return i === maxIter ? false : true;
}
/**
 * 异步函数wait，用于等待一定时间。
 * @param {number} ms 等待的时间，以毫秒为单位。
 * @returns {Promise} 返回一个无意义Promise对象。
 */
export async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 构建动态效果，返回动态效果，用于addActiveEffect
 * @param {string} name 效果名称，默认"特殊效果"
 * @param {string} icon 图标路径，默认"icons/svg/mystery-man.svg"
 * @param {change[]} changes 各项实际修改，默认空数组
 * @param {number} duration 持续时间，默认5
 * @param {0|1|2|3} expiration 效果结束时点，回合开始时为1，回合结束时为3，自动结束不弹窗则减去1（0，2），默认3
 * @param {effectmacro} effectmacro 动态效果宏，当动态效果创建、删除、开关等等时刻触发，默认空对象
 * @param {effectcontent} effectcontent 动态效果的描述，适用于Visual Active Effects这个mod，默认空对象
 * @param {string} statusId 状态id，用于标记状态，默认undefined
 * @returns {activeEffectData} 动态效果，用于addActiveEffect
 */
export function buildActiveEffect(name = "特殊效果", icon = "icons/svg/mystery-man.svg", changes = [], duration = 5, expiration = 3, effectmacro = {}, effectcontent = {}, statusId = undefined, type = "base") {
  if (duration == 0 && expiration != null) {
    expiration = null;
  }
  let activeEffect = {
    name: name, icon: icon, changes: changes, duration: { rounds: duration }, flags: { swade: { expiration: expiration }, effectmacro: effectmacro },
    system: {}, type: type
  };
  if (typeof effectcontent == "string") {
    activeEffect.description = effectcontent;
  } else if (effectcontent?.intro != undefined) {
    activeEffect.description = effectcontent.intro;
  } else if (effectcontent?.content != undefined) {
    activeEffect.description = effectcontent.content;
  }
  if (effectcontent?.inclusion != undefined || effectcontent?.alwayShow != undefined) {
    let inclusion = effectcontent.inclusion ?? 0;
    if (effectcontent.alwayShow) {
      inclusion = 1;
    } else if (effectcontent.alwayShow === false) {
      inclusion = -1;
    }
    activeEffect["flags"]["visual-active-effects"] = { data: { inclusion: inclusion } };
  }
  if (statusId) {
    // activeEffect["flags"]["core"] = { statusId: statusId };
    if (!Array.isArray(statusId)) {
      statusId = [statusId];
    }
    activeEffect["statuses"] = statusId;
  }
  return activeEffect;
}

/**
 * 应用变更到指定的项上
 * 此函数根据变更对象中的key和value，对项进行相应的修改
 * @param {Object} item - 需要应用变更的项，通常是一个数据对象
 * @param {Object} change - 变更对象，包含需要修改的key和对应的value
 */
export function applyChange(item, change) {
  // 获取当前项中与变更key对应的值，如果不存在则默认为null
  const current = foundry.utils.getProperty(item, change.key) ?? null;
  // 确定当前值的数据类型
  let targetType = foundry.utils.getType(current);
  // 初始化一个空对象，用于存储所有的更新
  let updates = {};
  // 定义delta变量，用于存储变更的值
  let delta;

  // 尝试将变更的值转换为目标类型
  try {
    if (targetType === "Array") {
      // 如果当前值是数组，确定数组内部元素的类型
      const innerType = current.length ? foundry.utils.getType(current[0]) : "string";
      // 将变更的值转换为数组，并指定内部元素类型
      delta = _castArray(change.value, innerType);
    }
    else {
      // 如果当前值不是数组，直接将其转换为目标类型
      delta = _castDelta(change.value, targetType);
    }
  } catch (err) {
    // 如果转换过程中出现错误，输出警告信息并终止函数执行
    console.warn(`Unable to parse active effect change for ${change.key}: "${change.value}"`);
    return;
  }

  // 获取所有活动效果模式的常量
  const modes = CONST.ACTIVE_EFFECT_MODES;
  // 根据变更的模式，选择相应的应用策略
  switch (change.mode) {
    case modes.ADD:
      // 应用添加模式的变更
      _applyAdd(change, current, delta, updates);
      break;
    case modes.MULTIPLY:
      // 应用乘法模式的变更
      _applyMultiply(change, current, delta, updates);
      break;
    case modes.OVERRIDE:
      // 应用覆盖模式的变更
      _applyOverride(change, current, delta, updates);
      break;
    case modes.UPGRADE:
    case modes.DOWNGRADE:
      // 应用升级或降级模式的变更
      _applyUpgrade(change, current, delta, updates);
      break;
    default:
      // 对于其他模式，目前不执行任何操作
      // _applyCustom(item, change, current, delta, changes);
      break;
  }

  // 将所有变更应用到项的数据上
  foundry.utils.mergeObject(item, updates);
}
/* -------------动态效果--------------- */

/**
 * Cast a raw EffectChangeData change string to the desired data type.
 * @param {string} raw      The raw string value
 * @param {string} type     The target data type that the raw value should be cast to match
 * @returns {*}             The parsed delta cast to the target data type
 */
export function _castDelta(raw, type) {
  let delta;
  switch (type) {
    case "boolean":
      delta = Boolean(_parseOrString(raw));
      break;
    case "number":
      delta = Number.fromString(raw);
      if (Number.isNaN(delta)) delta = 0;
      break;
    case "string":
      delta = String(raw);
      break;
    default:
      delta = _parseOrString(raw);
  }
  return delta;
}
/**
 * Cast a raw EffectChangeData change string to an Array of an inner type.
 * @param {string} raw      The raw string value
 * @param {string} type     The target data type of inner array elements
 * @returns {Array<*>}      The parsed delta cast as a typed array
 */
export function _castArray(raw, type) {
  let delta;
  try {
    delta = _parseOrString(raw);
    delta = delta instanceof Array ? delta : [delta];
  } catch (e) {
    delta = [raw];
  }
  return delta.map(d => _castDelta(d, type));
}
/**
   * Parse serialized JSON, or retain the raw string.
   * @param {string} raw      A raw serialized string
   * @returns {*}             The parsed value, or the original value if parsing failed
   */
export function _parseOrString(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    return raw;
  }
}
/**
   * Apply an ActiveEffect that uses an ADD application mode.
   * The way that effects are added depends on the data type of the current value.
   *
   * If the current value is null, the change value is assigned directly.
   * If the current type is a string, the change value is concatenated.
   * If the current type is a number, the change value is cast to numeric and added.
   * If the current type is an array, the change value is appended to the existing array if it matches in type.
   *
   * @param {EffectChangeData} change       The change data being applied
   * @param {*} current                     The current value being modified
   * @param {*} delta                       The parsed value of the change object
   * @param {object} updates                An object which accumulates changes to be applied
   */
export function _applyAdd(change, current, delta, updates) {
  let update;
  const ct = foundry.utils.getType(current);
  switch (ct) {
    case "boolean":
      update = current || delta;
      break;
    case "null":
      update = delta;
      break;
    case "Array":
      update = current.concat(delta);
      break;
    default:
      update = current + delta;
      break;
  }
  updates[change.key] = update;
}
/**
 * Apply an ActiveEffect that uses a MULTIPLY application mode.
 * Changes which MULTIPLY must be numeric to allow for multiplication.
 * @param {EffectChangeData} change       The change data being applied
 * @param {*} current                     The current value being modified
 * @param {*} delta                       The parsed value of the change object
 * @param {object} updates                An object which accumulates changes to be applied
 */
export function _applyMultiply(change, current, delta, updates) {
  let update;
  const ct = foundry.utils.getType(current);
  switch (ct) {
    case "boolean":
      update = current && delta;
      break;
    case "number":
      update = current * delta;
      break;
  }
  updates[change.key] = update;
}
/**
 * Apply an ActiveEffect that uses an OVERRIDE application mode.
 * Numeric data is overridden by numbers, while other data types are overridden by any value
 * @param {EffectChangeData} change       The change data being applied
 * @param {*} current                     The current value being modified
 * @param {*} delta                       The parsed value of the change object
 * @param {object} updates                An object which accumulates changes to be applied
 */
export function _applyOverride(change, current, delta, updates) {
  return updates[change.key] = delta;
}
/**
 * Apply an ActiveEffect that uses an UPGRADE, or DOWNGRADE application mode.
 * Changes which UPGRADE or DOWNGRADE must be numeric to allow for comparison.
 * @param {EffectChangeData} change       The change data being applied
 * @param {*} current                     The current value being modified
 * @param {*} delta                       The parsed value of the change object
 * @param {object} updates                An object which accumulates changes to be applied
 */
export function _applyUpgrade(change, current, delta, updates) {
  let update;
  const ct = foundry.utils.getType(current);
  switch (ct) {
    case "boolean":
    case "number":
      if ((change.mode === CONST.ACTIVE_EFFECT_MODES.UPGRADE) && (delta > current)) update = delta;
      else if ((change.mode === CONST.ACTIVE_EFFECT_MODES.DOWNGRADE) && (delta < current)) update = delta;
      break;
  }
  updates[change.key] = update;
}
/**
 * 编辑元素配置的选项
 */
export const multiShowOptions = {
  "max": `${MODULE_ID}.edit-element-config.multi-show-max`,
  "min": `${MODULE_ID}.edit-element-config.multi-show-min`,
  "default": `${MODULE_ID}.edit-element-config.multi-show-default`,
};
/**
 * 编辑元素配置的选项
 */
export const multiValueOptions = {
  "only-max": `${MODULE_ID}.edit-element-config.multi-value-only-max`,
  "only-min": `${MODULE_ID}.edit-element-config.multi-value-only-min`,
  "max-plus": `${MODULE_ID}.edit-element-config.multi-value-max-plus`,
  "max-minus": `${MODULE_ID}.edit-element-config.multi-value-max-minus`,
  "min-plus": `${MODULE_ID}.edit-element-config.multi-value-min-plus`,
  "min-minus": `${MODULE_ID}.edit-element-config.multi-value-min-minus`,
  "all": `${MODULE_ID}.edit-element-config.multi-value-all`
};