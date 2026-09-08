
import { sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { clientLogin, createOpportunity, clientOfferContract,
         activateContract, addMilestone, activateMilestone,
         makePayment, verifyPayment } from '../flows/clientFlow.js';
import { designerLogin, findOpportunities, sendProposal,
         acceptContract } from '../flows/designerFlow.js';
import { actorPairs, ACTOR_PASSWORD } from '../data/actors.js';
import { summaryReport } from '../utils/summary.js';

const VUS = Number(__ENV.VUS || 60);
const DURATION = __ENV.DURATION || '30m';
const LIFECYCLE_SECONDS = Number(__ENV.LIFECYCLE_SECONDS || 300);
const ALLOW_PAYMENT = __ENV.ALLOW_PAYMENT === 'true';
const PAYMENT_MODE = __ENV.PAYMENT_MODE || 'order-only';
const PAYMENT_TAIL = ALLOW_PAYMENT && PAYMENT_MODE === 'full';
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

const thresholds = {
  client_login_success: ['rate>0.99'],
  create_opportunity_success: ['rate>0.99'],
  designer_login_success: ['rate>0.99'],
  find_opportunities_success: ['rate>0.99'],
  send_proposal_success: ['rate>0.99'],
  offer_contract_success: ['rate>0.99'],
  accept_contract_success: ['rate>0.99'],
  activate_contract_success: ['rate>0.99'],
  add_milestone_success: ['rate>0.99'],

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
  thresholds.payment_verify_success = ['rate>0.99'];
  thresholds.activate_milestone_success = ['rate>0.99'];
}

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
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
  if (VUS > 1 && __ITER === 0) sleep(Math.random() * LIFECYCLE_SECONDS);
}

function endIteration(startedAt, completed) {
  const remaining = LIFECYCLE_SECONDS - (Date.now() - startedAt) / 1000;

  lifecycleOnBudget.add(remaining > 0);
  lifecycleCompleted.add(completed);

  if (remaining > 0) sleep(remaining);
  lifecycleDuration.add(Date.now() - startedAt);
}

export function setup() {

  if (ALLOW_PAYMENT && VUS > 1) {
    const perHour = ((VUS / LIFECYCLE_SECONDS) * 3600).toFixed(0);
    throw new Error(
      `ALLOW_PAYMENT=true with VUS=${VUS} would create real Cashfree orders ` +
      `at ~${perHour}/hour for ${DURATION}. Payment needs a human per order: ` +
      're-run the tail with -e VUS=1, or drop ALLOW_PAYMENT for the load run.'
    );
  }

  if (actorPairs.length * 2 > 14) {
    throw new Error(
      `${actorPairs.length} pairs = ${actorPairs.length * 2} logins, which ` +
      'exceeds the 15/60s login rate limit. Trim data/actors.js.'
    );
  }

  const actors = [];

  for (const pair of actorPairs) {
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

  const perHour = (VUS / LIFECYCLE_SECONDS) * 3600;
  console.log(
    `steady | ${VUS} VUs, ${LIFECYCLE_SECONDS}s lifecycle, ${DURATION} ` +
    `=> ~${perHour.toFixed(0)} journeys/hour at steady state`
  );
  console.log(
    `steady | think budget ${THINK_BUDGET.toFixed(0)}s + ` +
    `${LATENCY_RESERVE.toFixed(0)}s reserved for latency across 7 requests`
  );
  console.log(
    `steady | first ${LIFECYCLE_SECONDS}s is stagger ramp-in - discard it; ` +
    `wall clock runs up to ${LIFECYCLE_SECONDS + 30}s past ${DURATION}`
  );
  console.log(
    `steady | ${actors.length} actor pairs ready (${actors.length * 2} logins), ` +
    `${(VUS / actors.length).toFixed(1)} VUs per account`
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

  findOpportunities(actor.designerToken);
  think('browsed');

  const { proposalId } = sendProposal(actor.designerToken, opportunityId);
  if (!proposalId) { endIteration(startedAt, false); return; }
  think('proposed');

  const { contractId } = clientOfferContract(actor.clientToken, proposalId);
  if (!contractId) { endIteration(startedAt, false); return; }
  think('offered');

  acceptContract(actor.designerToken, contractId, opportunityId);
  think('accepted');

  activateContract(actor.clientToken, contractId);
  think('activated');

  const { milestoneId } = addMilestone(actor.clientToken, contractId);
  think('scoped');
  if (!ALLOW_PAYMENT || !milestoneId) {
    endIteration(startedAt, true);
    return;
  }

  const { orderId, alreadyPaid } = makePayment(actor.clientToken, contractId, milestoneId);

  console.log(
    `steady | orderId=${orderId} contractId=${contractId} ` +
    `milestoneId=${milestoneId} alreadyPaid=${alreadyPaid}`
  );

  if (!PAYMENT_TAIL || !orderId) {
    endIteration(startedAt, true);
    return;
  }

  verifyPayment(actor.clientToken, orderId);
  activateMilestone(actor.clientToken, contractId, milestoneId);

  endIteration(startedAt, true);
}

export function handleSummary(data) {
  return summaryReport(data, 'steadyLoad');
}
