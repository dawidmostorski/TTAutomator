const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');

class VideoPublisher {
    constructor(udid, systemPort) {
        this.udid = udid;
        this.systemPort = systemPort;
        this.driver = null;
        this.windowSize = { width: 1080, height: 2400 };
        this.publishing = false;
    }

    // ─── ADB helpers (same pattern as bot.js) ───

    async adbExec(command, { timeout = 15000, silent = false } = {}) {
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell ${command}`, { timeout }, (error, stdout, stderr) => {
                if (error) {
                    if (!silent) console.log(`⚠️ ADB: ${error.message.split('\n')[0]}`);
                    resolve(null);
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }

    async adbHost(command, { timeout = 30000 } = {}) {
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} ${command}`, { timeout }, (error, stdout, stderr) => {
                if (error) {
                    console.log(`⚠️ ADB host: ${error.message.split('\n')[0]}`);
                    resolve(null);
                    return;
                }
                resolve(stdout.trim());
            });
        });
    }

    async adbTapRelative(percentX, percentY) {
        const jitterX = (Math.random() - 0.5) * 0.018;
        const jitterY = (Math.random() - 0.5) * 0.012;
        const x = Math.floor(this.windowSize.width * (percentX + jitterX));
        const y = Math.floor(this.windowSize.height * (percentY + jitterY));
        console.log(`🎯 TAP: ${x}x${y} (${(percentX * 100).toFixed(1)}%, ${(percentY * 100).toFixed(1)}%)`);
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input tap ${x} ${y}`, () => resolve());
        });
    }

    async adbType(text) {
        const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const words = normalized.split(' ').filter(w => w.length > 0);
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const safe = word.replace(/([!$()&'"|<>?*\\`~#{}[\];,])/g, '\\$1');
            if (safe.length > 0) {
                await new Promise((resolve) => {
                    exec(`adb -s ${this.udid} shell input text "${safe}"`, (err) => {
                        if (err) console.warn(`⚠️ adbType error "${word}":`, err.message);
                        resolve();
                    });
                });
                const delay = 300 + word.length * 40 + (i === 0 ? 200 : 0) + (Math.random() < 0.15 ? 600 : 0);
                await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 200)));
            }
            if (i < words.length - 1) {
                await new Promise((resolve) => {
                    exec(`adb -s ${this.udid} shell input keyevent 62`, () => resolve());
                });
                await new Promise(r => setTimeout(r, 100 + Math.floor(Math.random() * 150)));
            }
        }
    }

    async adbKeyevent(keycode) {
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input keyevent ${keycode}`, () => resolve());
        });
    }

    async adbSwipe(x1, y1, x2, y2, duration = 500) {
        return new Promise((resolve) => {
            exec(`adb -s ${this.udid} shell input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`, () => resolve());
        });
    }

    async sleep(ms) {
        return new Promise(r => setTimeout(r, ms + Math.floor(Math.random() * (ms * 0.3))));
    }

    sendStatus(status, text) {
        if (process.send) {
            process.send({ type: 'upload-status', deviceId: this.udid, status, text });
        }
        console.log(`[UPLOAD] ${text}`);
    }

    sendProgress(data) {
        if (process.send) {
            process.send({ type: 'upload-progress', deviceId: this.udid, ...data });
        }
    }

    // ─── Config file parser ───

    parseConfigFile(txtPath) {
        try {
            const content = fs.readFileSync(txtPath, 'utf-8');
            const config = {};
            const lines = content.split('\n').filter(l => l.trim());

            for (const line of lines) {
                const match = line.match(/^(\w+)\s*:\s*(.+)$/i);
                if (!match) continue;
                const key = match[1].toUpperCase().trim();
                const value = match[2].trim();

                switch (key) {
                    case 'OPIS':
                        config.description = value;
                        break;
                    case 'HASHTAGI':
                        config.hashtags = value.split(/\s+/).map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
                        break;
                    case 'MUZYKA':
                        config.music = value;
                        break;
                    case 'LOKALIZACJA':
                        config.location = value;
                        break;
                    case 'OZNACZ':
                        config.mentions = value.split(/\s+/).map(m => m.startsWith('@') ? m : `@${m}`);
                        break;
                }
            }

            return config;
        } catch (e) {
            console.log(`⚠️ Brak pliku konfiguracyjnego: ${txtPath}`);
            return null;
        }
    }

    // ─── Transfer video to phone ───

    async transferToPhone(videoPath) {
        // Zamień spacje na podkreślniki w nazwie na telefonie (unikamy problemów z shellem)
        const safeFilename = path.basename(videoPath).replace(/\s+/g, '_');
        const remotePath = `/sdcard/DCIM/TikTokUpload/${safeFilename}`;

        await this.adbExec('mkdir -p /sdcard/DCIM/TikTokUpload');

        this.sendStatus('working', `📤 Przesyłam ${path.basename(videoPath)}...`);

        // ADB push — exec bezpośrednio (nie przez adbHost, lepsze logowanie)
        const pushCmd = `adb -s ${this.udid} push "${videoPath}" "${remotePath}"`;
        console.log(`📤 CMD: ${pushCmd}`);

        const pushOk = await new Promise((resolve) => {
            exec(pushCmd, { timeout: 120000 }, (error, stdout, stderr) => {
                const output = (stdout || '').trim() + ' ' + (stderr || '').trim();
                console.log(`📤 ADB push output: ${output}`);
                if (error) {
                    console.log(`❌ ADB push error: ${error.message}`);
                    resolve(false);
                    return;
                }
                // ADB push pisze progres na stderr, sukces = brak error
                resolve(true);
            });
        });

        if (!pushOk) {
            console.log('❌ ADB push failed');
            return null;
        }

        console.log(`✅ Przesłano: ${remotePath}`);

        await this.adbExec(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file://${remotePath}"`);
        await this.sleep(2000);

        return remotePath;
    }

    // ─── Cleanup: usuń video z telefonu ───

    async cleanup(remotePath) {
        await this.adbExec(`rm "${remotePath}"`);
        console.log(`🧹 Usunięto z telefonu: ${remotePath}`);
    }

    // ─── Appium session (potrzebna do screenshotów) ───

    async initAppiumSession() {
        const { remote } = require('webdriverio');

        const capabilities = {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:udid': this.udid,
            'appium:systemPort': this.systemPort,
            'appium:noReset': true,
            'appium:newCommandTimeout': 300,
            'appium:skipServerInstallation': true
        };

        this.driver = await remote({
            protocol: 'http',
            hostname: '127.0.0.1',
            port: 4723,
            path: '/',
            capabilities
        });

        const size = await this.driver.getWindowSize();
        this.windowSize = { width: size.width, height: size.height };
        console.log(`📱 Ekran: ${this.windowSize.width}x${this.windowSize.height}`);
    }

    async takeScreenshot() {
        try {
            return await this.driver.takeScreenshot();
        } catch (e) {
            console.log('❌ Screenshot error:', e.message);
            return null;
        }
    }

    // ─── Otwórz TikTok na ekranie tworzenia ───

    async openTikTokCreator() {
        this.sendStatus('working', '📱 Otwieram TikToka...');

        await this.adbExec('am force-stop com.zhiliaoapp.musically');
        await this.sleep(2000);
        await this.adbExec('am start -n com.zhiliaoapp.musically/com.ss.android.ugc.aweme.splash.SplashActivity');
        await this.sleep(5000);

        this.sendStatus('working', '➕ Klikam przycisk tworzenia...');
        await this.adbTapRelative(0.50, 0.93);
        await this.sleep(3000);

        const activity = await this.adbExec('"dumpsys activity activities | grep -E \'mResumedActivity|ResumedActivity\' || true"', { silent: true });
        if (activity && activity.toLowerCase().includes('shootactivity')) {
            console.log('✅ Jesteśmy w trybie tworzenia');
            return true;
        }

        await this.adbTapRelative(0.50, 0.93);
        await this.sleep(3000);
        return true;
    }

    // ─── Wybierz film z galerii ───

    async selectVideoFromGallery(remoteVideoPath) {
        this.sendStatus('working', '🎬 Wybieram film z galerii...');

        // W trybie tworzenia kliknij ikonę uploadu (niebieska, prawa strona od przycisku nagrywania)
        await this.adbTapRelative(0.83, 0.88);
        await this.sleep(3000);

        // Najnowszy film powinien być pierwszy (właśnie go przesłaliśmy)
        // Kliknij pierwszy element w galerii (lewy górny róg siatki)
        await this.adbTapRelative(0.17, 0.30);
        await this.sleep(2000);

        // Kliknij "Dalej" / "Next" (prawy górny róg)
        await this.adbTapRelative(0.90, 0.06);
        await this.sleep(3000);

        // Ekran edycji - kliknij "Dalej" / "Next" ponownie (pomijamy edycję)
        await this.adbTapRelative(0.90, 0.06);
        await this.sleep(3000);

        console.log('✅ Film wybrany, jesteśmy na ekranie opisu');
        return true;
    }

    // ─── Wpisz opis i hashtagi ───

    async fillDescription(description, hashtags) {
        this.sendStatus('working', '📝 Wpisuję opis...');

        // Kliknij pole opisu (górna część ekranu publikacji)
        await this.adbTapRelative(0.50, 0.25);
        await this.sleep(1500);

        if (description) {
            await this.adbType(description);
            await this.sleep(500);
        }

        if (hashtags) {
            await new Promise((resolve) => {
                exec(`adb -s ${this.udid} shell input keyevent 62`, () => resolve());
            });
            await this.sleep(300);
            await this.adbType(hashtags);
            await this.sleep(500);
        }

        // Zamknij klawiaturę
        await this.adbKeyevent(4);
        await this.sleep(1000);

        console.log('✅ Opis wpisany');
        return true;
    }

    // ─── Kliknij "Opublikuj" ───

    async clickPublish() {
        this.sendStatus('working', '🚀 Publikuję...');

        await this.adbTapRelative(0.50, 0.92);
        await this.sleep(8000);

        const activity = await this.adbExec('"dumpsys activity activities | grep -E \'mResumedActivity|ResumedActivity\' || true"', { silent: true });
        if (activity) {
            const a = activity.toLowerCase();
            if (a.includes('mainactivity') || a.includes('splashactivity')) {
                console.log('✅ Publikacja zakończona sukcesem');
                return true;
            }
        }

        this.sendStatus('working', '⏳ Czekam na zakończenie uploadu...');
        await this.sleep(15000);
        return true;
    }

    // ─── AI description generation (standalone, nie wymaga ai.js) ───

    async _generateDescriptionAI(client, filename) {
        try {
            const response = await client.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'Jesteś twórcą treści na TikToku. Generujesz krótkie, chwytliwe opisy po polsku.' },
                    { role: 'user', content: `Wygeneruj krótki opis i hashtagi dla filmu TikTok o nazwie: "${filename}".\n\nOdpowiedz w formacie JSON (bez markdown):\n{"description": "chwytliwy opis po polsku (max 150 znaków)", "hashtags": "#tag1 #tag2 #tag3 #tag4 #tag5"}` }
                ],
                max_tokens: 150,
                temperature: 0.8
            });
            let content = response.choices[0].message.content.trim();
            if (content.startsWith('```')) content = content.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
            return JSON.parse(content);
        } catch (e) {
            console.log('⚠️ AI fallback:', e.message);
            return { description: '', hashtags: '#fyp #foryou #viral #polska' };
        }
    }

    // ─── Główny flow publikacji jednego filmu ───

    async publishVideo(videoPath, config) {
        const filename = path.basename(videoPath);
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📤 PUBLIKUJĘ: ${filename}`);
        console.log(`${'='.repeat(60)}\n`);

        this.publishing = true;
        try {
            // 1. Parsuj config z pliku .txt (lub generuj AI)
            const txtPath = videoPath.replace(/\.[^.]+$/, '.txt');
            let videoConfig = this.parseConfigFile(txtPath);

            if (!videoConfig || !videoConfig.description) {
                this.sendStatus('working', '🤖 Generuję opis przez AI...');
                const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const aiGen = await this._generateDescriptionAI(ai, filename);
                videoConfig = videoConfig || {};
                videoConfig.description = videoConfig.description || aiGen.description;
                videoConfig.hashtags = videoConfig.hashtags || aiGen.hashtags;
            }

            // 2. Prześlij na telefon
            this.sendProgress({ step: 1, total: 6, label: 'Transfer na telefon' });
            const remotePath = await this.transferToPhone(videoPath);
            if (!remotePath) {
                throw new Error('ADB push failed');
            }

            // 3. Otwórz TikTok Creator
            this.sendProgress({ step: 2, total: 6, label: 'Otwieram TikToka' });
            await this.openTikTokCreator();

            // 4. Wybierz film z galerii
            this.sendProgress({ step: 3, total: 6, label: 'Wybieram film' });
            await this.selectVideoFromGallery(remotePath);

            // 5. Wpisz opis i hashtagi
            this.sendProgress({ step: 4, total: 6, label: 'Wpisuję opis' });
            await this.fillDescription(videoConfig.description, videoConfig.hashtags);

            // 6. Publikuj
            this.sendProgress({ step: 5, total: 6, label: 'Publikuję' });
            await this.clickPublish();

            // 7. Cleanup
            this.sendProgress({ step: 6, total: 6, label: 'Czyszczenie' });
            await this.cleanup(remotePath);

            this.sendStatus('working', `✅ Opublikowano: ${filename}`);
            this.sendProgress({ step: 6, total: 6, label: 'Gotowe', done: true, success: true });
            return { success: true, filename };

        } catch (e) {
            console.error(`❌ Błąd publikacji ${filename}:`, e.message);
            this.sendStatus('working', `❌ Błąd: ${e.message}`);
            this.sendProgress({ done: true, success: false, error: e.message });

            // Wróć do feedu po błędzie
            await this.adbExec('am force-stop com.zhiliaoapp.musically');
            return { success: false, filename, error: e.message };
        } finally {
            this.publishing = false;
        }
    }
}

module.exports = VideoPublisher;

// ─── CLI entrypoint (uruchamiany jako child process z main.js) ───

if (require.main === module) {
    const args = process.argv.slice(2);

    let udid = null, systemPort = 8201, videoPath = null;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--udid') udid = args[++i];
        else if (args[i] === '--systemPort') systemPort = parseInt(args[++i]);
        else if (args[i] === '--video') videoPath = args[++i];
    }

    if (!udid || !videoPath) {
        console.error('Usage: node publisher.js --udid DEVICE_ID --video /path/to/video.mp4 [--systemPort PORT]');
        process.exit(1);
    }

    require('dotenv').config({ path: require('path').join(__dirname, '.env') });

    const publisher = new VideoPublisher(udid, systemPort);

    (async () => {
        try {
            await publisher.initAppiumSession();
            const result = await publisher.publishVideo(videoPath, {});
            console.log('\n📊 Wynik:', JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        } catch (e) {
            console.error('💥 Fatal:', e.message);
            process.exit(1);
        }
    })();
}
