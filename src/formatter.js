import { DateTime } from 'luxon';

const GUADELOUPE_TZ = 'America/Guadeloupe'; // UTC-4, pas de DST

/**
 * Convertit une Date UTC en heure Guadeloupe formatée HH:mm
 * @param {Date} date
 * @returns {string}
 */
export function toGuadeloupeTime(date) {
  return DateTime.fromJSDate(date, { zone: 'UTC' })
    .setZone(GUADELOUPE_TZ)
    .toFormat('HH:mm');
}

/**
 * Formate la date du jour en format lisible
 * @returns {string}
 */
export function todayLabel() {
  return DateTime.now().setZone(GUADELOUPE_TZ).toFormat('dd/MM/yyyy');
}

/**
 * Calcule le verdict post-event (meilleur/moins bon que prévu)
 * @param {string|null} actual
 * @param {string|null} forecast
 * @param {string|null} previous
 * @returns {string}
 */
function buildVerdict(actual, forecast, previous) {
  if (!actual) return '';
  const a = parseFloat(actual);
  const f = parseFloat(forecast);
  const p = parseFloat(previous);

  if (!isNaN(a) && !isNaN(f)) {
    const diff = a - f;
    const sign = diff > 0 ? '+' : '';
    if (diff > 0) return `\n🟢 Meilleur que prévu (${sign}${diff.toFixed(2)})`;
    if (diff < 0) return `\n🔴 Moins bon que prévu (${sign}${diff.toFixed(2)})`;
    return '\n⚪ Conforme aux attentes';
  }
  if (!isNaN(a) && !isNaN(p)) {
    const diff = a - p;
    const sign = diff > 0 ? '+' : '';
    return diff > 0
      ? `\n🟢 En hausse vs précédent (${sign}${diff.toFixed(2)})`
      : `\n🔴 En baisse vs précédent (${sign}${diff.toFixed(2)})`;
  }
  return '';
}

/**
 * Formate une ligne événement pour le résumé matinal
 * @param {object} event
 * @returns {string}
 */
function formatSummaryLine(event) {
  const time = toGuadeloupeTime(event.date);
  const fcst = event.forecast ? `Fcst: ${event.forecast}` : 'Fcst: —';
  const prev = event.previous ? `Prev: ${event.previous}` : 'Prev: —';
  const instruments = event.instruments.join(' ');
  return `${time} ${event.impactIcon} <b>${event.currency}</b> ${event.name}\n    ${prev} | ${fcst} → 💹 ${instruments}`;
}

/**
 * Message résumé matinal de session NY
 * @param {object[]} events - Événements filtrés du jour
 * @returns {string}
 */
export function formatMorningSummary(events) {
  if (events.length === 0) {
    return `📅 <b>SESSION NY — ${todayLabel()}</b>\n\n✅ Aucune annonce économique aujourd'hui.`;
  }
  const lines = events.map(formatSummaryLine).join('\n\n');
  return `📅 <b>SESSION NY — ${todayLabel()}</b>\n🕐 Heures en heure Guadeloupe (UTC-4)\n\n${lines}`;
}

/**
 * Alerte 15 minutes avant
 * @param {object} event
 * @returns {string}
 */
export function formatPreAlert15(event) {
  const time = toGuadeloupeTime(event.date);
  const fcst = event.forecast ? `Prévision: ${event.forecast}` : 'Prévision: —';
  const prev = event.previous ? `Précédent: ${event.previous}` : 'Précédent: —';
  const instruments = event.instruments.join(' | ');
  return `⚠️ <b>DANS 15 MIN</b>\n${event.impactIcon} <b>${event.currency} — ${event.name}</b>\n📊 ${fcst} | ${prev}\n💹 Instruments: ${instruments}\n🕐 ${time} (Guadeloupe)`;
}

/**
 * Alerte 5 minutes avant
 * @param {object} event
 * @returns {string}
 */
export function formatPreAlert5(event) {
  const time = toGuadeloupeTime(event.date);
  const instruments = event.instruments.join(' | ');
  return `🚨 <b>DANS 5 MIN — PRÉPARE-TOI</b>\n${event.impactIcon} <b>${event.currency} — ${event.name}</b>\n💹 ${instruments}\n🕐 ${time} (Guadeloupe)`;
}

/**
 * Alerte post-event (chiffres réels publiés)
 * @param {object} event
 * @returns {string}
 */
export function formatPostAlert(event) {
  const instruments = event.instruments.join(' | ');
  const actual   = event.actual   ? `✅ Actuel : <b>${event.actual}</b>` : '✅ Actuel : —';
  const forecast = event.forecast ? `📈 Prévision : ${event.forecast}` : 'Prévision : —';
  const previous = event.previous ? `Précédent : ${event.previous}` : 'Précédent : —';
  const verdict  = buildVerdict(event.actual, event.forecast, event.previous);

  return `📢 <b>PUBLICATION : ${event.name}</b>\n${event.impactIcon} ${event.currency}\n${actual}\n${forecast} | ${previous}${verdict}\n💹 ${instruments}`;
}
