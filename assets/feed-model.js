/* Krmiva V3.8.6: daily costs and calendar-day stock forecasts. */
(function(root) {
  'use strict';
  const round = (value, digits = 2) => Math.round((value + Number.EPSILON) * 10 ** digits) / 10 ** digits;
  const days = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  const nameKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  function feedItems(settings = {}) {
    if (Array.isArray(settings.items)) return settings.items.map(item => ({...item}));
    if (!settings.revision) return [];
    return [{id:'legacy-feed-v370', name:'Dosavadní krmivo', dailyKg:Number(settings.dailyKg || 0),
      pricePerKg:Number(settings.pricePerKg || 0), stockKg:Number(settings.stockKg || 0),
      stockDate:settings.stockDate, unit:'kg', legacy:true}];
  }
  function dailyCosts(items, year) {
    const annualDays = days(`${year}-01-01`, `${Number(year) + 1}-01-01`);
    const rows = items.map(item => ({...item, dailyCost:round(Number(item.dailyKg) * Number(item.pricePerKg))}));
    // Round only after summing: small portions must not disappear from the total.
    const rawDailyCost = items.reduce((sum, item) => sum + Number(item.dailyKg) * Number(item.pricePerKg), 0);
    return {items:rows, dailyKg:round(items.reduce((sum, item) => sum + Number(item.dailyKg), 0), 6),
      dailyCost:round(rawDailyCost), monthlyCost:round(rawDailyCost * 30), yearlyCost:round(rawDailyCost * annualDays), annualDays};
  }
  function purchaseFeedId(purchase, items) {
    if (purchase.feedId) return String(purchase.feedId);
    const matching = items.find(item => nameKey(item.name) === nameKey(purchase.name));
    return matching?.id || items.find(item => item.legacy)?.id || '';
  }
  function summary(data, year) {
    const today = data.asOf;
    const currentYear = Number(today.slice(0, 4));
    const selectedYear = Number(year);
    const purchases = (data.purchases || []).filter(item => !item.deleted && item.date <= today);
    const annual = purchases.filter(item => Number(item.date.slice(0, 4)) === selectedYear);
    const spent = annual.reduce((sum, item) => sum + Math.round(Number(item.cost) * 100), 0) / 100;
    const sales = data.sales?.years?.[selectedYear] || {revenue:0, eggs:0, orders:0, estimatedDateOrders:0};
    const settings = data.settings || {};
    const items = feedItems(settings);
    const daily = dailyCosts(items, currentYear);
    const configured = Boolean(settings.revision && items.some(item => item.dailyKg > 0) && items.every(item => item.stockDate && item.stockDate <= today));
    let forecast = null;
    if (selectedYear === currentYear && configured) {
      const remainingDays = days(today, `${currentYear + 1}-01-01`);
      const stocks = items.map(item => {
        const purchasedKg = purchases.filter(purchase => purchase.date >= item.stockDate && purchaseFeedId(purchase, items) === item.id)
          .reduce((sum, purchase) => sum + Number(purchase.kg), 0);
        const rawStock = round(Number(item.stockKg) + purchasedKg - days(item.stockDate, today) * Number(item.dailyKg), 6);
        const stockKg = Math.max(0, rawStock);
        const neededKg = Math.max(0, round(remainingDays * Number(item.dailyKg) - stockKg, 6));
        return {...item, stockKg, rawStock, daysOfStock:item.dailyKg > 0 ? Math.floor(round(stockKg / item.dailyKg, 6)) : null,
          neededKg, remainingCost:round(neededKg * Number(item.pricePerKg))};
      });
      const remainingCost = round(stocks.reduce((sum, item) => sum + item.neededKg * Number(item.pricePerKg), 0));
      const stockDays = stocks.filter(item => item.dailyKg > 0).map(item => item.daysOfStock);
      forecast = {items:stocks, stockKg:round(stocks.reduce((sum, item) => sum + item.stockKg, 0), 3),
        rawStock:round(stocks.reduce((sum, item) => sum + item.rawStock, 0), 3),
        daysOfStock:Math.min(...stockDays), remainingDays,
        neededKg:round(stocks.reduce((sum, item) => sum + item.neededKg, 0), 3), remainingCost, totalCost:round(spent + remainingCost),
        depleted:stocks.filter(item => item.dailyKg > 0 && item.rawStock < 0).map(item => item.name)};
    }
    return {year:selectedYear, currentYear, purchases:annual.sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
      spent, purchasedKg:round(annual.reduce((sum, item) => sum + Number(item.kg), 0), 3),
      sales, profit:round(Number(sales.revenue) - spent), configured, forecast, daily};
  }
  const api = {summary, days, dailyCosts, feedItems, purchaseFeedId, nameKey};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PDPFeedModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
