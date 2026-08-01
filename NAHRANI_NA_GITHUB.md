# Nahrání verze V12

## 1. GitHub

1. Rozbal ZIP.
2. V repozitáři nahraď celý starý obsah obsahem této složky.
3. Soubor `index.html` musí být přímo v kořeni repozitáře.
4. Potvrď změny přes **Commit changes**.
5. Po zveřejnění otevři zákaznickou stránku a stiskni **Ctrl + F5**.

## 2. Google Apps Script

1. Otevři Google Tabulku → **Rozšíření → Apps Script**.
2. V `Code.gs` smaž celý starý kód.
3. Vlož celý obsah souboru `google-apps-script/Code.gs`.
4. Ulož.
5. Spusť funkci `setup`.
   - vytvoří se nový list `Nastavení`,
   - stávající heslo administrace zůstane zachované,
   - u vajec se zruší pevný předstih 7 dní, protože termín nově počítá algoritmus.
6. Otevři **Nasadit → Spravovat implementace → tužka**.
7. U verze vyber **Nová verze** a klikni na **Implementovat**.
8. Adresa `/exec` zůstává stejná.

## 3. První nastavení vajec

1. Přihlas se do administrace.
2. Otevři záložku **Vejce**.
3. Nastav:
   - aktuální fyzický počet vajec skladem,
   - očekávanou denní snášku,
   - bezpečnostní rezervu,
   - počet dní plánování.
4. Klikni na **Uložit nastavení**.

Aktuální sklad znamená všechna vejce, která fyzicky máš, včetně již rezervovaných, ale ještě nevyzvednutých. Když objednávku označíš jako `Vyzvednuto`, její vejce se automaticky odečtou z fyzického skladu.
