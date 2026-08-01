# Podprosečské domácí produkty – oprava V5

Tato verze používá jednu Google Tabulku jako společný backend pro zákaznickou stránku i administraci.

## Opraveno

- přihlášení administrátora po změně hesla,
- viditelná chybová zpráva, když Apps Script neodpoví,
- rychlá tlačítka množství u vajec `6, 10, 30`,
- ruční zadávání vícemístného množství bez ztráty kurzoru,
- sjednocená adresa Apps Scriptu ve všech souborech,
- sdílení produktů a objednávek mezi zákaznickou stránkou a administrací.

## Soubory

- `index.html` – zákaznická stránka,
- `admin/index.html` – administrace,
- `assets/config.js` – adresa Apps Scriptu,
- `assets/customer.js` – zákaznická logika,
- `assets/admin.js` – administrační logika,
- `google-apps-script/Code.gs` – backend Google Apps Scriptu.

## Důležité

Na GitHub nahrajte celý obsah této složky, včetně složek `admin`, `assets` a `google-apps-script`.
Nestačí nahradit pouze `index.html`.

Po změně `Code.gs` je nutné u stávající webové aplikace vytvořit **novou verzi nasazení**.
Adresa `/exec` zůstane stejná.
