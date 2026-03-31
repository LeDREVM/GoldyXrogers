import cron from 'node-cron';
import { config } from './config.js';
import { fetchEvents, getCachedEvents, forceRefresh } from './scraper.js';
import { sendAlert, isMuted } from './telegram.js';
import {
  formatMorningSummary,
  formatNoTradeZone15,
  formatNoTradeZone5,
  formatPostAlert,
  formatTrailingSLReminder,
  formatSessionBilan,
  formatMarketAnalysis,
} from './formatter.js';
import { formatImpactScore, formatCorrelationAlert } from './stats.js';
import { saveEventResult, normalizeEventKey, saveTradeStatsBefore, updateTradeStatsAfter5, updateTradeStatsAfter15 } from './db.js';
import { analyzePostEvent } from './market.js';
import { getAllPrices, getDXY } from './price.js';
import { formatCOTMessage } from './cot.js';
import { formatDXYAlert } from './formatter.js';
import { checkTodayExpiry } from './options.js';
import { getState, setState } from './db.js';
import { syncHistoryToNextcloud, syncDailyReport, isNextcloudEnabled } from './nextcloud.js';

const alertedPre15    = new Set();
const alertedPre5     = new Set();
const alertedPost     = new Set();
const alertedTrailSL  = new Set();
const TOLERANCE_MS    = config.alerts.toleranceMs;

// ─── Filtre impact ────────────────────────────────────────────────────────────

function passesImpactFilter(event) {
  const filter = getState('impact_filter', 'all');
  if (filter === 'all') return true;
  const map = { high: 3, medium: 2, low: 1 };
  return event.importance >= (map[filter] || 1);
}

// ─── Jobs principaux ──────────────────────────────────────────────────────────

async function sendMorningSummary() {
  console.log('[scheduler] Résumé matinal session NY...');
  try {
    const events = await forceRefresh();
    await sendAlert(formatMorningSummary(events), true); // forceSend = passe le mute

    // Alerte expiration d'options si applicable
    const expiry = checkTodayExpiry();
    if (expiry.message) await sendAlert(expiry.message, true);
  } catch (err) {
    console.error('[scheduler] Erreur résumé matinal:', err.message);
  }
}

function checkPreAlerts() {
  const events = getCachedEvents();
  const now = Date.now();

  for (const event of events) {
    if (!passesImpactFilter(event)) continue;
    const eventTime = event.date.getTime();
    const diff = eventTime - now;

    // Zone de non-trade 15 min
    if (!alertedPre15.has(event.id) && Math.abs(diff - config.alerts.pre15MinMs) <= TOLERANCE_MS) {
      alertedPre15.add(event.id);
      sendAlert(formatNoTradeZone15(event)).catch(console.error);
    }

    // Zone de non-trade 5 min
    if (!alertedPre5.has(event.id) && Math.abs(diff - config.alerts.pre5MinMs) <= TOLERANCE_MS) {
      alertedPre5.add(event.id);
      sendAlert(formatNoTradeZone5(event)).catch(console.error);
    }

    // Trailing SL reminder 10 min après l'annonce
    const afterEvent = now - eventTime;
    if (!alertedTrailSL.has(event.id) && afterEvent >= config.alerts.trailingSLMinMs && afterEvent <= config.alerts.trailingSLMaxMs) {
      alertedTrailSL.add(event.id);
      if (!isMuted()) {
        sendAlert(formatTrailingSLReminder(event)).catch(console.error);
      }
    }
  }
}

async function checkPostAlerts() {
  try {
    const freshEvents = await fetchEvents();

    for (const event of freshEvents) {
      if (!event.actual || alertedPost.has(event.id)) continue;
      if (!passesImpactFilter(event)) continue;

      alertedPost.add(event.id);

      // 1. Message post-event principal
      const postMsg = formatPostAlert(event);
      await sendAlert(postMsg);

      // 2. Score d'impact + corrélation en chaîne
      const impactMsg = formatImpactScore(event);
      if (impactMsg) await sendAlert(impactMsg);

      const corrMsg = formatCorrelationAlert(event);
      if (corrMsg) await sendAlert(corrMsg);

      // 3. Sauvegarder en DB + sync Nextcloud
      saveEventResult(event);

      // 3b. Capturer les prix avant/après pour trade_stats (si API disponible)
      if (process.env.TWELVEDATA_API_KEY) {
        const eventKey = normalizeEventKey(event.name, event.currency);
        const eventDate = event.date.toISOString();
        try {
          const pricesBefore = await getAllPrices();
          saveTradeStatsBefore(event, pricesBefore);

          setTimeout(async () => {
            try {
              const p = await getAllPrices();
              updateTradeStatsAfter5(eventKey, eventDate, p);
            } catch (err) {
              console.error('[scheduler] trade_stats 5min:', err.message);
            }
          }, 5 * 60 * 1000);

          setTimeout(async () => {
            try {
              const p = await getAllPrices();
              updateTradeStatsAfter15(eventKey, eventDate, p);
            } catch (err) {
              console.error('[scheduler] trade_stats 15min:', err.message);
            }
          }, 15 * 60 * 1000);
        } catch (err) {
          console.error('[scheduler] trade_stats capture:', err.message);
        }
      }
      if (isNextcloudEnabled()) {
        syncHistoryToNextcloud().catch(err =>
          console.error('[scheduler] Erreur sync Nextcloud:', err.message)
        );
      }

      // 4. Analyse marché post-event (après délai config pour laisser le prix réagir)
      if (event.importance >= 2) {
        setTimeout(async () => {
          try {
            const analyses = await analyzePostEvent(event.instruments);
            const marketMsg = formatMarketAnalysis(analyses);
            if (marketMsg) await sendAlert(marketMsg);
          } catch (err) {
            console.error('[scheduler] Erreur analyse marché:', err.message);
          }
        }, config.alerts.postEventDelayMs);
      }
    }
  } catch (err) {
    console.error('[scheduler] Erreur polling post-event:', err.message);
  }
}

