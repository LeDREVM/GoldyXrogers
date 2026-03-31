import axios from 'axios';
import { createRequire } from 'module';
import { config } from './config.js';
const require = createRequire(import.meta.url);
const { load } = require('cheerio');

// CFTC publie les données COT chaque vendredi après 15h30 EST
// Source : https://www.cftc.gov/dea/options/deacot.htm (futures only)
const COT_URL = config.urls.cotFinancial;
const COT_COMMODITY_URL = config.urls.cotCommodity;

// Contrats d'intérêt pour nos instruments
const CONTRACTS_OF_INTEREST = {
  'JAPANESE YEN':        'JPY',
  'GOLD':                'XAUUSD',
  'CRUDE OIL':           'XBRUSD',
  'U.S. DOLLAR INDEX':   'DXY',
};

/**
 * Scrape le rapport COT de la CFTC et retourne les positions nettes des non-commerciaux
 * @returns {Promise<object[]>}
 */
export async function fetchCOTReport() {
  const results = [];

  try {
    const [finRes, comRes] = await Promise.all([
      axios.get(COT_URL, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }),
      axios.get(COT_COMMODITY_URL, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }),
    ]);

    for (const html of [finRes.data, comRes.data]) {
      const $ = load(html);

      // Parsing du tableau HTML CFTC
      $('table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length < 5) return;

        const name = $(cells[0]).text().trim().toUpperCase();
        const matchKey = Object.keys(CONTRACTS_OF_INTEREST).find(k => name.includes(k));
        if (!matchKey) return;

        // Colonnes CFTC : [0]Nom [1]Date [2]Open_Int [3-4]NonComm_Long/Short [5-6]Comm_Long/Short ...
        const ncLong  = parseInt($(cells[3]).text().replace(/,/g, ''), 10);
        const ncShort = parseInt($(cells[4]).text().replace(/,/g, ''), 10);
        const netPos  = ncLong - ncShort;
        const date    = $(cells[1]).text().trim();

        if (!isNaN(netPos)) {
          results.push({
            instrument: CONTRACTS_OF_INTEREST[matchKey],
            contract:   matchKey,
            date,
            ncLong,
            ncShort,
            netPosition: netPos,
            bias: netPos > 0 ? 'LONG' : 'SHORT',
          });
        }
      });
    }
  } catch (err) {
    console.error('[cot] Erreur fetch CFTC:', err.message);
  }

  return results;
}

/**
 * Formate le rapport COT pour Telegram
 * @returns {Promise<string>}
 */
export async function formatCOTMessage() {
  const data = await fetchCOTReport();

  if (data.length === 0) {
    return '📋 <b>COT Report CFTC</b>\n\n⚠️ Données non disponibles cette semaine.';
  }

  const lines = data.map(d => {
    const biasIcon = d.bias === 'LONG' ? '🟢 NET LONG' : '🔴 NET SHORT';
    const net = d.netPosition > 0 ? `+${d.netPosition.toLocaleString()}` : d.netPosition.toLocaleString();
    return `<b>${d.instrument}</b> (${d.contract})\n  ${biasIcon} | Net: ${net} | Date: ${d.date}`;
  });

  return `📋 <b>COT Report CFTC — Institutionnels</b>\n\n${lines.join('\n\n')}\n\n<i>Non-commerciaux (spéculateurs)</i>`;
}
