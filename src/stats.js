import { getHistory, getDirectionalProb, normalizeEventKey } from './db.js';

/**
 * Formate l'historique d'un indicateur pour Telegram
 * @param {string} query - ex: "NFP", "CPI"
 * @returns {string}
 */
export function formatHistory(query) {
  const rows = getHistory(query, 6);
  if (rows.length === 0) {
    return `📊 <b>Historique : ${query}</b>\n\nAucune donnée enregistrée pour l'instant.\nLes résultats seront stockés dès la prochaine publication.`;
  }

  const lines = rows.map(r => {
    const date = new Date(r.event_date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const beatIcon = r.beat === 1 ? '🟢' : r.beat === 0 ? '🔴' : '⚪';
    const actual   = r.actual   || '—';
    const forecast = r.forecast || '—';
    return `${date} ${beatIcon} Réel: <b>${actual}</b> | Fcst: ${forecast}`;
  });

  const beats  = rows.filter(r => r.beat === 1).length;
  const misses = rows.filter(r => r.beat === 0).length;

  return `📊 <b>Historique : ${rows[0].event_name}</b> (${rows[0].currency})\n\n${lines.join('\n')}\n\n🟢 ${beats} beats | 🔴 ${misses} misses sur ${rows.length}`;
}

/**
 * Calcule le score d'impact marché basé sur le résultat d'une annonce
 * Retourne une analyse haussière/baissière par instrument
 * @param {object} event - avec actual, forecast, currency, name
 * @returns {object[]} [{instrument, direction, reason}]
 */
export function computeMarketImpact(event) {
  const { actual, forecast, previous, currency, name } = event;
  if (!actual) return [];

  const a = parseFloat(actual);
  const f = parseFloat(forecast);
  const p = parseFloat(previous);

  // Détermine si le chiffre est "fort" ou "faible" pour la devise
  let isStrong = null;
  if (!isNaN(a) && !isNaN(f)) {
    isStrong = a > f; // beat forecast = fort
  } else if (!isNaN(a) && !isNaN(p)) {
    isStrong = a > p;
  }

  if (isStrong === null) return [];

  // CPI/Inflation : beat = inflationniste = potentiellement hawkish Fed = fort USD
  // mais aussi négatif pour XAUUSD (Gold recule si Fed plus hawkish)
  const isInflation = /cpi|pce|inflation/i.test(name);

  const impacts = [];

  if (currency === 'USD') {
    const usdDir = isStrong ? '📈 Haussier' : '📉 Baissier';
    const usdReason = isStrong ? 'USD fort' : 'USD faible';

    impacts.push({ instrument: 'US30',   direction: isStrong ? '📈 Haussier' : '📉 Baissier', reason: usdReason });
    impacts.push({ instrument: 'USDJPY', direction: isStrong ? '📈 Haussier' : '📉 Baissier', reason: usdReason });
    // Gold : inverse USD (sauf si inflation forte → Gold aussi monte)
    const goldDir = isInflation && isStrong ? '📈 Haussier (inflation)' : isStrong ? '📉 Baissier' : '📈 Haussier';
    impacts.push({ instrument: 'XAUUSD', direction: goldDir, reason: isStrong ? 'USD fort → pression sur Gold' : 'USD faible → Gold monte' });
    impacts.push({ instrument: 'XBRUSD', direction: isStrong ? '⚡ Mixte (USD fort)' : '⚡ Mixte (USD faible)', reason: 'Oil dépend aussi de l\'offre/demande' });
  }

  if (currency === 'JPY') {
    impacts.push({ instrument: 'USDJPY', direction: isStrong ? '📉 Baissier' : '📈 Haussier', reason: isStrong ? 'JPY fort → USDJPY baisse' : 'JPY faible → USDJPY monte' });
  }

  return impacts;
}

/**
 * Formate le score d'impact et la probabilité directionnelle
 * @param {object} event
 * @returns {string}
 */
export function formatImpactScore(event) {
  const impacts = computeMarketImpact(event);
  if (impacts.length === 0) return '';

  const key = normalizeEventKey(event.name, event.currency);
  const prob = getDirectionalProb(key);

  const impactLines = impacts.map(i => `  ${i.instrument}: ${i.direction} — ${i.reason}`).join('\n');

  let probLine = '';
  if (prob && prob.total >= 3) {
    probLine = `\n📐 <b>Stats historiques</b> (${prob.total} occurrences) : USD fort ${prob.pct}% du temps après ce type de résultat`;
  }

  return `\n🧠 <b>Impact attendu :</b>\n${impactLines}${probLine}`;
}

/**
 * Formate une alerte de corrélation en chaîne (ex: NFP fort → USD fort → tous les instruments)
 * @param {object} event
 * @returns {string}
 */
export function formatCorrelationAlert(event) {
  const impacts = computeMarketImpact(event);
  if (impacts.length === 0) return '';

  const a = parseFloat(event.actual);
  const f = parseFloat(event.forecast);
  const diff = !isNaN(a) && !isNaN(f) ? (a - f) : null;
  const sign = diff !== null && diff > 0 ? '+' : '';
  const surprise = diff !== null ? ` (${sign}${diff.toFixed(2)} vs forecast)` : '';

  const lines = impacts.map(i => `${i.instrument}: ${i.direction}`).join(' | ');

  return `🔗 <b>CORRÉLATION EN CHAÎNE</b>\n${event.impactIcon} ${event.currency} ${event.name}${surprise}\n${lines}`;
}
