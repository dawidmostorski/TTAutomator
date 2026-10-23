const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const net = require('net');
require('dotenv').config();

app.setName('TTAutomator');

let mainWindow;
// MAPA PROCESÓW: klucz = deviceId (UDID), wartość = { process, systemPort }
const botProcesses = new Map();

let appiumProcess = null;
let unfollowProcess = null; // Unfollow na razie globalny (można ulepszyć w przyszłości)
let workTimer = null;
let sleepTimer = null;
let updateTimer = null;

// Pula portów systemowych dla Appium (UiAutomator2)
let nextSystemPort = 8200;

// Mapa timerów snu per device (żeby można było anulować)
const sleepTimers = new Map();

function getContext(deviceId) {
    // Helper do logowania
    const prefix = deviceId ? `[${deviceId.slice(0, 5)}...]` : '[MAIN]';
    return { prefix };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        title: 'TTAutomator',
        width: 1200,
        height: 800,
        backgroundColor: '#121212',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- LOGIKA HARMONOGRAMU ---

// --- ZARZĄDZANIE URZĄDZENIAMI ---

const DEVICE_CONFIGS_PATH = path.join(__dirname, '..', 'device_configs.json');

// Ładowanie konfiguracji wszystkich urządzeń
function loadDeviceConfigs() {
    try {
        if (fs.existsSync(DEVICE_CONFIGS_PATH)) {
            return JSON.parse(fs.readFileSync(DEVICE_CONFIGS_PATH, 'utf8'));
        }
    } catch (e) {
        console.error('Błąd ładowania device_configs.json:', e.message);
    }
    return {};
}

// Zapis konfiguracji wszystkich urządzeń
function saveAllDeviceConfigs(configs) {
    try {
        fs.writeFileSync(DEVICE_CONFIGS_PATH, JSON.stringify(configs, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Błąd zapisu device_configs.json:', e.message);
        return false;
    }
}

// Pobierz konfigurację dla konkretnego urządzenia
function getDeviceConfig(deviceId) {
    const configs = loadDeviceConfigs();
    return configs[deviceId] || {
        // Domyślne ustawienia
        probLike: 0.7,
        probComment: 0.4,
        probFollow: 0.3,
        mode: 'feed',
        tag: '',
        workTime: 120,
        sleepTime: 60,
        commentMode: 'ai',
        aiPrompt: 'Jesteś luźnym użytkownikiem TikToka. Komentuj krótko, naturalnie, po polsku. Używaj mało emoji.',
        staticComments: ''
    };
}

// Zapisz konfigurację dla konkretnego urządzenia
function saveDeviceConfig(deviceId, config) {
    const configs = loadDeviceConfigs();
    configs[deviceId] = { ...configs[deviceId], ...config };
    return saveAllDeviceConfigs(configs);
}

ipcMain.handle('get-devices', async () => {
    return new Promise((resolve) => {
        exec('adb devices', (error, stdout) => {
            if (error) {
                console.error('Błąd adb devices:', error);
                resolve([]);
                return;
            }
            const deviceIds = [];
            const lines = stdout.split('\n');
            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length === 2 && parts[1].trim() === 'device') {
                    deviceIds.push(parts[0].trim());
                }
            }

            // Pobierz model każdego urządzenia przez ADB
            const promises = deviceIds.map(id => {
                return new Promise((res) => {
                    exec(`adb -s ${id} shell getprop ro.product.model`, (err, out) => {
                        res({ id, model: out ? out.trim() : 'Nieznany' });
                    });
                });
            });
            Promise.all(promises).then(resolve);
        });
    });
});

// IPC dla konfiguracji per device
ipcMain.handle('get-device-config', async (event, deviceId) => {
    return getDeviceConfig(deviceId);
});

ipcMain.handle('save-device-config', async (event, deviceId, config) => {
    return saveDeviceConfig(deviceId, config);
});

ipcMain.handle('get-all-device-configs', async () => {
    return loadDeviceConfigs();
});

ipcMain.on('start-bot', async (event, config) => {
    // Config musi zawierać deviceId (tablica lub string)
    // Jeśli deviceId to tablica, uruchamiamy dla każdego
    const devices = Array.isArray(config.devices) ? config.devices : [config.deviceId];

    // Zapisz konfig raz (wspólny)
    saveCommentConfig(config);

    if (!devices || devices.length === 0) {
        if (mainWindow) mainWindow.webContents.send('console-log', '❌ Nie wybrano żadnych urządzeń!');
        return;
    }

    devices.forEach(deviceId => {
        startWorkCycle(config, deviceId);
    });
});

ipcMain.on('stop-bot', (event, deviceId) => {
    // Jeśli deviceId podane, zatrzymaj konkretnego. Jeśli nie - wszystkie.
    if (deviceId) {
        stopBot(true, deviceId);
    } else {
        stopAllBots();
    }
});

function saveCommentConfig(config) {
    const commentConfig = {
        mode: config.commentMode || 'ai',
        systemPrompt: config.aiPrompt || '',
        staticComments: config.staticComments ? config.staticComments.split('\n').map(c => c.trim()).filter(c => c.length > 0) : []
    };

    const configPath = app.isPackaged
        ? path.join(process.resourcesPath, '..', 'comments_config.json')
        : path.join(__dirname, '..', 'comments_config.json');

    try {
        fs.writeFileSync(configPath, JSON.stringify(commentConfig, null, 2));
        console.log(`💾 Zapisano konfigurację komentarzy: ${configPath}`);
    } catch (e) {
        console.error('Błąd zapisu configu komentarzy:', e);
    }
}


function startWorkCycle(config, deviceId) {
    if (!deviceId) return;

    if (botProcesses.has(deviceId)) {
        console.log(`⚠️ Bot dla ${deviceId} już działa.`);
        return;
    }

    const systemPort = nextSystemPort++; // Przydziel unikalny port
    const workTime = parseInt(config.workTime) * 60 * 1000;

    const botScriptPath = path.join(__dirname, '..', 'bot.js');

    const args = [botScriptPath, config.mode];
    if (config.mode === 'tags') {
        // Rozdziel tagi po średniku i wybierz losowy
        const tagsArray = config.tag.split(';').map(t => t.trim()).filter(t => t.length > 0);
        const randomTag = tagsArray.length > 0 ? tagsArray[Math.floor(Math.random() * tagsArray.length)] : 'funny';
        args.push(randomTag);
        if (mainWindow) mainWindow.webContents.send('console-log', `🏷️ Wylosowano tag: "${randomTag}" (z ${tagsArray.length} dostępnych)`);
    } else {
        args.push("NO_TAG");
    }
    args.push("99999"); // cycles

    // Argumenty Multi-Device
    args.push('--udid', deviceId);
    args.push('--systemPort', systemPort.toString());

    // Ścieżka do konfiguracji komentarzy (dla wersji EXE)
    const configPath = app.isPackaged
        ? path.join(process.resourcesPath, '..', 'comments_config.json')
        : path.join(__dirname, '..', 'comments_config.json');
    args.push('--config', configPath);

    const envPath = app.isPackaged
        ? path.join(process.resourcesPath, '..', '.env')
        : path.join(__dirname, '..', '.env');
    require('dotenv').config({ path: envPath });

    const env = {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        LIKE_PROBABILITY: config.probLike,
        FOLLOW_PROBABILITY: config.probFollow,
        COMMENT_PROBABILITY: config.probComment,
        REPLY_PROBABILITY: config.probReply || 0,
        REPLY_PROMPT: config.replyPrompt || '',
        DEVICE_PIN: process.env.DEVICE_PIN
    };

    console.log(`🚀 [${deviceId}] Start bota (port ${systemPort}): node ${args.join(' ')}`);
    if (mainWindow) mainWindow.webContents.send('console-log', `🚀 [${deviceId.slice(0, 5)}] Uruchamianie...`);

    const child = spawn('node', args, { env, shell: false, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });

    // Zapisz proces w mapie
    botProcesses.set(deviceId, {
        process: child,
        systemPort,
        workTimer: null
    });

    // WAŻNE: Wyślij status 'working' do UI zaraz po uruchomieniu (naprawia bug po wybudzeniu ze snu)
    if (mainWindow) mainWindow.webContents.send('device-status', { deviceId, status: 'working', text: '🚀 Uruchamianie...' });

    // --- IPC Listener (Statusy i Statystyki bezpośrednio z bota) ---
    child.on('message', (msg) => {
        if (msg.type === 'device-status') {
            // Bezpośredni update statusu
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('device-status', msg);
            }
        } else if (msg.type === 'stats-update') {
            // Bezpośredni update statystyk
            if (mainWindow && !mainWindow.isDestroyed()) {
                // Konwersja formatu: bot wysyła statsType, renderer oczekuje { deviceId, type }
                mainWindow.webContents.send('stats-update', {
                    deviceId: msg.deviceId,
                    type: msg.statsType
                });
            }
        }
    });

    child.stdout.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            const msg = data.toString();
            // Prefixujemy logi ID urządzenia
            const logLine = `[${deviceId.slice(0, 5)}] ${msg}`;
            mainWindow.webContents.send('console-log', logLine);
            // Stats liczone wyłącznie przez IPC (child.on('message')) - usunięto duplikat z stdout
        }
    });

    child.stderr.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('console-log', `[${deviceId.slice(0, 5)}] ERR: ${data.toString()}`);
        }
    });

    child.on('close', (code) => {
        console.log(`[${deviceId}] Bot process exited with code ${code}`);
        botProcesses.delete(deviceId);

        // WAŻNE: Aktualizacja UI dla konkretnego urządzenia
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('device-status', { deviceId, status: 'stopped', text: 'Zatrzymany.' });
        }

        if (botProcesses.size === 0) {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('status-update', { status: 'idle', text: 'Wszystkie boty zatrzymane.' });
        }
    });

    // Timer pracy dla tego konkretnego bota
    const timer = setTimeout(() => {
        console.log(`[${deviceId}] Koniec czasu pracy.`);
        stopBot(false, deviceId, config);
    }, workTime);

    // Zaktualizuj timer w mapie (child już tam jest, ale obiekt jest referencją, więc ok, ale lepiej bezpiecznie)
    const procData = botProcesses.get(deviceId);
    if (procData) procData.workTimer = timer;

    if (mainWindow) mainWindow.webContents.send('status-update', { status: 'working', text: `Praca: ${botProcesses.size} urz.` });
}

