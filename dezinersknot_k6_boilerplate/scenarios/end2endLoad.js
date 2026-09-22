

import { sleep } from 'k6';
import { actorPairs, ACTOR_PASSWORD } from '../data/actors.js';
import { paymentConfig, assertPaymentOrdersEnabled, isSandboxPaymentMode } from '../config/payment.js';
import {
  activateMilestone,
  approveWork,
  clientLogin,
  makePayment,
  reviewWork,
  verifyPayment,
} from '../flows/clientFlow.js';
import { designerLogin, submitWork } from '../flows/designerFlow.js';
import { settleCashfreeSandboxPayment, assertCashfreeSandboxSettlementConfigured } from '../flows/cashfreeSandbox.js';
import { createPaymentReadyLifecycle } from '../flows/lifecycleFlow.js';
import { isWriteOk } from '../utils/helpers.js';
import { recordPaymentWorkflow } from '../utils/metrics.js';
import { summaryReport } from '../utils/summary.js';

function fraction(name, fallback) {
  const raw = __ENV[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} must be greater than 0 and at most 1; received ${raw}`);
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

function optionalPositiveInteger(name) {
  const raw = __ENV[name];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive whole number; received ${raw}`);
  }
  return value;
}

const SANDBOX_SETTLEMENT = isSandboxPaymentMode();
const ACTIVE_VUS = paymentConfig.rate > 0 ? paymentConfig.maxVUs : paymentConfig.concurrency;
const REQUIRE_UNIQUE_ACTORS = __ENV.REQUIRE_UNIQUE_PAYMENT_ACTORS !== 'false';
const MIN_ORDER_SUCCESS = fraction('PAYMENT_MIN_ORDER_SUCCESS_RATE', 0.99);
const MIN_PAYMENT_SUCCESS = fraction('PAYMENT_MIN_SUCCESS_RATE', 0.99);
const MAX_5XX = nonNegativeInteger('PAYMENT_MAX_5XX', 0);
const PAYMENT_ITERATIONS = optionalPositiveInteger('PAYMENT_ITERATIONS');

function selectedActorPairs() {
  const raw = __ENV.PAYMENT_ACTOR_PAIR_INDEXES;
  if (raw === undefined || raw.trim() === '') return actorPairs;

  const indexes = raw.split(',').map((value) => Number(value.trim()));
  if (
    indexes.length === 0 ||
    indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= actorPairs.length)
  ) {
    throw new Error(
      `PAYMENT_ACTOR_PAIR_INDEXES must contain zero-based actor-pair indexes from ` +
      `0 to ${actorPairs.length - 1}; received ${raw}`
    );
  }

  const distinctIndexes = [...new Set(indexes)];
  return distinctIndexes.map((index) => actorPairs[index]);
}

const configuredActorPairs = selectedActorPairs();

if (PAYMENT_ITERATIONS !== null && paymentConfig.rate > 0) {
  throw new Error('PAYMENT_ITERATIONS cannot be combined with PAYMENT_RATE.');
}

const paymentExecutor = PAYMENT_ITERATIONS !== null
  ? {
      executor: 'shared-iterations',
      vus: paymentConfig.concurrency,
      iterations: PAYMENT_ITERATIONS,
      maxDuration: paymentConfig.duration,
    }
  : paymentConfig.rate > 0
  ? {
      executor: 'constant-arrival-rate',
      rate: paymentConfig.rate,
      timeUnit: '1s',
      duration: paymentConfig.duration,
      preAllocatedVUs: paymentConfig.concurrency,
      maxVUs: paymentConfig.maxVUs,
    }
  : {
      executor: 'constant-vus',
      vus: paymentConfig.concurrency,
      duration: paymentConfig.duration,
    };

const thresholds = {
  payment_order_success: [`rate>${MIN_ORDER_SUCCESS}`],
  http_5xx: [`count<${MAX_5XX + 1}`],
  http_req_failed: ['rate<0.01'],
};
if (SANDBOX_SETTLEMENT) {
  thresholds.cashfree_sandbox_payment_success = [`rate>${MIN_PAYMENT_SUCCESS}`];
  thresholds.payment_status_success = [`rate>${MIN_PAYMENT_SUCCESS}`];
  thresholds.payment_workflow_success = [`rate>${MIN_PAYMENT_SUCCESS}`];
  thresholds.payment_success_rate = [`rate>${MIN_PAYMENT_SUCCESS}`];
  thresholds.contract_milestones_success = [`rate>${MIN_PAYMENT_SUCCESS}`];
  thresholds.activate_milestone_success = [`rate>${MIN_PAYMENT_SUCCESS}`];
  thresholds.submit_work_success = [`rate>${MIN_PAYMENT_SUCCESS}`];
  thresholds.approve_work_success = [`rate>${MIN_PAYMENT_SUCCESS}`];
}

export const options = {
  scenarios: { sandbox_payment: paymentExecutor },
  thresholds,
};

