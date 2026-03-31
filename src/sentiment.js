import axios from 'axios';
import { createRequire } from 'module';
import { config } from './config.js';
const require = createRequire(import.meta.url);
const { load } = require('cheerio');

// Myfxbook Outlook : sentiment retail public
const MYFXBOOK_URL = config.urls.myfxbook;

// Mapping Myfxbook symbol → nos instruments
const SYMBOL_MAP = {
  'XAUUSD': 'XAUUSD',
  'USDJPY': 'USDJPY',
  'US30':   'US30',
  'USOIL':  'XBRUSD',
  'XBRUSD': 'XBRUSD',
};

/**
 * Scrape le sentiment retail depuis Myfxbook
 * @returns {Promise<object[]>}
 */
export async function fetchRetailSentiment() {
  try {
    const { data: html } = await axios.get(MYFXBOOK_URL, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const $ = load(html);
    const results = [];

    // Myfxbook affiche les données dans un tableau avec des data-* attributes
    $('[data-symbol]').each((_, el) => {
      const symbol = $(el).attr('data-symbol')?.toUpperCase();
      if (!SYMBOL_MAP[symbol]) return;

      const longPct  = parseFloat($(el).attr('data-long-percentage')  || $(el).find('.long-percentage').text());
      const shortPct = parseFloat($(el).attr('data-short-percentage') || $(el).find('.short-percentage').text());

      if (!isNaN(longPct) && !isNaN(shortPct)) {
        results.push({
          instrument: SYMBOL_MAP[symbol],
          longPct,
          shortPct,
          crowded: longPct > 70 ? 'LONG_CROWDED' : shortPct > 70 ? 'SHORT_CROWDED' : 'NEUTRAL',
        });
      }
    });

    return results;
  } catch (err) {
    console.error('[sentiment] Erreur Myfxbook:', err.message);
    return [];
  }
}

/**
 * Formate le sentiment retail pour Telegram
 * @returns {Promise<string>}
 */
export async function formatSentimentMessage() {
  const data = await fetchRetailSentiment();

  if (data.length === 0) {
    return '👥 <b>Sentiment Retail (Myfxbook)</b>\n\n⚠️ Données non disponibles.';
  }

  const lines = data.map(d => {
    const crowdIcon = d.crowded === 'LONG_CROWDED'  ? '⚠️ Majorité LONG (contrarian = SHORT)'
                    : d.crowded === 'SHORT_CROWDED' ? '⚠️ Majorité SHORT (contrarian = LONG)'
                    : '⚖️ Neutre';
    return `<b>${d.instrument}</b>: 🟢 ${d.longPct}% Long | 🔴 ${d.shortPct}% Short\n  ${crowdIcon}`;
  });

  return `👥 <b>Sentiment Retail — Myfxbook</b>\n\n${lines.join('\n\n')}\n\n<i>Rappel : le retail est souvent contre-tendance</i>`;
}
