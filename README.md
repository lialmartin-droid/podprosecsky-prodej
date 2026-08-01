# Podprosečské domácí produkty – kompletní verze V9

Tento balíček je připravený k nahrání do kořene GitHub repozitáře.

## Obsah

- `index.html` – zákaznická objednávková stránka
- `admin/index.html` – administrace
- `assets/style.css` – společný vzhled
- `assets/customer.js` – zákaznická logika V9
- `assets/admin.js` – administrační logika V9
- `assets/config.js` – adresa nasazeného Google Apps Scriptu
- `google-apps-script/Code.gs` – backend pro Google Tabulku, e-mail a přihlášení
- `google-apps-script/appsscript.json` – nastavení Apps Scriptu
- `.nojekyll` – nastavení GitHub Pages

## Opraveno ve V9

- rychlá tlačítka u vajec `6`, `10` a `30 ks` se po načtení dat neztratí,
- ručně lze zadat vícemístné množství bez ztráty kurzoru,
- produkty se načítají z Google Tabulky, nikoli ze starého `localStorage`,
- administrace přijímá výsledek přihlášení z Google Apps Scriptu,
- všechny odkazy na CSS a JavaScript mají novou verzi proti staré mezipaměti.

Podrobný postup je v souboru `NAHRANI_NA_GITHUB.md`.
