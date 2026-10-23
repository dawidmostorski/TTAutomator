# TTAutomator — instalacja na Windows

## Wymagania

- Windows 10/11
- Node.js i npm dostępne w `PATH` (kontrole projektu używają Node.js 24)
- Android SDK Platform Tools (ADB)
- Appium z driverem UiAutomator2
- Telefon z Androidem, zainstalowanym TikTokiem i debugowaniem USB
- Własny klucz OpenAI API (obecny bot inicjalizuje klienta również w trybie komentarzy z listy)

---

## Krok 1: Zainstaluj Node.js

Pobierz i zainstaluj Node.js LTS ze strony https://nodejs.org

Sprawdź instalację:
```powershell
node --version
npm --version
```

---

## Krok 2: Zainstaluj Appium

```powershell
npm install -g appium
appium driver install uiautomator2
```

Sprawdź:
```powershell
appium --version
```

---

## Krok 3: Skonfiguruj ADB i ANDROID_HOME

### 3a. Przygotuj ADB

Pobierz Android Platform Tools (samo ADB, bez Android Studio):
https://developer.android.com/tools/releases/platform-tools

Rozpakuj np. do `C:\android\platform-tools\`

Albo jeśli masz juz adb.exe w innym miejscu (np. C:\adb\):
```powershell
mkdir C:\android\platform-tools
Copy-Item C:\adb\* C:\android\platform-tools\
```

**WAZNE:** Appium wymaga struktury `ANDROID_HOME\platform-tools\adb.exe`.
Folder musi sie nazywac dokladnie `platform-tools`.

### 3b. Ustaw zmienne srodowiskowe

Otwórz PowerShell i wykonaj:
```powershell
[System.Environment]::SetEnvironmentVariable("ANDROID_HOME", "C:\android", "User")
[System.Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "C:\android", "User")

$oldPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
[System.Environment]::SetEnvironmentVariable("Path", "$oldPath;C:\android\platform-tools", "User")
```

### 3c. Weryfikacja

Otwórz **nowe okno** PowerShell i sprawdz:
```powershell
adb devices
echo $env:ANDROID_HOME
Test-Path "$env:ANDROID_HOME\platform-tools\adb.exe"
# Wszystkie komendy musza zwrocic sensowny wynik / True
```

---

## Krok 4: Podlacz telefony

1. Wlacz **Opcje dewelopera** na telefonie (Ustawienia > O telefonie > klikaj 7x w numer kompilacji)
2. Wlacz **Debugowanie USB**
3. Podlacz telefon kablem USB
4. Potwierdz na telefonie komunikat "Zezwolić na debugowanie USB?"

Sprawdz czy telefon jest widoczny:
```powershell
adb devices
# Powinno pokazać: YOUR_DEVICE_ID   device
```

---

## Krok 5: Pobierz źródła i przygotuj konfigurację

```powershell
git clone https://github.com/dawidmostorski/TTAutomator.git
cd TTAutomator
npm ci
Copy-Item .env.example .env
Copy-Item device_configs.example.json device_configs.json
Copy-Item comments_config.example.json comments_config.json
```

Polecenia kopiowania wykonuj przy pierwszej instalacji. Przy aktualizacji zachowaj istniejące pliki z własnymi ustawieniami.

Wpisz własny `OPENAI_API_KEY` w pliku `.env`. `DEVICE_PIN` jest opcjonalny; pozostaw go pusty, jeżeli nie jest potrzebny. `APPIUM_DEVICE_ID` może wskazywać telefon dla skryptów diagnostycznych. Panel pozwala wybrać telefony osobno.

Prywatne ustawienia, klucze API i historia są wykluczone z repozytorium. Pliki z końcówką `.example` zawierają tylko neutralne przykłady.

---

## Krok 6: Uruchomienie

1. Otwórz PowerShell
2. Uruchom Appium:
```powershell
appium
```
3. W osobnym terminalu, w katalogu TTAutomator, uruchom panel:
```powershell
npm start
```
4. Zeskanuj urządzenia, otwórz ustawienia telefonu i dopasuj współrzędne przycisków. Zobacz [KALIBRACJA.md](KALIBRACJA.md).

Serwer Appium powinien działać pod `localhost:4723`.

## Budowanie wersji EXE

```powershell
npm run check
npm run build
```

Program powstanie jako `dist\TTAutomator-win32-x64\TTAutomator.exe`. Skopiuj własny plik `.env` **do tego samego folderu co EXE**. Przykład znajduje się w `resources\app\.env.example`.

Paczka nie zawiera prywatnych konfiguracji, historii, logów ani zrzutów. Ustawienia urządzeń zapisane w panelu wersji EXE trafiają do `resources\app\device_configs.json`, a konfiguracja komentarzy do `comments_config.json` obok EXE. Używaj folderu, w którym masz uprawnienia zapisu. Ponowny build zastępuje katalog wynikowy, więc wcześniej zachowaj własne ustawienia z tego katalogu.

Na komputerze docelowym nadal muszą być dostępne Node.js, ADB i uruchomiony serwer Appium. Nie są dołączane do EXE.

---

## Rozwiazywanie problemów

### "Neither ANDROID_HOME nor ANDROID_SDK_ROOT environment variable was exported"
- Nie ustawiono zmiennych srodowiskowych - wykonaj Krok 3b
- Pamietaj o otwarciu NOWEGO okna PowerShell po ustawieniu zmiennych

### "The Android SDK root folder '...' does not exist on the local file system"
- ANDROID_HOME wskazuje na nieistniejacy folder
- Sprawdz: `Test-Path "$env:ANDROID_HOME\platform-tools\adb.exe"` - musi zwrocic `True`
- Jesli `False`: popraw sciezke w ANDROID_HOME lub stworz wlasciwa strukture folderów

### ADB widzi telefon ale Appium nie
- Upewnij sie ze `ANDROID_HOME\platform-tools\adb.exe` istnieje (nie tylko `adb` w PATH)
- Zrestartuj PowerShell po zmianie zmiennych srodowiskowych

### Telefon nie jest wykrywany przez ADB
- Sprawdz czy debugowanie USB jest wlaczone
- Potwierdz komunikat na ekranie telefonu
- Spróbuj innego kabla USB lub portu
