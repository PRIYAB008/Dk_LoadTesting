import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { getJSON, safeIdentifier } from '../utils/helpers.js';
import { assertSandboxSettlementMode } from '../config/payment.js';
import { recordHttpClass } from '../utils/metrics.js';

const SANDBOX_BASE_URL = 'https://sandbox.cashfree.com/pg';
const paymentDuration = new Trend('cashfree_sandbox_payment_duration', true);
const paymentSuccess = new Rate('cashfree_sandbox_payment_success');
const paymentErrors = new Counter('cashfree_sandbox_payment_errors');

function positiveInteger(name, fallback) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive whole number; received ${__ENV[name]}`);
  }
  return value;
}

function config() {
  const required = [
    'CASHFREE_SANDBOX_CLIENT_ID',
    'CASHFREE_SANDBOX_CLIENT_SECRET',
    'CASHFREE_TEST_CARD_NUMBER',
    'CASHFREE_TEST_CARD_EXPIRY_MM',
    'CASHFREE_TEST_CARD_EXPIRY_YY',
    'CASHFREE_TEST_CARD_CVV',
  ];
  const missing = required.filter((name) => !__ENV[name]);

  assertSandboxSettlementMode();
  if (__ENV.CASHFREE_SETTLEMENT !== 's2s-card') {
    throw new Error(
      'Set CASHFREE_SETTLEMENT=s2s-card to explicitly enable sandbox S2S card settlement.'
    );
  }
  if (missing.length) {
    throw new Error(
      `Cashfree sandbox settlement needs: ${missing.join(', ')}. ` +
      'Pass them through your secret store; do not commit them.'
    );
  }

  return {
    clientId: __ENV.CASHFREE_SANDBOX_CLIENT_ID,
    clientSecret: __ENV.CASHFREE_SANDBOX_CLIENT_SECRET,
    apiVersion: __ENV.CASHFREE_API_VERSION || '2025-01-01',
    cardNumber: __ENV.CASHFREE_TEST_CARD_NUMBER,
    cardHolder: __ENV.CASHFREE_TEST_CARD_HOLDER || 'K6 Sandbox User',
    expiryMonth: __ENV.CASHFREE_TEST_CARD_EXPIRY_MM,
    expiryYear: __ENV.CASHFREE_TEST_CARD_EXPIRY_YY,
    cvv: __ENV.CASHFREE_TEST_CARD_CVV,
    otp: __ENV.CASHFREE_TEST_CARD_OTP || null,
    channel: __ENV.CASHFREE_CARD_CHANNEL || 'post',
    pollAttempts: positiveInteger('CASHFREE_POLL_ATTEMPTS', 6),
    pollIntervalSeconds: positiveInteger('CASHFREE_POLL_INTERVAL_SECONDS', 1),
  };
}

function headers(settings) {
  return {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-version': settings.apiVersion,
      'x-client-id': settings.clientId,
      'x-client-secret': settings.clientSecret,
    },
  };
}

function successfulPayment(body) {
  const payments = Array.isArray(body) ? body : [body];
  return payments.find((payment) => payment?.payment_status === 'SUCCESS') || null;
}

// Validates configuration before the test creates any API or Cashfree records.
export function assertCashfreeSandboxSettlementConfigured() {
  const settings = config();
  if (!['link', 'post'].includes(settings.channel)) {
    throw new Error('CASHFREE_CARD_CHANNEL must be link or post.');
  }
}

// Uses Cashfree's sandbox-only server-to-server Order Pay API. This is guarded
// behind CASHFREE_SETTLEMENT=s2s-card because it handles test-card data.
export function settleCashfreeSandboxPayment(paymentSessionId, orderId) {
  const settings = config();
  if (!paymentSessionId || !orderId) {
    throw new Error('Cashfree settlement needs both payment_session_id and order_id.');
  }

  const startedAt = Date.now();
  const paymentRequest = {
    payment_session_id: paymentSessionId,
    payment_method: {
      card: {
        channel: settings.channel,
        card_number: settings.cardNumber,
        card_holder_name: settings.cardHolder,
        card_expiry_mm: settings.expiryMonth,
        card_expiry_yy: settings.expiryYear,
        card_cvv: settings.cvv,
      },
    },
  };

  let response = http.post(
    `${SANDBOX_BASE_URL}/orders/sessions`,
    JSON.stringify(paymentRequest),
    headers(settings)
  );
  recordHttpClass(response);
  let paymentResponse = getJSON(response);
  let payment = successfulPayment(paymentResponse);
  const paymentId = paymentResponse?.cf_payment_id || null;

  // Some sandbox cards require the configured headless OTP. Cashfree must
  // enable that feature on the sandbox account before this call can succeed.
  if (!payment && paymentId && settings.otp) {
    response = http.post(
      `${SANDBOX_BASE_URL}/orders/pay/authenticate/${encodeURIComponent(paymentId)}`,
      JSON.stringify({ action: 'SUBMIT_OTP', otp: settings.otp }),
      headers(settings)
    );
    recordHttpClass(response);
    paymentResponse = getJSON(response);
    payment = successfulPayment(paymentResponse);
  }

  // Order Pay may first return a pending payment. Poll Cashfree's order status
  // before continuing to the marketplace's verify-payment endpoint.
  for (let attempt = 1; !payment && attempt < settings.pollAttempts; attempt += 1) {
    sleep(settings.pollIntervalSeconds);
    response = http.get(
      `${SANDBOX_BASE_URL}/orders/${encodeURIComponent(orderId)}/payments`,
      headers(settings)
    );
    recordHttpClass(response);
    payment = successfulPayment(getJSON(response));
  }

  const ok = payment !== null;
  paymentDuration.add(Date.now() - startedAt);
  paymentSuccess.add(ok);
  if (!ok) paymentErrors.add(1);
  check(response, {
    'Cashfree sandbox payment settled': () => ok,
  });

  if (!ok) {
    console.log(
      `cashfree sandbox | orderId=${safeIdentifier(orderId)} did not settle after ` +
      `${settings.pollAttempts} status checks`
    );
  }

  return {
    response,
    ok,
    paymentId: payment?.cf_payment_id || paymentId,
  };
}
