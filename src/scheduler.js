import cron from 'node-cron';
import { fetchEvents, getCachedEvents, forceRefresh } from './scraper.js';
import { sendAlert } from './telegram.js';
import {
  formatMorningSummary,
  formatPreAlert15,
  formatPreAlert5,
  formatPostAlert,
} from './formatter.js';

// Sets pour éviter les doublons d'alertes (réinitialisés chaque jour)
const alertedPre15 = new Set();
const alertedPre5  = new Set();
const alertedPost  = new Set();

// Tolérance de détection pour les pré-alertes : ±90 secondes
const TOLERANCE_MS = 90 * 1000;

/**
 * Envoie le résumé matinal et rafraîchit le cache
 */
async function sendMorningSummary() {
  console.log('[scheduler] Envoi résumé matinal session NY...');
  try {
    const events = await forceRefresh();
    await sendAlert(formatMorningSummary(events));
  } catch (err) {
    console.error('[scheduler] Erreur résumé matinal:', err.message);
  }
}

/**
 * Vérifie les pré-alertes (15min et 5min) toutes les minutes
 */
function checkPreAlerts() {
  const events = getCachedEvents();
  const now = Date.now();

  for (const event of events) {
    const eventTime = event.date.getTime();
    const diff = eventTime - now;

    // Alerte 15 min (dans ±90s autour de J-15min)
    if (!alertedPre15.has(event.id) && Math.abs(diff - 15 * 60 * 1000) <= TOLERANCE_MS) {
      alertedPre15.add(event.id);
      sendAlert(formatPreAlert15(event)).catch(err =>
        console.error('[scheduler] Erreur pré-alerte 15min:', err.message)
      );
    }

    // Alerte 5 min (dans ±90s autour de J-5min)
    if (!alertedPre5.has(event.id) && Math.abs(diff - 5 * 60 * 1000) <= TOLERANCE_MS) {
      alertedPre5.add(event.id);
      sendAlert(formatPreAlert5(event)).catch(err =>
        console.error('[scheduler] Erreur pré-alerte 5min:', err.message)
      );
    }
  }
}

/**
 * Polling post-event : détecte les chiffres réels publiés
 */
async function checkPostAlerts() {
  try {
    const freshEvents = await fetchEvents();
    for (const event of freshEvents) {
      if (event.actual && !alertedPost.has(event.id)) {
        alertedPost.add(event.id);
        await sendAlert(formatPostAlert(event));
      }
    }
  } catch (err) {
    console.error('[scheduler] Erreur polling post-event:', err.message);
  }
}

/**
 * Réinitialise les sets d'alertes (nouveau jour)
 */
function resetDailyAlerts() {
  alertedPre15.clear();
  alertedPre5.clear();
  alertedPost.clear();
  console.log('[scheduler] Sets d\'alertes réinitialisés');
}

/**
 * Démarre tous les jobs cron
 */
export function startScheduler() {
  // Résumé matinal à 10h25 Guadeloupe = 14h25 UTC (lun-ven)
  cron.schedule('25 14 * * 1-5', sendMorningSummary, { timezone: 'UTC' });

  // Vérification pré-alertes chaque minute
  cron.schedule('* * * * *', checkPreAlerts, { timezone: 'UTC' });

  // Polling post-event toutes les 2 min (13h-22h UTC, lun-ven)
  cron.schedule('*/2 13-22 * * 1-5', checkPostAlerts, { timezone: 'UTC' });

  // Refresh cache toutes les 5 min pendant la session NY
  cron.schedule('*/5 13-22 * * 1-5', () => {
    fetchEvents().catch(err =>
      console.error('[scheduler] Erreur refresh cache:', err.message)
    );
  }, { timezone: 'UTC' });

  // Reset sets d'alertes à minuit UTC
  cron.schedule('0 0 * * *', resetDailyAlerts, { timezone: 'UTC' });

  console.log('[scheduler] Jobs cron démarrés');
  console.log('  → Résumé matinal    : 14h25 UTC (lun-ven)');
  console.log('  → Pré-alertes       : chaque minute');
  console.log('  → Polling actuals   : toutes les 2 min (session NY)');
  console.log('  → Refresh cache     : toutes les 5 min (session NY)');
}

export { sendMorningSummary };