async function sendSessionBilan() {
  console.log('[scheduler] Bilan de session...');
  try {
    const events = getCachedEvents();
    await sendAlert(formatSessionBilan(events), true);

    // Sync rapport journalier + historique complet vers Nextcloud
    if (isNextcloudEnabled()) {
      await syncDailyReport(events).catch(err =>
        console.error('[scheduler] Erreur sync rapport Nextcloud:', err.message)
      );
      await syncHistoryToNextcloud().catch(err =>
        console.error('[scheduler] Erreur sync historique Nextcloud:', err.message)
      );
    }
  } catch (err) {
    console.error('[scheduler] Erreur bilan:', err.message);
  }
}

async function sendWeeklyCOT() {
  console.log('[scheduler] COT Report vendredi...');
  try {
    const text = await formatCOTMessage();
    await sendAlert(text, true);
  } catch (err) {
    console.error('[scheduler] Erreur COT:', err.message);
  }
}

// ─── DXY correlation alert ────────────────────────────────────────────────────

function buildDXYCascade(direction) {
  const strong = direction === 'strong';
  return [
    { instrument: 'USDJPY', direction: strong ? 'up'   : 'down',  reason: strong ? 'USD fort → USDJPY monte'  : 'USD faible → USDJPY baisse' },
    { instrument: 'XAUUSD', direction: strong ? 'down' : 'up',    reason: strong ? 'USD fort → Gold sous pression' : 'USD faible → Gold monte' },
    { instrument: 'US30',   direction: 'mixed',                    reason: 'Dépend des fondamentaux US' },
    { instrument: 'XBRUSD', direction: strong ? 'down' : 'up',    reason: strong ? 'USD fort → Oil baisse'    : 'USD faible → Oil monte' },
  ];
}

async function checkDXYAlert() {
  if (!process.env.TWELVEDATA_API_KEY) return;
  try {
    const current = await getDXY();
    const baselineStr = getState(config.dxy.stateKey);

    if (!baselineStr) {
      setState(config.dxy.stateKey, String(current));
      return;
    }

    const baseline = parseFloat(baselineStr);
    const movePct  = (current - baseline) / baseline * 100;

    if (Math.abs(movePct) < config.dxy.moveThresholdPct) return;

    const direction   = movePct > 0 ? 'strong' : 'weak';
    const cooldownKey = config.dxy.cooldownKeyPrefix + direction;
    const cooldownTs  = getState(cooldownKey);

    if (cooldownTs && Date.now() - Number(cooldownTs) < config.dxy.cooldownMs) return;

    const impacts = buildDXYCascade(direction);
    await sendAlert(formatDXYAlert(direction, movePct, impacts));

    setState(config.dxy.stateKey, String(current));
    setState(cooldownKey, String(Date.now()));
  } catch (err) {
    console.warn('[scheduler] DXY check:', err.message);
  }
}

function resetDailyAlerts() {
  alertedPre15.clear();
  alertedPre5.clear();
  alertedPost.clear();
  alertedTrailSL.clear();
  console.log('[scheduler] Sets d\'alertes réinitialisés');
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

export function startScheduler() {
  const tz = { timezone: config.timing.timezone };

  // Résumé matinal 14h25 UTC (10h25 Guadeloupe) lun-ven
  cron.schedule(config.timing.morningCron, sendMorningSummary, tz);

  // Pré-alertes chaque minute
  cron.schedule(config.timing.preAlertCron, checkPreAlerts, tz);

  // Polling actuals toutes les 2 min (session NY)
  cron.schedule(config.timing.postPollCron, checkPostAlerts, tz);

  // Refresh cache toutes les 5 min (session NY)
  cron.schedule(config.timing.cacheRefreshCron, () => {
    fetchEvents().catch(err => console.error('[scheduler] Refresh cache:', err.message));
  }, tz);

  // Bilan de session 21h00 UTC (17h00 Guadeloupe) lun-ven
  cron.schedule(config.timing.sessionBilanCron, sendSessionBilan, tz);

  // COT Report vendredi 22h00 UTC (après publication CFTC)
  cron.schedule(config.timing.cotCron, sendWeeklyCOT, tz);

  // Reset sets d'alertes à minuit UTC
  cron.schedule(config.timing.resetCron, resetDailyAlerts, tz);

  // DXY correlation alert toutes les 5 min (session NY, si API disponible)
  if (process.env.TWELVEDATA_API_KEY) {
    cron.schedule(config.timing.dxyCheckCron, checkDXYAlert, tz);
    console.log('  */5 min   — DXY correlation alert (session NY)');
  }

  console.log('[scheduler] Jobs cron actifs:');
  console.log('  14h25 UTC — Résumé matinal (lun-ven)');
  console.log('  */1 min   — Pré-alertes zone de non-trade');
  console.log('  */2 min   — Polling actuals (13h-22h)');
  console.log('  21h00 UTC — Bilan de session (lun-ven)');
  console.log('  22h00 UTC — COT Report (vendredi)');
}

export { sendMorningSummary };
