// Configuration constants for plan changes
export const PLAN_CHANGE_CONFIG = {
  FREE_UPGRADE_THRESHOLD: 0.5,

  PENDING_PAYMENT_WINDOW_MS: 30 * 60 * 1000,

  VALID_PRICES: [0, 29.9, 49.9, 287.0, 479.0],

  // Rate limiting
  RATE_LIMIT: {
    CHANGE_PLAN: {
      TTL: 60000,
      LIMIT: 3,
    },
    PREVIEW: {
      TTL: 60000,
      LIMIT: 10,
    },
  },
} as const;
