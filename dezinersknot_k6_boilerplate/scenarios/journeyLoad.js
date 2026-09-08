
import { sleep } from 'k6';
import { clientLogin, createOpportunity, clientOfferContract,
         activateContract, addMilestone } from '../flows/clientFlow.js';
import { designerLogin, findOpportunities, sendProposal,
         acceptContract } from '../flows/designerFlow.js';
import { actorPairs, ACTOR_PASSWORD } from '../data/actors.js';
import { summaryReport } from '../utils/summary.js';

export const options = {
  stages: [
    { duration: '1m', target: 1 },
    { duration: '4m', target: 10 },
    { duration: '1m', target: 30 },
    { duration: '5m', target:40 },
    { duration: '1m', target: 50},
  ],

  thresholds: {
    client_login_success: ['rate>0.99'],
    create_opportunity_success: ['rate>0.99'],
    designer_login_success: ['rate>0.99'],
    find_opportunities_success: ['rate>0.99'],
    send_proposal_success: ['rate>0.99'],
    offer_contract_success: ['rate>0.99'],
    accept_contract_success: ['rate>0.99'],
    activate_contract_success: ['rate>0.99'],
    add_milestone_success: ['rate>0.99'],

    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<3000'],
  },
};

export function setup() {
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
        'aborting before the ramp rather than measuring an error path.'
      );
    }
    actors.push({ clientToken, designerToken });
  }

  console.log(`journey | ${actors.length} actor pairs ready (${actors.length * 2} logins)`);
  return { actors };
}

export default function (data) {

  const actor = data.actors[(__VU - 1) % data.actors.length];

  const { opportunityId } = createOpportunity(actor.clientToken);
  if (!opportunityId) { sleep(1); return; }
  findOpportunities(actor.designerToken);
  const { proposalId } = sendProposal(actor.designerToken, opportunityId);
  if (!proposalId) { sleep(1); return; }

  const { contractId } = clientOfferContract(actor.clientToken, proposalId);
  if (!contractId) { sleep(1); return; }

  acceptContract(actor.designerToken, contractId, opportunityId);
  activateContract(actor.clientToken, contractId);
  addMilestone(actor.clientToken, contractId);

  sleep(1);
}

export function handleSummary(data) {
  return summaryReport(data, 'journeyLoad');
}
