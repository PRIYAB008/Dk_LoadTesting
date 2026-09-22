
import { sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { clientLogin, createOpportunity, clientOfferContract,
         activateContract, getContractMilestones, activateMilestone,
         makePayment, verifyPayment } from '../flows/clientFlow.js';
import { designerLogin, findOpportunities, sendProposal,
         acceptContract, submitWork } from '../flows/designerFlow.js';
import { actorPairs, ACTOR_PASSWORD } from '../data/actors.js';
import { summaryReport } from '../utils/summary.js';
import { isWriteOk, safeIdentifier } from '../utils/helpers.js';
import {
  assertCashfreeSandboxSettlementConfigured,
  settleCashfreeSandboxPayment,
} from '../flows/cashfreeSandbox.js';
import { paymentConfig, isSandboxPaymentMode } from '../config/payment.js';

const TEST_TYPE = __ENV.TEST_TYPE || 'load';
const VUS = positiveInteger('VUS', 60);
const DURATION = __ENV.DURATION || '30m';
const LIFECYCLE_SECONDS = positiveInteger('LIFECYCLE_SECONDS', 300);
const ALLOW_PAYMENT = paymentConfig.enabled;
const PAYMENT_TAIL = ALLOW_PAYMENT && isSandboxPaymentMode();
const ORDER_ONLY_PAYMENT_LOAD_APPROVED = __ENV.ORDER_ONLY_PAYMENT_LOAD_APPROVED === 'true';
const SPIKE_VUS = positiveInteger('SPIKE_VUS', VUS);
const BASELINE_VUS = positiveInteger('BASELINE_VUS', Math.max(1, Math.ceil(VUS * 0.25)));
const SPIKE_DURATION = __ENV.SPIKE_DURATION || '1m';
const STAGE_HOLD_DURATION = __ENV.STAGE_HOLD_DURATION || '5m';
const STAGE_TRANSITION_DURATION = __ENV.STAGE_TRANSITION_DURATION || '1s';
const STAGED_VUS = [25, 50, 100, 150, 200, 250, 300];
const START_STAGGER_SECONDS = nonNegativeNumber(
  'START_STAGGER_SECONDS',
  TEST_TYPE === 'spike' ? 0 : Math.min(60, LIFECYCLE_SECONDS)
);
const LATENCY_RESERVE = Math.min(30, LIFECYCLE_SECONDS * 0.5);
const THINK_BUDGET = LIFECYCLE_SECONDS - LATENCY_RESERVE;
const JITTER = 0.1;
const THINK_WEIGHTS = {
  posted:    60,  // opportunity sits in the feed before a designer opens it
  browsed:   45,  // designer reads the listing and decides to bid
  proposed:  70,  // proposal waits for the client to compare and price it
  offered:   50,
  accepted:  30,
  activated: 15,
  scoped:    20,
};

const WEIGHT_TOTAL = Object.keys(THINK_WEIGHTS)
  .reduce((sum, k) => sum + THINK_WEIGHTS[k], 0);
const lifecycleDuration = new Trend('lifecycle_duration', true);
const lifecycleOnBudget = new Rate('lifecycle_on_budget');
const lifecycleCompleted = new Rate('lifecycle_completed');

function positiveInteger(name, fallback) {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive whole number; received ${__ENV[name]}`);
  }
  return value;
}

function nonNegativeNumber(name, fallback) {
  const value = Number(__ENV[name] === undefined ? fallback : __ENV[name]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be zero or greater; received ${__ENV[name]}`);
  }
  return value;
}

function target(percent) {
  return Math.max(1, Math.ceil(VUS * percent));
}

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
  return [...new Set(indexes)].map((index) => actorPairs[index]);
}

function stagesFor(testType) {
  switch (testType) {
    case 'load':
      return [
        { duration: '2m', target: target(0.25) },
        { duration: '3m', target: target(0.5) },
        { duration: '5m', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '5m', target: 0 },
      ];

    case 'concurrency':
      return [
        { duration: '2m', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '2m', target: 0 },
      ];

    case 'stress':
      return [
        { duration: '3m', target: target(0.25) },
        { duration: '5m', target: target(0.5) },
        { duration: '5m', target: target(0.75) },
        { duration: '5m', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '5m', target: 0 },
      ];

    case 'spike':
      if (SPIKE_VUS < BASELINE_VUS) {
        throw new Error(
          `SPIKE_VUS (${SPIKE_VUS}) must be at least BASELINE_VUS (${BASELINE_VUS}).`
        );
      }
      return [
        { duration: '2m', target: BASELINE_VUS },
        { duration: DURATION, target: BASELINE_VUS },
        { duration: '10s', target: SPIKE_VUS },
        { duration: SPIKE_DURATION, target: SPIKE_VUS },
        { duration: '1m', target: BASELINE_VUS },
        { duration: '2m', target: 0 },
      ];

    case 'staged': {
      const stages = [{ duration: STAGE_HOLD_DURATION, target: STAGED_VUS[0] }];
      for (let index = 1; index < STAGED_VUS.length; index++) {
        stages.push({ duration: STAGE_TRANSITION_DURATION, target: STAGED_VUS[index] });
        stages.push({ duration: STAGE_HOLD_DURATION, target: STAGED_VUS[index] });
      }
      stages.push({ duration: '2m', target: 0 });
      return stages;
    }

    default:
      throw new Error(
        `Unknown TEST_TYPE=${testType}. Use load, concurrency, stress, spike, or staged.`
      );
  }
}

