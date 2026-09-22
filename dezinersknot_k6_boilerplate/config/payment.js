function positiveInteger(name, fallback) {
  const raw = __ENV[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive whole number; received ${raw}`);
  }
  return value;
}

function nonNegativeNumber(name, fallback) {
  const raw = __ENV[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be zero or greater; received ${raw}`);
  }
  return value;
}

function nonNegativeInteger(name, fallback) {
  const raw = __ENV[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a whole number that is zero or greater; received ${raw}`);
  }
  return value;
}

// PAYMENT_ENABLED / CASHFREE_ENV are the preferred names. The older names are
// intentionally retained so existing scenarios and CI commands keep working.
export const paymentConfig = {
  enabled: __ENV.PAYMENT_ENABLED === 'true' || __ENV.ALLOW_PAYMENT === 'true',
  mode: __ENV.PAYMENT_MODE || 'order-only',
  cashfreeEnv: __ENV.CASHFREE_ENV || (__ENV.CASHFREE_SANDBOX === 'true' ? 'sandbox' : ''),
  concurrency: positiveInteger('PAYMENT_CONCURRENCY', 5),
  rate: nonNegativeInteger('PAYMENT_RATE', 0),
  maxVUs: positiveInteger('PAYMENT_MAX_VUS', positiveInteger('PAYMENT_CONCURRENCY', 5)),
  duration: __ENV.PAYMENT_DURATION || '5m',
  startStaggerSeconds: nonNegativeNumber('PAYMENT_START_STAGGER_SECONDS', 10),
  cooldownSeconds: nonNegativeNumber('PAYMENT_COOLDOWN_SECONDS', 10),
};

export function isSandboxPaymentMode() {
  // "full" is the legacy name used by steadyLoad.js. New commands should use
  // PAYMENT_MODE=sandbox, which means the explicit sandbox S2S path.
  return paymentConfig.mode === 'sandbox' || paymentConfig.mode === 'full';
}

export function assertPaymentOrdersEnabled() {
  if (!paymentConfig.enabled) {
    throw new Error(
      'Payment order creation is disabled. Set PAYMENT_ENABLED=true ' +
      '(or legacy ALLOW_PAYMENT=true) only against an approved sandbox.'
    );
  }
  if (paymentConfig.cashfreeEnv !== 'sandbox') {
    throw new Error(
      'Set CASHFREE_ENV=sandbox (or legacy CASHFREE_SANDBOX=true). ' +
      'Payment scenarios never target production Cashfree.'
    );
  }
}

export function assertSandboxSettlementMode() {
  assertPaymentOrdersEnabled();
  if (!isSandboxPaymentMode()) {
    throw new Error(
      'Set PAYMENT_MODE=sandbox for direct Cashfree sandbox settlement. ' +
      'Use PAYMENT_MODE=order-only when measuring only DK order creation.'
    );
  }
}
