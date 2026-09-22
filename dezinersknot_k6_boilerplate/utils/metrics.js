
import { Trend, Rate, Counter } from 'k6/metrics';
import { check } from 'k6';
import {
  checkWrite,
  isWriteOk,
  logPaymentResponse,
  logResponse,
} from './helpers.js';

export const STEPS = [

  'client_login',
  'client_profile',
  'create_opportunity',
  'offer_contract',
  'activate_contract',
  'add_milestone',
  'contract_milestones',
  'activate_milestone',
  'payment',
  'payment_order',
  'payment_verify',
  'payment_status',
  'payment_webhook',
  'payment_workflow',
  'review_work',
  'approve_work',
  'designer_login',
  'find_opportunities',
  'designer_opportunity_list',
  'send_proposal',
  'pending_contract_offers',
  'accept_contract',
  'submit_work',
  'admin_payment_stats',
];

const metrics = {};
const paymentSuccessRate = new Rate('payment_success_rate');
const http2xx = new Counter('http_2xx');
const http4xx = new Counter('http_4xx');
const http429 = new Counter('http_429');
const http5xx = new Counter('http_5xx');
const httpTimeout = new Counter('http_timeout');
const httpTransportError = new Counter('http_transport_error');
for (const step of STEPS) {
  metrics[step] = {
    duration: new Trend(`${step}_duration`, true),
    success: new Rate(`${step}_success`),
    errors: new Counter(`${step}_errors`),
  };
}

export function record(step, response) {
  const m = metrics[step];
  const ok = isWriteOk(response);
  recordHttpClass(response);
  if (!m) return ok;

  m.duration.add(response.timings.duration);
  m.success.add(ok);
  if (!ok) m.errors.add(1);
  return ok;
}

export function recordHttpClass(response) {
  const status = response.status;
  if (status >= 200 && status < 300) {
    http2xx.add(1);
  } else if (status === 429) {
    http429.add(1);
    http4xx.add(1);
  } else if (status >= 400 && status < 500) {
    http4xx.add(1);
  } else if (status >= 500 && status < 600) {
    http5xx.add(1);
  } else if (status === 0) {
    const error = String(response.error || '').toLowerCase();
    if (error.indexOf('timeout') !== -1) httpTimeout.add(1);
    else httpTransportError.add(1);
  }
}

export function track(step, label, response, options = {}) {
  const ok = record(step, response);
  checkWrite(response, label);
  logResponse(label, response, options.allowBody !== false);
  return ok;
}

function recordOutcome(step, response, ok) {
  const m = metrics[step];
  if (!m) return ok;

  m.duration.add(response.timings.duration);
  m.success.add(ok);
  if (!ok) m.errors.add(1);
  return ok;
}

export function trackPaymentOrder(response, orderId, paymentSessionId) {
  const apiOk = record('payment', response);
  const ok = apiOk && Boolean(orderId);
  recordOutcome('payment_order', response, ok);
  checkWrite(response, 'Payment Order');
  check(response, {
    'Payment Order - Cashfree order id present': () => Boolean(orderId),
  });
  logPaymentResponse(
    'Payment Order',
    response,
    ok,
    orderId,
    `payment_session=${paymentSessionId ? 'present' : 'missing'}`
  );
  return ok;
}

export function trackPaymentStatus(response, orderId) {
  const ok = record('payment_verify', response);
  recordOutcome('payment_status', response, ok);
  checkWrite(response, 'Payment Status');
  logPaymentResponse('Payment Status', response, ok, orderId);
  return ok;
}

export function trackPaymentWebhook(response, accepted, orderId = null) {
  const ok = Boolean(accepted);
  recordOutcome('payment_webhook', response, ok);
  logPaymentResponse('Payment Webhook', response, ok, orderId);
  return ok;
}

export function recordPaymentWorkflow(ok, durationMs) {
  const m = metrics.payment_workflow;
  m.duration.add(durationMs);
  m.success.add(ok);
  if (!ok) m.errors.add(1);
  paymentSuccessRate.add(ok);
}