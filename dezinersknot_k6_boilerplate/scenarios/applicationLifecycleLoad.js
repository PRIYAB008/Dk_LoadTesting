import { sleep } from 'k6';
import { actorPairs, ACTOR_PASSWORD } from '../data/actors.js';
import { clientLogin } from '../flows/clientFlow.js';
import { designerLogin } from '../flows/designerFlow.js';
import { createPaymentReadyLifecycle } from '../flows/lifecycleFlow.js';
import { summaryReport } from '../utils/summary.js';

function positiveInteger(name, fallback) {
  const raw = __ENV[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive whole number; received ${raw}`);
  }
  return value;
}

const PAIR_VUS = positiveInteger('LIFECYCLE_PAIR_VUS', actorPairs.length);
const RAMP_DURATION = __ENV.LIFECYCLE_RAMP_DURATION || '5m';
const HOLD_DURATION = __ENV.LIFECYCLE_HOLD_DURATION || '30m';
const REQUIRE_UNIQUE_ACTORS = __ENV.REQUIRE_UNIQUE_ACTORS !== 'false';

export const options = {
  scenarios: {
    lifecycle_pairs: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP_DURATION, target: PAIR_VUS },
        { duration: HOLD_DURATION, target: PAIR_VUS },
        { duration: RAMP_DURATION, target: 0 },
      ],
      gracefulRampDown: '30s',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    client_login_success: ['rate>0.99'],
    designer_login_success: ['rate>0.99'],
    create_opportunity_success: ['rate>0.99'],
    find_opportunities_success: ['rate>0.99'],
    send_proposal_success: ['rate>0.99'],
    offer_contract_success: ['rate>0.99'],
    accept_contract_success: ['rate>0.99'],
    activate_contract_success: ['rate>0.99'],
    contract_milestones_success: ['rate>0.99'],
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
  },
};

export function setup() {
  if (REQUIRE_UNIQUE_ACTORS && actorPairs.length < PAIR_VUS) {
    throw new Error(
      `LIFECYCLE_PAIR_VUS=${PAIR_VUS} needs ${PAIR_VUS} isolated client/designer ` +
      `pairs, but data/actors.js contains ${actorPairs.length}. ` +
      'Add test-only pairs or explicitly set REQUIRE_UNIQUE_ACTORS=false.'
    );
  }

  if (actorPairs.length * 2 > 14 && __ENV.LOGIN_RATE_LIMIT_APPROVED !== 'true') {
    throw new Error(
      `${actorPairs.length * 2} setup logins exceed the known QA login limiter. ` +
      'Run in an IP-whitelisted/rate-limit-approved window, then set ' +
      'LOGIN_RATE_LIMIT_APPROVED=true.'
    );
  }

  const actors = [];
  for (const pair of actorPairs) {
    const client = clientLogin(pair.client, ACTOR_PASSWORD);
    const designer = designerLogin(pair.designer, ACTOR_PASSWORD);
    if (!client.token || !designer.token) {
      throw new Error('A lifecycle actor login failed; aborting before any writes.');
    }
    actors.push({ clientToken: client.token, designerToken: designer.token });
  }

  console.log(
    `application lifecycle | ${PAIR_VUS} k6 lifecycle pairs represent ` +
    `${PAIR_VUS * 2} logical users (${PAIR_VUS} client + ${PAIR_VUS} designer)`
  );
  return { actors };
}

export default function (data) {
  const actor = data.actors[(__VU - 1) % data.actors.length];
  createPaymentReadyLifecycle(actor);
  sleep(1);
}

export function handleSummary(data) {
  return summaryReport(data, 'applicationLifecycleLoad');
}
