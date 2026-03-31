import { filterRelevantEvents } from './filters.js';

// Cache en mémoire des événements du jour
let cachedEvents = [];
let lastFetchTime = null;

// Délai minimum entre deux fetches (30 secondes)
const MIN_FETCH_INTERVAL_MS = 30 * 1000;

/**
 * Pause utilitaire
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch avec retry exponentiel (2s, 4s, 8s, 16s)
 * @param {Function} fn - Fonction async à exécuter
 * @param {number} maxRetries
 * @returns {Promise<any>}
 */
async function withRetry(fn, maxRetries = 4) {
  let delay = 2000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.warn(`[scraper] Tentative ${attempt} échouée : ${err.message}. Retry dans ${delay}ms...`);
      await sleep(delay);
      delay *= 2;
    }
  }
}

/**
 * Convertit le time string "8:30" + timestampDay (Unix seconds) en objet Date UTC
 * Le package retourne le time dans le fuseau demandé (UTC ici)
 * @param {string} timeStr - ex: "8:30" ou "All Day"
 * @param {number} timestampDay - Unix timestamp en secondes (début du jour)
 * @returns {Date}
 */
function parseEventDate(timeStr, timestampDay) {
  if (!timeStr || timeStr === 'All Day' || !timestampDay) {
    return new Date(timestampDay * 1000);
  }
  const match = timeStr.match(/(\d+):(\d+)/);
  if (!match) return new Date(timestampDay * 1000);

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  const d = new Date(timestampDay * 1000);
  // timestampDay est en UTC (début de journée UTC)
  d.setUTCHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Normalise les événements du package vers un format uniforme
 * @param {object[]} rawEvents
 * @returns {object[]}
 */
function normalizeEvents(rawEvents) {
  return (rawEvents || []).map(ev => ({
    id: String(ev.id || `ev_${ev.timestampDay}_${ev.time}`),
    date: parseEventDate(ev.time, ev.timestampDay),
    currency: (ev.currency || '').trim().toUpperCase(),
    name: (ev.name || '').trim(),
    importance: ev.importance || 0,
    forecast: ev.forecast || null,
    previous: ev.previous || null,
    actual: ev.actual || null,
  }));
}

/**
 * Récupère les événements économiques depuis Investing.com
 * @returns {Promise<object[]>} Événements filtrés et enrichis
 */
export async function fetchEvents() {
  const now = Date.now();

  if (lastFetchTime && now - lastFetchTime < MIN_FETCH_INTERVAL_MS) {
    return cachedEvents;
  }

  return withRetry(async () => {
    const { fetchEconomicEvents, Importance, CalendarType, Language, TimeZone, Currency } =
      await import('investing-economic-calendar');

    const rawEvents = await fetchEconomicEvents({
      importance: [Importance.HIGH, Importance.MEDIUM, Importance.LOW],
      calType: CalendarType.DAILY,
      lang: Language.ENGLISH,
      timeZone: TimeZone.UTC,
      currencies: [Currency.USD, Currency.JPY],
    });

    const normalized = normalizeEvents(rawEvents);
    const filtered = filterRelevantEvents(normalized);

    cachedEvents = filtered;
    lastFetchTime = Date.now();

    console.log(`[scraper] ${filtered.length} événements NY récupérés (${rawEvents.length} bruts)`);
    return filtered;
  });
}

/**
 * Retourne les événements en cache (sans refetch)
 */
export function getCachedEvents() {
  return cachedEvents;
}

/**
 * Force un rafraîchissement du cache (ignore le délai minimum)
 */
export async function forceRefresh() {
  lastFetchTime = null;
  return fetchEvents();
}
