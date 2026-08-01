# Nahrání kompletní verze V9

## 1. GitHub

1. Rozbalte ZIP.
2. Otevřete repozitář `podprosecsky-prodej`.
3. Smažte nebo nahraďte starý obsah repozitáře.
4. Nahrajte **všechny soubory a složky z rozbaleného ZIPu**.
5. V kořeni GitHubu musí být přímo `index.html`, `.nojekyll`, `README.md`, složka `admin`, složka `assets` a složka `google-apps-script`.
6. Po dokončení otevřete zákaznickou stránku a použijte tvrdé obnovení `Ctrl + F5`.

Správné odkazy na konci `index.html` jsou:

```html
<script src="assets/config.js?v=9-20260801"></script>
<script src="assets/customer.js?v=9-20260801"></script>
```

## 2. Google Apps Script

Tento krok je potřeba udělat, pokud dosud není nasazený backend V7 nebo novější.

1. V Google Tabulce otevřete **Rozšíření → Apps Script**.
2. Obsah souboru `Code.gs` nahraďte obsahem `google-apps-script/Code.gs` z balíčku.
3. Uložte změny.
4. Spusťte funkci `setup` a potvrďte oprávnění.
5. Otevřete **Nasadit → Spravovat nasazení**.
6. U webové aplikace klikněte na tužku.
7. Vyberte **Nová verze** a klikněte na **Nasadit**.
8. Přístup musí být nastavený na **Kdokoli**.

Adresa `/exec` je již vložená v `assets/config.js`.

## Heslo administrace

Heslo není z bezpečnostních důvodů uloženo v souborech na veřejném GitHubu. Zůstává v Script Properties Google Apps Scriptu. Nahráním tohoto balíčku se existující heslo nemění.
