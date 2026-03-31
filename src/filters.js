// Mapping instrument → codes devise surveillés
// 'OIL' est un tag custom pour les événements pétroliers (EIA, API Crude)
const INSTRUMENT_CURRENCIES = {
  US30:   ['USD'],
  USDJPY: ['USD', 'JPY'],
  XBRUSD: ['USD', 'OIL'],
  XAUUSD: ['USD'],
};

// Mots-clés pour identifier les événements Oil (Brent/WTI)
const OIL_KEYWORDS = [
  'crude oil',
  'eia',
  'api crude',
  'petroleum',
  'oil inventories',
  'oil stocks',
];

// Session NY en UTC (avec marge de 30 min avant/après)
const NY_SESSION_START_UTC = { hour: 13, minute: 0 };  // 09:00 EST = 13:00 UTC (marge -30min)
const NY_SESSION_END_UTC   = { hour: 21, minute: 30 }; // 17:30 EST = 21:30 UTC (marge +30min)

export const IMPACT_ICONS = {
  1: '🟢',
  2: '🟡',
  3: '🔴',
  high:   '🔴',
  medium: '🟡',
  low:    '🟢',
};

/**
 * Vérifie si un événement est dans la fenêtre session NY (UTC)
 * @param {Date} eventDate
 * @returns {boolean}
 */
function isInNYSession(eventDate) {
  const h = eventDate.getUTCHours();
  const m = eventDate.getUTCMinutes();
  const totalMinutes = h * 60 + m;
  const start = NY_SESSION_START_UTC.hour * 60 + NY_SESSION_START_UTC.minute;
  const end   = NY_SESSION_END_UTC.hour   * 60 + NY_SESSION_END_UTC.minute;
  return totalMinutes >= start && totalMinutes <= end;
}

/**
 * Détermine si un événement est lié au pétrole
 * @param {string} eventName
 * @returns {boolean}
 */
function isOilEvent(eventName) {
  const lower = (eventName || '').toLowerCase();
  return OIL_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Retourne la liste des instruments affectés par un événement
 * @param {object} event - { currency, name }
 * @returns {string[]}
 */
export function getAffectedInstruments(event) {
  const currency = (event.currency || '').toUpperCase();
  const instruments = [];

  for (const [instrument, currencies] of Object.entries(INSTRUMENT_CURRENCIES)) {
    if (currencies.includes(currency)) {
      instruments.push(instrument);
      continue;
    }
    if (currencies.includes('OIL') && isOilEvent(event.name)) {
      if (!instruments.includes(instrument)) {
        instruments.push(instrument);
      }
    }
  }
  return instruments;
}

/**
 * Filtre et enrichit les événements pertinents pour la session NY
 * @param {object[]} events - Événements bruts du scraper
 * @returns {object[]} Événements enrichis avec .instruments[]
 */
export function filterRelevantEvents(events) {
  return events
    .filter(event => {
      const eventDate = new Date(event.date || event.time);
      return isInNYSession(eventDate);
    })
    .map(event => ({
      ...event,
      instruments: getAffectedInstruments(event),
      impactIcon: IMPACT_ICONS[event.importance] || IMPACT_ICONS[event.impact] || '⚪',
    }))
    .filter(event => event.instruments.length > 0)
    .sort((a, b) => new Date(a.date || a.time) - new Date(b.date || b.time));
}
