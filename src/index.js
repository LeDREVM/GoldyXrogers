import 'dotenv/config';
import { initBot, sendAlert } from './telegram.js';
import { fetchEvents } from './scraper.js';
import { startScheduler } from './scheduler.js';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function main() {
  console.log('========================================');
  console.log('   GoldyXrogers — Trading Alert Bot     ');
  console.log('   Session NY | Guadeloupe (UTC-4)      ');
  console.log('   US30 | USDJPY | XBRUSD | XAUUSD      ');
  console.log('========================================');

  // 1. Init Telegram
  initBot(TOKEN, CHAT_ID);

  // 2. Chargement initial du calendrier
  console.log('[main] Chargement initial du calendrier économique...');
  try {
    const events = await fetchEvents();
    console.log(`[main] ${events.length} événements NY chargés`);

    await sendAlert(
      events.length > 0
        ? `✅ <b>GoldyXrogers Bot démarré</b>\n📊 ${events.length} événements NY chargés pour aujourd'hui.\n\nEnvoie /today pour voir le résumé de la session.`
        : `✅ <b>GoldyXrogers Bot démarré</b>\nAucun événement économique aujourd'hui pour la session NY.`
    );
  } catch (err) {
    console.error('[main] Erreur chargement initial:', err.message);
    await sendAlert(`⚠️ <b>Bot démarré avec erreur</b>\n${err.message}`).catch(() => {});
  }

  // 3. Démarrage des jobs cron
  startScheduler();

  console.log('[main] Bot opérationnel. CTRL+C pour arrêter.');
}

process.on('uncaughtException', (err) => {
  console.error('[main] Erreur non catchée:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[main] Promise rejetée non gérée:', reason);
});

main().catch(err => {
  console.error('[main] Erreur fatale:', err);
  process.exit(1);
});
