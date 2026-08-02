# Podprosečské domácí produkty V15.2 – opravená verze

Objednávková stránka a administrace propojené s Google Tabulkou přes Google Apps Script.

## Hlavní funkce

- aktuální nabídka a ceny se načítají přímo z Google Tabulky,
- objednávky se ukládají do listu `Objednávky`,
- administrace umožňuje spravovat objednávky, produkty a nastavení vajec,
- dostupnost vajec se počítá z fyzického skladu, denní snášky, rezervy a aktivních objednávek,
- sklad vajec se automaticky dopočítává od posledního potvrzeného fyzického stavu.

## Opravy této verze

- bezpečné serverové vytváření ID objednávek,
- ochrana textů na stránce i v Google Tabulce,
- kontrola názvu, ceny, data a ID produktu,
- kontrola platných stavů objednávek,
- zákaz obcházení limitu opakováním stejné položky,
- bezpečné vrácení skladu při chybě ukládání,
- postupné zpracování změn v administraci bez pomíchání odpovědí,
- sjednocení aktivních souborů na verzi V15.

Postup nasazení je v souboru `NAHRANI_NA_GITHUB.md`.


## Oprava V15.2
Administrace nyní správně zpracuje přihlašovací odpověď z vnořeného rámce Google Apps Scriptu. Google Apps Script `Code.gs` se proti předchozí opravené verzi nemění; stačí znovu nahrát obsah tohoto ZIPu na GitHub.
