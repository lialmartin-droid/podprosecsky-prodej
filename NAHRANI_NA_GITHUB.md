# Verze 2.2.2 – kontrola skladu a tržby

## 1. GitHub

1. Rozbalte ZIP.
2. Nahrajte celý obsah do kořene GitHub repozitáře.
3. Potvrďte přepsání souborů a klikněte na **Commit changes**.

Tím se opraví zobrazení skladu vajec a zahodí stará zákaznická mezipaměť.

## 2. Google Apps Script

1. Otevřete Google Tabulku s objednávkami.
2. Zvolte **Rozšíření → Apps Script**.
3. Nahraďte celý obsah souboru `Code.gs` obsahem souboru `google-apps-script/Code.gs`.
4. Kód uložte.
5. Otevřete **Nasadit → Spravovat implementace → Upravit**.
6. Vyberte **Nová verze** a klikněte na **Implementovat**.
7. Přístup ponechte nastavený na **Kdokoli**.

Funkci `setup()` znovu spouštět nemusíte.

## Ověření

- Když systém dovolí dnes objednat 36 vajec, zákaznická karta musí ukázat „Skladem: 36 ks“.
- Po označení objednávky jako „Vyzvednuto“ se sklad ihned sníží.
- Tržba se započítá do měsíce, ve kterém bylo skutečně potvrzeno převzetí.
