const { remote } = require('webdriverio');

const capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'Android Device',
    'appium:appPackage': 'com.zhiliaoapp.musically',
    'appium:appActivity': 'com.ss.android.ugc.aweme.splash.SplashActivity',
    'appium:noReset': true
};

async function inspect() {
    const driver = await remote({
        hostname: 'localhost',
        port: 4723,
        capabilities
    });

    console.log('🔍 Pobieram strukturę ekranu...');
    // Pobierz wszystkie elementy, które mają ID lub opis
    const elements = await driver.$$('//*');

    for (const el of elements) {
        try {
            const id = await el.getAttribute('resource-id');
            const text = await el.getAttribute('text');
            const desc = await el.getAttribute('content-desc');

            if (id || text || desc) {
                console.log(`ID: ${id} | Text: ${text} | Desc: ${desc}`);
            }
        } catch (e) {}
    }

    await driver.deleteSession();
}

inspect();
