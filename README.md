# Podprosečské domácí produkty V12

Objednávková stránka a administrace propojené s Google Tabulkou přes Google Apps Script.

## Novinka V12 – rezervace vajec

Systém počítá dostupnost vajec z:

- aktuálního fyzického skladu,
- očekávané denní snášky,
- bezpečnostní rezervy,
- všech aktivních objednávek podle data vyzvednutí.

Zákazník po zadání množství uvidí nejbližší bezpečný termín. Apps Script dostupnost znovu ověří při odeslání pod zámkem, takže dvě současné objednávky nemohou rezervovat stejná vejce.

Administrace obsahuje záložku **Vejce** s nastavením a předpovědí na následujících 21 dní.

Podrobný postup je v `NAHRANI_NA_GITHUB.md`.
