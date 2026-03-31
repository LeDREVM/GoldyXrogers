import cron from 'node-cron';
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
import { saveEventResult } from './db.js';
import { analyzePostEvent } from './market.js';
import { formatCOTMessage } from './cot.js';
import { checkTodayExpiry } from './options.js';
import { getState } from './db.js';
import { syncHistoryToNextcloud, syncDailyReport, isNextcloudEnabled } from './nextcloud.js';

const alertedPre15    = new Set();
const alertedPre5     = new Set();
const alertedPost     = new Set();
const alertedTrailSL  = new Set();
const TOLERANCE_MS    = 90 * 1000;

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
    if (!alertedPre15.has(event.id) && Math.abs(diff - 15 * 60 * 1000) <= TOLERANCE_MS) {
      alertedPre15.add(event.id);
      sendAlert(formatNoTradeZone15(event)).catch(console.error);
    }

    // Zone de non-trade 5 min
    if (!alertedPre5.has(event.id) && Math.abs(diff - 5 * 60 * 1000) <= TOLERANCE_MS) {
      alertedPre5.add(event.id);
      sendAlert(formatNoTradeZone5(event)).catch(console.error);
    }

    // Trailing SL reminder 10 min après l'annonce
    const afterEvent = now - eventTime;
    if (!alertedTrailSL.has(event.id) && afterEvent >= 9 * 60 * 1000 && afterEvent <= 11 * 60 * 1000) {
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
      if (isNextcloudEnabled()) {
        syncHistoryToNextcloud().catch(err =>
          console.error('[scheduler] Erreur sync Nextcloud:', err.message)
        );
      }

      // 4. Analyse marché post-event (après 3 min pour laisser le prix réagir)
      if (event.importance >= 2) {
        setTimeout(async () => {
          try {
            const analyses = await analyzePostEvent(event.instruments);
            const marketMsg = formatMarketAnalysis(analyses);
            if (marketMsg) await sendAlert(marketMsg);
          } catch (err) {
            console.error('[scheduler] Erreur analyse marché:', err.message);
          }
        }, 3 * 60 * 1000);
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

function resetDailyAlerts() {
  alertedPre15.clear();
  alertedPre5.clear();
  alertedPost.clear();
  alertedTrailSL.clear();
  console.log('[scheduler] Sets d\'alertes réinitialisés');
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

export function startScheduler() {
  // Résumé matinal 14h25 UTC (10h25 Guadeloupe) lun-ven
  cron.schedule('25 14 * * 1-5', sendMorningSummary, { timezone: 'UTC' });

  // Pré-alertes chaque minute
  cron.schedule('* * * * *', checkPreAlerts, { timezone: 'UTC' });

  // Polling actuals toutes les 2 min (session NY)
  cron.schedule('*/2 13-22 * * 1-5', checkPostAlerts, { timezone: 'UTC' });

  // Refresh cache toutes les 5 min (session NY)
  cron.schedule('*/5 13-22 * * 1-5', () => {
    fetchEvents().catch(err => console.error('[scheduler] Refresh cache:', err.message));
  }, { timezone: 'UTC' });

  // Bilan de session 21h00 UTC (17h00 Guadeloupe) lun-ven
  cron.schedule('0 21 * * 1-5', sendSessionBilan, { timezone: 'UTC' });

  // COT Report vendredi 22h00 UTC (après publication CFTC)
  cron.schedule('0 22 * * 5', sendWeeklyCOT, { timezone: 'UTC' });

  // Reset sets d'alertes à minuit UTC
  cron.schedule('0 0 * * *', resetDailyAlerts, { timezone: 'UTC' });

  console.log('[scheduler] Jobs cron actifs:');
  console.log('  14h25 UTC — Résumé matinal (lun-ven)');
  console.log('  */1 min   — Pré-alertes zone de non-trade');
  console.log('  */2 min   — Polling actuals (13h-22h)');
  console.log('  21h00 UTC — Bilan de session (lun-ven)');
  console.log('  22h00 UTC — COT Report (vendredi)');
}

export { sendMorningSummary };