const STAGES = stagesFor(TEST_TYPE);
const MAX_VUS = Math.max(...STAGES.map((stage) => stage.target));
const INITIAL_VUS = TEST_TYPE === 'staged' ? STAGED_VUS[0] : 0;
const CONFIGURED_ACTOR_PAIRS = selectedActorPairs();

const thresholds = {
  client_login_success: ['rate>0.99'],
  create_opportunity_success: ['rate>0.99'],
  designer_login_success: ['rate>0.99'],
  find_opportunities_success: ['rate>0.99'],
  send_proposal_success: ['rate>0.99'],
  offer_contract_success: ['rate>0.99'],
  accept_contract_success: ['rate>0.99'],
  activate_contract_success: ['rate>0.99'],
  contract_milestones_success: ['rate>0.99'],

  lifecycle_on_budget: ['rate>0.99'],
  lifecycle_completed: ['rate>0.99'],
  lifecycle_duration: [`avg<${(LIFECYCLE_SECONDS + 5) * 1000}`],

  checks: ['rate>0.99'],
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<3000'],
};

if (ALLOW_PAYMENT) {
  thresholds.payment_success = ['rate>0.99'];
}
if (PAYMENT_TAIL) {
  thresholds.cashfree_sandbox_payment_success = ['rate>0.99'];
  thresholds.payment_verify_success = ['rate>0.99'];
  thresholds.activate_milestone_success = ['rate>0.99'];
  thresholds.submit_work_success = ['rate>0.99'];
}

export const options = {
  scenarios: {
    steady: {
      executor: 'ramping-vus',
      startVUs: INITIAL_VUS,
      stages: STAGES,
      gracefulRampDown: `${LIFECYCLE_SECONDS + 30}s`,
      gracefulStop: `${LIFECYCLE_SECONDS + 30}s`,
    },
  },

  thresholds,
};

function think(step) {
  const base = (THINK_WEIGHTS[step] / WEIGHT_TOTAL) * THINK_BUDGET;
  sleep(base * (1 + (Math.random() * 2 - 1) * JITTER));
}

function stagger() {
  if (MAX_VUS > 1 && __ITER === 0 && START_STAGGER_SECONDS > 0) {
    sleep(Math.random() * START_STAGGER_SECONDS);
  }
}

function endIteration(startedAt, completed) {
  const remaining = LIFECYCLE_SECONDS - (Date.now() - startedAt) / 1000;

  lifecycleOnBudget.add(remaining > 0);
  lifecycleCompleted.add(completed);

  if (remaining > 0) sleep(remaining);
  lifecycleDuration.add(Date.now() - startedAt);
}