function stopBot(isUserStop, deviceId, config = null) {
    // Anuluj sleep timer jeśli user ręcznie zatrzymuje (żeby bot nie "zmartwychwstał")
    if (isUserStop && sleepTimers.has(deviceId)) {
        clearTimeout(sleepTimers.get(deviceId));
        sleepTimers.delete(deviceId);
        console.log(`[${deviceId}] 🛑 Anulowano timer snu`);
    }

    const procData = botProcesses.get(deviceId);
    if (!procData) {
        // Wyślij status idle nawet jeśli proces nie istnieje
        if (mainWindow) mainWindow.webContents.send('device-status', { deviceId, status: 'idle', text: 'Zatrzymano' });
        return;
    }

    const child = procData.process;
    if (procData.workTimer) clearTimeout(procData.workTimer);

    if (child) {
        if (mainWindow) mainWindow.webContents.send('console-log', `[${deviceId.slice(0, 5)}] 🛑 Zatrzymywanie...`);
        // Wyślij status stopping
        if (mainWindow) mainWindow.webContents.send('device-status', { deviceId, status: 'stopping', text: 'Zatrzymywanie...' });

        try {
            if (child.stdin) child.stdin.write('STOP\n');
        } catch (e) { }

        setTimeout(() => {
            // Force kill jeśli nadal istnieje
            if (botProcesses.has(deviceId)) {
                try {
                    require('child_process').spawn('taskkill', ['/pid', child.pid, '/f', '/t']);
                } catch (e) { child.kill(); }
                botProcesses.delete(deviceId);
            }

            // Wyślij status idle po zatrzymaniu
            if (mainWindow) mainWindow.webContents.send('device-status', { deviceId, status: 'idle', text: 'Zatrzymano' });
            if (mainWindow) mainWindow.webContents.send('console-log', `[${deviceId.slice(0, 5)}] ✅ Zatrzymano pomyślnie`);

            // Sleep cycle logic (tylko jeśli nie user stop)
            if (!isUserStop && config) {
                // Force-stop TikTok na telefonie przed snem (po godzinach pracy appka się przeciąża)
                exec(`adb -s ${deviceId} shell am force-stop com.zhiliaoapp.musically`, (err) => {
                    if (err) console.warn(`⚠️ [${deviceId}] Błąd force-stop TikTok:`, err.message);
                    else console.log(`[${deviceId}] 🛑 TikTok wyłączony na czas snu`);
                });
                if (mainWindow) mainWindow.webContents.send('console-log', `[${deviceId.slice(0, 5)}] 🛑 TikTok wyłączony na czas snu`);
                startSleepCycle(config, deviceId);
            }
        }, 5000);
    }
}

