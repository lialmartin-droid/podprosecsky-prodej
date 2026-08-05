# Verze 2.1.2 – oprava termínu po změně košíku

1. Rozbalte ZIP.
2. Nahrajte celý obsah do kořene GitHub repozitáře.
3. Potvrďte přepsání souborů a klikněte na **Commit changes**.

## Co oprava řeší
Když zákazník vložil produkt s naskladněním za několik měsíců, systém automaticky
nastavil vzdálený termín. Po odstranění tohoto produktu ale datum zůstalo stejné.

Nově se automaticky nastavené datum po každé změně košíku přepočítá. Pokud zákazník
datum změnil ručně na pozdější, jeho volba zůstane zachována.

## Apps Script
Google Apps Script není nutné měnit ani znovu nasazovat. Jde pouze o opravu zákaznické stránky.
