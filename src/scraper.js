import { filterRelevantEvents } from './filters.js';
import { config } from './config.js';

let cachedEvents = [];
let lastFetchTime = null;
const MIN_FETCH_INTERVAL_MS = config.scraper.minFetchIntervalMs;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, maxRetries = config.scraper.retryMaxAttempts) {
  let delay = config.scraper.retryInitialDelayMs;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt === maxRetries) throw err;
      console.warn(`[scraper] Tentative ${attempt} échouée: ${err.message}. Retry dans ${delay}ms...`);
      await sleep(delay);
      delay *= 2;
    }
  }
}

function parseEventDate(timeStr, timestampDay) {
  if (!timeStr || timeStr === 'All Day' || !timestampDay) return new Date(timestampDay * 1000);
  const match = timeStr.match(/(\d+):(\d+)/);
  if (!match) return new Date(timestampDay * 1000);
  const d = new Date(timestampDay * 1000);
  d.setUTCHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
  return d;
}

function normalizeEvents(rawEvents) {
  return (rawEvents || []).map(ev => ({
    id:         String(ev.id || `ev_${ev.timestampDay}_${ev.time}`),
    date:       parseEventDate(ev.time, ev.timestampDay),
    currency:   (ev.currency || '').trim().toUpperCase(),
    name:       (ev.name || '').trim(),
    importance: ev.importance || 0,
    forecast:   ev.forecast || null,
    previous:   ev.previous || null,
    actual:     ev.actual || null,
  }));
}

/**
 * Fetch les événements pour aujourd'hui
 */
export async function fetchEvents() {
  const now = Date.now();
  if (lastFetchTime && now - lastFetchTime < MIN_FETCH_INTERVAL_MS) return cachedEvents;

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
    if (normalized.length > 0) {
      console.log('[scraper] Premier événement brut:', JSON.stringify({ name: normalized[0].name, date: normalized[0].date, utcH: normalized[0].date?.getUTCHours() }));
    }
    const filtered = filterRelevantEvents(normalized);
    cachedEvents = filtered;
    lastFetchTime = Date.now();
    console.log(`[scraper] ${filtered.length} événements NY (${rawEvents.length} bruts)`);
    return filtered;
  });
}

/**
 * Fetch pour une date ou période spécifique
 * @param {Date|null} date - null = aujourd'hui
 * @param {'day'|'week'} period
 */
export async function fetchEventsForDate(date = null, period = 'day') {
  return withRetry(async () => {
    const { fetchEconomicEvents, Importance, CalendarType, Language, TimeZone, Currency } =
      await import('investing-economic-calendar');

    const calType = period === 'week' ? CalendarType.WEEKLY : CalendarType.DAILY;

    const rawEvents = await fetchEconomicEvents({
      importance: [Importance.HIGH, Importance.MEDIUM, Importance.LOW],
      calType,
      lang: Language.ENGLISH,
      timeZone: TimeZone.UTC,
      currencies: [Currency.USD, Currency.JPY],
    });

    return filterRelevantEvents(normalizeEvents(rawEvents));
  });
}

export function getCachedEvents() { return cachedEvents; }

export async function forceRefresh() {
  lastFetchTime = null;
  return fetchEvents();
}