function stopAllBots() {
    if (mainWindow) mainWindow.webContents.send('console-log', '🛑 Zatrzymywanie WSZYSTKICH botów...');
    // Anuluj wszystkie sleep timery
    sleepTimers.forEach((timer, deviceId) => {
        clearTimeout(timer);
        console.log(`[${deviceId}] 🛑 Anulowano timer snu`);
    });
    sleepTimers.clear();
    botProcesses.forEach((value, key) => {
        stopBot(true, key);
    });
    if (mainWindow) mainWindow.webContents.send('status-update', { status: 'idle', text: 'Zatrzymano wszystkie.' });
}

// Zmodyfikowany Sleep Cycle (per device)
function startSleepCycle(config, deviceId) {
    const sleepTime = parseInt(config.sleepTime) * 60 * 1000;
    const sleepMinutes = (sleepTime / 60000).toFixed(1);

    if (mainWindow) {
        mainWindow.webContents.send('console-log', `[${deviceId.slice(0, 5)}] 💤 Sen przez ${sleepMinutes} min...`);
        // WAŻNE: Wyślij status 'sleeping' do UI żeby zaktualizować przycisk i etykietę
        mainWindow.webContents.send('device-status', {
            deviceId,
            status: 'sleeping',
            text: `💤 Sen (${sleepMinutes} min)`
        });
    }

    // Zapisz timer snu żeby można było anulować przy ręcznym Stop
    const timer = setTimeout(() => {
        sleepTimers.delete(deviceId);
        console.log(`[${deviceId}] Koniec snu. Wznawianie...`);
        if (mainWindow) {
            mainWindow.webContents.send('console-log', `[${deviceId.slice(0, 5)}] ⏰ Koniec snu. Wznawianie pracy...`);
        }
        startWorkCycle(config, deviceId);
    }, sleepTime);
    sleepTimers.set(deviceId, timer);
}



