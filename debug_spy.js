const { remote } = require('webdriverio');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const idxUdid = args.indexOf('--udid');
const UDID = idxUdid !== -1 ? args[idxUdid + 1] : null;

// Konfiguracja (taka sama jak w bot.js)
const capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:appPackage': 'com.zhiliaoapp.musically',
    'appium:appActivity': 'com.ss.android.ugc.aweme.splash.SplashActivity',
    'appium:noReset': true,
    'appium:newCommandTimeout': 3600,
    'appium:forceAppLaunch': false // Nie restartuj apki
};

if (UDID) {
    console.log(`🎯 Targetowanie urządzenia: ${UDID}`);
    capabilities['appium:udid'] = UDID;
}

const wdOpts = {
    hostname: 'localhost',
    port: 4723,
    logLevel: 'error',
    capabilities,
};

async function runSpy() {
    console.log('🕵️ START SPY MODE');
    console.log('Połącz się i wykonuj akcje na telefonie. Skrypt będzie zrzucał XML co 3 sekundy.');

    let driver;
    try {
        driver = await remote(wdOpts);
        console.log('✅ Połączono z Appium.');
    } catch (e) {
        console.error('❌ Nie udało się połączyć. Upewnij się, że Appium server działa! (npm start w gui lub appium w konsoli)');
        console.error(e);
        return;
    }

    let counter = 1;
    const interval = setInterval(async () => {
        try {
            console.log(`📸 Próba zrzutu #${counter}...`);
            const xml = await driver.getPageSource();
            // Opcjonalnie screenshot (może spowolnić, odkomentuj jeśli potrzebne)
            // const screen = await driver.takeScreenshot();

            const filenameMsg = `spy_dump_${counter}.xml`;
            fs.writeFileSync(path.join(__dirname, filenameMsg), xml);
            // fs.writeFileSync(path.join(__dirname, `spy_screen_${counter}.png`), screen, 'base64');

            console.log(`💾 Zapisano: ${filenameMsg}`);
            counter++;
        } catch (e) {
            console.error('⚠️ Błąd zrzutu:', e.message);
        }
    }, 5000); // Co 5 sekund

    // Zakończ po Ctrl+C
    process.on('SIGINT', async () => {
        clearInterval(interval);
        console.log('🛑 Zamykanie sesji Spy...');
        if (driver) await driver.deleteSession();
        process.exit();
    });
}

runSpy();
