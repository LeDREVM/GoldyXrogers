import 'dotenv/config';
import { initBot, sendAlert } from './telegram.js';
import { fetchEvents } from './scraper.js';
import { startScheduler } from './scheduler.js';
import { initPrice } from './price.js';
import { initNextcloud } from './nextcloud.js';

const TOKEN             = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID           = process.env.TELEGRAM_CHAT_ID;
const TWELVEDATA_KEY    = process.env.TWELVEDATA_API_KEY;
const NEXTCLOUD_URL     = process.env.NEXTCLOUD_URL;
const NEXTCLOUD_USER    = process.env.NEXTCLOUD_USERNAME;
const NEXTCLOUD_PASS    = process.env.NEXTCLOUD_PASSWORD;
const NEXTCLOUD_FOLDER  = process.env.NEXTCLOUD_FOLDER || 'GoldyXrogers';

async function main() {
  console.log('========================================');
  console.log('   GoldyXrogers v2 — Scalping Assistant ');
  console.log('   Session NY | Guadeloupe (UTC-4)       ');
  console.log('   US30 | USDJPY | XBRUSD | XAUUSD       ');
  console.log('========================================');

  // 1. Init Twelve Data (optionnel)
  if (TWELVEDATA_KEY) {
    initPrice(TWELVEDATA_KEY);
    console.log('[main] Twelve Data initialisé');
  } else {
    console.warn('[main] TWELVEDATA_API_KEY absent — analyses marché désactivées');
  }

  // 1b. Init Nextcloud (optionnel)
  initNextcloud(NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_PASS, NEXTCLOUD_FOLDER);

  // 2. Init Telegram
  initBot(TOKEN, CHAT_ID);

  // 3. Chargement initial calendrier
  console.log('[main] Chargement calendrier économique...');
  try {
    const events = await fetchEvents();
    console.log(`[main] ${events.length} événements NY chargés`);

    await sendAlert(
      events.length > 0
        ? `✅ <b>GoldyXrogers v2 démarré</b>\n📊 ${events.length} événements NY aujourd'hui\n\n/today pour le résumé · /help pour les commandes`
        : `✅ <b>GoldyXrogers v2 démarré</b>\nAucun événement économique aujourd'hui.`,
      true
    );
  } catch (err) {
    console.error('[main] Erreur chargement initial:', err.message);
    await sendAlert(`⚠️ <b>Démarré avec erreur</b>\n${err.message}`, true).catch(() => {});
  }

  // 4. Jobs cron
  startScheduler();

  console.log('[main] Bot opérationnel. CTRL+C pour arrêter.');
}

process.on('uncaughtException',  (err) => console.error('[main] Erreur non catchée:', err));
process.on('unhandledRejection', (reason) => console.error('[main] Promise rejetée:', reason));

main().catch(err => { console.error('[main] Erreur fatale:', err); process.exit(1); });
