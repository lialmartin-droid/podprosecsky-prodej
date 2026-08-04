# Verze 2.1.1 – sklad a e-mail o zrušení

## GitHub
1. Rozbalte ZIP.
2. Nahrajte celý obsah do kořene repozitáře.
3. Potvrďte přepsání souborů a klikněte na **Commit changes**.

## Google Apps Script
1. Nahraďte celý obsah současného `.gs` souboru obsahem `google-apps-script/Code.gs`.
2. `appsscript.json` může zůstat z verze 2.1.0.
3. Klikněte **Nasadit → Spravovat nasazení → tužka → Nová verze → Nasadit**.

## Po nasazení
U každého produktu kromě vajec nastavte v administraci:
- Počet skladem
- Jednotku skladu
- Text při vyprodání

Vejce se nadále nastavují v samostatné záložce **Vejce**.

Při změně celé objednávky na **Zrušeno** se odešle zákazníkovi e-mail.
Při změně na **Vyzvednuto** se žádný e-mail neposílá.
