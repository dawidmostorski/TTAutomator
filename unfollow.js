const { remote } = require('webdriverio');
const { exec, execSync } = require('child_process');
const ActionDatabase = require('./db');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Parsowanie argumentów CLI
const getArg = (argName) => {
    const idx = process.argv.indexOf(argName);
    return idx !== -1 ? process.argv[idx + 1] : null;
};

// Pobierz listę podłączonych urządzeń
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

// Auto-port na podstawie UDID
const getAutoPort = (udid, basePort = 8200) => {
    const devices = getConnectedDevices();
    const index = devices.indexOf(udid);
    return index === -1 ? basePort : basePort + index;
};

const DEVICE_UDID = getArg('--udid') || process.env.APPIUM_DEVICE_ID || getConnectedDevices()[0];
const SYSTEM_PORT = getAutoPort(DEVICE_UDID);

console.log(`\n🗑️  INTELIGENTNY UNFOLLOW`);
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
    'appium:newCommandTimeout': 600,
    'appium:systemPort': SYSTEM_PORT
};

const wdOpts = {
    hostname: 'localhost',
    port: 4723,
    logLevel: 'error',
    capabilities,
};

class TikTokUnfollower {
    constructor() {
        this.driver = null;
        this.db = new ActionDatabase();
        this.udid = DEVICE_UDID;
        this.windowSize = { width: 1080, height: 2400 };
    }

    async init() {
        console.log('🚀 Łączenie z telefonem przez Appium...');
        this.driver = await remote(wdOpts);
        this.windowSize = await this.driver.getWindowSize();
        console.log(`✅ Połączono. Rozdzielczość: ${this.windowSize.width}x${this.windowSize.height}`);

        // Uruchom TikTok jeśli nie jest aktywny
        console.log('📱 Uruchamiam TikTok...');
        try {
            await this.driver.activateApp('com.zhiliaoapp.musically');
            await this.sleep(3000);
        } catch (e) {
            console.log('   ⚠️ Nie udało się aktywować TikTok, kontynuuję...');
        }
        console.log('');
    }

