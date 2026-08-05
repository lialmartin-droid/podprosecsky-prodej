# Verze 2.2.0 – jednotný sklad

## 1. GitHub
1. Rozbalte ZIP.
2. Nahrajte celý obsah do kořene repozitáře.
3. Potvrďte přepsání souborů a klikněte na **Commit changes**.

## 2. Google Apps Script – nutná aktualizace
1. Nahraďte celý obsah současného `.gs` souboru obsahem `google-apps-script/Code.gs`.
2. `appsscript.json` není potřeba měnit.
3. Klikněte **Nasadit → Spravovat nasazení → tužka → Nová verze → Nasadit**.

Google tabulka se při prvním načtení automaticky rozšíří o dva nové sloupce
pro skutečné převzetí dostupné a předobjednané části.

## Doporučený test
1. Zkontrolujte fyzický sklad vajec v záložce Vejce.
2. Vytvořte objednávku s vejci a předobjednaným produktem.
3. Označte pouze dostupnou část jako Vyzvednuto.
4. Ověřte:
   - fyzický sklad vajec se snížil,
   - vejce už nejsou vedena jako rezervace,
   - zákaznický sklad odpovídá fyzickému skladu po odečtení ostatních rezervací a rezervy,
   - tržba za vejce se započítala v aktuálním měsíci,
   - předobjednaná část zůstala aktivní.

Při označení Vyzvednuto se zákazníkovi neposílá žádný e-mail.
