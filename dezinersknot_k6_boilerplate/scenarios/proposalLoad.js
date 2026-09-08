
import { sleep } from 'k6';
import { clientLogin, createOpportunity } from '../flows/clientFlow.js';
import { designerLogin, sendProposal } from '../flows/designerFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = {
  stages: [
    { duration: '30s', target: 1 },
    { duration: '1m',  target: 1 },
    { duration: '30s', target: 0 }
  ],

  thresholds: {
    send_proposal_success: ['rate>0.95'],
    send_proposal_duration: ['p(95)<3000'],
    create_opportunity_success: ['rate>0.95'],
    http_req_failed: ['rate<0.05'],
    checks: ['rate>0.95'],
  }
};

export function setup() {
  const { token: clientToken } = clientLogin(
    testData.client.email,
    testData.client.password
  );

  if (!clientToken) {
    throw new Error('Client token not extracted - aborting before the ramp');
  }

  const { token: designerToken } = designerLogin(
    testData.designer.email,
    testData.designer.password
  );

  if (!designerToken) {
    throw new Error('Designer token not extracted - aborting before the ramp');
  }

  return { clientToken, designerToken };
}

export default function (data) {
  const { opportunityId } = createOpportunity(data.clientToken);

  if (!opportunityId) {
    sleep(1);
    return;
  }

  sendProposal(data.designerToken, opportunityId);
  sleep(1);
}

export function handleSummary(data) {
  return summaryReport(data, 'proposalLoad');
}
