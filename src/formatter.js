import { DateTime } from 'luxon';

const GUADELOUPE_TZ = 'America/Guadeloupe'; // UTC-4, pas de DST

export function toGuadeloupeTime(date) {
  return DateTime.fromJSDate(date, { zone: 'UTC' })
    .setZone(GUADELOUPE_TZ)
    .toFormat('HH:mm');
}

export function todayLabel() {
  return DateTime.now().setZone(GUADELOUPE_TZ).toFormat('dd/MM/yyyy');
}

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

// ─── Résumé matinal ───────────────────────────────────────────────────────────

export function formatMorningSummary(events) {
  if (events.length === 0) {
    return `📅 <b>SESSION NY — ${todayLabel()}</b>\n\n✅ Aucune annonce économique aujourd'hui.`;
  }
  const lines = events.map(ev => {
    const time = toGuadeloupeTime(ev.date);
    const fcst = ev.forecast ? `Fcst: ${ev.forecast}` : 'Fcst: —';
    const prev = ev.previous ? `Prev: ${ev.previous}` : 'Prev: —';
    return `${time} ${ev.impactIcon} <b>${ev.currency}</b> ${ev.name}\n    ${prev} | ${fcst} → 💹 ${ev.instruments.join(' ')}`;
  }).join('\n\n');

  return `📅 <b>SESSION NY — ${todayLabel()}</b>\n🕐 Heures Guadeloupe (UTC-4)\n\n${lines}`;
}

// ─── Zone de non-trade (remplace l'alerte 5min) ──────────────────────────────

/**
 * Alerte "zone de non-trade" 15 min avant — avec code couleur selon impact
 */
export function formatNoTradeZone15(event) {
  const time = toGuadeloupeTime(event.date);
  const fcst = event.forecast ? `Prévision: ${event.forecast}` : 'Prévision: —';
  const prev = event.previous ? `Précédent: ${event.previous}` : 'Précédent: —';
  const instruments = event.instruments.join(' | ');

  const header = event.importance === 3
    ? '⚠️ <b>ZONE DE PRUDENCE — DANS 15 MIN</b>'
    : event.importance === 2
    ? '⚠️ <b>ANNONCE DANS 15 MIN</b>'
    : 'ℹ️ <b>Annonce dans 15 min</b>';

  return `${header}\n${event.impactIcon} <b>${event.currency} — ${event.name}</b>\n📊 ${fcst} | ${prev}\n💹 ${instruments}\n🕐 ${time} (Guadeloupe)`;
}

/**
 * Zone de non-trade 5 min — selon impact, recommandation stricte
 */
export function formatNoTradeZone5(event) {
  const time = toGuadeloupeTime(event.date);
  const instruments = event.instruments.join(' | ');

  const header = event.importance === 3
    ? '⛔ <b>NE PAS ENTRER EN POSITION</b>\n🔴 Annonce à fort impact dans 5 MIN'
    : event.importance === 2
    ? '🟡 <b>ATTENTION — Annonce dans 5 MIN</b>\nRéduis ton exposition'
    : '🟢 <b>Annonce dans 5 MIN</b>\nFaible impact probable';

  return `${header}\n${event.impactIcon} <b>${event.currency} — ${event.name}</b>\n💹 ${instruments}\n🕐 ${time} (Guadeloupe)`;
}

// ─── Post-event ───────────────────────────────────────────────────────────────

export function formatPostAlert(event) {
  const instruments = event.instruments.join(' | ');
  const actual   = event.actual   ? `✅ Actuel : <b>${event.actual}</b>` : '✅ Actuel : —';
  const forecast = event.forecast ? `📈 Prévision : ${event.forecast}` : 'Prévision : —';
  const previous = event.previous ? `Précédent : ${event.previous}` : 'Précédent : —';
  const verdict  = buildVerdict(event.actual, event.forecast, event.previous);

  return `📢 <b>PUBLICATION : ${event.name}</b>\n${event.impactIcon} ${event.currency}\n${actual}\n${forecast} | ${previous}${verdict}\n💹 ${instruments}`;
}

// ─── Market structure post-event ─────────────────────────────────────────────

export function formatMarketAnalysis(analyses) {
  if (!analyses || analyses.length === 0) return '';

  const lines = analyses
    .filter(a => a.pattern || a.fvg || a.structure || a.imbalance)
    .map(a => {
      const parts = [];
      if (a.pattern)   parts.push(`  📊 ${a.instrument}: ${a.pattern}`);
      if (a.structure) parts.push(`  🔓 ${a.instrument}: Bris de structure ${a.structure.type} @ ${a.structure.level?.toFixed(2)} (+${a.structure.breakPct}%)`);
      if (a.fvg)       parts.push(`  📐 ${a.instrument}: FVG ${a.fvg.type} [${a.fvg.low?.toFixed(2)} – ${a.fvg.high?.toFixed(2)}]`);
      if (a.imbalance) parts.push(`  ⚡ ${a.instrument}: Imbalance ${a.imbalance.type} @ ${a.imbalance.level?.toFixed(2)}`);
      return parts.join('\n');
    })
    .filter(Boolean)
    .join('\n');

  if (!lines) return '';
  return `\n\n🔍 <b>Structure de marché (5min) :</b>\n${lines}`;
}

// ─── Trailing SL reminder ────────────────────────────────────────────────────

export function formatTrailingSLReminder(event) {
  return `⏰ <b>TRAILING SL — 10 min après l'annonce</b>\n${event.impactIcon} ${event.currency} — ${event.name}\n\nVérifie ta position et ajuste ton Stop Loss si tu es en profit.\n💹 ${event.instruments.join(' | ')}`;
}

// ─── Bilan de session ────────────────────────────────────────────────────────

export function formatSessionBilan(events) {
  if (events.length === 0) {
    return `📊 <b>BILAN SESSION NY — ${todayLabel()}</b>\n\nAucun événement à reporter aujourd'hui.`;
  }

  const withActuals = events.filter(e => e.actual);
  const beats  = withActuals.filter(e => {
    const a = parseFloat(e.actual), f = parseFloat(e.forecast);
    return !isNaN(a) && !isNaN(f) && a > f;
  });
  const misses = withActuals.filter(e => {
    const a = parseFloat(e.actual), f = parseFloat(e.forecast);
    return !isNaN(a) && !isNaN(f) && a < f;
  });

  const lines = withActuals.map(e => {
    const time = toGuadeloupeTime(e.date);
    const a = parseFloat(e.actual), f = parseFloat(e.forecast);
    const icon = !isNaN(a) && !isNaN(f) ? (a > f ? '🟢' : a < f ? '🔴' : '⚪') : '⚪';
    return `${time} ${icon} ${e.currency} ${e.name}: <b>${e.actual}</b> (Fcst: ${e.forecast || '—'})`;
  }).join('\n');

  return `📊 <b>BILAN SESSION NY — ${todayLabel()}</b>\n\n${lines}\n\n🟢 ${beats.length} beats | 🔴 ${misses.length} misses | ${withActuals.length - beats.length - misses.length} in-line`;
}
