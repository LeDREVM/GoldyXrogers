/**
 * Configuration centralisée — toutes les constantes ajustables du bot
 * Importez { config } depuis ce fichier dans les modules qui en ont besoin.
 * Ce fichier n'a aucune dépendance pour rester au bas du graphe d'imports.
 */
export const config = {

  // ── Base de données ─────────────────────────────────────────────────────────
  db: {
    historyLimit: 6,           // nb de résultats pour /history
    tradeStatsMonths: 6,       // fenêtre historique pour /patterns
    minDataPoints: 5,          // minimum d'événements avant d'afficher les stats
  },

  // ── Crons & timezone ────────────────────────────────────────────────────────
  timing: {
    morningCron:      '25 14 * * 1-5',   // 14h25 UTC = 10h25 Guadeloupe, lun-ven
    sessionBilanCron: '0 21 * * 1-5',    // 21h00 UTC = 17h00 Guadeloupe, lun-ven
    cotCron:          '0 22 * * 5',      // 22h00 UTC vendredi
    preAlertCron:     '* * * * *',       // chaque minute
    postPollCron:     '*/2 13-22 * * 1-5',
    cacheRefreshCron: '*/5 13-22 * * 1-5',
    dxyCheckCron:     '*/5 13-22 * * 1-5',
    resetCron:        '0 0 * * *',
    timezone:         'UTC',
    guadeloupeTz:     'America/Guadeloupe',
  },

  // ── Timings alertes ─────────────────────────────────────────────────────────
  alerts: {
    pre15MinMs:        15 * 60 * 1000,  // 900_000 ms
    pre5MinMs:          5 * 60 * 1000,  // 300_000 ms
    trailingSLMinMs:    9 * 60 * 1000,  // 540_000 ms — borne basse 10 min
    trailingSLMaxMs:   11 * 60 * 1000,  // 660_000 ms — borne haute 10 min
    toleranceMs:       90 * 1000,       //  90_000 ms — fenêtre de matching cron
    postEventDelayMs:   3 * 60 * 1000,  // 180_000 ms — délai avant analyse marché
  },

  // ── Analyse technique ───────────────────────────────────────────────────────
  market: {
    instruments: ['XAUUSD', 'USDJPY', 'US30', 'XBRUSD'],
    marubozuThreshold:   0.90,   // corps/range min pour Marubozu
    pinBarWickThreshold: 0.60,   // mèche/range min pour Pin Bar
    pinBarBodyMax:       0.25,   // corps/range max pour Pin Bar
    imbalanceMinPct:     0.0005, // 0.05% — gap minimum pour imbalance
    structureLookback:   4,      // nb bougies H1 pour le bris de structure
    pipSizes: {                  // taille d'un pip par instrument
      XAUUSD: 0.01,
      USDJPY: 0.01,
      US30:   1.0,
      XBRUSD: 0.01,
    },
  },

  // ── DXY correlation alert ───────────────────────────────────────────────────
  dxy: {
    moveThresholdPct:  0.3,              // % de mouvement pour déclencher une alerte
    cooldownMs:        30 * 60 * 1000,   // 1_800_000 ms — cooldown par direction
    stateKey:          'dxy_baseline',
    cooldownKeyPrefix: 'dxy_cooldown_',  // + 'strong' ou 'weak'
  },

  // ── Mapping instruments ─────────────────────────────────────────────────────
  instruments: {
    symbolMap: {
      XAUUSD: 'XAU/USD',
      USDJPY: 'USD/JPY',
      US30:   'DJI',
      XBRUSD: 'XBR/USD',
      DXY:    'DXY',
    },
  },

  // ── URLs externes ───────────────────────────────────────────────────────────
  urls: {
    myfxbook:       'https://www.myfxbook.com/community/outlook',
    cotFinancial:   'https://www.cftc.gov/dea/options/financial_lof.htm',
    cotCommodity:   'https://www.cftc.gov/dea/options/other_lof.htm',
    twelveDataBase: 'https://api.twelvedata.com',
  },

  // ── Scraper ─────────────────────────────────────────────────────────────────
  scraper: {
    minFetchIntervalMs:  30 * 1000,  // 30_000 ms — cache minimum
    retryMaxAttempts:    4,
    retryInitialDelayMs: 2000,
  },
};

export default config;
