const { remote } = require('webdriverio');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const udidArgument = process.argv.indexOf('--udid');
const udid = udidArgument !== -1 ? process.argv[udidArgument + 1] : process.env.APPIUM_DEVICE_ID;

// Konfiguracja (taka sama jak w bot.js)
const capabilities = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'Android Device',
    'appium:appPackage': 'com.zhiliaoapp.musically',
    'appium:appActivity': 'com.ss.android.ugc.aweme.splash.SplashActivity',
    'appium:noReset': true,
    'appium:newCommandTimeout': 3600,
};

if (udid) capabilities['appium:udid'] = udid;

const wdOpts = {
    hostname: 'localhost',
    port: 4723,
    logLevel: 'error', // Mniej śmieci w logach, skupiamy się na naszych
    capabilities,
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function runSpy() {
    console.log('🚀 Łączenie z telefonem...');
    const driver = await remote(wdOpts);
    console.log('✅ Połączono! Jesteśmy w trybie SZPIEGA.');
    console.log('---------------------------------------------------');
    console.log('INSTRUKCJA:');
    console.log('1. Wykonuj czynności na telefonie manualnie.');
    console.log('2. Gdy dojdziesz do ważnego momentu (np. otwarta klawiatura), wróć do konsoli.');
    console.log('3. Wpisz nazwę kroku (np. "otwarta_klawiatura") i naciśnij ENTER.');
    console.log('4. Skrypt zrzuci strukturę XML i współrzędne elementów.');
    console.log('---------------------------------------------------');

    while (true) {
        const stepName = await askQuestion('\n📸 Podaj nazwę kroku (lub "exit" by wyjść): ');

        if (stepName.toLowerCase() === 'exit') break;
        if (!stepName.trim()) continue;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `spy_log_${stepName}_${timestamp}.xml`;
        const filePath = path.join(__dirname, fileName);

        console.log(`🔍 Analizuję ekran dla kroku: [${stepName}]...`);

        try {
            // 1. Zapisz strukturę XML
            const source = await driver.getPageSource();
            fs.writeFileSync(filePath, source);
            console.log(`   📄 Zapisano XML do: ${fileName}`);

            // 2. Spróbuj znaleźć aktywne pole tekstowe i przycisk wysyłania (analiza "na żywo")
            console.log('   🕵️  Szukam kluczowych elementów...');

            // Szukamy czegokolwiek co jest edytowalne
            const edits = await driver.$$('android.widget.EditText');
            if (edits.length > 0) {
                console.log(`   📝 Znaleziono ${edits.length} pól tekstowych:`);
                for (const edit of edits) {
                    const rect = await edit.getAttribute('bounds'); // Zwraca string "[x,y][x,y]" w czystym uiautomator, ale w wdio pobieramy rect
                    const displayed = await edit.isDisplayed();
                    const text = await edit.getText();
                    const size = await edit.getSize();
                    const loc = await edit.getLocation();
                    console.log(`      - Text: "${text}" | Visible: ${displayed} | Pos: (${loc.x}, ${loc.y}) | Size: ${size.width}x${size.height}`);
                }
            } else {
                console.log('   📝 Brak aktywnych pól tekstowych (EditText).');
            }

            // Sprawdź czy klawiatura jest widoczna
            const keyboard = await driver.isKeyboardShown();
            console.log(`   ⌨️  Czy klawiatura jest systemowo widoczna? ${keyboard ? 'TAK' : 'NIE'}`);

            // Szukamy potencjalnych przycisków wysyłania
            const sendKeywords = ['Wyślij', 'Opublikuj', 'Post', 'Send'];
            for (const word of sendKeywords) {
                const el = await driver.$(`~${word}`);
                if (await el.isExisting()) {
                     const displayed = await el.isDisplayed();
                     const loc = await el.getLocation();
                     console.log(`   🚀 Znaleziono przycisk "~${word}": Visible: ${displayed} | Pos: (${loc.x}, ${loc.y})`);
                }
            }

        } catch (e) {
            console.error('⚠️ Błąd podczas analizy:', e.message);
        }
    }

    await driver.deleteSession();
    rl.close();
    console.log('👋 Koniec sesji szpiegowskiej.');
}

runSpy().catch(console.error);
