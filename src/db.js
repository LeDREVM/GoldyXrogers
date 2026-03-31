import { createRequire } from 'module';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const DB_PATH = join(__dirname, '..', 'data', 'goldyxrogers.db');

// Création du dossier data si nécessaire
const dataDir = join(__dirname, '..', 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

// Pragmas pour la performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ─── Création des tables ─────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS event_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key   TEXT NOT NULL,          -- ex: "nfp_usd", "cpi_usd"
    event_name  TEXT NOT NULL,
    currency    TEXT NOT NULL,
    importance  INTEGER NOT NULL,
    event_date  TEXT NOT NULL,          -- ISO date string
    forecast    TEXT,
    previous    TEXT,
    actual      TEXT,
    beat        INTEGER,               -- 1=beat, 0=miss, NULL=in-line/unknown
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_event_key ON event_results(event_key);
  CREATE INDEX IF NOT EXISTS idx_event_date ON event_results(event_date);

  CREATE TABLE IF NOT EXISTS session_stats (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_date TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD
    events_count INTEGER DEFAULT 0,
    beats_count  INTEGER DEFAULT 0,
    misses_count INTEGER DEFAULT 0,
    inline_count INTEGER DEFAULT 0,
    notes        TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bot_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Fonctions événements ─────────────────────────────────────────────────────

/**
 * Génère une clé normalisée pour un événement (ex: "non-farm payrolls" → "nfp_usd")
 */
const EVENT_KEY_MAP = {
  'non-farm payrolls': 'nfp_usd',
  'nfarm payrolls':    'nfp_usd',
  'cpi':               'cpi_usd',
  'core cpi':          'core_cpi_usd',
  'pce':               'pce_usd',
  'core pce':          'core_pce_usd',
  'gdp':               'gdp_usd',
  'retail sales':      'retail_usd',
  'unemployment rate': 'unemployment_usd',
  'ism manufacturing': 'ism_mfg_usd',
  'ism services':      'ism_svc_usd',
  'federal funds rate':'fomc_usd',
  'jobless claims':    'jobless_usd',
  'adp':               'adp_usd',
  'boj':               'boj_jpy',
};

export function normalizeEventKey(name, currency) {
  const lower = (name || '').toLowerCase();
  for (const [pattern, key] of Object.entries(EVENT_KEY_MAP)) {
    if (lower.includes(pattern)) return key;
  }
  // Fallback : slug du nom + devise
  return lower.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30) + `_${currency.toLowerCase()}`;
}

/**
 * Enregistre le résultat d'un événement post-publication
 */
export function saveEventResult(event) {
  const key = normalizeEventKey(event.name, event.currency);
  const beat = computeBeat(event.actual, event.forecast);

  db.prepare(`
    INSERT INTO event_results (event_key, event_name, currency, importance, event_date, forecast, previous, actual, beat)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key, event.name, event.currency, event.importance, event.date.toISOString(), event.forecast, event.previous, event.actual, beat);
}

/**
 * Récupère les N derniers résultats d'un indicateur
 * @param {string} query - nom partiel ex: "NFP"
 * @param {number} limit
 */
export function getHistory(query, limit = 6) {
  const keyPattern = `%${query.toLowerCase().replace(/\s+/g, '_')}%`;
  const namePattern = `%${query}%`;

  return db.prepare(`
    SELECT * FROM event_results
    WHERE event_key LIKE ? OR event_name LIKE ?
    ORDER BY event_date DESC
    LIMIT ?
  `).all(keyPattern, namePattern, limit);
}

/**
 * Calcule la probabilité directionnelle d'un événement (beat = USD fort)
 * @param {string} eventKey
 */
export function getDirectionalProb(eventKey) {
  const rows = db.prepare(`
    SELECT beat FROM event_results
    WHERE event_key = ? AND beat IS NOT NULL
    ORDER BY event_date DESC LIMIT 20
  `).all(eventKey);

  if (rows.length < 3) return null;
  const beats = rows.filter(r => r.beat === 1).length;
  return { total: rows.length, beats, misses: rows.length - beats, pct: Math.round(beats / rows.length * 100) };
}

// ─── Fonctions état bot ───────────────────────────────────────────────────────

const setStateStmt  = db.prepare(`INSERT OR REPLACE INTO bot_state (key, value, updated_at) VALUES (?, ?, datetime('now'))`);
const getStateStmt  = db.prepare(`SELECT value FROM bot_state WHERE key = ?`);

export function setState(key, value) {
  setStateStmt.run(key, String(value));
}

export function getState(key, defaultValue = null) {
  const row = getStateStmt.get(key);
  return row ? row.value : defaultValue;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeBeat(actual, forecast) {
  if (!actual || !forecast) return null;
  const a = parseFloat(actual);
  const f = parseFloat(forecast);
  if (isNaN(a) || isNaN(f)) return null;
  if (a > f) return 1;
  if (a < f) return 0;
  return null;
}

export default db;
