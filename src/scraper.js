import axios from 'axios';
import * as cheerio from 'cheerio';
import { DateTime } from 'luxon';
import { filterRelevantEvents } from './filters.js';
import { config } from './config.js';

const FF_THISWEEK_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
const FF_NEXTWEEK_URL = 'https://nfs.faireconomy.media/ff_calendar_nextweek.xml';

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

const IMPACT_MAP = {
  'High':    3,
  'Medium':  2,
  'Low':     1,
  'Holiday': 0,
};

/**
 * Parse a ForexFactory date+time into a UTC Date.
 * FF date format: "MM-DD-YYYY" — FF times are US Eastern (America/New_York).
 */
function parseFFDate(dateStr, timeStr) {
  if (!dateStr) return null;

  const [month, day, year] = dateStr.split('-');
  if (!month || !day || !year) return null;

  const base = { year: parseInt(year, 10), month: parseInt(month, 10), day: parseInt(day, 10) };

  if (!timeStr || timeStr === 'All Day' || timeStr === 'Tentative') {
    return DateTime.fromObject({ ...base, hour: 0, minute: 0 }, { zone: 'America/New_York' }).toJSDate();
  }

  const match = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (!match) {
    return DateTime.fromObject({ ...base, hour: 0, minute: 0 }, { zone: 'America/New_York' }).toJSDate();
  }

  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const ampm = match[3].toLowerCase();

  if (ampm === 'am' && hour === 12) hour = 0;
  if (ampm === 'pm' && hour !== 12) hour += 12;

  return DateTime.fromObject({ ...base, hour, minute }, { zone: 'America/New_York' }).toJSDate();
}

async function fetchFFXml(url) {
  const response = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    responseType: 'text',
  });
  return response.data;
}

function parseXmlEvents(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const events = [];

  $('event').each((_, el) => {
    const title    = $(el).find('title').text().trim();
    const country  = $(el).find('country').text().trim().toUpperCase();
    const dateStr  = $(el).find('date').text().trim();
    const timeStr  = $(el).find('time').text().trim();
    const impact   = $(el).find('impact').text().trim();
    const forecast = $(el).find('forecast').text().trim() || null;
    const previous = $(el).find('previous').text().trim() || null;
    const actual   = $(el).find('actual').text().trim() || null;

    const date = parseFFDate(dateStr, timeStr);
    if (!date) return;

    events.push({
      id:         `ff_${country}_${dateStr}_${timeStr}_${title}`.replace(/\s+/g, '_'),
      date,
      currency:   country,
      name:       title,
      importance: IMPACT_MAP[impact] ?? 0,
      forecast,
      previous,
      actual,
    });
  });

  return events;
}

/**
 * Fetch les événements pour aujourd'hui
 */
export async function fetchEvents() {
  const now = Date.now();
  if (lastFetchTime && now - lastFetchTime < MIN_FETCH_INTERVAL_MS) return cachedEvents;

  return withRetry(async () => {
    const xml = await fetchFFXml(FF_THISWEEK_URL);
    const rawEvents = parseXmlEvents(xml);

    // Filter to today (ET date)
    const todayET = DateTime.now().setZone('America/New_York').startOf('day');
    const todayEvents = rawEvents.filter(ev => {
      const evDay = DateTime.fromJSDate(ev.date).setZone('America/New_York').startOf('day');
      return evDay.equals(todayET);
    });

    const filtered = filterRelevantEvents(todayEvents);
    cachedEvents = filtered;
    lastFetchTime = Date.now();
    console.log(`[scraper] ${filtered.length} événements NY (${todayEvents.length} du jour, ${rawEvents.length} semaine) — ForexFactory XML`);
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
    const urls = period === 'week'
      ? [FF_THISWEEK_URL, FF_NEXTWEEK_URL]
      : [FF_THISWEEK_URL];

    const allEvents = [];
    for (const url of urls) {
      const xml = await fetchFFXml(url);
      allEvents.push(...parseXmlEvents(xml));
    }

    if (period === 'day') {
      const target = DateTime.fromJSDate(date || new Date()).setZone('America/New_York').startOf('day');
      return filterRelevantEvents(
        allEvents.filter(ev => {
          const evDay = DateTime.fromJSDate(ev.date).setZone('America/New_York').startOf('day');
          return evDay.equals(target);
        })
      );
    }

    return filterRelevantEvents(allEvents);
  });
}

export function getCachedEvents() { return cachedEvents; }

export async function forceRefresh() {
  lastFetchTime = null;
  return fetchEvents();
}
