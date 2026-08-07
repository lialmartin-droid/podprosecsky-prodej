# Nastavení Google Apps Scriptu V2.4.0

1. Otevřete Google Tabulku s objednávkami.
2. Zvolte **Rozšíření → Apps Script**.
3. Nahraďte celý obsah `Code.gs` obsahem souboru `google-apps-script/Code.gs`.
4. Pokud používáte manifest, nahraďte také `appsscript.json` přiloženou verzí.
5. Kód uložte.
6. Jednou spusťte funkci **setupPickupReminderAutomation()** a potvrďte nová oprávnění. Tím vznikne denní časový spouštěč přibližně na 8:00 v časové zóně Europe/Prague.
7. Otevřete **Nasadit → Spravovat implementace**.
8. U aktivní webové aplikace klikněte na tužku, vyberte **Nová verze** a klikněte na **Implementovat**.
9. Přístup ponechte **Kdokoli**. Adresa `/exec` se nemění.

## Co dělá automatická připomínka
- Každé ráno se zkontrolují objednávky na následující den.
- Pokud zákazník zvolil **E-mail**, připomínka se mu odešle automaticky.
- Pokud zvolil **SMS**, prodejci přijde e-mail s telefonem a připraveným textem SMS k ručnímu odeslání.
- Prodejci přijde upozornění vždy na `podprosecskeprodukty@gmail.com`.
- U rozdělené objednávky se oba termíny hlídají samostatně.
- Změní-li se termín, nový termín může dostat novou připomínku; stejný termín se neposílá opakovaně.

Funkci `setup()` znovu spouštět nemusíte, pokud už je tabulka založená. Pro novou automatiku stačí jednorázově `setupPickupReminderAutomation()`.