export function setup() {

  if (
    ALLOW_PAYMENT &&
    MAX_VUS > 1 &&
    !(
      (PAYMENT_TAIL &&
        __ENV.CASHFREE_SETTLEMENT === 's2s-card' &&
        paymentConfig.cashfreeEnv === 'sandbox') ||
      (!PAYMENT_TAIL && ORDER_ONLY_PAYMENT_LOAD_APPROVED)
    )
  ) {
    const perHour = ((MAX_VUS / LIFECYCLE_SECONDS) * 3600).toFixed(0);
    throw new Error(
      `ALLOW_PAYMENT=true with a ${MAX_VUS}-VU peak would create real Cashfree ` +
      `orders at up to ~${perHour}/hour. Payment needs a human per order: ` +
      're-run with -e VUS=1, drop ALLOW_PAYMENT, use the explicitly configured ' +
      'Cashfree sandbox S2S settlement path, or explicitly acknowledge the ' +
      'paced order-only load with -e ORDER_ONLY_PAYMENT_LOAD_APPROVED=true.'
    );
  }

  if (PAYMENT_TAIL) {
    assertCashfreeSandboxSettlementConfigured();
  }

  if (CONFIGURED_ACTOR_PAIRS.length * 2 > 14) {
    throw new Error(
      `${CONFIGURED_ACTOR_PAIRS.length} pairs = ${CONFIGURED_ACTOR_PAIRS.length * 2} logins, which ` +
      'exceeds the 15/60s login rate limit. Trim data/actors.js.'
    );
  }

  const actors = [];

  for (const pair of CONFIGURED_ACTOR_PAIRS) {
    const { token: clientToken } = clientLogin(pair.client, ACTOR_PASSWORD);
    const { token: designerToken } = designerLogin(pair.designer, ACTOR_PASSWORD);

    if (!clientToken || !designerToken) {
      throw new Error(
        `Login failed for pair ${pair.client} / ${pair.designer} - ` +
        'aborting before the run rather than measuring an error path.'
      );
    }
    actors.push({ clientToken, designerToken });
  }

  const perHour = (MAX_VUS / LIFECYCLE_SECONDS) * 3600;
  console.log(
    `steady | ${TEST_TYPE} profile, ${MAX_VUS}-VU peak, ` +
    `${LIFECYCLE_SECONDS}s lifecycle => up to ~${perHour.toFixed(0)} journeys/hour`
  );
  console.log(`steady | stages: ${STAGES.map((stage) => `${stage.duration}->${stage.target} VUs`).join(', ')}`);
  console.log(
    `steady | think budget ${THINK_BUDGET.toFixed(0)}s + ` +
    `${LATENCY_RESERVE.toFixed(0)}s reserved for latency across 7 requests`
  );
  console.log(
    `steady | new VUs stagger over ${START_STAGGER_SECONDS}s; ` +
    `each ramp-down can wait up to ${LIFECYCLE_SECONDS + 30}s for a journey to finish`
  );
  console.log(
    `steady | ${actors.length} actor pairs ready (${actors.length * 2} logins), ` +
    `${(MAX_VUS / actors.length).toFixed(1)} peak VUs per account`
  );

  return { actors };
}

export default function (data) {
  stagger();

  const startedAt = Date.now();
  const actor = data.actors[(__VU - 1) % data.actors.length];

  const { opportunityId } = createOpportunity(actor.clientToken);
  if (!opportunityId) { endIteration(startedAt, false); return; }
  think('posted');

  const opportunities = findOpportunities(actor.designerToken);
  if (!isWriteOk(opportunities.response)) { endIteration(startedAt, false); return; }
  think('browsed');

  const { proposalId } = sendProposal(actor.designerToken, opportunityId);
  if (!proposalId) { endIteration(startedAt, false); return; }
  think('proposed');

  const { contractId } = clientOfferContract(actor.clientToken, proposalId);
  if (!contractId) { endIteration(startedAt, false); return; }
  think('offered');

  const acceptance = acceptContract(actor.designerToken, contractId, opportunityId);
  if (!isWriteOk(acceptance.response)) { endIteration(startedAt, false); return; }
  think('accepted');

  const activation = activateContract(actor.clientToken, contractId);
  if (!isWriteOk(activation.response)) { endIteration(startedAt, false); return; }
  think('activated');

  const { milestoneId } = getContractMilestones(actor.clientToken, contractId);
  think('scoped');
  if (!ALLOW_PAYMENT || !milestoneId) {
    endIteration(startedAt, true);
    return;
  }

  const { orderId, paymentSessionId, alreadyPaid } = makePayment(
    actor.clientToken,
    contractId,
    milestoneId
  );

  console.log(
    `steady | payment order_id=${safeIdentifier(orderId)} ` +
    `already_paid=${alreadyPaid}`
  );

  if (!PAYMENT_TAIL) {
    endIteration(startedAt, true);
    return;
  }

  if (!orderId || !paymentSessionId) {
    console.log('steady | payment order did not return both order_id and payment_session_id');
    endIteration(startedAt, false);
    return;
  }

  const settlement = settleCashfreeSandboxPayment(paymentSessionId, orderId);
  if (!settlement.ok) { endIteration(startedAt, false); return; }

  const verification = verifyPayment(actor.clientToken, orderId);
  if (!isWriteOk(verification.response)) { endIteration(startedAt, false); return; }

  const milestoneActivation = activateMilestone(actor.clientToken, contractId, milestoneId);
  if (!isWriteOk(milestoneActivation.response)) { endIteration(startedAt, false); return; }

  const workSubmission = submitWork(actor.designerToken, contractId, milestoneId);
  if (!isWriteOk(workSubmission.response)) { endIteration(startedAt, false); return; }

  endIteration(startedAt, true);
}

export function handleSummary(data) {
  return summaryReport(data, 'steadyLoad');
}
