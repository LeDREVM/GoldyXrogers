import axios from 'axios';
import { createRequire } from 'module';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DateTime } from 'luxon';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const db = require('better-sqlite3')(join(__dirname, '..', 'data', 'goldyxrogers.db'));

// ─── Config ───────────────────────────────────────────────────────────────────

let config = null;

/**
 * Initialise la connexion Nextcloud
 * @param {string} url      - ex: https://cloud.monserveur.fr
 * @param {string} username
 * @param {string} password - mot de passe ou token d'application
 * @param {string} folder   - dossier distant, ex: GoldyXrogers
 */
export function initNextcloud(url, username, password, folder = 'GoldyXrogers') {
  if (!url || !username || !password) {
    console.warn('[nextcloud] Variables manquantes — sync désactivée');
    return;
  }
  config = { url: url.replace(/\/$/, ''), username, password, folder };
  console.log(`[nextcloud] Sync activée → ${config.url}/remote.php/dav/files/${username}/${folder}/`);
}

export function isNextcloudEnabled() {
  return config !== null;
}

// ─── Helpers WebDAV ───────────────────────────────────────────────────────────

function getWebDAVBase() {
  return `${config.url}/remote.php/dav/files/${config.username}/${config.folder}`;
}

function getAxiosConfig() {
  return {
    auth: { username: config.username, password: config.password },
    timeout: 15000,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  };
}

/**
 * Crée le dossier distant s'il n'existe pas (MKCOL WebDAV)
 */
async function ensureRemoteFolder() {
  try {
    await axios({ method: 'MKCOL', url: getWebDAVBase(), ...getAxiosConfig() });
  } catch (err) {
    // 405 = dossier existe déjà → OK
    if (err.response?.status !== 405) {
      console.warn('[nextcloud] Impossible de créer le dossier:', err.message);
    }
  }
}

/**
 * Upload un fichier texte/JSON vers Nextcloud via WebDAV PUT
 * @param {string} filename - nom du fichier distant
 * @param {string} content  - contenu du fichier
 */
async function uploadFile(filename, content) {
  if (!config) return;
  const url = `${getWebDAVBase()}/${filename}`;
  await axios.put(url, content, getAxiosConfig());
}

// ─── Exports de données ───────────────────────────────────────────────────────

/**
 * Exporte tout l'historique des événements en JSON et l'upload sur Nextcloud
 */
export async function syncHistoryToNextcloud() {
  if (!config) return;

  try {
    await ensureRemoteFolder();

    // 1. Historique complet des annonces (JSON)
    const rows = db.prepare('SELECT * FROM event_results ORDER BY event_date DESC').all();
    const historyJson = JSON.stringify({
      exported_at: new Date().toISOString(),
      total: rows.length,
      events: rows,
    }, null, 2);
    await uploadFile('history.json', historyJson);

    // 2. Export CSV pour import dans Excel/Google Sheets
    const csvLines = [
      'date,event_key,event_name,currency,importance,forecast,previous,actual,beat',
      ...rows.map(r =>
        [r.event_date, r.event_key, `"${r.event_name}"`, r.currency, r.importance,
         r.forecast || '', r.previous || '', r.actual || '', r.beat ?? ''].join(',')
      ),
    ];
    await uploadFile('history.csv', csvLines.join('\n'));

    // 3. Stats résumées par indicateur (JSON)
    const stats = db.prepare(`
      SELECT event_key, event_name, currency,
             COUNT(*) as total,
             SUM(CASE WHEN beat = 1 THEN 1 ELSE 0 END) as beats,
             SUM(CASE WHEN beat = 0 THEN 1 ELSE 0 END) as misses
      FROM event_results
      GROUP BY event_key
      ORDER BY total DESC
    `).all();

    const statsWithProb = stats.map(s => ({
      ...s,
      beat_pct: s.total > 0 ? Math.round(s.beats / s.total * 100) : null,
    }));

    await uploadFile('stats.json', JSON.stringify({
      exported_at: new Date().toISOString(),
      stats: statsWithProb,
    }, null, 2));

    console.log(`[nextcloud] Sync OK — ${rows.length} événements uploadés`);
  } catch (err) {
    console.error('[nextcloud] Erreur sync:', err.message);
  }
}

/**
 * Upload un rapport de session journalier (résumé du jour)
 * @param {object[]} events - événements du jour avec actuals
 */
export async function syncDailyReport(events) {
  if (!config) return;

  try {
    await ensureRemoteFolder();

    const date = DateTime.now().setZone('America/Guadeloupe').toFormat('yyyy-MM-dd');
    const report = {
      date,
      events: events.filter(e => e.actual).map(e => ({
        time: e.date.toISOString(),
        currency: e.currency,
        name: e.name,
        importance: e.importance,
        forecast: e.forecast,
        previous: e.previous,
        actual: e.actual,
        instruments: e.instruments,
      })),
      beats:  events.filter(e => e.actual && parseFloat(e.actual) > parseFloat(e.forecast)).length,
      misses: events.filter(e => e.actual && parseFloat(e.actual) < parseFloat(e.forecast)).length,
    };

    await uploadFile(`sessions/session_${date}.json`, JSON.stringify(report, null, 2));
    console.log(`[nextcloud] Rapport session ${date} uploadé`);
  } catch (err) {
    console.error('[nextcloud] Erreur rapport session:', err.message);
  }
}
