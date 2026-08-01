# Podprosečské domácí produkty

Projekt obsahuje:

- `index.html` – zákaznická objednávková stránka
- `admin/index.html` – administrace
- `assets/style.css` – společný vzhled
- `assets/customer.js` – logika zákaznické stránky
- `assets/admin.js` – logika administrace

## Nahrání na GitHub Pages

1. Vytvořte nový veřejný repozitář na GitHubu.
2. Nahrajte do něj celý obsah této složky.
3. Otevřete `Settings` → `Pages`.
4. U `Build and deployment` zvolte:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
5. Uložte nastavení.

Zákaznická stránka bude na adrese:

`https://UZIVATEL.github.io/NAZEV-REPOZITARE/`

Administrace bude na adrese:

`https://UZIVATEL.github.io/NAZEV-REPOZITARE/admin/`

## Důležité omezení této verze

Tato verze ukládá produkty a objednávky jen do `localStorage` daného prohlížeče.

To znamená:

- zákaznická objednávka z jednoho telefonu se neobjeví v administraci na jiném telefonu,
- data nejsou sdílená mezi zařízeními,
- zatím se neposílá e-mailové upozornění,
- administrace ještě není chráněná přihlášením.

Pro ostrý provoz je nutné doplnit společnou databázi a bezpečné přihlášení správce.
Doporučená další fáze: Supabase nebo Firebase.


## E-mailová upozornění a Google Tabulka

Složka `google-apps-script` obsahuje backend, který:

- ukládá každou objednávku do Google Tabulky,
- posílá upozornění na `podprosecskeprodukty@gmail.com`,
- vrací zákaznické stránce potvrzení o přijetí.

Postup je v souboru `google-apps-script/NASTAVENI.md`.

Po nasazení Google Apps Scriptu vložte jeho `/exec` URL do `assets/config.js`.
