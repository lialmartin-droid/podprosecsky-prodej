DŮLEŽITÉ V2.3.4: Nahraj celý obsah této složky do kořene repozitáře a aktualizuj také google-apps-script/Code.gs. Nové ?v=44 v HTML vynutí načtení aktuálních JS/CSS souborů.

# Verze 2.3.0 – nevyzvednuté objednávky a rychlejší aktualizace

## GitHub

1. Rozbalte ZIP.
2. Nahrajte celý obsah do kořene repozitáře a potvrďte přepsání souborů.
3. Klikněte na **Commit changes**.
4. Počkejte, až GitHub Pages dokončí nové nasazení.

## Google Apps Script

1. V Google Tabulce otevřete **Rozšíření → Apps Script**.
2. Nahraďte celý obsah současného `Code.gs` obsahem souboru `google-apps-script/Code.gs`.
3. Klikněte na **Uložit**.
4. Otevřete **Nasadit → Spravovat implementace**.
5. U webové aplikace klikněte na tužku, vyberte novou verzi a potvrďte **Implementovat**.
6. Adresa `/exec` zůstává stejná. Funkci `setup()` znovu spouštět nemusíte.

## Ověření

- Objednávka s minulým termínem a stavem jiným než Vyzvednuto/Zrušeno se zvýrazní červeně.
- Ve filtru **Po termínu** se zobrazí pouze nevyzvednuté objednávky.
- Tlačítko **Připomenout** otevře SMS nebo odešle e-mail podle uloženého způsobu kontaktu.
- Po změně produktu či skladu otevřete zákaznickou stránku: měla by načíst aktuální data během běžné odpovědi serveru, bez několikahodinového čekání na starou cache.


Poznámka k návštěvnosti:
- QR kód vytvořte s odkazem zakončeným `?src=qr`
- běžný odkaz může být bez parametru nebo s `?src=link`
- zařízení, na kterém se přihlásíte do administrace, se do návštěvnosti nezapočítá


V2.3.7: po nahrání souborů nahraďte také google-apps-script/Code.gs a aktualizujte stávající implementaci Apps Scriptu.
