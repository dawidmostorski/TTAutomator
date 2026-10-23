/**
 * Test wykrywania i ucieczki z menu dodawania TikToka
 * Uruchom: node test_add_menu.js --udid YOUR_DEVICE_ID
 */

const { remote } = require('webdriverio');
const { exec, execSync } = require('child_process');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// Pobierz UDID z argumentów
const getArg = (argName) => {
    const idx = process.argv.indexOf(argName);
    return idx !== -1 ? process.argv[idx + 1] : null;
};

// Automatyczne przydzielanie portu
const getConnectedDevices = () => {
    try {
        const output = execSync('adb devices', { encoding: 'utf8' });
        const lines = output.split('\n').slice(1);
        const devices = [];
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && parts[1] === 'device') {
                devices.push(parts[0]);
            }
        }
        return devices;
    } catch (e) {
        return [];
    }
};

const connectedDevices = getConnectedDevices();
const DEVICE_UDID = getArg('--udid') || process.env.APPIUM_DEVICE_ID ||
    (connectedDevices.length === 1 ? connectedDevices[0] : null);
if (!DEVICE_UDID) {
    console.error('Podaj --udid YOUR_DEVICE_ID lub APPIUM_DEVICE_ID w .env.');
    process.exit(1);
}

const getAutoPort = (udid, basePort = 8200) => {
    const devices = getConnectedDevices();
    const index = devices.indexOf(udid);
    return index === -1 ? basePort : basePort + index;
};

const SYSTEM_PORT = getAutoPort(DEVICE_UDID);

console.log(`\n🧪 TEST: Wykrywanie menu dodawania TikToka`);
console.log(`📱 Urządzenie: ${DEVICE_UDID}`);
console.log(`🔌 Port: ${SYSTEM_PORT}\n`);

const capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': DEVICE_UDID,
    'appium:udid': DEVICE_UDID,
    'appium:appPackage': 'com.zhiliaoapp.musically',
    'appium:appActivity': 'com.ss.android.ugc.aweme.splash.SplashActivity',
    'appium:noReset': true,
    'appium:newCommandTimeout': 300,
    'appium:systemPort': SYSTEM_PORT
};

const wdOpts = {
    hostname: 'localhost',
    port: 4723,
    logLevel: 'error',
    capabilities,
};

class AddMenuTester {
    constructor() {
        this.driver = null;
        this.udid = DEVICE_UDID;
        this.windowSize = { width: 1080, height: 2400 };
    }

