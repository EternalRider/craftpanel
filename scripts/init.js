const MODULE_ID = 'craftpanel';
import * as api from './api.js';
import { register_settings } from './settings.js';
// import CraftSocket from './socket.js';

Hooks.once('init', function () {
    game.modules.get(MODULE_ID).api = api; // 之后可被如此调用: const craftpanel = game.modules.get('craftpanel')?.api;
    window.craftPanels = [];
    register_settings();

    console.log('Craftpanel | Initializing Craftpanel');
});

// Hooks.once("socketlib.ready", () => {
//     SpellBookSocket.initialize();
// });
// Hooks.once("socketlib.ready", () => {
//     CraftSocket.initialize();
// });

Hooks.on('ready', () => {
    Handlebars.registerHelper('range', function (start, end) {
        let array = [];
        for (let i = start; i < end; i++) {
            array.push(i);
        }
        return array;
    });
    Handlebars.registerHelper('equal', function (a, b) {
        return a == b;
    });
    Handlebars.registerHelper('exist', function (a, b) {
        return a ?? b;
    });

    console.log('Craftpanel | Ready');
});

// Hooks.on("renderSidebarTab", (app, html) => {
//     if (!(app instanceof ItemDirectory)) return;
//     const buttonContainer = html[0].querySelector(".header-actions.action-buttons");
//     const button = document.createElement("button");
//     button.classList.add(`${MODULE_ID}-open-panel-manager`);
//     button.innerHTML = `<i class="fas fa-book"></i> ${game.i18n.localize(`${MODULE_ID}.openCraftPanelManager`)}`;
//     button.onclick = () => {
//         if (game.user.isGM) {
//             api.openCraftPanelManager();
//         } else {
//             api.selectCraftPanel();
//         }
//     }
//     buttonContainer.appendChild(button);
// })
Hooks.on("renderItemDirectory", (app, html) => {
    //检查版本为v12还是v13
    let buttonContainer;
    if (game.version.startsWith("12")) {
        buttonContainer = html[0].querySelector(".header-actions.action-buttons");
    } else if (game.version.startsWith("13")) {
        buttonContainer = html.querySelector(".header-actions.action-buttons");
    }
    // const buttonContainer = html.querySelector(".header-actions.action-buttons");
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add(`${MODULE_ID}-open-panel-manager`);
    button.innerHTML = `<i class="fas fa-book"></i> ${game.i18n.localize(`${MODULE_ID}.openCraftPanelManager`)}`;
    button.onclick = () => {
        if (game.user.isGM) {
            api.openCraftPanelManager();
        } else {
            api.selectCraftPanel();
        }
    }
    buttonContainer.appendChild(button);
})