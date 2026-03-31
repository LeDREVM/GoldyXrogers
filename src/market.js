import { getCandles } from './price.js';
import { config } from './config.js';

// Instruments à analyser post-annonce
const INSTRUMENTS = config.market.instruments;

// ─── Détection de patterns bougie ─────────────────────────────────────────────

/**
 * Détecte les patterns sur la dernière bougie
 * @param {object[]} candles - tableau OHLCV ordonné chronologiquement
 * @returns {string|null} nom du pattern ou null
 */
export function detectCandlePattern(candles) {
  if (candles.length < 2) return null;
  const c = candles[candles.length - 1]; // dernière bougie
  const prev = candles[candles.length - 2];
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  if (range === 0) return null;

  // Marubozu haussier — corps >= 90% du range, sans mèches significatives
  if (c.close > c.open && body / range >= config.market.marubozuThreshold) return '🟢 Marubozu haussier';
  // Marubozu baissier
  if (c.close < c.open && body / range >= config.market.marubozuThreshold) return '🔴 Marubozu baissier';

  // Pin Bar haussier — longue mèche basse (>= 60% du range), petit corps en haut
  if (lowerWick / range >= config.market.pinBarWickThreshold && body / range <= config.market.pinBarBodyMax) return '🟢 Pin Bar haussier';
  // Pin Bar baissier — longue mèche haute
  if (upperWick / range >= config.market.pinBarWickThreshold && body / range <= config.market.pinBarBodyMax) return '🔴 Pin Bar baissier';

  // Engulfing haussier — bougie verte qui englobe le corps rouge précédent
  if (c.close > c.open && prev.close < prev.open &&
      c.open < prev.close && c.close > prev.open) return '🟢 Engulfing haussier';
  // Engulfing baissier
  if (c.close < c.open && prev.close > prev.open &&
      c.open > prev.close && c.close < prev.open) return '🔴 Engulfing baissier';

  // Doji — corps <= 10% du range
  if (body / range <= 0.1 && range > 0) return '⚪ Doji (indécision)';

  return null;
}

/**
 * Détecte un Fair Value Gap (FVG) sur les 3 dernières bougies
 * @param {object[]} candles
 * @returns {{type: string, high: number, low: number}|null}
 */
export function detectFVG(candles) {
  if (candles.length < 3) return null;
  const [c1, , c3] = candles.slice(-3);

  // FVG haussier : c3.low > c1.high → gap entre c1 et c3
  if (c3.low > c1.high) {
    return { type: 'haussier', high: c3.low, low: c1.high };
  }
  // FVG baissier : c3.high < c1.low
  if (c3.high < c1.low) {
    return { type: 'baissier', high: c1.low, low: c3.high };
  }
  return null;
}

/**
 * Détecte un déséquilibre (imbalance) de prix
 * Un imbalance = gap entre le high d'une bougie et le low de la suivante (ou inverse)
 * @param {object[]} candles
 * @returns {{type: string, gap: number, level: number}|null}
 */
export function detectImbalance(candles) {
  if (candles.length < 2) return null;
  const c1 = candles[candles.length - 2];
  const c2 = candles[candles.length - 1];

  const gapUp   = c2.low - c1.high;   // gap haussier
  const gapDown = c1.low - c2.high;   // gap baissier

  const minGap = c1.close * config.market.imbalanceMinPct;

  if (gapUp > minGap)   return { type: 'haussier', gap: gapUp, level: (c2.low + c1.high) / 2 };
  if (gapDown > minGap) return { type: 'baissier', gap: gapDown, level: (c1.low + c2.high) / 2 };
  return null;
}

/**
 * Vérifie un bris de structure sur H1 (high/low des 4 dernières heures)
 * @param {object[]} candles - bougies H1
 * @param {number} currentPrice
 * @returns {{type: string, level: number, breakPct: number}|null}
 */
export function detectStructureBreak(candles, currentPrice) {
  if (candles.length < config.market.structureLookback) return null;
  const recent = candles.slice(-config.market.structureLookback);
  const swingHigh = Math.max(...recent.map(c => c.high));
  const swingLow  = Math.min(...recent.map(c => c.low));

  if (currentPrice > swingHigh) {
    const breakPct = ((currentPrice - swingHigh) / swingHigh * 100).toFixed(2);
    return { type: 'haussier', level: swingHigh, breakPct };
  }
  if (currentPrice < swingLow) {
    const breakPct = ((swingLow - currentPrice) / swingLow * 100).toFixed(2);
    return { type: 'baissier', level: swingLow, breakPct };
  }
  return null;
}

/**
 * Analyse post-annonce complète pour tous les instruments affectés
 * Appelée ~3 minutes après la publication d'un événement
 * @param {string[]} instruments - instruments affectés
 * @returns {Promise<object[]>} résultats d'analyse
 */
export async function analyzePostEvent(instruments) {
  const results = [];

  for (const inst of instruments) {
    try {
      const [candles5m, candlesH1] = await Promise.all([
        getCandles(inst, '5min', 10),
        getCandles(inst, '1h', 8),
      ]);

      const currentPrice = candles5m[candles5m.length - 1]?.close;
      const pattern    = detectCandlePattern(candles5m);
      const fvg        = detectFVG(candles5m);
      const imbalance  = detectImbalance(candles5m);
      const structure  = detectStructureBreak(candlesH1, currentPrice);

      results.push({ instrument: inst, currentPrice, pattern, fvg, imbalance, structure });
    } catch (err) {
      console.warn(`[market] Erreur analyse ${inst}:`, err.message);
    }
  }

  return results;
}
