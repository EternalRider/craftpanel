import { debug } from "./utils";

export default class CraftSocket {

  static _socket;

  static BINDINGS = {
    ["updateDocument"]: (...args) => updateDocument(...args),
  }

  static initialize() {
    this._socket = socketlib.registerModule("craftpanel");
    for (let [key, callback] of Object.entries(this.BINDINGS)) {
      this._socket.register(key, callback);
      debug(`Registered CraftSocket: ${key}`);
    }
    debug("Registered all Craftpanel sockets")
  }

  static async executeAsGM(handler, ...args) {
    return await this._socket.executeAsGM(handler, ...args);
  }

  static async executeAsUser(handler, userId, ...args) {
    return await this._socket.executeAsUser(handler, userId, ...args);
  }

  static async executeForAllGMs(handler, ...args) {
    return await this._socket.executeForAllGMs(handler, ...args);
  }

  static async executeForOtherGMs(handler, ...args) {
    return await this._socket.executeForOtherGMs(handler, ...args);
  }

  static async executeForEveryone(handler, ...args) {
    return await this._socket.executeForEveryone(handler, ...args);
  }

  static async executeForOthers(handler, ...args) {
    return await this._socket.executeForOthers(handler, ...args);
  }

  static async executeForUsers(handler, userIds, ...args) {
    return await this._socket.executeForUsers(handler, userIds, ...args);
  }

  static callHook(hook, ...args) {
    if (!Helpers.hooks.run) return;
    return this._socket.executeForEveryone("callHook", hook, ...args);
  }

  static callHookForUsers(hook, users, ...args) {
    if (!Helpers.hooks.run) return;
    return this._socket.executeForUsers("callHook", users, hook, ...args);
  }

}

async function updateDocument(uuid, data, options = {}) {
  const document = await fromUuid(uuid);
  debug("updateDocument", document, data, options, uuid);
  if (!document) return false;
  const res = await document.update(data, options);
  return res;
}