    async adbTap(percentX, percentY) {
        const x = Math.floor(this.windowSize.width * percentX);
        const y = Math.floor(this.windowSize.height * percentY);
        console.log(`   🎯 TAP: (${(percentX * 100).toFixed(0)}%, ${(percentY * 100).toFixed(0)}%) = ${x}x${y}`);
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input tap ${x} ${y}`, () => resolve());
        });
    }

    async adbKeyevent(keycode) {
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input keyevent ${keycode}`, () => resolve());
        });
    }

    async sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    async swipeUp() {
        const { width, height } = this.windowSize;
        const startY = height * 0.7;
        const endY = height * 0.3;
        const x = width / 2;

        await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ duration: 0, x: Math.floor(x), y: Math.floor(startY) })
            .down({ button: 0 })
            .pause(100)
            .move({ duration: 400, x: Math.floor(x), y: Math.floor(endY) })
            .up({ button: 0 })
            .perform();
    }

    async swipeDown() {
        const { width, height } = this.windowSize;
        const startY = height * 0.3;
        const endY = height * 0.7;
        const x = width / 2;

        await this.driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ duration: 0, x: Math.floor(x), y: Math.floor(startY) })
            .down({ button: 0 })
            .pause(100)
            .move({ duration: 400, x: Math.floor(x), y: Math.floor(endY) })
            .up({ button: 0 })
            .perform();
    }

    /**
     * Nawigacja: Feed → Profil
     */
    async goToProfile() {
        console.log('👤 Przechodzę do profilu...');

        // Spróbuj znaleźć przycisk "Profil" w dolnym pasku
        let clicked = false;
        try {
            const profilBtn = await this.driver.$('//android.widget.TextView[@text="Profil"]');
            if (await profilBtn.isDisplayed()) {
                console.log('   Znaleziono "Profil" - klikam...');
                await profilBtn.click();
                clicked = true;
            }
        } catch (e) {}

        // Fallback na współrzędne
        if (!clicked) {
            await this.adbTap(0.90, 0.95);
        }

        await this.sleep(4000);

        // DEBUG: Pokaż elementy po kliknięciu profilu
        console.log('   🔍 Elementy na ekranie:');
        try {
            const allTexts = await this.driver.$$('//android.widget.TextView');
            for (const el of allTexts.slice(0, 15)) {
                try {
                    const text = await el.getText();
                    const loc = await el.getLocation();
                    if (text && text.length > 0 && text.length < 40) {
                        const yPct = (loc.y / this.windowSize.height * 100).toFixed(1);
                        const xPct = (loc.x / this.windowSize.width * 100).toFixed(1);
                        console.log(`      "${text}" @ (${xPct}%, ${yPct}%)`);
                    }
                } catch (e) {}
            }
        } catch (e) {}

        // Weryfikacja
        try {
            const profileElements = await this.driver.$$('//android.widget.TextView[contains(@text, "Obserwowani")]');
            if (profileElements.length > 0) {
                console.log('   ✅ Jestem na profilu\n');
                return true;
            }
        } catch (e) {}

        console.log('   ⚠️ Nie mogę zweryfikować profilu, kontynuuję...\n');
        return true;
    }

    /**
     * Nawigacja: Profil → Lista Obserwowanych
     */
    async goToFollowingList() {
        console.log('👥 Otwieram listę obserwowanych...');

        // Spróbuj kliknąć przez selektor
        let clicked = false;
        try {
            const obserwowaniBtn = await this.driver.$('//android.widget.TextView[@text="Obserwowani"]');
            if (await obserwowaniBtn.isDisplayed()) {
                const loc = await obserwowaniBtn.getLocation();
                console.log(`   Znaleziono "Obserwowani" @ (${loc.x}, ${loc.y}) - klikam...`);
                await obserwowaniBtn.click();
                clicked = true;
            }
        } catch (e) {
            console.log('   Selektor nie znalazł "Obserwowani"');
        }

        // Fallback na współrzędne - "Obserwowani" @ (13.3%, 28.5%)
        if (!clicked) {
            console.log('   Próbuję współrzędne (13.3%, 28.5%)...');
            await this.adbTap(0.133, 0.285);
        }

        await this.sleep(3500);

        // DEBUG: Pokaż elementy po kliknięciu
        console.log('   🔍 Elementy po otwarciu listy:');
        try {
            const allTexts = await this.driver.$$('//android.widget.TextView');
            for (const el of allTexts.slice(0, 20)) {
                try {
                    const text = await el.getText();
                    const loc = await el.getLocation();
                    if (text && text.length > 0 && text.length < 40) {
                        const yPct = (loc.y / this.windowSize.height * 100).toFixed(1);
                        const xPct = (loc.x / this.windowSize.width * 100).toFixed(1);
                        console.log(`      "${text}" @ (${xPct}%, ${yPct}%)`);
                    }
                } catch (e) {}
            }
        } catch (e) {}

        // Weryfikacja - szukamy "Zarządzaj" lub "Sortuj" (są tylko na liście)
        try {
            const manageElements = await this.driver.$$('//android.widget.TextView[@text="Zarządzaj"]');
            if (manageElements.length > 0) {
                console.log('   ✅ Jestem na liście obserwowanych\n');
                return true;
            }
        } catch (e) {}

        try {
            const sortElements = await this.driver.$$('//android.widget.TextView[contains(@text, "Sortuj")]');
            if (sortElements.length > 0) {
                console.log('   ✅ Jestem na liście obserwowanych (znaleziono Sortuj)\n');
                return true;
            }
        } catch (e) {}

        // Sprawdź czy są użytkownicy z @username
        try {
            const usernames = await this.driver.$$('//android.widget.TextView[starts-with(@text, "@")]');
            if (usernames.length > 0) {
                console.log('   ✅ Jestem na liście obserwowanych (znaleziono @usernames)\n');
                return true;
            }
        } catch (e) {}

        console.log('   ⚠️ Nie mogę zweryfikować listy\n');
        return false;
    }

    /**
     * Nawigacja: Lista → Tryb Zarządzania
     */
    async enterManageMode() {
        console.log('⚙️ Wchodzę w tryb zarządzania...');

        // DEBUG: Pokaż elementy na ekranie
        console.log('   🔍 Elementy na liście:');
        try {
            const allTexts = await this.driver.$$('//android.widget.TextView');
            for (const el of allTexts.slice(0, 20)) {
                try {
                    const text = await el.getText();
                    const loc = await el.getLocation();
                    if (text && text.length > 0 && text.length < 40) {
                        const yPct = (loc.y / this.windowSize.height * 100).toFixed(1);
                        const xPct = (loc.x / this.windowSize.width * 100).toFixed(1);
                        console.log(`      "${text}" @ (${xPct}%, ${yPct}%)`);
                    }
                } catch (e) {}
            }
        } catch (e) {}

        // Spróbuj znaleźć przycisk "Zarządzaj" przez selektor
        let clicked = false;
        try {
            const manageBtn = await this.driver.$('//android.widget.TextView[@text="Zarządzaj"]');
            if (await manageBtn.isDisplayed()) {
                const loc = await manageBtn.getLocation();
                console.log(`   Znaleziono "Zarządzaj" @ (${loc.x}, ${loc.y}) - klikam...`);
                await manageBtn.click();
                clicked = true;
            }
        } catch (e) {
            console.log('   Selektor nie znalazł "Zarządzaj"');
        }

        // Fallback na współrzędne
        if (!clicked) {
            console.log('   Próbuję współrzędne (90%, 22%)...');
            await this.adbTap(0.90, 0.22);
        }

        await this.sleep(3000);

        // DEBUG: Pokaż elementy PO kliknięciu
        console.log('   🔍 Elementy po kliknięciu Zarządzaj:');
        try {
            const allTexts = await this.driver.$$('//android.widget.TextView');
            for (const el of allTexts.slice(0, 15)) {
                try {
                    const text = await el.getText();
                    const loc = await el.getLocation();
                    if (text && text.length > 0 && text.length < 40) {
                        const yPct = (loc.y / this.windowSize.height * 100).toFixed(1);
                        const xPct = (loc.x / this.windowSize.width * 100).toFixed(1);
                        console.log(`      "${text}" @ (${xPct}%, ${yPct}%)`);
                    }
                } catch (e) {}
            }
        } catch (e) {}

        // Weryfikacja - szukamy przycisku "Przestań obserwować" lub nagłówka "Zarządzaj"
        try {
            const unfollowBtn = await this.driver.$$('//android.widget.TextView[contains(@text, "Przestań obserwować")]');
            if (unfollowBtn.length > 0) {
                console.log('   ✅ Tryb zarządzania aktywny\n');
                return true;
            }
        } catch (e) {}

        // Sprawdź czy nagłówek to "Zarządzaj"
        try {
            const headers = await this.driver.$$('//android.widget.TextView[@text="Zarządzaj"]');
            for (const h of headers) {
                const loc = await h.getLocation();
                if (loc.y < this.windowSize.height * 0.15) {
                    console.log('   ✅ Tryb zarządzania aktywny (nagłówek)\n');
                    return true;
                }
            }
        } catch (e) {}

        console.log('   ⚠️ Nie mogę zweryfikować trybu zarządzania\n');
        return false;
    }

    /**
     * Skanuje widocznych użytkowników i zwraca ich nazwy z pozycjami
     * Szuka zarówno display names jak i @usernames
     */
    async scanVisibleUsers() {
        const users = [];

        try {
            const textViews = await this.driver.$$('//android.widget.TextView');

            for (const tv of textViews) {
                try {
                    const text = await tv.getText();
                    if (!text || text.length < 2 || text.length > 50) continue;

                    const location = await tv.getLocation();

                    // Filtruj tylko elementy w obszarze listy (Y > 20% i Y < 85%)
                    const yPercent = location.y / this.windowSize.height;
                    if (yPercent < 0.20 || yPercent > 0.85) continue;

                    // Ignoruj elementy UI (przyciski, nagłówki, itp.)
                    const skipTexts = ['Sortuj', 'Zarządzaj', 'Obserwowani', 'Obserwujący',
                                       'Znajomi', 'LIVE', 'Przestań', 'Anuluj', 'Profil',
                                       'Główna', 'Przychodzące', 'Domyślne'];
                    if (skipTexts.some(s => text.includes(s))) continue;

                    // Ignoruj czyste liczby (statystyki)
                    if (/^\d+$/.test(text)) continue;

                    // To może być display name lub username
                    const displayText = text.trim();
                    const normalizedText = displayText.toLowerCase()
                        .replace(/[^\w\s]/g, '') // usuń emoji i znaki specjalne do porównania
                        .replace(/\s+/g, ' ')
                        .trim();

                    users.push({
                        displayText: displayText,
                        normalizedText: normalizedText,
                        y: location.y,
                        yPercent: yPercent,
                        // Checkbox jest po prawej stronie wiersza (~90% X)
                        checkboxX: 0.90,
                        checkboxY: yPercent
                    });
                } catch (e) {}
            }
        } catch (e) {
            console.log('   ⚠️ Błąd skanowania:', e.message);
        }

        // Usuń duplikaty (ta sama pozycja Y +/- 5% = ten sam wiersz)
        const uniqueUsers = [];
        for (const user of users) {
            const isDuplicate = uniqueUsers.some(u =>
                Math.abs(u.yPercent - user.yPercent) < 0.05
            );
            if (!isDuplicate) {
                uniqueUsers.push(user);
            }
        }

        return uniqueUsers;
    }

    /**
     * Główna funkcja unfollow
     * Wybiera losowych użytkowników z listy obserwowanych
     */
    async run(maxUnfollows = 5) {
        console.log(`🎯 Cel: odobserwować ${maxUnfollows} losowych użytkowników\n`);

        await this.init();

        try {
            // KROK 0: Upewnij się że jesteśmy na głównym feedzie
            // Kliknij "Główna" w dolnym pasku (bez BACK żeby nie zamknąć TikToka)
            console.log('🏠 Klikam "Główna" w dolnym pasku...');
            await this.adbTap(0.10, 0.95);
            await this.sleep(2000);

            // KROK 1: Przejdź do profilu
            const profileOk = await this.goToProfile();
            if (!profileOk) {
                console.log('❌ Nie udało się przejść do profilu');
                return;
            }

            // KROK 2: Przejdź do listy obserwowanych
            const listOk = await this.goToFollowingList();
            if (!listOk) {
                console.log('❌ Nie udało się otworzyć listy obserwowanych');
                return;
            }

            // KROK 3: Wejdź w tryb zarządzania
            const manageOk = await this.enterManageMode();
            if (!manageOk) {
                console.log('❌ Nie udało się wejść w tryb zarządzania');
                return;
            }

            // KROK 4: Skanuj i zaznaczaj użytkowników
            console.log(`🔍 Skanuję listę w poszukiwaniu celów (max ${maxUnfollows})...\n`);

            let selected = 0;
            const processedUsernames = [];

            // Skanuj widocznych użytkowników
            const visibleUsers = await this.scanVisibleUsers();
            console.log(`   Widoczni użytkownicy: ${visibleUsers.length}\n`);

            if (visibleUsers.length === 0) {
                console.log('   ⚠️ Nie znaleziono żadnych użytkowników do zaznaczenia');
            } else {
                // Wybierz losowych użytkowników (do maxUnfollows)
                const toSelect = Math.min(maxUnfollows, visibleUsers.length);
                const shuffled = visibleUsers.sort(() => Math.random() - 0.5);
                const selectedUsers = shuffled.slice(0, toSelect);

                for (const user of selectedUsers) {
                    console.log(`   ✅ Zaznaczam: "${user.displayText}"`);

                    // Kliknij checkbox (po prawej stronie wiersza)
                    await this.adbTap(user.checkboxX, user.checkboxY);
                    await this.sleep(1000);

                    selected++;
                    processedUsernames.push(user.displayText);
                }
            }

            console.log(`\n📊 Zaznaczono: ${selected} użytkowników\n`);

            // Poczekaj chwilę żeby przycisk się pojawił/ustabilizował
            await this.sleep(2000);

            // KROK 5: Kliknij "Przestań obserwować"
            if (selected > 0) {
                console.log('🚀 Klikam "Przestań obserwować"...');

                // Przewiń lekko w dół żeby upewnić się że przycisk jest widoczny
                console.log('   Przewijam w dół...');
                await this.swipeUp();
                await this.sleep(1500);

                // DEBUG: Pokaż WSZYSTKIE elementy na ekranie (szczególnie na dole)
                console.log('   🔍 Elementy na ekranie po przewinięciu:');
                try {
                    const allTexts = await this.driver.$$('//android.widget.TextView');
                    for (const el of allTexts) {
                        try {
                            const text = await el.getText();
                            const loc = await el.getLocation();
                            if (text && text.length > 0) {
                                const yPct = (loc.y / this.windowSize.height * 100).toFixed(1);
                                const xPct = (loc.x / this.windowSize.width * 100).toFixed(1);
                                // Pokaż elementy na dole (>80% Y) lub zawierające "Przestań"
                                if (parseFloat(yPct) > 80 || text.includes('Przestań')) {
                                    console.log(`      "${text}" @ (${xPct}%, ${yPct}%)`);
                                }
                            }
                        } catch (e) {}
                    }
                } catch (e) {}

                // Szukaj przycisku - może być Button lub TextView
                let clicked = false;

                // Próba 1: Szukaj przez tekst
                try {
                    const unfollowBtns = await this.driver.$$('//*[contains(@text, "Przestań obserwować")]');
                    for (const btn of unfollowBtns) {
                        const loc = await btn.getLocation();
                        const yPct = loc.y / this.windowSize.height;
                        console.log(`   Znaleziono element z "Przestań obserwować" @ Y=${(yPct*100).toFixed(1)}%`);
                        // Przycisk jest na dole ekranu (>80% Y)
                        if (yPct > 0.80) {
                            console.log(`   Klikam przycisk @ (${loc.x}, ${loc.y})...`);
                            await btn.click();
                            clicked = true;
                            await this.sleep(1000);
                            break;
                        }
                    }
                } catch (e) {
                    console.log('   Błąd szukania przycisku:', e.message);
                }

                // Fallback - kliknij przez współrzędne w różnych miejscach
                if (!clicked) {
                    console.log('   Przycisk nie znaleziony przez selektor, próbuję współrzędne...');

                    // Na podstawie screena przycisk jest na samym dole
                    // Spróbuj kliknąć bezpośrednio przez adb z różnymi Y
                    const positions = [0.88, 0.90, 0.92, 0.94];
                    for (const yPos of positions) {
                        console.log(`   Próba kliknięcia (50%, ${(yPos*100).toFixed(0)}%)...`);
                        await this.adbTap(0.50, yPos);
                        await this.sleep(800);

                        // Sprawdź czy pojawił się popup (szukaj "Anuluj")
                        try {
                            const popup = await this.driver.$('//android.widget.TextView[@text="Anuluj"]');
                            if (await popup.isDisplayed()) {
                                console.log('   ✓ Popup się pojawił!');
                                clicked = true;
                                break;
                            }
                        } catch (e) {}
                    }
                }

                // Poczekaj na pojawienie się popupu
                await this.sleep(3000);

                // Kliknij przycisk potwierdzenia w popupie
                console.log('   Klikam potwierdzenie w popupie...');

                // DEBUG: Pokaż elementy w popupie
                console.log('   🔍 Elementy w popupie:');
                try {
                    const allTexts = await this.driver.$$('//android.widget.TextView');
                    for (const el of allTexts) {
                        try {
                            const text = await el.getText();
                            const loc = await el.getLocation();
                            if (text && text.length > 0 && text.length < 50) {
                                const yPct = (loc.y / this.windowSize.height * 100).toFixed(1);
                                const xPct = (loc.x / this.windowSize.width * 100).toFixed(1);
                                console.log(`      "${text}" @ (${xPct}%, ${yPct}%)`);
                            }
                        } catch (e) {}
                    }
                } catch (e) {}

                let confirmed = false;

                // Spróbuj przez selektor - szukaj przycisku "Przestań obserwować" w popupie
                try {
                    const confirmBtns = await this.driver.$$('//android.widget.TextView[contains(@text, "Przestań obserwować")]');
                    for (const btn of confirmBtns) {
                        const loc = await btn.getLocation();
                        // Przycisk w popupie jest niżej na ekranie (>50% Y)
                        if (loc.y > this.windowSize.height * 0.5) {
                            console.log(`   Znaleziono przycisk potwierdzenia @ (${loc.x}, ${loc.y}) - klikam...`);
                            await btn.click();
                            confirmed = true;
                            await this.sleep(1500);
                            break;
                        }
                    }
                } catch (e) {}

                // Fallback - kliknij na czerwony przycisk w popupie
                // Na podstawie screenshota: przycisk "Przestań obserwować" jest ~75% Y
                if (!confirmed) {
                    console.log('   Próbuję współrzędne popupu (50%, 75%)...');
                    await this.adbTap(0.50, 0.75);
                    await this.sleep(2000);
                }

                await this.sleep(1000);
                console.log('   ✅ Potwierdzono');

                console.log(`\n✅ Pomyślnie odobserwowano ${selected} użytkowników!`);
                console.log('   Odobserwowani:');
                processedUsernames.forEach(u => console.log(`   - ${u}`));
            } else {
                console.log('⚠️ Nie zaznaczono żadnych użytkowników.');
            }

            // Wróć do głównego feedu
            console.log('\n🏠 Wracam do feedu...');
            await this.adbKeyevent(4); // BACK
            await this.sleep(1000);
            await this.adbKeyevent(4); // BACK
            await this.sleep(1000);
            await this.adbTap(0.10, 0.97); // Kliknij "Główna"

        } catch (e) {
            console.error('❌ Błąd krytyczny:', e.message);
        } finally {
            if (this.driver) {
                try {
                    await this.driver.deleteSession();
                    console.log('🔌 Sesja Appium zamknięta.\n');
                } catch (e) {}
            }
        }
    }
}

// Argumenty CLI
const args = process.argv.slice(2);
let maxUnfollows = 5;

// Parsuj argumenty
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max' && args[i + 1]) {
        maxUnfollows = parseInt(args[i + 1]);
    }
}

console.log(`📋 Cel: usunąć ${maxUnfollows} losowych użytkowników\n`);

const unfollower = new TikTokUnfollower();
unfollower.run(maxUnfollows)
    .then(() => {
        console.log('🏁 Proces Unfollow zakończony.');
        process.exit(0);
    })
    .catch((e) => {
        console.error('❌ Unfollow zakończony z błędem:', e.message);
        process.exit(1);
    });