    async adbExec(command) {
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell ${command}`, (error, stdout) => {
                resolve(stdout ? stdout.trim() : null);
            });
        });
    }

    async adbKeyevent(keycode) {
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input keyevent ${keycode}`, () => resolve());
        });
    }

    async adbTapRelative(percentX, percentY) {
        const x = Math.floor(this.windowSize.width * percentX);
        const y = Math.floor(this.windowSize.height * percentY);
        console.log(`   🎯 TAP: ${x}x${y} (${(percentX * 100).toFixed(1)}%, ${(percentY * 100).toFixed(1)}%)`);
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input tap ${x} ${y}`, () => resolve());
        });
    }

    async init() {
        console.log('🚀 Łączenie z urządzeniem przez Appium...');
        this.driver = await remote(wdOpts);
        this.windowSize = await this.driver.getWindowSize();
        console.log(`✅ Połączono. Rozdzielczość: ${this.windowSize.width}x${this.windowSize.height}\n`);
    }

    async checkIfInAddMenu() {
        console.log('🔍 Sprawdzam czy jestem w menu dodawania...\n');

        // NAJPIERW sprawdź czy jesteśmy na feedzie (aby uniknąć false positives)
        console.log('   [0] Szybkie sprawdzenie feedu...');
        let feedIndicators = 0;
        try {
            const desc = await this.driver.$$('id:com.zhiliaoapp.musically:id/desc');
            if (desc && desc.length > 0) feedIndicators++;
            const author = await this.driver.$$('id:com.zhiliaoapp.musically:id/title');
            if (author && author.length > 0) feedIndicators++;
            for (const sel of ['//*[contains(@content-desc, "Główna")]', '//*[contains(@content-desc, "Home")]']) {
                try {
                    const btn = await this.driver.$$(sel);
                    if (btn && btn.length > 0) { feedIndicators++; break; }
                } catch (e) { }
            }
        } catch (e) { }

        if (feedIndicators >= 2) {
            console.log(`       ✅ Wykryto feed (${feedIndicators} wskaźników) - NIE jesteśmy w menu\n`);
            return false;
        }
        console.log(`       Feed: ${feedIndicators} wskaźników (kontynuuję sprawdzanie)\n`);

        // Metoda 1: Activity (szukaj PEŁNYCH nazw klas)
        console.log('   [1] Sprawdzam activity...');
        const currentActivity = await this.adbExec('dumpsys activity activities | grep mResumedActivity');
        if (currentActivity) {
            console.log(`       Activity: ${currentActivity.substring(0, 100)}...`);
            const cameraActivityPatterns = [
                'shootactivity', 'recordactivity', 'cameraactivity',
                'publishactivity', 'postactivity', 'uploadactivity',
                'editactivity', 'shortvideo.ui.shoot', 'record.activity',
                'camera.activity', 'creation.activity', 'draft.activity'
            ];
            const activityLower = currentActivity.toLowerCase();
            for (const pattern of cameraActivityPatterns) {
                if (activityLower.includes(pattern)) {
                    console.log(`       ✅ WYKRYTO: Activity zawiera "${pattern}"\n`);
                    return true;
                }
            }
            console.log('       ❌ Brak wzorców kamery w activity\n');
        }

        // Metoda 2: Elementy kamery
        console.log('   [2] Szukam elementów kamery (PL/EN)...');
        const cameraOnlyElements = [
            ['//*[contains(@content-desc, "Flip")]', 'Flip (EN)'],
            ['//*[contains(@content-desc, "Odwróć")]', 'Odwróć (PL)'],
            ['//*[contains(@content-desc, "Flash")]', 'Flash (EN)'],
            ['//*[contains(@content-desc, "Flesz")]', 'Flesz (PL)'],
            ['//*[contains(@content-desc, "Effects")]', 'Effects (EN)'],
            ['//*[contains(@content-desc, "Efekty")]', 'Efekty (PL)'],
            ['//android.widget.TextView[@text="15s"]', '15s'],
            ['//android.widget.TextView[@text="60s"]', '60s'],
            ['//android.widget.TextView[contains(@text, "Prześlij")]', 'Prześlij (PL)'],
            ['//android.widget.TextView[contains(@text, "Upload")]', 'Upload (EN)'],
            ['//android.widget.TextView[contains(@text, "Dźwięki")]', 'Dźwięki (PL)'],
            ['//android.widget.TextView[contains(@text, "Dodaj dźwięk")]', 'Dodaj dźwięk (PL)'],
        ];

        for (const [selector, name] of cameraOnlyElements) {
            try {
                const elements = await this.driver.$$(selector);
                if (elements && elements.length > 0) {
                    console.log(`       ✅ WYKRYTO: ${name}\n`);
                    return true;
                }
            } catch (e) { }
        }
        console.log('       ❌ Brak elementów kamery\n');

        // Metoda 3: Brak elementów feedu (już sprawdzone na początku, ale double-check)
        console.log('   [3] Brak elementów feedu = prawdopodobnie menu dodawania');
        if (feedIndicators === 0) {
            console.log('       ✅ WYKRYTO: Brak feedu = menu dodawania\n');
            return true;
        }

        console.log('\n📍 WYNIK: NIE jestem w menu dodawania\n');
        return false;
    }

    async checkIfOnMainFeed() {
        console.log('🔍 Sprawdzam czy jestem na głównym feedzie...\n');
        let indicators = 0;

        // 1. Opis
        try {
            const desc = await this.driver.$$('id:com.zhiliaoapp.musically:id/desc');
            if (desc && desc.length > 0) { indicators++; console.log('   ✅ Opis wideo'); }
            else console.log('   ❌ Brak opisu');
        } catch (e) { console.log('   ❌ Brak opisu (błąd)'); }

        // 2. Autor
        try {
            const author = await this.driver.$$('id:com.zhiliaoapp.musically:id/title');
            if (author && author.length > 0) { indicators++; console.log('   ✅ Nazwa autora'); }
            else console.log('   ❌ Brak autora');
        } catch (e) { console.log('   ❌ Brak autora (błąd)'); }

        // 3. Home button
        const homeSelectors = ['//*[contains(@content-desc, "Główna")]', '//*[contains(@content-desc, "Home")]'];
        let hasHome = false;
        for (const sel of homeSelectors) {
            try {
                const btn = await this.driver.$$(sel);
                if (btn && btn.length > 0) { hasHome = true; break; }
            } catch (e) { }
        }
        if (hasHome) { indicators++; console.log('   ✅ Przycisk Główna/Home'); }
        else console.log('   ❌ Brak przycisku Home');

        // 4. Dla Ciebie
        const fySelectors = ['//*[contains(@content-desc, "Dla Ciebie")]', '//*[contains(@content-desc, "For you")]'];
        let hasFY = false;
        for (const sel of fySelectors) {
            try {
                const tab = await this.driver.$$(sel);
                if (tab && tab.length > 0) { hasFY = true; break; }
            } catch (e) { }
        }
        if (hasFY) { indicators++; console.log('   ✅ Zakładka Dla Ciebie/For you'); }
        else console.log('   ❌ Brak zakładki Dla Ciebie');

        const onFeed = indicators >= 2;
        console.log(`\n📍 WYNIK: ${onFeed ? '✅ Na feedzie' : '❌ Nie na feedzie'} (${indicators}/4 wskaźników)\n`);
        return onFeed;
    }

    async escapeFromAddMenu() {
        console.log('🚨 UCIECZKA Z MENU DODAWANIA\n');

        // Próba 1: BACK + popup
        console.log('   [1] Próba: BACK + obsługa popupu...');
        await this.adbKeyevent(4);
        await new Promise(r => setTimeout(r, 2000));
        console.log('       Klikam "Odrzuć" (różne pozycje)...');
        await this.adbTapRelative(0.70, 0.60);
        await new Promise(r => setTimeout(r, 500));
        await this.adbTapRelative(0.50, 0.65);
        await new Promise(r => setTimeout(r, 1500));

        if (!(await this.checkIfInAddMenu())) {
            console.log('✅ Sukces po próbie 1!\n');
            return true;
        }

        // Próba 2: Gest wstecz (swipe od lewej krawędzi)
        console.log('   [2] Próba: Gest wstecz (swipe od lewej)...');
        await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ duration: 0, x: 10, y: Math.floor(this.windowSize.height * 0.5) })
            .down({ button: 0 })
            .pause(50)
            .move({ duration: 200, x: Math.floor(this.windowSize.width * 0.4), y: Math.floor(this.windowSize.height * 0.5) })
            .up({ button: 0 })
            .perform();
        await new Promise(r => setTimeout(r, 2000));
        await this.adbTapRelative(0.50, 0.65);
        await new Promise(r => setTimeout(r, 1500));

        if (!(await this.checkIfInAddMenu())) {
            console.log('✅ Sukces po próbie 2!\n');
            return true;
        }

        // Próba 3: Kolejny BACK
        console.log('   [3] Próba: Kolejny BACK...');
        await this.adbKeyevent(4);
        await new Promise(r => setTimeout(r, 1500));
        await this.adbTapRelative(0.50, 0.65);
        await new Promise(r => setTimeout(r, 1500));

        if (!(await this.checkIfInAddMenu())) {
            console.log('✅ Sukces po próbie 3!\n');
            return true;
        }

        // Próba 4: X w różnych pozycjach
        console.log('   [4] Próba: X w różnych pozycjach...');
        await this.adbTapRelative(0.07, 0.05); // Lewy górny (wyżej)
        await new Promise(r => setTimeout(r, 800));
        await this.adbTapRelative(0.07, 0.10); // Lewy górny (niżej)
        await new Promise(r => setTimeout(r, 800));
        await this.adbTapRelative(0.50, 0.65); // Popup
        await new Promise(r => setTimeout(r, 1500));

        if (!(await this.checkIfInAddMenu())) {
            console.log('✅ Sukces po próbie 4!\n');
            return true;
        }

        // Próba 5: X w lewym dolnym rogu
        console.log('   [5] Próba: X w lewym dolnym (7%, 88%)...');
        await this.adbTapRelative(0.07, 0.88);
        await new Promise(r => setTimeout(r, 1000));
        await this.adbTapRelative(0.50, 0.65);
        await new Promise(r => setTimeout(r, 1500));

        if (!(await this.checkIfInAddMenu())) {
            console.log('✅ Sukces po próbie 5!\n');
            return true;
        }

        // Próba 6: Force stop + restart
        console.log('   [6] Próba: Force stop + restart TikToka...');
        await this.adbExec('am force-stop com.zhiliaoapp.musically');
        await new Promise(r => setTimeout(r, 2000));
        await this.driver.activateApp('com.zhiliaoapp.musically');
        await new Promise(r => setTimeout(r, 5000));

        const escaped = !(await this.checkIfInAddMenu());
        console.log(escaped ? '✅ Sukces po próbie 6!\n' : '❌ Nie udało się uciec z menu!\n');
        return escaped;
    }

    async runTest() {
        try {
            await this.init();

            console.log('═'.repeat(50));
            console.log('FAZA 1: DETEKCJA');
            console.log('═'.repeat(50) + '\n');

            const inAddMenu = await this.checkIfInAddMenu();
            const onFeed = await this.checkIfOnMainFeed();

            console.log('═'.repeat(50));
            console.log('PODSUMOWANIE DETEKCJI');
            console.log('═'.repeat(50));
            console.log(`W menu dodawania: ${inAddMenu ? '✅ TAK' : '❌ NIE'}`);
            console.log(`Na głównym feedzie: ${onFeed ? '✅ TAK' : '❌ NIE'}`);
            console.log('═'.repeat(50) + '\n');

            if (inAddMenu) {
                console.log('═'.repeat(50));
                console.log('FAZA 2: UCIECZKA');
                console.log('═'.repeat(50) + '\n');

                const escaped = await this.escapeFromAddMenu();

                console.log('═'.repeat(50));
                console.log('WERYFIKACJA PO UCIECZCE');
                console.log('═'.repeat(50) + '\n');

                await this.checkIfOnMainFeed();

                console.log('═'.repeat(50));
                console.log(`WYNIK TESTU: ${escaped ? '✅ SUKCES' : '❌ NIEPOWODZENIE'}`);
                console.log('═'.repeat(50) + '\n');
            } else {
                console.log('ℹ️ Urządzenie nie jest w menu dodawania - test ucieczki pominięty.\n');
            }

        } catch (e) {
            console.error('❌ Błąd testu:', e.message);
        } finally {
            if (this.driver) {
                console.log('🔌 Zamykam sesję...');
                await this.driver.deleteSession();
            }
        }
    }
}

const tester = new AddMenuTester();
tester.runTest();
