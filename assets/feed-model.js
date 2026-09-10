/* Pure calendar-day calculations; shared by the admin and Node regression checks. */
(function(root) {
  'use strict';
  const round = (value, digits = 2) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;
  const days = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  function summary(data, year) {
    const today = data.asOf;
    const currentYear = Number(today.slice(0, 4));
    const selectedYear = Number(year);
    const purchases = (data.purchases || []).filter(item => !item.deleted && item.date <= today);
    const annual = purchases.filter(item => Number(item.date.slice(0, 4)) === selectedYear);
    const spent = annual.reduce((sum, item) => sum + Math.round(Number(item.cost) * 100), 0) / 100;
    const sales = data.sales?.years?.[selectedYear] || {revenue:0, eggs:0, orders:0, estimatedDateOrders:0};
    const settings = data.settings || {};
    const configured = Boolean(settings.revision && settings.dailyKg > 0 && settings.stockDate <= today);
    let forecast = null;
    if (selectedYear === currentYear && configured) {
      const purchasedKg = purchases.filter(item => item.date >= settings.stockDate).reduce((sum, item) => sum + Number(item.kg), 0);
      // Estimate at the beginning of today, after all purchases recorded for today.
      const rawStock = round(Number(settings.stockKg) + purchasedKg - days(settings.stockDate, today) * Number(settings.dailyKg), 3);
      const stockKg = Math.max(0, rawStock);
      const remainingDays = days(today, `${currentYear + 1}-01-01`); // Includes today, handles leap years and DST.
      const neededKg = Math.max(0, round(remainingDays * Number(settings.dailyKg) - stockKg, 3));
      const remainingCost = round(neededKg * Number(settings.pricePerKg));
      forecast = {stockKg, rawStock, daysOfStock:Math.floor(stockKg / settings.dailyKg), remainingDays, neededKg, remainingCost, totalCost:round(spent + remainingCost)};
    }
    return {year:selectedYear, currentYear, purchases:annual.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
      spent, purchasedKg:round(annual.reduce((sum, item) => sum + Number(item.kg), 0), 3),
      sales, profit:round(Number(sales.revenue) - spent), configured, forecast};
  }
  const api = {summary, days};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PDPFeedModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
