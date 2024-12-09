const MODULE_ID = 'craftpanel';

import * as Utilities from './utils.js';
import * as api from './api.js';
import { register_settings } from './settings.js';

Hooks.once('init', function () {
    game.modules.get(MODULE_ID).api = api; // 之后可被如此调用: const craftpanel = game.modules.get('craftpanel')?.api;
    window.craftPanels = [];

    console.log('Craftpanel | Initializing Craftpanel');
});

// Hooks.once("socketlib.ready", () => {
//     SpellBookSocket.initialize();
// });

Hooks.on('ready', () => {
    register_settings();

    Handlebars.registerHelper('range', function (start, end) {
        let array = [];
        for (let i = start; i < end; i++) {
            array.push(i);
        }
        return array;
    });

    console.log('Craftpanel | Ready');
});

Hooks.on("renderSidebarTab", (app, html) => {
    if (!(app instanceof ItemDirectory)) return;
    const buttonContainer = html[0].querySelector(".header-actions.action-buttons");
    const button = document.createElement("button");
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