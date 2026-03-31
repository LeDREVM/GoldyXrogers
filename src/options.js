import axios from 'axios';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { load } = require('cheerio');
import { DateTime } from 'luxon';

// CME Group — expirations d'options importantes
// Gold options (GC) et paires majeures USD
const CME_GOLD_URL = 'https://www.cmegroup.com/trading/metals/precious/gold_product_calendar_futures.html';

// Dates connues des expirations mensuelles (OPEX) pour Gold/Forex
// Mis à jour manuellement ou via scraping CME
// Source: CME expiry schedule

/**
 * Retourne les prochaines expirations d'options majeures
 * Logique: dernier vendredi du mois pour les options Forex CME
 *          avant-dernier jour ouvré avant le 3e mercredi pour Gold
 * @returns {object[]}
 */
export function getUpcomingExpirations() {
  const now = DateTime.now().setZone('UTC');
  const expirations = [];

  // Calcul du prochain OPEX Gold (4e vendredi du mois courant ou suivant)
  for (let monthOffset = 0; monthOffset <= 2; monthOffset++) {
    const target = now.plus({ months: monthOffset });
    const goldExpiry = getLastFridayOfMonth(target.year, target.month);
    const forexExpiry = getThirdWednesdayOfMonth(target.year, target.month);

    if (goldExpiry > now) {
      expirations.push({
        instrument: 'XAUUSD',
        type: 'Options COMEX Gold',
        date: goldExpiry,
        daysUntil: Math.floor(goldExpiry.diff(now, 'days').days),
      });
    }

    if (forexExpiry > now) {
      expirations.push({
        instrument: 'USDJPY',
        type: 'Options CME FX',
        date: forexExpiry,
        daysUntil: Math.floor(forexExpiry.diff(now, 'days').days),
      });
    }
  }

  // Trier par date
  return expirations.sort((a, b) => a.date - b.date).slice(0, 6);
}

/**
 * Calcule le dernier vendredi du mois
 */
function getLastFridayOfMonth(year, month) {
  const lastDay = DateTime.fromObject({ year, month }).endOf('month');
  let d = lastDay;
  while (d.weekday !== 5) { // 5 = vendredi
    d = d.minus({ days: 1 });
  }
  return d.set({ hour: 20, minute: 0, second: 0 }); // 20h UTC ~ 15h EST
}

/**
 * Calcule le 3e mercredi du mois
 */
function getThirdWednesdayOfMonth(year, month) {
  let d = DateTime.fromObject({ year, month, day: 1 });
  let count = 0;
  while (count < 3) {
    if (d.weekday === 3) count++; // 3 = mercredi
    if (count < 3) d = d.plus({ days: 1 });
  }
  return d.set({ hour: 16, minute: 0, second: 0 }); // 16h UTC
}

/**
 * Formate les prochaines expirations pour Telegram
 * @returns {string}
 */
export function formatOptionsMessage() {
  const expirations = getUpcomingExpirations();

  if (expirations.length === 0) {
    return '📅 <b>Options Expiry (CME)</b>\n\nAucune expiration prochaine.';
  }

  const lines = expirations.map(e => {
    const dateStr = e.date.toFormat('dd/MM/yyyy');
    const urgency = e.daysUntil <= 1 ? '🚨' : e.daysUntil <= 5 ? '⚠️' : '📌';
    return `${urgency} <b>${e.instrument}</b> — ${e.type}\n   ${dateStr} (J-${e.daysUntil})`;
  });

  return `📅 <b>Options Expiry CME — Prochaines dates</b>\n\n${lines.join('\n\n')}\n\n<i>Les prix tendent à graviter vers les gros strikes autour des expirations</i>`;
}

/**
 * Vérifie si aujourd'hui est un jour d'expiration et envoie une alerte si oui
 * @returns {{isExpiry: boolean, instruments: string[]}}
 */
export function checkTodayExpiry() {
  const expirations = getUpcomingExpirations();
  const today = DateTime.now().setZone('UTC');
  const todayExpiries = expirations.filter(e => e.daysUntil === 0 || e.daysUntil === 1);
  return {
    isExpiry: todayExpiries.length > 0,
    instruments: todayExpiries.map(e => e.instrument),
    message: todayExpiries.length > 0
      ? `📅 <b>EXPIRATION D'OPTIONS AUJOURD'HUI</b>\n${todayExpiries.map(e => `⚠️ ${e.instrument} — ${e.type}`).join('\n')}\n\n<i>Attends une attraction vers les gros strikes. Sois prudent en scalp.</i>`
      : null,
  };
}
