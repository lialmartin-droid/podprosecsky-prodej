# Nahrání V2.4.0

## GitHub Pages
1. Rozbalte ZIP.
2. Nahrajte obsah složky `Podprosecske_produkty_V2_4_0` do kořene repozitáře a potvrďte přepsání souborů.
3. Commitněte změny.
4. Nová cache značka `v=50-20260807-v240` vynutí načtení aktuálního JS/CSS.

## Google Apps Script
1. Nahraďte stávající `Code.gs` souborem `google-apps-script/Code.gs`.
2. Používáte-li manifest, nahraďte také `appsscript.json`.
3. Uložte.
4. Jednou spusťte `setupPickupReminderAutomation()` a povolte požadovaná oprávnění.
5. V **Nasadit → Spravovat implementace** vytvořte novou verzi stávající webové aplikace.
6. `/exec` URL zůstává stejná.

## Rychlá kontrola po nasazení
- U vajec zkuste zadat více kusů, než je dnes skladem: musí se posunout nejbližší datum podle denní snášky.
- U běžného produktu nesmí množství překročit dostupný sklad.
- Po vypnutí „nezapočítávat moje návštěvy“ obnovte admin stránku: volba musí zůstat vypnutá.
- Zákaznická cache může nabídku zobrazit rychle, ale tlačítko objednávky se aktivuje až po ověření serverem.
