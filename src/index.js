import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initBot, stopBot, sendAlert } from './telegram.js';
import { fetchEvents } from './scraper.js';
import { startScheduler } from './scheduler.js';
import { initPrice } from './price.js';
import { initNextcloud } from './nextcloud.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PID_FILE = path.resolve(__dirname, '..', 'bot.pid');

function acquirePidLock() {
  if (fs.existsSync(PID_FILE)) {
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    try {
      process.kill(oldPid, 0); // vérifie si le process existe
      console.error(`[main] Une instance est déjà en cours (PID ${oldPid}). Arrêt.`);
      process.exit(1);
    } catch {
      // Process mort — on nettoie le PID file
      console.warn(`[main] PID file orphelin détecté (PID ${oldPid}), nettoyage...`);
    }
  }
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function releasePidLock() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

const TOKEN             = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID           = process.env.TELEGRAM_CHAT_ID;
const TWELVEDATA_KEY    = process.env.TWELVEDATA_API_KEY;
const NEXTCLOUD_URL     = process.env.NEXTCLOUD_URL;
const NEXTCLOUD_USER    = process.env.NEXTCLOUD_USERNAME;
const NEXTCLOUD_PASS    = process.env.NEXTCLOUD_PASSWORD;
const NEXTCLOUD_FOLDER  = process.env.NEXTCLOUD_FOLDER || 'GoldyXrogers';

async function shutdown(signal) {
  console.log(`\n[main] Signal ${signal} reçu — arrêt propre...`);
  await stopBot().catch(() => {});
  releasePidLock();
  process.exit(0);
}

async function main() {
  acquirePidLock();
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
  await initBot(TOKEN, CHAT_ID);

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

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException',  (err) => { console.error('[main] Erreur non catchée:', err); releasePidLock(); });
process.on('unhandledRejection', (reason) => console.error('[main] Promise rejetée:', reason));

main().catch(err => { console.error('[main] Erreur fatale:', err); releasePidLock(); process.exit(1); });
