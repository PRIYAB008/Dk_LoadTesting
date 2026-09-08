
import { sleep } from 'k6';

import { USERS } from '../config/config.js';
import { summaryReport } from '../utils/summary.js';

import {
  clientLogin,
  createOpportunity,
  clientOfferContract,
  activateContract,
  addMilestone,
  activateMilestone,
  makePayment,
  verifyPayment,
  reviewWork,
  approveWork,
} from '../flows/clientFlow.js';

import {
  designerLogin,
  findOpportunities,
  sendProposal,
  acceptContract,
  submitWork,
} from '../flows/designerFlow.js';

const ALLOW_PAYMENT = __ENV.ALLOW_PAYMENT === 'true';
const PAYMENT_MODE = __ENV.PAYMENT_MODE || 'order-only';

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '1m', target: 150 },
    { duration: '1m', target: 300 },
    { duration: '5m', target: 300 },
    { duration: '1m', target: 0 },
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

export default function () {

  const client = clientLogin(
    USERS.client.email,
    USERS.client.password
  );

  if (!client.token) {
    throw new Error('Client token not extracted');
  }

  const opportunity = createOpportunity(client.token);

  if (!opportunity.opportunityId) {
    throw new Error('Opportunity ID not extracted');
  }

  const opportunityId = opportunity.opportunityId;
  sleep(1);

  const designer = designerLogin(
    USERS.designer.email,
    USERS.designer.password
  );

  if (!designer.token) {
    throw new Error('Designer token not extracted');
  }

  findOpportunities(designer.token);

  const proposal = sendProposal(
    designer.token,
    opportunityId
  );

  if (!proposal.proposalId) {
    throw new Error('Proposal ID not extracted');
  }

  const proposalId = proposal.proposalId;

  const contract = clientOfferContract(
    client.token,
    proposalId
  );

  if (!contract.contractId) {
    throw new Error('Contract ID not extracted');
  }

  const contractId = contract.contractId;

  acceptContract(
    designer.token,
    contractId,
    opportunityId
  );

  activateContract(
    client.token,
    contractId
  );

  const milestone = addMilestone(
    client.token,
    contractId
  );

  if (!milestone.milestoneId) {
    throw new Error('Milestone ID not extracted');
  }

  const milestoneId = milestone.milestoneId;
  if (!ALLOW_PAYMENT) {
    console.log(
      'e2e | stopped after add_milestone. Payment is opt-in: ' +
      're-run with -e ALLOW_PAYMENT=true against an approved sandbox.'
    );
    return;
  }

  const payment = makePayment(
    client.token,
    contractId,
    milestoneId
  );

  console.log(
    `e2e | payment orderId=${payment.orderId} alreadyPaid=${payment.alreadyPaid}`
  );

  if (PAYMENT_MODE !== 'full') {
    console.log(
      'e2e | stopped after payment. verify/activate/submit/review/approve ' +
      'need a SETTLED payment (Cashfree hosted checkout, which k6 cannot ' +
      'drive). Re-run with -e PAYMENT_MODE=full once the order is paid.'
    );
    return;
  }

  verifyPayment(
    client.token,
    payment.orderId
  );

  activateMilestone(
    client.token,
    contractId,
    milestoneId
  );

  submitWork(
    designer.token,
    contractId,
    milestoneId
  );

  reviewWork(
    client.token,
    contractId
  );

  approveWork(
    client.token,
    contractId,
    milestoneId
  );
}

export function handleSummary(data) {
  return summaryReport(data, 'e2eLoad');
}
