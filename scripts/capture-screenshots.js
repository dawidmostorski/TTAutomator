// Render the production UI in a separate, hidden Electron window. Only the
// documentation preload is used: no real devices or personal data are loaded.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const output = path.join(root, 'docs', 'assets');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;

async function waitFor(expression) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (await window.webContents.executeJavaScript(expression)) return;
        await pause(100);
    }
    throw new Error('Documentation preview timed out: ' + expression);
}

async function capture(filename, rectangle) {
    await pause(250);
    const image = await window.webContents.capturePage(rectangle);
    fs.writeFileSync(path.join(output, filename), image.toPNG());
    console.log('Saved ' + filename + ' (' + image.getSize().width + ' × ' + image.getSize().height + ')');
}

app.whenReady().then(async () => {
    fs.mkdirSync(output, { recursive: true });
    window = new BrowserWindow({
        width: 1360,
        height: 860,
        useContentSize: true,
        show: false,
        backgroundColor: '#0d0d0d',
        webPreferences: {
            preload: path.join(__dirname, 'screenshot-preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            offscreen: true,
            backgroundThrottling: false
        }
    });
    // Documentation renders are self-contained and do not contact external sites.
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: /^https?:/.test(details.url) });
    });
    await window.loadFile(path.join(root, 'gui', 'index.html'));
    await waitFor('document.querySelectorAll(".device-card").length === 3');
    await capture('dashboard.png');

    await window.webContents.executeJavaScript('document.querySelector(".btn-settings").click()');
    await waitFor('document.getElementById("device-settings-modal").style.display === "flex"');
    const modal = await window.webContents.executeJavaScript(`(() => {
        const bounds = document.querySelector('.modal-content').getBoundingClientRect();
        return { x: Math.floor(bounds.x) - 12, y: Math.floor(bounds.y) - 12,
            width: Math.ceil(bounds.width) + 24, height: Math.ceil(bounds.height) + 24 };
    })()`);
    await capture('device-settings.png', modal);

    await window.webContents.executeJavaScript(`
        document.getElementById('modal-close').click();
        document.querySelector('[data-page="upload"]').click();
        document.getElementById('upload-device').value = 'DEMO-01';
        document.getElementById('btn-select-folder').click();
    `);
    await waitFor('document.getElementById("upload-queue").textContent.includes("03-city-walk.mp4")');
    await capture('publishing.png');
    console.log('Documentation screenshots use demo data. No device actions were run.');
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    if (window && !window.isDestroyed()) window.destroy();
    app.quit();
});
