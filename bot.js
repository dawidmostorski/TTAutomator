const { remote } = require('webdriverio');
const AICommentGenerator = require('./ai');
const ActionDatabase = require('./db');
const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Parsowanie argumentów CLI dla Multi-Device (Ręczne, bez zależności)
const getArg = (argName) => {
    const idx = process.argv.indexOf(argName);
    return idx !== -1 ? process.argv[idx + 1] : null;
};

// Funkcja do pobrania listy podłączonych urządzeń przez ADB
const getConnectedDevices = () => {
    try {
        const output = execSync('adb devices', { encoding: 'utf8' });
        const lines = output.split('\n').slice(1); // Pomijamy nagłówek "List of devices..."
        const devices = [];
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2 && parts[1] === 'device') {
                devices.push(parts[0]);
            }
        }
        return devices;
    } catch (e) {
        console.error('❌ Błąd pobierania listy urządzeń ADB:', e.message);
        return [];
    }
};

// Automatyczne przydzielanie portu na podstawie UDID
const getAutoPort = (udid, basePort = 8200) => {
    const devices = getConnectedDevices();
    const index = devices.indexOf(udid);
    if (index === -1) {
        console.warn(`⚠️ Urządzenie ${udid} nie znalezione w ADB, używam domyślnego portu ${basePort}`);
        return basePort;
    }
    const port = basePort + index;
    console.log(`📱 Urządzenie ${udid} (indeks: ${index}) → Port: ${port}`);
    return port;
};

// Pobierz UDID z argumentów lub .env
let DEVICE_UDID = getArg('--udid') || process.env.APPIUM_DEVICE_ID;

// Jeśli nie podano UDID, pokaż listę urządzeń
if (!DEVICE_UDID) {
    const devices = getConnectedDevices();
    if (devices.length === 0) {
        console.error('❌ Brak podłączonych urządzeń Android!');
        process.exit(1);
    } else if (devices.length === 1) {
        DEVICE_UDID = devices[0];
        console.log(`📱 Automatycznie wybrano jedyne urządzenie: ${DEVICE_UDID}`);
    } else {
        console.log('📱 Dostępne urządzenia:');
        devices.forEach((d, i) => console.log(`   ${i}: ${d}`));
        console.error('❌ Podaj --udid aby wybrać urządzenie, np: node bot.js --udid=' + devices[0]);
        process.exit(1);
    }
}

// Automatyczne przydzielanie portu (lub użyj podanego ręcznie)
const SYSTEM_PORT = getArg('--systemPort') || getAutoPort(DEVICE_UDID);

console.log(`🔧 Konfiguracja bota: UDID=${DEVICE_UDID}, SystemPort=${SYSTEM_PORT}`);

const capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': DEVICE_UDID || 'Android Device',
    'appium:udid': DEVICE_UDID,
    'appium:appPackage': 'com.zhiliaoapp.musically',
    'appium:appActivity': 'com.ss.android.ugc.aweme.splash.SplashActivity',
    'appium:noReset': true,
    'appium:newCommandTimeout': 3600,
    'appium:turnScreenOn': true,
    'appium:systemPort': parseInt(SYSTEM_PORT) // Kluczowe dla wielu urządzeń
};

// Dodaj obsługę PINu, jeśli zdefiniowano w .env
if (process.env.DEVICE_PIN) {
    capabilities['appium:unlockType'] = 'pin';
    capabilities['appium:unlockKey'] = process.env.DEVICE_PIN;
}

const wdOpts = {
    hostname: 'localhost',
    port: 4723,
    logLevel: 'error', // Mniej logów webdrivera
    capabilities,
};

class TikTokAppiumBot {
    constructor() {
        this.driver = null;
        this.udid = DEVICE_UDID;

        // Ładowanie konfiguracji komentarzy
        this.commentConfig = this.loadCommentConfig();

        // Konfiguracja AI (jeśli tryb AI, przekaż prompt)
        const aiConfig = {
            systemPrompt: (this.commentConfig && this.commentConfig.mode === 'ai') ? this.commentConfig.systemPrompt : null
        };
        this.ai = new AICommentGenerator(process.env.OPENAI_API_KEY, aiConfig);

        this.db = new ActionDatabase();
        this.historyPath = path.join(__dirname, 'visited.json');
        this.visited = this.loadHistory();
        this.windowSize = { width: 1080, height: 2400 };

        // Kalibracja współrzędnych per urządzenie (z device_configs.json)
        this.calibration = this.loadCalibration();

        this.sessionStats = {
            startTime: new Date(),
            watched: 0,
            liked: 0,
            followed: 0,
            commented: 0,
            errors: 0
        };

        // Flaga zajętości - blokuje interwał addMenuCheck gdy bot wykonuje akcję (komentarz, reply)
        this.isBusy = false;

        // Interwał sprawdzający czy bot utknął w menu dodawania (co 6-8 min)
        // Zwiększony dla multi-device - ADB check jest lekki (~100ms), ale rzadszy = mniej kolizji
        this.addMenuCheckInterval = null;
        this.addMenuCheckFrequency = 180000; // 3 min
        this.consecutiveUnknowns = 0; // Licznik kolejnych 'unknown' w watchdogu
        this.consecutiveEmptyContexts = 0; // Licznik pustych getVideoContext (off-feed heurystyka)
    }

    sendStatus(status, text) {
        if (process.send) {
            process.send({
                type: 'device-status',
                deviceId: this.udid,
                status: status,
                text: text
            });
        }
        console.log(`[STATUS] ${status}: ${text}`);
    }

    sendStats(statsType) {
        if (process.send) {
            process.send({
                type: 'stats-update',
                deviceId: this.udid,
                statsType: statsType
            });
        }
    }

    /**
     * Sprawdza czy błąd oznacza crashniętą sesję Appium/UiAutomator2
     * @param {Error} error
     * @returns {boolean}
     */
    isSessionDead(error) {
        const msg = (error?.message || '').toLowerCase();
        return msg.includes('instrumentation') ||
            msg.includes('not running') ||
            msg.includes('session not created') ||
            msg.includes('invalid session') ||
            msg.includes('session id') ||
            msg.includes('cannot be proxied');
    }

