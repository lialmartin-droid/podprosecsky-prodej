# Verze 2.1.5 – tržba při skutečném převzetí

## GitHub
1. Rozbalte ZIP.
2. Nahrajte celý obsah do kořene repozitáře.
3. Potvrďte přepsání a klikněte na **Commit changes**.

## Google Apps Script – nutná aktualizace
1. Nahraďte celý obsah `.gs` souboru obsahem `google-apps-script/Code.gs`.
2. `appsscript.json` není potřeba měnit.
3. Klikněte **Nasadit → Spravovat nasazení → tužka → Nová verze → Nasadit**.

Po nasazení se objednávka započítá do tržby okamžitě při označení **Vyzvednuto**,
i když si zákazník původně zvolil pozdější termín.

Starší již vyzvednuté objednávky nemají uložený skutečný čas převzetí. Nově označené
objednávky se budou zapisovat správně.
