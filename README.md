V2.3.7 – kompletní audit objednávkového toku:
- produkty a rezervace se při validaci načítají dávkově místo opakovaného čtení Google Tabulky pro každý produkt,
- po vytvoření objednávky se veřejná cache pouze zneplatní; zákazník nečeká na druhý přepočet celé nabídky,
- při změně objednávky se nejdřív validuje nový stav a až potom se mění fyzický sklad,
- e-maily při stavech Připraveno/Zrušeno se odesílají mimo hlavní tabulkový zámek,
- zachována ochrana Request ID proti duplicitní objednávce,
- zachováno správné započítání skutečného času Vyzvednuto a tržby.

V2.3.6: Potvrzení Vyzvednuto už nepřepočítává veřejnou nabídku během globálního zámku. Po zápisu se veřejná cache pouze zneplatní a zákaznická stránka si aktuální stav načte při dalším požadavku. Admin čeká na pomalejší Google odpověď až 45 s.

V2.3.5: Zámek objednávky se drží jen při validaci a zápisu do tabulky. E-maily už další objednávky neblokují. Přidána idempotence Request ID proti duplicitám po opakovaném pokusu.

V2.3.4 – finální kontrola. Opravena cache značka, aby se po nasazení vždy načetl nový admin.js/customer.js. Vyloučení vlastního zařízení je dvojí: lokálně v prohlížeči i na backendu podle ID návštěvníka.

V2.3.2 – opraveno načítání hodnot do horních karet návštěvnosti v administraci.

V2.3.1 – přidáno sledování návštěvnosti zákaznické stránky (QR / odkaz), bez započítání zařízení administrátora.

# Podprosečské domácí produkty 2.0

Samostatná testovací verze nového vzhledu. Původní veřejný repozitář není potřeba měnit.

## Obsah

- `index.html` – nová zákaznická stránka 2.0
- `admin/index.html` – administrace
- `assets/style.css` – vzhled zákaznické stránky i administrace
- `assets/customer.js` – zákaznická logika
- `assets/admin.js` – administrace
- `assets/config.js` – URL nasazeného Google Apps Scriptu
- `assets/images/` – hlavní akvarelový obrázek a ilustrace
- `assets/images/products/` – fotografie produktů
- `google-apps-script/Code.gs` – backend pro Google Apps Script

## Fotografie produktu

1. Nahrajte fotografii do `assets/images/products/`, například `med-kvetovy.jpg`.
2. V administraci otevřete produkt.
3. Do pole **Fotografie produktu** vložte:

```text
assets/images/products/med-kvetovy.jpg
```

Lze použít také úplnou HTTPS adresu obrázku. Doporučený poměr fotografie je přibližně 4:3 nebo 3:2 a rozlišení alespoň 1200 × 800 px.

## První nahrání do nového repozitáře

1. Vytvořte nový veřejný repozitář na GitHubu.
2. Nahrajte do kořene celý obsah této složky, nikoli nadřazenou složku.
3. V GitHubu otevřete **Settings → Pages**.
4. Jako zdroj zvolte větev `main` a složku `/root`.
5. Počkejte na vytvoření testovací adresy GitHub Pages.

## Google Apps Script

Nová verze přidává do listu `Produkty` sloupec **Fotografie produktu**. Pro úplnou funkčnost:

1. V Apps Scriptu nahraďte `Code.gs` souborem z `google-apps-script/Code.gs`.
2. Uložte změny.
3. Otevřete **Nasadit → Spravovat implementace → Upravit**.
4. Vyberte **Nová verze** a implementujte ji.
5. Funkci `setup()` znovu spouštět nemusíte.

Původní data a objednávky zůstanou zachované.