// --- UNFOLLOW ---

ipcMain.on('start-unfollow', (event, config) => {
    if (unfollowProcess) {
        mainWindow.webContents.send('console-log', '⚠️ Unfollow już działa.');
        return;
    }

    const daysOld = config.daysOld || 3;
    const maxUnfollows = config.maxUnfollows || 10;
    const deviceId = config.deviceId || null; // Opcjonalny UDID dla konkretnego urządzenia

    // Skrypt unfollow.js znajduje się w katalogu głównym aplikacji.
    const unfollowScriptPath = path.join(__dirname, '..', 'unfollow.js');

    const deviceLabel = deviceId ? `[${deviceId.slice(0, 5)}]` : '[GLOBAL]';
    console.log(`🚀 Uruchamiam Unfollow ${deviceLabel}: ${unfollowScriptPath}`);
    mainWindow.webContents.send('console-log', `🗑️ ${deviceLabel} Start Unfollow (dni: ${daysOld}, max: ${maxUnfollows})...`);
    mainWindow.webContents.send('console-log', 'ℹ️ Pamiętaj o włączeniu serwera (npx appium)!');

    const env = { ...process.env, DEVICE_PIN: process.env.DEVICE_PIN };

    // Args: daysOld, maxUnfollows, [opcjonalnie] udid
    const args = [unfollowScriptPath, daysOld, maxUnfollows];
    if (deviceId) args.push('--udid', deviceId);

    unfollowProcess = spawn('node', args, {
        env,
        shell: false
    });

    unfollowProcess.stdout.on('data', (data) => {
        const msg = data.toString();
        mainWindow.webContents.send('console-log', msg);

        if (msg.includes('Oznaczono w bazie jako Unfollowed') || msg.includes('🗑️')) {
            mainWindow.webContents.send('stats-update', 'unfollowed');
        }
    });

    unfollowProcess.stderr.on('data', (data) => {
        mainWindow.webContents.send('console-log', `ERR: ${data.toString()}`);
    });

    unfollowProcess.on('close', (code) => {
        console.log(`Unfollow process exited with code ${code}`);
        unfollowProcess = null;
        if (code === 0) {
            mainWindow.webContents.send('unfollow-complete', { success: true });
            mainWindow.webContents.send('console-log', '✅ Unfollow zakończony sukcesem.');
        } else {
            mainWindow.webContents.send('unfollow-complete', { success: false });
            mainWindow.webContents.send('console-log', `❌ Unfollow zakończony błędem (kod ${code}).`);
        }
    });
});

