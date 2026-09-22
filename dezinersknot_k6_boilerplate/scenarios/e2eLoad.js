
import { sleep } from 'k6';

import { USERS } from '../config/config.js';
import { paymentConfig } from '../config/payment.js';
import { summaryReport } from '../utils/summary.js';
import { isWriteOk, safeIdentifier } from '../utils/helpers.js';

import {
  clientLogin,
  createOpportunity,
  clientOfferContract,
  activateContract,
  getContractMilestones,
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

const ALLOW_PAYMENT = paymentConfig.enabled;
const PAYMENT_MODE = paymentConfig.mode;

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
    contract_milestones_success: ['rate>0.99'],

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

  const contractActivation = activateContract(
    client.token,
    contractId
  );
  if (!isWriteOk(contractActivation.response)) {
    throw new Error('Contract activation failed');
  }

  const milestone = getContractMilestones(
    client.token,
    contractId
  );

  if (!milestone.milestoneId) {
    throw new Error('Offered milestone ID not extracted from combined_milestones');
  }

  const milestoneId = milestone.milestoneId;
  if (!ALLOW_PAYMENT) {
    console.log(
      'e2e | stopped after resolving an offered milestone. Payment is opt-in: ' +
      're-run with -e PAYMENT_ENABLED=true -e CASHFREE_ENV=sandbox ' +
      'against an approved sandbox.'
    );
    return;
  }

  const payment = makePayment(
    client.token,
    contractId,
    milestoneId
  );

  console.log(
    `e2e | payment order_id=${safeIdentifier(payment.orderId)} ` +
    `already_paid=${payment.alreadyPaid}`
  );

  if (!payment.orderCreated) {
    throw new Error('Cashfree payment order was not created with an order_id');
  }

  if (PAYMENT_MODE !== 'full') {
    console.log(
      'e2e | stopped after payment. verify/activate/submit/review/approve ' +
      'need a SETTLED payment (Cashfree hosted checkout, which k6 cannot ' +
      'drive). Re-run with -e PAYMENT_MODE=full once the order is paid.'
    );
    return;
  }

  const verification = verifyPayment(
    client.token,
    payment.orderId
  );
  if (!verification.statusValid) {
    console.log('e2e | payment is not settled in DK; stopping before milestone activation');
    return;
  }

  const activation = activateMilestone(
    client.token,
    contractId,
    milestoneId
  );
  if (!isWriteOk(activation.response)) return;

  const submission = submitWork(
    designer.token,
    contractId,
    milestoneId
  );
  if (!isWriteOk(submission.response)) return;

  const review = reviewWork(
    client.token,
    contractId
  );
  if (!isWriteOk(review.response)) return;

  approveWork(
    client.token,
    contractId,
    milestoneId
  );
}

export function handleSummary(data) {
  return summaryReport(data, 'e2eLoad');
}
