# Jednorázové nastavení nahrávání obrázků na GitHub

## 1. Vytvořte fine-grained token na GitHubu
Na GitHubu otevřete **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.

Nastavte:
- Repository access: pouze repozitář s webem
- Repository permissions → Contents: **Read and write**
- ostatní oprávnění ponechte bez zápisu

Token po vytvoření zkopírujte. GitHub jej později znovu celý nezobrazí.

## 2. Doplňte údaje do Apps Scriptu
V souboru `Code.gs` najděte funkci `nastavitGitHubObrazky()` a doplňte:

```javascript
const GITHUB_UZIVATEL = 'vas-github-uzivatel';
const GITHUB_REPOZITAR = 'nazev-repozitare';
const GITHUB_VETEV = 'main';
const GITHUB_TOKEN = 'github_pat_...';
```

Potom nahoře v seznamu funkcí vyberte `nastavitGitHubObrazky`, klikněte na **Spustit** a potvrďte oprávnění.
Po úspěšném spuštění můžete token z řádku ve funkci smazat a nahradit textem `TOKEN_UZ_ULOZEN` – uložená hodnota zůstane ve vlastnostech Apps Scriptu.

## 3. Znovu nasaďte webovou aplikaci
Klikněte **Nasadit → Spravovat nasazení → tužka → Nová verze → Nasadit**.

Poté lze v administraci nahrávat obrázky přímo z telefonu i počítače.