// ─── UPLOAD IPC ───

const uploadProcesses = new Map();

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Wybierz folder z filmami'
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

ipcMain.handle('scan-video-folder', async (event, folderPath) => {
    try {
        const files = fs.readdirSync(folderPath);
        const videos = files
            .filter(f => /\.(mp4|mov|avi|mkv|webm)$/i.test(f))
            .map(f => {
                const txtPath = path.join(folderPath, f.replace(/\.[^.]+$/, '.txt'));
                const hasConfig = fs.existsSync(txtPath);
                return { filename: f, hasConfig, fullPath: path.join(folderPath, f) };
            })
            .sort((a, b) => a.filename.localeCompare(b.filename));
        return videos;
    } catch (e) {
        console.error('scan-video-folder error:', e.message);
        return [];
    }
});

ipcMain.on('start-upload', (event, config) => {
    const { deviceId, videoPath } = config;
    if (!deviceId || !videoPath) return;

    if (uploadProcesses.has(deviceId)) {
        console.log(`⚠️ Upload already running on ${deviceId}`);
        return;
    }

    const publisherPath = app.isPackaged
        ? path.join(process.resourcesPath, 'app', 'publisher.js')
        : path.join(__dirname, '..', 'publisher.js');

    const systemPort = 8300 + Math.floor(Math.random() * 100);

    const envPath = app.isPackaged
        ? path.join(process.resourcesPath, '..', '.env')
        : path.join(__dirname, '..', '.env');
    require('dotenv').config({ path: envPath });

    const args = [
        publisherPath,
        '--udid', deviceId,
        '--systemPort', systemPort.toString(),
        '--video', videoPath
    ];

    const child = spawn('node', args, {
        env: { ...process.env, OPENAI_API_KEY: process.env.OPENAI_API_KEY },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    uploadProcesses.set(deviceId, child);

    child.on('message', (msg) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (msg.type === 'upload-progress') {
                mainWindow.webContents.send('upload-progress', msg);
            } else if (msg.type === 'upload-status') {
                mainWindow.webContents.send('upload-status', msg);
            }
        }
    });

    child.stdout.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('console-log', `[UPLOAD ${deviceId.slice(0, 5)}] ${data.toString()}`);
        }
    });

    child.stderr.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('console-log', `[UPLOAD ${deviceId.slice(0, 5)}] ERR: ${data.toString()}`);
        }
    });

    child.on('close', (code) => {
        uploadProcesses.delete(deviceId);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('upload-progress', {
                deviceId,
                done: true,
                success: code === 0,
                error: code !== 0 ? `Process exited with code ${code}` : null
            });
        }
    });
});

ipcMain.on('stop-upload', (event, deviceId) => {
    const proc = uploadProcesses.get(deviceId);
    if (proc) {
        proc.kill('SIGTERM');
        uploadProcesses.delete(deviceId);
    }
});

// --- CLEANUP ---

app.on('before-quit', () => {
    if (appiumProcess) {
        try { appiumProcess.kill(); } catch (e) { }
    }

    // Kill all bots
    botProcesses.forEach((data) => {
        try { data.process.kill(); } catch (e) { }
    });

    if (unfollowProcess) {
        try { unfollowProcess.kill(); } catch (e) { }
    }
});