export function setup() {
  assertPaymentOrdersEnabled();
  if (!SANDBOX_SETTLEMENT && paymentConfig.mode !== 'order-only') {
    throw new Error('PAYMENT_MODE must be order-only or sandbox.');
  }
  if (SANDBOX_SETTLEMENT) assertCashfreeSandboxSettlementConfigured();

  if (REQUIRE_UNIQUE_ACTORS && configuredActorPairs.length < ACTIVE_VUS) {
    throw new Error(
      `This payment load needs ${ACTIVE_VUS} isolated actor pairs, but only ` +
      `${configuredActorPairs.length} are selected. Add QA test pairs or explicitly set ` +
      'REQUIRE_UNIQUE_PAYMENT_ACTORS=false.'
    );
  }

  const pairs = configuredActorPairs.slice(0, Math.min(configuredActorPairs.length, ACTIVE_VUS));
  if (pairs.length * 2 > 14 && __ENV.LOGIN_RATE_LIMIT_APPROVED !== 'true') {
    throw new Error(
      `${pairs.length * 2} setup logins exceed the known QA login limiter. ` +
      'Use an approved IP-whitelisted/rate-limit window and set ' +
      'LOGIN_RATE_LIMIT_APPROVED=true.'
    );
  }

  const actors = [];
  for (const pair of pairs) {
    const client = clientLogin(pair.client, ACTOR_PASSWORD);
    const designer = designerLogin(pair.designer, ACTOR_PASSWORD);
    if (!client.token || !designer.token) {
      throw new Error('A payment-scenario actor login failed; aborting before any writes.');
    }
    actors.push({ clientToken: client.token, designerToken: designer.token });
  }

  const rateLabel = paymentConfig.rate > 0
    ? `${paymentConfig.rate}/s arrival rate, up to ${paymentConfig.maxVUs} VUs`
    : PAYMENT_ITERATIONS !== null
      ? `${PAYMENT_ITERATIONS} shared iteration(s) across ${paymentConfig.concurrency} VUs`
      : `${paymentConfig.concurrency} concurrent VUs`;
  console.log(
    `payment sandbox | mode=${paymentConfig.mode}, ${rateLabel}, ` +
    `cooldown=${paymentConfig.cooldownSeconds}s`
  );
  return { actors };
}

function paymentWorkflow(actor) {
  const startedAt = Date.now();
  const lifecycle = createPaymentReadyLifecycle(actor);
  if (!lifecycle.ok) {
    if (SANDBOX_SETTLEMENT) recordPaymentWorkflow(false, Date.now() - startedAt);
    return;
  }

  const payment = makePayment(actor.clientToken, lifecycle.contractId, lifecycle.milestoneId);
  if (!payment.orderCreated) {
    if (SANDBOX_SETTLEMENT) recordPaymentWorkflow(false, Date.now() - startedAt);
    return;
  }

  if (!SANDBOX_SETTLEMENT) return;

  if (!payment.paymentSessionId) {
    console.log('payment sandbox | DK order response omitted payment_session_id');
    recordPaymentWorkflow(false, Date.now() - startedAt);
    return;
  }

  const settled = settleCashfreeSandboxPayment(payment.paymentSessionId, payment.orderId);
  if (!settled.ok) {
    recordPaymentWorkflow(false, Date.now() - startedAt);
    return;
  }

  const status = verifyPayment(actor.clientToken, payment.orderId);
  if (!status.statusValid) {
    recordPaymentWorkflow(false, Date.now() - startedAt);
    return;
  }

  const milestone = activateMilestone(
    actor.clientToken,
    lifecycle.contractId,
    lifecycle.milestoneId
  );
  if (!isWriteOk(milestone.response)) {
    recordPaymentWorkflow(false, Date.now() - startedAt);
    return;
  }

  const submission = submitWork(
    actor.designerToken,
    lifecycle.contractId,
    lifecycle.milestoneId
  );
  if (!isWriteOk(submission.response)) {
    recordPaymentWorkflow(false, Date.now() - startedAt);
    return;
  }

  const review = reviewWork(actor.clientToken, lifecycle.contractId);
  if (!isWriteOk(review.response)) {
    recordPaymentWorkflow(false, Date.now() - startedAt);
    return;
  }

  const approval = approveWork(
    actor.clientToken,
    lifecycle.contractId,
    lifecycle.milestoneId
  );
  const ok = isWriteOk(approval.response);
  recordPaymentWorkflow(ok, Date.now() - startedAt);
}

export default function (data) {
  if (__ITER === 0 && paymentConfig.startStaggerSeconds > 0) {
    sleep(Math.random() * paymentConfig.startStaggerSeconds);
  }

  const actor = data.actors[(__VU - 1) % data.actors.length];
  paymentWorkflow(actor);
  if (paymentConfig.rate === 0 && paymentConfig.cooldownSeconds > 0) {
    sleep(paymentConfig.cooldownSeconds);
  }
}

export function handleSummary(data) {
  return summaryReport(data, 'paymentSandboxLoad');
}
