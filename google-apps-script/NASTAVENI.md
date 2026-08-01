# Nastavení Google Apps Scriptu

## 1. Vytvoření tabulky

1. Na Disku Google vytvořte novou Google Tabulku.
2. Pojmenujte ji například `Podprosečské objednávky`.
3. V horním menu otevřete **Rozšíření → Apps Script**.

## 2. Vložení skriptu

1. Smažte původní obsah souboru `Code.gs`.
2. Vložte obsah přiloženého souboru `Code.gs`.
3. V nastavení projektu zapněte zobrazení manifestu `appsscript.json`.
4. Nahraďte jeho obsah přiloženým souborem `appsscript.json`.
5. Uložte projekt.

E-mail pro upozornění je už nastavený na:

`podprosecskeprodukty@gmail.com`

## 3. První spuštění

1. V horním výběru funkcí zvolte `setup`.
2. Klikněte na **Spustit**.
3. Přihlaste se ke Google účtu a povolte přístup k tabulce a odesílání e-mailů.
4. Na e-mail přijde testovací zpráva.
5. V tabulce se vytvoří list `Objednávky`.

## 4. Nasazení jako webová aplikace

1. Klikněte na **Nasadit → Nové nasazení**.
2. Typ nasazení nastavte na **Webová aplikace**.
3. **Spouštět jako:** Já.
4. **Kdo má přístup:** Kdokoli.
5. Klikněte na **Nasadit**.
6. Zkopírujte adresu končící `/exec`.

## 5. Propojení s GitHub stránkou

Otevřete soubor:

`assets/config.js`

Vložte zkopírovanou adresu mezi uvozovky:

```js
window.PDP_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/VAŠE_ID/exec"
};
```

Potom soubory nahrajte na GitHub.

## Aktualizace skriptu

Po pozdější změně `Code.gs` vytvořte nové nasazení, nebo upravte existující nasazení na novou verzi. Adresa `/exec` může při úpravě stejného nasazení zůstat stejná.
