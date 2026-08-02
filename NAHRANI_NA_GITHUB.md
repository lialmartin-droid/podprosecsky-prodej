# Nasazení opravené V15

## 1. Google Apps Script

1. Otevři Google Tabulku s objednávkami.
2. Zvol **Rozšíření → Apps Script**.
3. Otevři `Code.gs`, označ celý původní obsah a nahraď ho souborem `google-apps-script/Code.gs` z tohoto balíčku.
4. Ulož změny.
5. Otevři **Nasadit → Spravovat implementace → tužka**.
6. U položky Verze vyber **Nová verze**.
7. Přístup ponech **Kdokoli** a klikni na **Implementovat**.
8. Adresa webové aplikace `/exec` se při úpravě stejné implementace nezmění.

## 2. GitHub

1. Rozbal ZIP.
2. Nahraj celý obsah rozbalené složky do kořene GitHub repozitáře.
3. Povol nahrazení starých souborů, hlavně `index.html`, složky `admin`, `assets` a `google-apps-script`.
4. Po dokončení otevři zákaznickou stránku a administraci s tvrdým obnovením stránky (`Ctrl+F5`).

## 3. Kontrola

- zákaznická stránka musí načíst aktuální produkty a ceny,
- přihlášení administrace musí reagovat,
- změna produktu se musí po obnovení projevit zákazníkovi,
- testovací objednávku lze po kontrole smazat v administraci.
