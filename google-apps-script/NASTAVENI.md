# Nasazení opravy V5

## 1. Google Apps Script

1. Otevřete Google Tabulku používanou pro objednávky.
2. Otevřete **Rozšíření → Apps Script**.
3. V souboru `Code.gs` smažte celý původní obsah.
4. Vložte celý obsah souboru `google-apps-script/Code.gs` z tohoto balíčku.
5. Uložte projekt.
6. Spusťte funkci `setup`.
   - zachová stávající heslo, pokud už existuje,
   - doplní rychlá tlačítka `6, 10, 30`, pokud u vajec chybí,
   - pošle aktuální heslo na `podprosecskeprodukty@gmail.com`.
7. Otevřete **Nasadit → Spravovat nasazení**.
8. U stávající webové aplikace klikněte na tužku.
9. V poli verze vyberte **Nová verze** a potvrďte nasazení.
10. Nastavení musí být:
    - **Spouštět jako:** Já
    - **Kdo má přístup:** Kdokoli

Adresa `/exec` má zůstat:

`https://script.google.com/macros/s/AKfycbxX0zM4gURHiBdJfzn1Vux3y7WqgN_gP1DE9m26_e8bHQYynUOl2LZbkpmoGQJbhbZdvw/exec`

## 2. GitHub

Nahrajte celý obsah balíčku do kořene repozitáře a nahraďte všechny staré soubory.
Zvlášť zkontrolujte, že se nahradily:

- `assets/config.js`
- `assets/admin.js`
- `assets/customer.js`
- `admin/index.html`

## 3. Test

1. Otevřete administraci v anonymním okně.
2. Přihlaste se heslem z e-mailu.
3. U produktu Čerstvá vejce zkontrolujte hodnotu rychlých tlačítek `6, 10, 30`.
4. Na zákaznické stránce napište ručně například `30`; celé číslo musí zůstat v poli bez nutnosti znovu klikat.
