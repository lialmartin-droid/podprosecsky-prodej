# Podprosečské domácí produkty V2.4.0

Tato verze opravuje skladové limity, cache cen, denní limit vyzvednutí, vyloučení vlastních návštěv a přidává automatické upozornění den před vyzvednutím.

## Automatická připomínka
Po nahrání nového `Code.gs` jednou spusťte v Google Apps Scriptu funkci `setupPickupReminderAutomation()` a potvrďte oprávnění. Spouštěč potom každé ráno zkontroluje vyzvednutí na následující den.

- zákazník s volbou **E-mail** dostane připomínku automaticky,
- při volbě **SMS** dostane prodejce e-mail s připraveným textem SMS pro ruční odeslání,
- prodejce dostane upozornění vždy na `podprosecskeprodukty@gmail.com`,
- rozdělené objednávky se hlídají samostatně pro oba termíny.
