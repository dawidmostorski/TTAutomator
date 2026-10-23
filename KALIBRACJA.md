# Kalibracja TTAutomator (Appium)

Ten dokument opisuje krok po kroku, jak zaktualizować selektory bota w przypadku aktualizacji aplikacji TikTok lub zmiany wyglądu interfejsu.

## 📋 Wymagania wstępne
1.  Podłączony telefon z włączonym debugowaniem USB.
2.  Uruchomiona konsola w głównym folderze projektu `TTAutomator`.

---

## Krok 1: Identyfikacja Urządzenia
Jeśli masz więcej niż jeden telefon, sprawdź jego ID (UDID):
```powershell
adb devices
```
Skopiuj ID urządzenia i używaj go zamiast `YOUR_DEVICE_ID` w poniższych poleceniach.

---

## Krok 2: Uruchomienie Trybu Szpiega (Spy Mode)
Uruchom skrypt, który będzie zrzucał strukturę widoku (XML) co 3 sekundy.

```powershell
node debug_spy.js --udid YOUR_DEVICE_ID
```
*Gdy zobaczysz komunikat "START SPY MODE" - wszystko jest gotowe.*

---

## Krok 3: Nagranie Sesji
Teraz weź telefon do ręki i wykonaj akcje, które chcesz naprawić.

1.  **Dla przycisku Follow:**
    *   Wejdź na profil użytkownika lub znajdź wideo z przyciskiem "Obserwuj" (czerwony plusik).
    *   **Zatrzymaj się** na tym widoku na 5-10 sekund. Nie ruszaj ekranu.
    *   Pozwól, aby spy zrzucił plik (zobaczysz w konsoli `Zapisano: spy_dump_X.xml`).

2.  **Dla Komentarzy:**
    *   Otwórz panel komentarzy.
    *   Poczekaj 5 sekund.

3.  **Dla Wykrywania Feedu:**
    *   Bądź na głównym ekranie wideo (For You).
    *   Poczekaj 5 sekund.

Gdy skończysz, zatrzymaj skrypt w konsoli (`Ctrl + C`).

---

## Krok 4: Analiza Plików (Szukanie Selektorów)
1.  Otwórz folder `TTAutomator` w edytorze kodu.
2.  Posortuj pliki, aby znaleźć **ostatni** utworzony `spy_dump_X.xml`.
3.  Otwórz ten plik.
4.  Wciśnij `Ctrl + F` i szukaj słów kluczowych:
    *   `Obserwuj`, `Follow`, `+` - dla przycisku follow.
    *   `Komentarz`, `Comment` - dla ikonki komentarza.
    *   `Polub`, `Like` - dla lajków.

5.  **Co kopiować?**
    Szukaj atrybutu `resource-id`. Powinien wyglądać np. tak:
    `com.zhiliaoapp.musically:id/hke`

    *Jeśli element nie ma ID, szukaj unikalnego `content-desc` (np. "Komentarz").*

---

## Krok 5: Aktualizacja Kodu (`bot.js`)
1.  Otwórz plik `bot.js`.
2.  Znajdź odpowiednią funkcję (np. `followUser`, `ensureInFeed`, `commentOnVideo`).
3.  Zaktualizuj listę selektorów.

**Przykład (Follow):**
```javascript
// Stary kod
const followBtn = await this.driver.$('id:com.zhiliaoapp.musically:id/stare_id');

// Nowy kod (dodaj nowy, nie usuwaj starego jeśli chcesz wspierać też starsze wersje)
const followBtn = await this.driver.$('id:com.zhiliaoapp.musically:id/NOWE_ID_Z_PLIKU_XML');
```

---

## Krok 6: Weryfikacja
1.  Zapisz zmiany.
2.  Uruchom bota normalnie i zobacz, czy klika poprawnie.
3.  Jeśli tak -> **Gotowe!** 🎉
4.  Jeśli nie -> Wróć do Kroku 2 i spróbuj znaleźć inny element (często jest ich kilka jeden na drugim).