    loadCommentConfig() {
        try {
            // DIAGNOSTYKA: Pokaż wszystkie argumenty CLI
            console.log(`🔍 [DEBUG] process.argv: ${JSON.stringify(process.argv)}`);

            // Zmiana: Pobierz ścieżkę z flagi --config (niezależne od kolejności argumentów)
            const configPathArg = getArg('--config');
            console.log(`🔍 [DEBUG] --config flag value: ${configPathArg}`);

            const configPath = configPathArg || path.join(__dirname, 'comments_config.json');

            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                console.log(`📝 Załadowano konfigurację komentarzy z: ${configPath}`);
                console.log(`📝 Tryb: ${config.mode}`);
                if (config.mode === 'ai') {
                    console.log(`🧠 System Prompt: "${config.systemPrompt ? config.systemPrompt.substring(0, 50) + '...' : 'BRAK'}"`);
                }
                if (config.mode === 'list') console.log(`📋 Liczba gotowych komentarzy: ${config.staticComments.length}`);
                return config;
            } else {
                console.warn(`⚠️ Nie znaleziono pliku konfiguracji: ${configPath}`);
            }
        } catch (e) {
            console.error('⚠️ Błąd ładowania konfigu komentarzy:', e.message);
        }
        return { mode: 'ai', systemPrompt: '', staticComments: [] };
    }

    loadCalibration() {
        // Domyślne wartości (skalibrowane na Motorola G31, 1080x2400)
        const defaults = {
            followY: 54,    // Plusik follow na awatarze (% wysokości)
            likeY: 60.5,    // Serduszko like (% wysokości)
            commentY: 66,   // Ikona komentarza (% wysokości)
            sendButtonY: 61 // Przycisk wyślij komentarz (% wysokości)
        };

        try {
            const configPath = path.join(__dirname, 'device_configs.json');
            if (fs.existsSync(configPath)) {
                const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                const deviceConfig = configs[this.udid];
                if (deviceConfig) {
                    const cal = {
                        followY: deviceConfig.followY ?? defaults.followY,
                        likeY: deviceConfig.likeY ?? defaults.likeY,
                        commentY: deviceConfig.commentY ?? defaults.commentY,
                        sendButtonY: deviceConfig.sendButtonY ?? defaults.sendButtonY
                    };
                    console.log(`📐 Kalibracja [${this.udid}]: follow=${cal.followY}%, like=${cal.likeY}%, comment=${cal.commentY}%, send=${cal.sendButtonY}%`);
                    return cal;
                }
            }
        } catch (e) {
            console.warn('⚠️ Błąd ładowania kalibracji:', e.message);
        }

        console.log(`📐 Kalibracja: domyślna (follow=${defaults.followY}%, like=${defaults.likeY}%)`);
        return defaults;
    }

    loadHistory() {
        try {
            if (fs.existsSync(this.historyPath)) {
                return JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
            }
        } catch (e) {
            console.error('⚠️ Błąd ładowania historii:', e.message);
        }
        return [];
    }

    saveHistory() {
        try {
            fs.writeFileSync(this.historyPath, JSON.stringify(this.visited, null, 2));
        } catch (e) {
            console.error('⚠️ Błąd zapisu historii:', e.message);
        }
    }

    isVisited(description) {
        if (!description) return false;
        const shortDesc = description.substring(0, 100);
        return this.visited.includes(shortDesc);
    }

    addToVisited(description) {
        if (!description) return;
        const shortDesc = description.substring(0, 100);
        if (!this.visited.includes(shortDesc)) {
            this.visited.push(shortDesc);
            if (this.visited.length > 500) this.visited.shift();
            this.saveHistory();
        }
    }

    async wakeUpDevice() {
        try {
            console.log('📱 Sprawdzam stan ekranu...');
            // Sprawdź czy ekran jest zablokowany/wygaszony
            await new Promise((resolve) => {
                exec(`adb -s ${this.udid} shell dumpsys window policy | findstr "mInputRestricted=true"`, async (error, stdout) => {
                    if (stdout && stdout.includes('mInputRestricted=true')) {
                        console.log('🌑 Ekran wygaszony. Wybudzam...');
                        await this.adbKeyevent(224); // KEYCODE_WAKEUP
                        await new Promise(r => setTimeout(r, 1000));
                        await this.swipeUp(); // Swipe żeby zdjąć "slide to unlock"
                        await new Promise(r => setTimeout(r, 1000));
                    } else {
                        console.log('☀️ Ekran jest aktywny.');
                    }
                    resolve();
                });
            });
        } catch (e) {
            console.error('⚠️ Błąd wybudzania:', e.message);
        }
    }

    async init() {
        console.log('🚀 Łączenie z telefonem przez Appium...');
        this.driver = await remote(wdOpts);

        await this.wakeUpDevice();

        console.log('📱 Uruchamiam aplikację TikTok...');
        if (await this.driver.isAppInstalled('com.zhiliaoapp.musically')) {
            await this.driver.activateApp('com.zhiliaoapp.musically');
            await new Promise(r => setTimeout(r, 5000));
        } else {
            console.error('❌ Aplikacja TikTok nie jest zainstalowana na urządzeniu!');
        }

        this.windowSize = await this.driver.getWindowSize();
        console.log(`✅ Połączono. Rozdzielczość ekranu: ${this.windowSize.width}x${this.windowSize.height}`);
    }

    async debugScreenshot(name) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = path.join(__dirname, `error_screen_${name}_${timestamp}.png`);
            await this.driver.saveScreenshot(filename);
        } catch (e) { }
    }



    async getCurrentUsername() {
        // Używane jako fallback jeśli ADB dump zawiedzie
        try {
            const userEl = await this.driver.$('id:com.zhiliaoapp.musically:id/title');
            const username = await userEl.getText();
            return username ? username.replace('@', '').trim() : null;
        } catch (e) {
            if (this.isSessionDead(e)) throw e;
            return null;
        }
    }

    // getMusicTitle() - USUNIĘTO dla optymalizacji
    async getMusicTitle() {
        return null;
    }

    async getVideoDescription() {
        // Fallback - używane jeśli ADB dump zawiedzie
        try {
            const els = await this.driver.$$('id:com.zhiliaoapp.musically:id/desc');
            if (els.length > 0) {
                const text = await els[0].getText();
                if (text && text.length > 3) return text;
            }
        } catch (e) {
            if (this.isSessionDead(e)) throw e;
        }
        return null;
    }

    async getVideoContext() {
        // Sprawdź czy jesteśmy na feedzie ZANIM odpytamy Appium (WebDriver)
        // Gdy off-feed, findElement szuka elementów w pętli ~300ms/req blokując ADB
        const uiState = await this.detectUiState();
        if (uiState !== 'feed') {
            console.log(`⚠️ getVideoContext: off-feed (${uiState}), pomijam Appium queries`);
            return { description: '', author: 'Nieznany', music: null };
        }

        const description = await this.getVideoDescription() || '';
        const author = await this.getCurrentUsername() || 'Nieznany';
        return { description, author, music: null };
    }

    async likeVideo(description) {
        try {
            const likeY = this.calibration.likeY / 100;
            console.log(`❤️ Lajkuję (Y=${this.calibration.likeY}%)...`);
            await this.adbTapRelative(0.93, likeY);
            await new Promise(r => setTimeout(r, 400 + Math.floor(Math.random() * 400))); // 400-800ms
            // getCurrentUsername używa Appium — skip gdy off-feed
            let username = null;
            const uiState = await this.detectUiState();
            if (uiState === 'feed') username = await this.getCurrentUsername();
            this.db.addLike(username, description);
            this.sessionStats.liked++;
            this.sendStats('likes');
            return true;
        } catch (e) {
            if (this.isSessionDead(e)) throw e;
            console.log('⚠️ Błąd lajkowania:', e.message);
            return false;
        }
    }

    async followUser() {
        try {
            console.log(`➕ Obserwuję użytkownika (Y=${this.calibration.followY}%)...`);
            await this.adbTapRelative(0.93, this.calibration.followY / 100);
            await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 500))); // 500-1000ms
            // getCurrentUsername używa Appium — skip gdy off-feed
            let username = null;
            const uiState = await this.detectUiState();
            if (uiState === 'feed') username = await this.getCurrentUsername();
            this.db.addFollow(username);
            this.sessionStats.followed++;
            this.sendStats('follows');
            console.log(`✅ Zaobserwowano: ${username}`);
            return true;
        } catch (e) {
            if (this.isSessionDead(e)) throw e;
            console.log('⚠️ Błąd follow:', e.message);
            return false;
        }
    }

    async adbType(text) {
        const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const words = normalizedText.split(' ').filter(w => w.length > 0);
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            // Escapowanie znaków specjalnych dla shell (podwójny backslash → prawdziwy escape)
            const safeWord = word.replace(/([!$()&'"|<>?*\\`~#{}[\];,])/g, '\\$1');
            if (safeWord.length > 0) {
                await new Promise((resolve) => {
                    exec(`adb -s ${this.udid} shell input text "${safeWord}"`, (err) => {
                        if (err) console.warn(`⚠️ adbType błąd słowa "${word}":`, err.message);
                        resolve();
                    });
                });
                // Ludzka prędkość pisania: ~35 WPM na telefonie
                // Dłuższe słowa = dłuższy czas, pierwsze słowo wolniejsze (namysł)
                const baseDelay = 300 + word.length * 40; // dłuższe słowo = dłużej
                const startBonus = i === 0 ? 200 : 0;     // pierwsze słowo wolniejsze
                const thinkPause = Math.random() < 0.15 ? 600 : 0; // 15% szans na pauzę "myślenia"
                await new Promise(r => setTimeout(r, baseDelay + startBonus + thinkPause + Math.floor(Math.random() * 200)));
            }
            if (i < words.length - 1) {
                await new Promise((resolve) => {
                    exec(`adb -s ${this.udid} shell input keyevent 62`, (err) => {
                        if (err) console.warn('⚠️ adbType błąd spacji:', err.message);
                        resolve();
                    });
                });
                await new Promise(r => setTimeout(r, 100 + Math.floor(Math.random() * 150)));
            }
        }
    }

    async adbTapRelative(percentX, percentY) {
        // Jitter procentowy - symuluje naturalną niedokładność palca (skaluje się z rozdzielczością)
        const jitterX = (Math.random() - 0.5) * 0.018; // ±0.9% szerokości (~±10px na 1080)
        const jitterY = (Math.random() - 0.5) * 0.012; // ±0.6% wysokości (~±14px na 2400)

        const x = Math.floor(this.windowSize.width * (percentX + jitterX));
        const y = Math.floor(this.windowSize.height * (percentY + jitterY));

        // DEBUG: Log współrzędnych dla kalibracji
        console.log(`🎯 TAP: ${x}x${y} (${(percentX * 100).toFixed(1)}%, ${(percentY * 100).toFixed(1)}%)`);

        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input tap ${x} ${y}`, () => { resolve(); });
        });
    }

    async adbExec(command, { timeout = 10000, silent = false } = {}) {
        return new Promise((resolve) => {
            const child = exec(`adb -s ${this.udid} shell ${command}`, { timeout }, (error, stdout, stderr) => {
                if (error) {
                    if (!silent) console.log(`⚠️ ADB: ${error.message.split('\n')[0]}`);
                    resolve(null);
                } else {
                    resolve(stdout.trim());
                }
            });
        });
    }

    async adbKeyevent(keycode) {
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input keyevent ${keycode}`, () => { resolve(); });
        });
    }

    stripEmoji(text) {
        if (!text) return '';
        return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
    }

    async commentOnVideo(context) {
        if (this.isVisited(context.description)) return false;

        this.isBusy = true; // Blokuj interwał addMenuCheck
        try {
            const startTime = Date.now();
            this.sendStatus('working', '💬 Komentowanie...');

            let comment = '';

            if (this.commentConfig && this.commentConfig.mode === 'list' && this.commentConfig.staticComments.length > 0) {
                const list = this.commentConfig.staticComments;
                comment = list[Math.floor(Math.random() * list.length)];
                console.log(`📋 Pobrano komentarz z listy (${list.length}): "${comment}"`);
            } else {
                try {
                    console.log('🤖 Generowanie komentarza przez AI (z kontekstem)...');
                    comment = await this.ai.generateComment(context);
                } catch (err) {
                    console.error('❌ Błąd generowania AI:', err);
                }
            }

            if (!comment || typeof comment !== 'string' || comment.trim() === '') {
                console.warn('⚠️ Brak wygenerowanego komentarza! Używam zapasowego.');
                comment = "Wow, super! 🔥";
            }

            this.currentComment = comment;
            console.log(`💬 Treść komentarza: "${this.currentComment}"`);

            // 1. Otwórz panel komentarzy - bezpośredni ADB tap
            console.log('💬 Otwieram panel komentarzy...');
            await this.adbTapRelative(0.93, this.calibration.commentY / 100);
            await new Promise(r => setTimeout(r, 3500 + Math.floor(Math.random() * 1500))); // 3.5-5s

            // 2. Kliknij w pole wprowadzania i wpisz przez ADB
            console.log('👆 Aktywacja pola tekstowego...');
            await this.adbTapRelative(0.50, 0.92);
            await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 1000))); // 1.5-2.5s

            // Wpisz przez ADB słowo po słowie
            const cleanComment = this.stripEmoji(this.currentComment).trim();
            if (cleanComment) {
                console.log('⌨️ Wpisuję tekst przez ADB...');
                await this.adbType(cleanComment);
            }
            await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 500))); // 1.5-2s

            // 3. Kliknij WYŚLIJ (kalibracja z device_configs.json)
            const sendY = this.calibration.sendButtonY / 100;
            console.log(`📤 Wysyłanie komentarza (Y=${this.calibration.sendButtonY}%)...`);
            await this.adbTapRelative(0.92, sendY);

            await new Promise(r => setTimeout(r, 800));
            // Fallback: kliknij Enter na klawiaturze (jeśli tap nie zadziałał)
            // await this.adbKeyevent(66); // ENTER wyłączony zgodnie z prośbą użytkownika

            await new Promise(r => setTimeout(r, 3500 + Math.floor(Math.random() * 1500))); // 3.5-5s

            // 4. Zamknij panel i zweryfikuj
            let closed = false;

            // Próba kliknięcia w tło (góra ekranu 50% szer, 20% wys) zamiast BACK
            console.log('🏁 Zamykanie panelu (Tap tła)...');
            await this.adbTapRelative(0.5, 0.2);
            await new Promise(r => setTimeout(r, 1500));

            if (await this.ensureInFeed()) {
                closed = true;
            } else {
                console.log('🏁 Zamykanie panelu (BACK)...');
                await this.adbKeyevent(4);
                await new Promise(r => setTimeout(r, 1500));
                if (await this.ensureInFeed()) closed = true;
            }

            if (closed) {
                this.addToVisited(context.description);
                this.sessionStats.commented++;
                this.sendStats('comments');
                this.sendStatus('working', '✅ Komentarz wysłany.');

                // KRYTYCZNE: Swipe w górę natychmiast po sukcesie
                console.log('🚀 Swiping up after comment...');
                await this.swipeUp();
                return true;
            } else {
                console.warn('❌ Panel komentarzy nie został zamknięty - możliwe niepowodzenie.');
                return false;
            }

        } catch (e) {
            if (this.isSessionDead(e)) throw e;
            console.log('⚠️ Błąd komentowania:', e.message);
            this.sessionStats.errors++;
            this.sendStats('errors');
            await this.adbKeyevent(4);
            return false;
        } finally {
            this.isBusy = false; // GWARANCJA resetu na każdym wyjściu
        }
    }

    async ensureInFeed() {
        const state = await this.detectUiState();
        if (state === 'feed') return true;
        console.log(`⚠️ ensureInFeed: nie na feedzie (stan: ${state})`);
        return false;
    }

    /**
     * Sprawdza activity i zwraca czy jesteśmy na feedzie
     */
    isOnFeed(activityStr) {
        if (!activityStr) return false; // FIX: null = NIE na feedzie (było true!)
        const a = activityStr.toLowerCase();
        // Tylko główne activity feedu — NIE profile/comment/search
        const feedOnly = ['mainactivity', 'splashactivity', 'feedactivity', 'detailactivity'];
        return feedOnly.some(p => a.includes(p));
    }

    /**
     * Klasyfikuje aktualny stan UI TikToka przez ADB activity check.
     * Jedno źródło prawdy zamiast wielu rozproszonych funkcji.
     * @returns {Promise<string>} - 'feed' | 'comments' | 'camera' | 'profile' | 'search' | 'inbox' | 'live' | 'unknown'
     */
    async detectUiState() {
        try {
            let raw = await this.adbExec('"dumpsys activity activities | grep -E \'mResumedActivity|ResumedActivity\' || true"', { silent: true });
            // Retry raz po 1.5s jeśli ADB nie odpowiedział (null = exec error, '' = brak activity)
            if (raw === null) {
                await new Promise(r => setTimeout(r, 1500));
                raw = await this.adbExec('"dumpsys activity activities | grep -E \'mResumedActivity|ResumedActivity\' || true"', { silent: false });
            }
            if (raw === null) return 'unknown'; // ADB totalnie martwy
            if (raw.trim() === '') return 'unknown'; // TikTok nie na foreground (lub inna apka)

            const a = raw.toLowerCase();

            // 1. Kamera / publikacja / nagrywanie (najwyższy priorytet)
            const cameraPatterns = ['shootactivity', 'recordactivity', 'cameraactivity',
                'publishactivity', 'uploadactivity', 'postactivity', 'editactivity',
                'shortvideo.ui.shoot', 'record.activity', 'camera.activity',
                'creation.activity', 'draft.activity'];
            if (cameraPatterns.some(p => a.includes(p))) return 'camera';

            // 2. Live stream
            if (a.includes('live')) return 'live';

            // 3. Inbox / wiadomości
            if (a.includes('inbox') || a.includes('message') || a.includes('im.')) return 'inbox';

            // 4. Search / discover
            if (a.includes('searchactivity') || a.includes('discoveractivity') ||
                a.includes('search.activity')) return 'search';

            // 5. Profil (cudzy lub własny)
            if (a.includes('profileactivity') || a.includes('userdetail') ||
                a.includes('profile.activity')) return 'profile';

            // 6. Feed — główny ekran z filmami
            const feedPatterns = ['mainactivity', 'splashactivity'];
            if (feedPatterns.some(p => a.includes(p))) return 'feed';

            // DetailActivity = film pełnoekranowy. Traktujemy jako feed (overlay komentarzy zamykany BACKiem).
            if (a.includes('detailactivity') || a.includes('feedactivity')) return 'feed';

            // 7. Nie TikTok
            if (!a.includes('musically') && !a.includes('aweme')) return 'unknown';

            // 8. TikTok ale nieznany ekran
            return 'unknown';
        } catch (e) {
            console.warn('⚠️ detectUiState error:', e.message);
            return 'unknown';
        }
    }

    /**
     * Lekki recovery po miss-clicku
     * Sprawdza activity i wraca do feedu jeśli bot zbłądził
     * Próby: BACK → Home tab → force-stop + restart TikTok
     */
    /**
     * Sprawdza czy faktycznie jesteśmy na feedzie przez Appium element check.
     * Activity check nie wystarcza bo TikTok używa SplashActivity dla overlay'ów.
     * @returns {Promise<boolean>}
     */
    async isActuallyOnFeed() {
        try {
            const el = await this.driver.$('id:com.zhiliaoapp.musically:id/desc');
            const exists = await el.isExisting();
            return exists;
        } catch (e) {
            return false;
        }
    }

    async recoverToFeed() {
        try {
            // Szybki check: może już jesteśmy na feedzie
            if (await this.isActuallyOnFeed()) return true;

            const state = await this.detectUiState();
            console.log(`🔧 recoverToFeed: off-feed (stan: ${state}), restartuję TikToka...`);
            this.sendStatus('working', '🔄 Recovery: restart TikTok...');

            // Force-stop + launch main activity przez ADB (nie activateApp — to tylko przywraca z tła)
            await this.adbExec('am force-stop com.zhiliaoapp.musically');
            await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 1000)));

            await this.adbExec('am start -n com.zhiliaoapp.musically/com.ss.android.ugc.aweme.splash.SplashActivity');
            await new Promise(r => setTimeout(r, 6000 + Math.floor(Math.random() * 2000)));

            if (await this.isActuallyOnFeed()) {
                console.log('✅ recoverToFeed: restart TikToka zadziałał');
                this.sendStatus('working', '✅ TikTok zrestartowany, wracam do pracy');
                return true;
            }

            console.log('❌ recoverToFeed: nie udało się wrócić mimo restartu');
            this.sendStatus('working', '⚠️ Recovery nie powiodło się');
            return false;
        } catch (e) {
            console.log('⚠️ recoverToFeed błąd:', e.message);
            return false;
        }
    }

    async swipeUp() {
        const { width, height } = this.windowSize;
        // Losowy start i koniec Y (ruch w górę)
        // Obniżony startY (65-75%) - unika przycisków CTA reklam w strefie 75-85%
        const startY = Math.floor(height * (0.65 + (Math.random() * 0.1))); // 65-75% wysokości
        const endY = Math.floor(height * (0.2 + (Math.random() * 0.1)));    // 20-30% wysokości

        // Przesunięte w lewo od środka (35-50% X) - unika przycisku "+" na 50% X
        const startX = Math.floor(width * (0.35 + Math.random() * 0.15));
        const endX = Math.floor(startX + (Math.random() * 60 - 30)); // Lekki łuk

        const duration = Math.floor(Math.random() * 300) + 600; // 600-900ms

        // ADB swipe zamiast Appium action (nie degraduje się z czasem jak UiAutomator2)
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`, () => { resolve(); });
        });
    }

    async checkPopups() {
        // Funkcja wyłączona - popup "Później" nie istnieje w mobilnej wersji TikTok
        // (pozostałość z wersji desktopowej bota)
        // Powodowało to 12-sekundowe opóźnienia przy każdym cyklu!
        return;
    }

    async goToSearch(tag) {
        console.log(`🔎 Szukam taga: #${tag}`);
        try {
            // 1. Kliknij lupę - używamy tylko działającego selektora lub ADB fallback
            // Optymalizacja: zamiast próbować wielu selektorów (~3s każdy), od razu XPath lub ADB
            let searchClicked = false;

            try {
                // XPath działa najlepiej na podstawie logów
                const searchIcon = await this.driver.$('//android.widget.ImageView[@content-desc="Szukaj"]');
                if (await searchIcon.isDisplayed()) {
                    await searchIcon.click();
                    searchClicked = true;
                }
            } catch (e) {
                // Fallback na angielski content-desc
                try {
                    const searchIconEn = await this.driver.$('//android.widget.ImageView[contains(@content-desc, "Search")]');
                    if (await searchIconEn.isDisplayed()) {
                        await searchIconEn.click();
                        searchClicked = true;
                    }
                } catch (e2) { }
            }

            if (!searchClicked) {
                console.log('⚠️ Używam ADB tap dla lupy...');
                await this.adbTapRelative(0.93, 0.05);
            }
            await new Promise(r => setTimeout(r, 2000));

            // 2. Wpisz tag - używamy tylko XPath (najszybszy fallback)
            let inputField = null;
            try {
                inputField = await this.driver.$('//android.widget.EditText');
            } catch (e) { }

            if (!inputField) {
                console.error('⚠️ Nie znaleziono pola wyszukiwania!');
                return false;
            }

            await inputField.setValue(tag);
            await new Promise(r => setTimeout(r, 1000));

            // 3. Kliknij Szukaj (Enter na klawiaturze)
            console.log('⌨️ Wciskam Enter/Szukaj...');
            await this.adbKeyevent(66); // KEYCODE_ENTER - szybsze niż performEditorAction
            await new Promise(r => setTimeout(r, 5000));

            return true;
        } catch (e) {
            console.error('⚠️ Błąd nawigacji do wyszukiwania:', e.message);
            return false;
        }
    }

    async enterFirstSearchResult() {
        console.log('👆 Wchodzę w pierwszy wynik (ADB)...');
        // Używamy ADB tap zamiast WebDriver action - szybsze i niezawodne
        await this.adbTapRelative(0.25, 0.30); // Lewy górny wynik w gridzie
        await new Promise(r => setTimeout(r, 3000));
        return true;
    }

    async restartSession(maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            console.log(`🔄 Restart sesji Appium (próba ${attempt}/${maxRetries})...`);
            this.sendStatus('working', `🔄 Restart sesji (${attempt}/${maxRetries})...`);

            // 1. Zamknij starą sesję
            try { if (this.driver) await this.driver.deleteSession(); } catch (e) { }
            this.driver = null;

            // 2. Ubij UiAutomator2 na urządzeniu (root cause crashy)
            try {
                await this.adbExec('am force-stop io.appium.uiautomator2.server');
                await this.adbExec('am force-stop io.appium.uiautomator2.server.test');
            } catch (e) { }

            // 3. Cooldown (rosnący z każdą próbą)
            const cooldown = 10000 + (attempt - 1) * 5000; // 10s, 15s, 20s
            console.log(`⏳ Cooldown ${cooldown / 1000}s...`);
            await new Promise(r => setTimeout(r, cooldown));

            // 4. Próba ponownego połączenia
            try {
                await this.init();
                console.log('✅ Sesja wznowiona pomyślnie!');
                this.sendStatus('working', '✅ Sesja wznowiona');
                return true;
            } catch (e) {
                console.error(`❌ Restart próba ${attempt} nieudana:`, e.message);
                if (attempt === maxRetries) {
                    console.error('💀 Wyczerpano limity restartów sesji.');
                    this.sendStatus('stopped', '💀 Nie udało się wznowić sesji');
                    return false;
                }
            }
        }
        return false;
    }

    /**
     * Sprawdza czy bot utknął w menu dodawania TikToka (przycisk +)
     * Używa WYŁĄCZNIE ADB activity check (~100ms) zamiast XPath queries (~90s)
     * @returns {Promise<boolean>} - true jeśli jesteśmy w menu dodawania
     */
    async checkIfInAddMenu() {
        try {
            // Cudzysłowy: pipe musi iść przez shell Androida (ma grep), NIE przez Windows cmd (nie ma grep)
            const currentActivity = await this.adbExec('"dumpsys activity activities | grep -E \'mResumedActivity|ResumedActivity\' || true"');
            if (!currentActivity) return false;

            const activityLower = currentActivity.toLowerCase();

            // Wzorce activity specyficzne dla menu kamery/dodawania
            const cameraActivityPatterns = [
                'shootactivity',           // ShootActivity - główny ekran nagrywania
                'recordactivity',          // RecordActivity
                'cameraactivity',          // CameraActivity
                'publishactivity',         // PublishActivity - ekran publikacji
                'postactivity',            // PostActivity
                'uploadactivity',          // UploadActivity
                'editactivity',            // EditActivity - edycja wideo
                'shortvideo.ui.shoot',     // com.ss.android.ugc.aweme.shortvideo.ui.ShootXXX
                'record.activity',         // com.xxx.record.activity.XXX
                'camera.activity',         // com.xxx.camera.activity.XXX
                'creation.activity',       // Ekrany tworzenia treści
                'draft.activity'           // Szkice
            ];

            for (const pattern of cameraActivityPatterns) {
                if (activityLower.includes(pattern)) {
                    console.log(`🚨 Wykryto menu dodawania (activity: ${pattern})`);
                    return true;
                }
            }

            // Heurystyka: activity "aweme" bez znanych ekranów feedu = podejrzane
            if (activityLower.includes('aweme') &&
                !activityLower.includes('main') &&
                !activityLower.includes('splash') &&
                !activityLower.includes('feed') &&
                !activityLower.includes('detail') &&
                !activityLower.includes('profile') &&
                !activityLower.includes('comment') &&
                !activityLower.includes('search')) {
                console.log('⚠️ Podejrzane activity (nieznany ekran aweme) - traktuję jako menu dodawania');
                return true;
            }

            return false;
        } catch (e) {
            console.warn('⚠️ Błąd sprawdzania menu dodawania:', e.message);
            return false;
        }
    }

    /**
     * Ucieka z menu dodawania TikToka i wraca do głównego feedu
     * Strategia: BACK + popup → X → kolejny BACK → force restart
     * Wszystkie sprawdzenia przez ADB (~100ms każde, zero obciążenia Appium)
     * @returns {Promise<boolean>} - true jeśli udało się wrócić
     */
    async escapeFromAddMenu() {
        console.log('🚨 Wykryto menu dodawania! Wracam do feedu...');
        this.sendStatus('working', '🔙 Wracam do feedu...');

        try {
            // Próba 1: BACK + obsługa popupu "Odrzuć"
            console.log('🔙 Próba 1: BACK + popup...');
            await this.adbKeyevent(4); // KEYCODE_BACK
            await new Promise(r => setTimeout(r, 2000));
            await this.adbTapRelative(0.70, 0.60); // "Odrzuć" prawy-środek
            await new Promise(r => setTimeout(r, 500));
            await this.adbTapRelative(0.50, 0.65); // "Odrzuć" środek-dół
            await new Promise(r => setTimeout(r, 1500));

            if (!(await this.checkIfInAddMenu())) {
                console.log('✅ Wyszedłem z menu (próba 1)');
                await this.adbTapRelative(0.10, 0.97); // Klik "Główna"
                await new Promise(r => setTimeout(r, 2000));
                this.sendStatus('working', '✅ Wrócono do feedu');
                return true;
            }

            // Próba 2: Kliknij X (lewy górny róg) + popup
            console.log('🔙 Próba 2: Klik X + BACK...');
            await this.adbTapRelative(0.07, 0.05);
            await new Promise(r => setTimeout(r, 1000));
            await this.adbTapRelative(0.07, 0.10);
            await new Promise(r => setTimeout(r, 1000));
            await this.adbTapRelative(0.50, 0.65); // Popup "Odrzuć"
            await new Promise(r => setTimeout(r, 1000));
            await this.adbKeyevent(4); // Kolejny BACK
            await new Promise(r => setTimeout(r, 1500));
            await this.adbTapRelative(0.50, 0.65); // Popup
            await new Promise(r => setTimeout(r, 1500));

            if (!(await this.checkIfInAddMenu())) {
                console.log('✅ Wyszedłem z menu (próba 2)');
                await this.adbTapRelative(0.10, 0.97); // Klik "Główna"
                await new Promise(r => setTimeout(r, 2000));
                this.sendStatus('working', '✅ Wrócono do feedu');
                return true;
            }

            // Próba 3: Force stop + restart TikToka (gwarantowany reset)
            console.log('🔙 Próba 3: Force stop + restart...');
            await this.adbExec('am force-stop com.zhiliaoapp.musically');
            await new Promise(r => setTimeout(r, 2000));
            await this.driver.activateApp('com.zhiliaoapp.musically');
            await new Promise(r => setTimeout(r, 5000));

            const escaped = !(await this.checkIfInAddMenu());
            if (escaped) {
                console.log('✅ Wrócono do feedu po restarcie');
                this.sendStatus('working', '✅ Wrócono do feedu');
            } else {
                console.warn('⚠️ Nie udało się wyjść z menu mimo restartu');
            }
            return escaped;

        } catch (e) {
            console.error('❌ Błąd podczas ucieczki z menu dodawania:', e.message);
            try {
                await this.adbKeyevent(3); // HOME
            } catch (e2) { }
            return false;
        }
    }

    /**
     * Sprawdza czy jesteśmy na głównym feedzie TikToka
     * Używa WYŁĄCZNIE ADB activity check (~100ms) zamiast XPath queries
     * @returns {Promise<boolean>} - true jeśli jesteśmy na feedzie
     */
    async checkIfOnMainFeed() {
        const state = await this.detectUiState();
        if (state === 'feed') {
            console.log('📍 ✅ Na feedzie (ADB activity check)');
            return true;
        }
        console.log(`📍 ❌ Nie na feedzie (stan: ${state})`);
        return false;
    }

    /**
     * Uruchamia interwał sprawdzający czy bot utknął w menu dodawania
     */
    startAddMenuCheck() {
        if (this.addMenuCheckInterval) {
            clearInterval(this.addMenuCheckInterval);
        }

        console.log(`🔍 Uruchamiam watchdog feedu co ${(this.addMenuCheckFrequency / 60000).toFixed(1)} min`);

        this.addMenuCheckInterval = setInterval(async () => {
            try {
                if (this.isBusy) {
                    console.log('🔍 Bot zajęty (komentarz/reply) - pomijam watchdog');
                    return;
                }

                const state = await this.detectUiState();

                if (state === 'feed') {
                    // Activity mówi "feed" ale TikTok używa jednej Activity dla overlayów
                    // Dodatkowy check: czy elementy feedu są widoczne?
                    try {
                        const els = await this.driver.$$('id:com.zhiliaoapp.musically:id/desc');
                        if (els.length === 0) {
                            // Brak elementów feedu mimo "feed" activity = overlay (profil/komentarze/search)
                            this.consecutiveUnknowns++;
                            console.log(`🔍 Watchdog: activity=feed ale brak elementów feedu #${this.consecutiveUnknowns}/2`);
                            if (this.consecutiveUnknowns >= 2) {
                                console.log('🔧 Watchdog: off-feed overlay wykryty, recovery...');
                                this.sendStatus('working', '🔧 Watchdog: recovery (overlay)...');
                                await this.recoverToFeed();
                                this.consecutiveUnknowns = 0;
                            }
                            return;
                        }
                    } catch (e) {
                        // Appium error — nie blokuj, traktuj jak unknown
                    }
                    this.consecutiveUnknowns = 0;
                    console.log('🔍 Watchdog: stan UI = feed ✅');
                    return;
                }

                if (state === 'unknown') {
                    // ADB error / przejściowy problem — nie odpalaj od razu ciężkiego recovery
                    this.consecutiveUnknowns++;
                    console.log(`🔍 Watchdog: unknown #${this.consecutiveUnknowns} (ADB problem?)`);
                    if (this.consecutiveUnknowns < 2) {
                        return; // Poczekaj na następny tick
                    }
                    // 2+ unknown z rzędu = prawdopodobnie realny problem
                    console.log('🔧 Watchdog: powtarzający się unknown, próbuję recovery...');
                    this.sendStatus('working', '🔧 Watchdog: ADB recovery...');
                    await this.recoverToFeed();
                    return;
                }

                this.consecutiveUnknowns = 0;

                if (state === 'camera') {
                    console.log('🚨 Watchdog: wykryto kamerę!');
                    await this.escapeFromAddMenu();
                } else {
                    // Profile, search, inbox, live — recovery od razu
                    console.log(`🔧 Watchdog: off-feed (${state}), uruchamiam recovery...`);
                    this.sendStatus('working', `🔧 Watchdog: recovery (${state})...`);
                    await this.recoverToFeed();
                }
            } catch (e) {
                console.warn('⚠️ Watchdog error:', e.message);
            }
        }, this.addMenuCheckFrequency);
    }

    /**
     * Zatrzymuje interwał sprawdzania menu dodawania
     */
    stopAddMenuCheck() {
        if (this.addMenuCheckInterval) {
            clearInterval(this.addMenuCheckInterval);
            this.addMenuCheckInterval = null;
            console.log('🛑 Zatrzymano sprawdzanie menu dodawania');
        }
    }

    async ensureTagVideoMode() {
        // OPTYMALIZACJA: Ta funkcja była wywoływana CO CYKL i powodowała ~30s opóźnienia!
        // Teraz jest uproszczona - zakładamy, że po swipe jesteśmy w trybie wideo.
        // Jeśli coś pójdzie nie tak, bot i tak zrobi swipe.
        return true;
    }

    /**
     * Otwiera panel komentarzy (tap na ikonę 💬)
     */
    async openCommentsPanel() {
        try {
            console.log('💬 Otwieram panel komentarzy...');
            await this.adbTapRelative(0.93, this.calibration.commentY / 100);
            await new Promise(r => setTimeout(r, 2500));
            return true;
        } catch (e) {
            console.error('❌ Błąd otwierania panelu komentarzy:', e.message);
            return false;
        }
    }

    /**
     * Scrolluje panel komentarzy
     * @param {number} times - Ile razy scrollować (1-2)
     */
    async scrollComments(times = 1) {
        try {
            console.log(`📜 Scrolluję panel komentarzy ${times}x...`);
            const { width, height } = this.windowSize;
            for (let i = 0; i < times; i++) {
                // Losowe parametry scrolla (jak palec człowieka)
                const startY = Math.floor(height * (0.65 + Math.random() * 0.1));  // 65-75%
                const endY = Math.floor(height * (0.35 + Math.random() * 0.1));    // 35-45%
                const x = Math.floor(width * (0.4 + Math.random() * 0.2));         // 40-60%
                const endX = Math.floor(x + (Math.random() * 40 - 20));            // lekki łuk
                const duration = 350 + Math.floor(Math.random() * 250);            // 350-600ms

                await new Promise((resolve) => {
                    exec(`adb -s ${this.udid} shell input swipe ${x} ${startY} ${endX} ${endY} ${duration}`, () => { resolve(); });
                });

                await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 600)));
            }
            return true;
        } catch (e) {
            console.error('❌ Błąd scrollowania komentarzy:', e.message);
            return false;
        }
    }

    /**
     * Robi screenshot panelu komentarzy
     * @returns {Promise<string>} - Screenshot w formacie base64
     */
    async captureCommentsScreenshot() {
        try {
            console.log('📸 Robię screenshot panelu komentarzy...');
            const screenshot = await this.driver.takeScreenshot();
            return screenshot;
        } catch (e) {
            console.error('❌ Błąd screenshota:', e.message);
            return null;
        }
    }

    /**
     * Mapuje pozycję opisową (góra/środek/dół) na współrzędne Y
     * @param {string} position - "góra", "środek" lub "dół"
     * @returns {number} - Procent Y (0.0 - 1.0)
     */
    mapCommentPosition(position) {
        const positionMap = {
            'góra': 0.25,
            'środek': 0.50,
            'dół': 0.75
        };
        return positionMap[position] || 0.50;
    }

    /**
     * Klika przycisk "Odpowiedz" przy komentarzu
     * @param {string} position - Pozycja komentarza ("góra"/"środek"/"dół")
     */
    async tapReplyButton(position) {
        try {
            const yPercent = this.mapCommentPosition(position);
            console.log(`👆 Klikam "Odpowiedz" przy komentarzu (Y=${yPercent})...`);

            // Przycisk "Odpowiedz" jest po prawej stronie komentarza (~85% szerokości)
            await this.adbTapRelative(0.85, yPercent);
            await new Promise(r => setTimeout(r, 1500));
            return true;
        } catch (e) {
            console.error('❌ Błąd klikania "Odpowiedz":', e.message);
            // Fallback: długie przytrzymanie na komentarzu
            try {
                console.log('🔄 Próbuję długie przytrzymanie...');
                const yPercent = this.mapCommentPosition(position);
                await this.adbExec(`input swipe ${this.windowSize.width * 0.5} ${this.windowSize.height * yPercent} ${this.windowSize.width * 0.5} ${this.windowSize.height * yPercent} 1000`);
                await new Promise(r => setTimeout(r, 1500));
                return true;
            } catch (e2) {
                console.error('❌ Fallback nie powiódł się:', e2.message);
                return false;
            }
        }
    }

    /**
     * Wpisuje i wysyła odpowiedź na komentarz
     * @param {string} replyText - Treść odpowiedzi
     */
    async typeAndSendReply(replyText) {
        try {
            console.log(`⌨️ Wpisuję odpowiedź: "${replyText}"...`);

            // 1. Kliknij pole tekstowe
            await this.adbTapRelative(0.50, 0.92);
            await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 1000))); // 1.5-2.5s

            // 2. Wpisz tekst przez ADB
            const cleanReply = this.stripEmoji(replyText).trim();
            if (cleanReply) {
                await this.adbType(cleanReply);
            }
            await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 500))); // 1.5-2s

            // 3. Kliknij WYŚLIJ (kalibracja z device_configs.json)
            const sendY = this.calibration.sendButtonY / 100;
            console.log(`📤 Wysyłam odpowiedź (Y=${this.calibration.sendButtonY}%)...`);
            await this.adbTapRelative(0.92, sendY);
            await new Promise(r => setTimeout(r, 3000 + Math.floor(Math.random() * 1000))); // 3-4s

            return true;
        } catch (e) {
            console.error('❌ Błąd wysyłania odpowiedzi:', e.message);
            return false;
        }
    }

    /**
     * Główna funkcja trybu "Odpowiedzi na komentarze"
     * @param {Object} context - Kontekst filmu
     * @param {number} replyProb - Prawdopodobieństwo odpowiedzi (0.0 - 1.0)
     * @param {string} replyPrompt - Prompt użytkownika dla odpowiedzi
     * @returns {Promise<boolean>} - Czy wykonano akcję
     */
    async replyToComments(context, replyProb = 0.35, replyPrompt = '') {
        // Losuj czy odpowiadać (PRZED ustawieniem isBusy)
        if (Math.random() >= replyProb) {
            console.log(`⏭️ Pomijam odpowiedź (losowanie: ${(replyProb * 100).toFixed(0)}%)`);
            return false;
        }

        this.isBusy = true; // Blokuj interwał addMenuCheck
        try {
            console.log('💬 [REPLY MODE] Rozpoczynam odpowiadanie na komentarze...');
            this.sendStatus('working', '💬 Odpowiadam na komentarze...');

            // 1. Otwórz panel komentarzy
            const panelOpened = await this.openCommentsPanel();
            if (!panelOpened) {
                console.log('❌ Nie udało się otworzyć panelu komentarzy');
                return false; // finally resetuje isBusy
            }

            // 2. Scrolluj panel 1-2 razy
            const scrollTimes = Math.random() < 0.5 ? 1 : 2;
            await this.scrollComments(scrollTimes);

            // 3. Zrób screenshot
            const screenshot = await this.captureCommentsScreenshot();
            if (!screenshot) {
                console.log('❌ Nie udało się zrobić screenshota');
                await this.adbKeyevent(4); // Zamknij panel
                return false;
            }

            // 4. Wyślij do GPT Vision
            console.log('🤖 Analizuję komentarze przez AI Vision...');
            const analysis = await this.ai.analyzeComments(screenshot, replyPrompt);

            if (!analysis || !analysis.found) {
                console.log('⚠️ Brak odpowiedniego komentarza, pomijam');
                await this.adbKeyevent(4); // Zamknij panel
                return false;
            }

            // 5. Kliknij "Odpowiedz" przy wybranym komentarzu
            const replyClicked = await this.tapReplyButton(analysis.commentPosition);
            if (!replyClicked) {
                console.log('❌ Nie udało się kliknąć "Odpowiedz"');
                await this.adbKeyevent(4);
                return false;
            }

            // 6. Wpisz i wyślij odpowiedź
            const replySent = await this.typeAndSendReply(analysis.suggestedReply);
            if (!replySent) {
                console.log('❌ Nie udało się wysłać odpowiedzi');
                await this.adbKeyevent(4);
                return false;
            }

            // 7. Zamknij panel
            console.log('🏁 Zamykam panel komentarzy...');
            await this.adbTapRelative(0.5, 0.2); // Tap tła
            await new Promise(r => setTimeout(r, 1500));

            // 8. Aktualizuj statystyki
            if (!this.sessionStats.replied) this.sessionStats.replied = 0;
            this.sessionStats.replied++;
            this.sendStats('replies');
            this.sendStatus('working', '✅ Odpowiedź wysłana');

            console.log(`✅ [REPLY MODE] Pomyślnie odpowiedziano na komentarz od @${analysis.authorName}`);
            return true;

        } catch (e) {
            console.error('❌ [REPLY MODE] Błąd:', e.message);
            this.sessionStats.errors++;
            this.sendStats('errors');
            try { await this.adbKeyevent(4); } catch (e2) { }
            return false;
        } finally {
            this.isBusy = false; // GWARANCJA resetu na każdym wyjściu
        }
    }

    async run(mode = 'feed', tag = null, cycles = 1000) {
        try {
            console.log(`🤖 Start w trybie: ${mode.toUpperCase()}`);
            await this.init();

            // Uruchom sprawdzanie menu dodawania w tle
            this.startAddMenuCheck();

            // Obsługa trybu TAGI - Wejście początkowe
            if (mode === 'tags' && tag && tag !== 'NO_TAG') {
                // [FIX] Losowanie tagu jeśli podano wiele po średniku
                let selectedTag = tag;
                if (tag.includes(';')) {
                    const tags = tag.split(';').filter(t => t.trim().length > 0);
                    selectedTag = tags[Math.floor(Math.random() * tags.length)];
                    console.log(`🎲 Wylosowano tag z listy: ${selectedTag}`);
                }

                const searchSuccess = await this.goToSearch(selectedTag);
                if (searchSuccess) {
                    await this.enterFirstSearchResult();
                } else {
                    console.error('❌ Nie udało się wyszukać taga. Przechodzę do Feed.');
                }
            }

            let cycle = 0;
            let consecutiveCrashes = 0; // Licznik kolejnych crashy sesji
            while (cycle < cycles) {
                cycle++;
                this.sessionStats.watched++;
                this.sendStats('watched');
                this.sendStatus('working', `Cykl #${cycle} / ${cycles}`);
                console.log(`\n📍 CYKL #${cycle} / ${cycles}`);

                // Sprawdź stan UI co 10 cykli (feed/kamera/profil/search/...)
                if (cycle % 10 === 0) {
                    const uiState = await this.detectUiState();
                    if (uiState === 'camera') {
                        await this.escapeFromAddMenu();
                        continue;
                    } else if (uiState !== 'feed' && uiState !== 'unknown') {
                        console.log(`🔧 Cykl #${cycle}: off-feed (${uiState}), recovery...`);
                        await this.recoverToFeed();
                        continue;
                    }
                }

                if (mode === 'tags') {
                    await this.ensureTagVideoMode();
                }

                await new Promise(r => setTimeout(r, 3000 + Math.floor(Math.random() * 3000))); // 3-6s
                await this.checkPopups();

                // [FIX] 1. Pobierz kontekst OD RAZU po wejściu na wideo
                let context = { description: '', author: '', music: '' };
                try {
                    context = await this.getVideoContext();
                } catch (e) { console.log('⚠️ Błąd pobierania kontekstu (pre-check):', e.message); }

                // Heurystyka off-feed: jeśli getVideoContext zwraca puste 3x z rzędu = nie jesteśmy na feedzie
                // (TikTok używa jednej Activity dla wielu ekranów, activity check nie wykrywa overlayów)
                if (!context.description && (!context.author || context.author === 'Nieznany')) {
                    this.consecutiveEmptyContexts++;
                    console.log(`⚠️ Pusty kontekst #${this.consecutiveEmptyContexts}/3`);
                    if (this.consecutiveEmptyContexts >= 3) {
                        console.log('🔧 3x pusty kontekst z rzędu — prawdopodobnie off-feed, recovery...');
                        this.sendStatus('working', '🔧 Off-feed wykryty, recovery...');
                        await this.recoverToFeed();
                        this.consecutiveEmptyContexts = 0;
                        continue;
                    }
                } else {
                    this.consecutiveEmptyContexts = 0;
                }

                // [FIX] 2. Sprawdź czy film był oglądany ZANIM zaczniesz oglądać
                if (context && this.isVisited(context.description)) {
                    console.log('⏭️ Film już oglądany (Fast Skip) - pomijam.');
                    this.sendStatus('working', '⏭️ Fast Skip (Widziany)...');
                    await this.swipeUp();
                    continue; // Przejdź do następnego cyklu pętli natychmiast
                }

                // Bimodalny rozkład oglądania (jak prawdziwy użytkownik)
                const roll = Math.random();
                let watchTime;
                let isQuickScroll = false;

                if (roll < 0.30) {
                    // Szybki scroll - nie interesuje (1-3s)
                    watchTime = 1000 + Math.floor(Math.random() * 2000);
                    isQuickScroll = true;
                } else if (roll < 0.80) {
                    // Normalne oglądanie (6-18s)
                    watchTime = 6000 + Math.floor(Math.random() * 12000);
                } else {
                    // Długie oglądanie - mocno zainteresowany (18-40s)
                    watchTime = 18000 + Math.floor(Math.random() * 22000);
                }

                console.log(`👀 Oglądam przez ${(watchTime / 1000).toFixed(1)}s${isQuickScroll ? ' (quick scroll)' : ''}...`);
                await new Promise(r => setTimeout(r, watchTime));

                let actionPerformed = false;
                try {
                    // Quick scroll = pasywna konsumpcja (człowiek nie lajkuje po 1.5s oglądania)
                    if (isQuickScroll) {
                        this.addToVisited(context.description);
                        await this.swipeUp();
                        await new Promise(r => setTimeout(r, 500 + Math.floor(Math.random() * 1000)));
                        continue;
                    }

                    // context mamy już pobrany wyżej.
                    // Jeśli był null (błąd), spróbujmy jeszcze raz (może się załadował)
                    if (!context || !context.description) {
                        context = await this.getVideoContext();
                    }

                    // Logika odwiedzin (powtórne sprawdzenie na wszelki wypadek, ale skip już zadziałał wyżej)
                    if (this.isVisited(context.description)) {
                        console.log('⏭️ Film już oglądany - pomijam (Double Check).');
                        await this.swipeUp();
                        continue;
                    }

                    if (context.description || (context.music && context.music !== 'Oryginalny dźwięk')) {
                        const getProb = (val, defaultVal) => {
                            if (val === undefined || val === null || val === '') return defaultVal;
                            const parsed = parseFloat(val);
                            return isNaN(parsed) ? defaultVal : parsed;
                        };

                        const probLike = getProb(process.env.LIKE_PROBABILITY, 0);
                        const probFollow = getProb(process.env.FOLLOW_PROBABILITY, 0);
                        const probComment = getProb(process.env.COMMENT_PROBABILITY, 0);
                        const probReply = getProb(process.env.REPLY_PROBABILITY, 0);
                        const replyPrompt = process.env.REPLY_PROMPT || '';

                        // Buduj listę akcji i losuj kolejność (człowiek nie robi zawsze like→follow→comment)
                        const actions = [];
                        if (probLike > 0 && Math.random() < probLike) {
                            actions.push({ name: 'like', fn: () => this.likeVideo(context.description) });
                        }
                        if (probFollow > 0 && Math.random() < probFollow) {
                            actions.push({ name: 'follow', fn: () => this.followUser() });
                        }
                        if (mode === 'replies') {
                            if (probReply > 0) {
                                actions.push({ name: 'reply', fn: () => this.replyToComments(context, probReply, replyPrompt), setsAction: true });
                            }
                        } else {
                            if (probComment > 0 && Math.random() < probComment) {
                                actions.push({ name: 'comment', fn: () => this.commentOnVideo(context), setsAction: true });
                            }
                        }

                        // Fisher-Yates shuffle
                        for (let i = actions.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [actions[i], actions[j]] = [actions[j], actions[i]];
                        }

                        // Wykonaj w losowej kolejności
                        for (const action of actions) {
                            const result = await action.fn();
                            if (action.setsAction && result) actionPerformed = true;
                        }

                        // Zapisz film jako obejrzany (dla logiki pomijania)
                        this.addToVisited(context.description);
                    }

                    // Reset crash countera po udanym cyklu
                    consecutiveCrashes = 0;

                    // Recovery check po akcjach - jeśli miss-click nas wyrzucił z feedu, wróć
                    await this.recoverToFeed();

                    // Jeśli NIE robiliśmy komentarza (który ma własny swipe), to robimy swipe tutaj
                    if (!actionPerformed) {
                        await this.swipeUp();
                    }
                    await new Promise(r => setTimeout(r, 1500 + Math.floor(Math.random() * 1500)));
                } catch (e) {
                    console.error(`❌ Błąd w cyklu #${cycle}:`, e.message);
                    this.sessionStats.errors++;
                    this.sendStats('errors');

                    // Crash sesji Appium/UiAutomator2
                    if (this.isSessionDead(e)) {
                        consecutiveCrashes++;
                        console.error(`💀 Sesja martwa (crash #${consecutiveCrashes}/5)`);
                        this.sendStatus('working', `💀 Crash sesji #${consecutiveCrashes}/5 - restartuję...`);

                        if (consecutiveCrashes >= 5) {
                            console.error('🛑 Za dużo crashy z rzędu. Zatrzymuję bota.');
                            this.sendStatus('stopped', '🛑 Zbyt wiele crashy sesji - bot zatrzymany');
                            break;
                        }

                        const restarted = await this.restartSession();
                        if (!restarted) {
                            console.error('🛑 Restart nieudany. Zatrzymuję bota.');
                            this.sendStatus('stopped', '🛑 Restart sesji nieudany');
                            break;
                        }
                        continue; // Pomiń resztę i zacznij nowy cykl
                    }

                    // Sprawdź stan UI po błędzie i uruchom recovery jeśli off-feed
                    const uiState = await this.detectUiState();
                    if (uiState === 'camera') {
                        console.log('🔍 Błąd spowodowany przez kamerę');
                        await this.escapeFromAddMenu();
                    } else if (uiState !== 'feed') {
                        console.log(`🔍 Błąd: off-feed (${uiState}), recovery...`);
                        await this.recoverToFeed();
                    }
                }
            }
            // Zatrzymaj sprawdzanie menu dodawania po zakończeniu pętli
            this.stopAddMenuCheck();
        } catch (e) {
            console.error('❌ Krytyczny błąd:', e);
            this.stopAddMenuCheck();
            this.sendStatus('stopped', '❌ Błąd krytyczny.');
        }
    }
}

const args = process.argv.slice(2);
const bot = new TikTokAppiumBot();

process.stdin.on('data', async (data) => {
    if (data.toString().trim() === 'STOP') {
        bot.sendStatus('stopped', '🛑 Zatrzymywanie...');
        console.log('🛑 STOP signal received. Minimizing...');
        bot.stopAddMenuCheck(); // Zatrzymaj sprawdzanie menu
        try {
            if (bot.driver) await bot.driver.pressKeyCode(3); // HOME btn
            await bot.driver.deleteSession();
        } catch (e) { }
        process.exit(0);
    }
});

process.on('SIGINT', async () => {
    bot.stopAddMenuCheck(); // Zatrzymaj sprawdzanie menu
    try { if (bot.driver) await bot.driver.pressKeyCode(3); } catch (e) { }
    process.exit(0);
});

bot.run(args[0] || 'feed', args[1], parseInt(args[2]) || 1000).catch(console.error);
