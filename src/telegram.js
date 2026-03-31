import TelegramBot from 'node-telegram-bot-api';
import { getCachedEvents } from './scraper.js';
import { formatMorningSummary } from './formatter.js';

let bot = null;
let chatId = null;

/**
 * Initialise le bot Telegram
 * @param {string} token
 * @param {string} targetChatId
 * @returns {TelegramBot}
 */
export function initBot(token, targetChatId) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN manquant dans .env');
  if (!targetChatId) throw new Error('TELEGRAM_CHAT_ID manquant dans .env');

  chatId = targetChatId;
  bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      '✅ <b>GoldyXrogers Bot actif</b>\n\nJe surveille le calendrier économique pour la session NY.\n\nCommandes:\n/today — Résumé de la journée\n/status — État du bot',
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/\/today/, (msg) => {
    const events = getCachedEvents();
    const text = formatMorningSummary(events);
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/status/, (msg) => {
    const events = getCachedEvents();
    const now = new Date().toISOString();
    bot.sendMessage(msg.chat.id,
      `🟢 <b>Bot actif</b>\n🕐 ${now}\n📊 ${events.length} événements en mémoire`,
      { parse_mode: 'HTML' }
    );
  });

  bot.on('polling_error', (err) => {
    console.error('[telegram] Polling error:', err.message);
  });

  console.log('[telegram] Bot initialisé avec succès');
  return bot;
}

/**
 * Envoie un message au chat cible
 * @param {string} text - HTML autorisé
 * @returns {Promise<void>}
 */
export async function sendAlert(text) {
  if (!bot || !chatId) {
    console.error('[telegram] Bot non initialisé');
    return;
  }
  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[telegram] Erreur envoi message:', err.message);
  }
}
