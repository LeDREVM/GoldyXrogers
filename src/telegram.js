import TelegramBot from 'node-telegram-bot-api';
import { getCachedEvents, fetchEventsForDate } from './scraper.js';
import { formatMorningSummary, formatTradeStats, formatPatternStats } from './formatter.js';
import { formatHistory, getTradeStats, getPatternStats } from './stats.js';
import { formatCOTMessage } from './cot.js';
import { formatSentimentMessage } from './sentiment.js';
import { formatOptionsMessage } from './options.js';
import { setState, getState, normalizeEventKey } from './db.js';
import { config } from './config.js';

let bot = null;
let chatId = null;

// État runtime (mute)
let muteUntil = null;

export function initBot(token, targetChatId) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN manquant dans .env');
  if (!targetChatId) throw new Error('TELEGRAM_CHAT_ID manquant dans .env');

  chatId = targetChatId;
  bot = new TelegramBot(token, { polling: true });

  // Restaure le mute depuis DB au démarrage
  const savedMute = getState('mute_until');
  if (savedMute && new Date(savedMute) > new Date()) {
    muteUntil = new Date(savedMute);
    console.log(`[telegram] Mute actif jusqu'à ${muteUntil.toISOString()}`);
  }

  // ─── Commandes ──────────────────────────────────────────────────────────────

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      '✅ <b>GoldyXrogers Bot actif</b>\n\nSession NY | Guadeloupe (UTC-4)\nUS30 · USDJPY · XBRUSD · XAUUSD\n\nCommandes:\n/today — Résumé session NY\n/tomorrow — Événements demain\n/week — Planning de la semaine\n/history [indicateur] — Ex: /history NFP\n/best [indicateur] — Amplitudes moyennes post-annonce\n/patterns [instrument] — Ex: /patterns XAUUSD\n/mute [min] — Suspendre alertes (ex: /mute 30)\n/unmute — Réactiver alertes\n/impact [level] — Filtrer impact (high/medium/low/all)\n/cot — Rapport COT institutionnels\n/sentiment — Sentiment retail Myfxbook\n/options — Expirations options CME\n/status — État du bot',
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/\/today/, (msg) => {
    const events = getCachedEvents();
    bot.sendMessage(msg.chat.id, formatMorningSummary(events), { parse_mode: 'HTML' });
  });

  bot.onText(/\/tomorrow/, async (msg) => {
    try {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const events = await fetchEventsForDate(tomorrow);
      const text = events.length > 0
        ? formatMorningSummary(events).replace('SESSION NY', 'SESSION NY (DEMAIN)')
        : `📅 <b>DEMAIN — Aucun événement majeur</b>`;
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Erreur: ${err.message}`);
    }
  });

  bot.onText(/\/week/, async (msg) => {
    try {
      const events = await fetchEventsForDate(null, 'week');
      const text = events.length > 0
        ? formatMorningSummary(events).replace('SESSION NY', 'SEMAINE NY')
        : `📅 <b>SEMAINE — Aucun événement majeur</b>`;
      bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Erreur: ${err.message}`);
    }
  });

  bot.onText(/\/history(?:\s+(.+))?/, (msg, match) => {
    const query = match[1] || 'NFP';
    const text = formatHistory(query.trim());
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/best(?:\s+(.+))?/, (msg, match) => {
    const query = match[1]?.trim() || null;
    const eventKey = query ? normalizeEventKey(query, 'USD') : null;
    const data = getTradeStats(eventKey);
    const text = formatTradeStats(data, eventKey);
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/patterns(?:\s+(\w+))?/, (msg, match) => {
    const instrument = match[1]?.trim().toUpperCase() || null;
    if (instrument && !config.market.instruments.includes(instrument)) {
      bot.sendMessage(msg.chat.id,
        `❌ Instrument invalide. Options: ${config.market.instruments.join(', ')}`);
      return;
    }
    const data = getPatternStats(instrument);
    const text = formatPatternStats(data, instrument);
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/mute(?:\s+(\d+))?/, (msg, match) => {
    const minutes = parseInt(match[1] || '30', 10);
    muteUntil = new Date(Date.now() + minutes * 60 * 1000);
    setState('mute_until', muteUntil.toISOString());
    bot.sendMessage(msg.chat.id,
      `🔇 <b>Alertes suspendues ${minutes} min</b>\nRéactivation à ${muteUntil.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}\n\nEnvoie /unmute pour réactiver immédiatement.`,
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/\/unmute/, (msg) => {
    muteUntil = null;
    setState('mute_until', '');
    bot.sendMessage(msg.chat.id, '🔔 <b>Alertes réactivées</b>', { parse_mode: 'HTML' });
  });

  bot.onText(/\/impact(?:\s+(\w+))?/, (msg, match) => {
    const level = (match[1] || 'all').toLowerCase();
    const valid = ['high', 'medium', 'low', 'all'];
    if (!valid.includes(level)) {
      bot.sendMessage(msg.chat.id, `❌ Niveau invalide. Options: high | medium | low | all`);
      return;
    }
    setState('impact_filter', level);
    bot.sendMessage(msg.chat.id,
      `⚙️ <b>Filtre d'impact mis à jour</b>\nNiveau actif: <b>${level}</b>\n\nLes prochaines alertes respecteront ce filtre.`,
      { parse_mode: 'HTML' }
    );
  });

  bot.onText(/\/cot/, async (msg) => {
    bot.sendMessage(msg.chat.id, '⏳ Chargement COT Report CFTC...');
    const text = await formatCOTMessage();
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/sentiment/, async (msg) => {
    bot.sendMessage(msg.chat.id, '⏳ Chargement sentiment Myfxbook...');
    const text = await formatSentimentMessage();
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/options/, (msg) => {
    const text = formatOptionsMessage();
    bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
  });

  bot.onText(/\/status/, (msg) => {
    const events = getCachedEvents();
    const muteStr = muteUntil && muteUntil > new Date()
      ? `🔇 Mute actif jusqu'à ${muteUntil.toLocaleTimeString('fr-FR')}`
      : '🔔 Alertes actives';
    const impactFilter = getState('impact_filter', 'all');
    bot.sendMessage(msg.chat.id,
      `🟢 <b>Bot actif</b>\n${muteStr}\n⚙️ Filtre impact: ${impactFilter}\n📊 ${events.length} événements en mémoire\n📈 /best — amplitudes | 🔍 /patterns — patterns historiques\n🕐 ${new Date().toISOString()}`,
      { parse_mode: 'HTML' }
    );
  });

  bot.on('polling_error', (err) => {
    console.error('[telegram] Polling error:', err.message);
  });

  console.log('[telegram] Bot initialisé');
  return bot;
}

/**
 * Vérifie si le bot est en mode mute
 */
export function isMuted() {
  return muteUntil && muteUntil > new Date();
}

/**
 * Envoie un message (respecte le mute)
 * @param {string} text
 * @param {boolean} forceSend - ignorer le mute (pour les alertes critiques)
 */
export async function sendAlert(text, forceSend = false) {
  if (!bot || !chatId) { console.error('[telegram] Bot non initialisé'); return; }
  if (!forceSend && isMuted()) { console.log('[telegram] Message bloqué (mute actif)'); return; }

  try {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('[telegram] Erreur envoi:', err.message);
    // Retry une fois après 5s
    await new Promise(r => setTimeout(r, 5000));
    try { await bot.sendMessage(chatId, text, { parse_mode: 'HTML' }); } catch {}
  }
}
