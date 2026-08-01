# Nastavení Google Apps Scriptu pro V9

1. Otevřete Google Tabulku používanou pro objednávky.
2. Zvolte **Rozšíření → Apps Script**.
3. Nahraďte celý obsah `Code.gs` souborem `Code.gs` z této složky.
4. Uložte a spusťte funkci `setup`.
5. Otevřete **Nasadit → Spravovat nasazení**.
6. U stávající webové aplikace vytvořte **Novou verzi**.
7. Spouštět jako: vlastník skriptu. Přístup: **Kdokoli**.
8. URL musí končit `/exec`.

Existující heslo zůstává uložené v Script Properties. Funkce `setup` ho nepřepisuje.
