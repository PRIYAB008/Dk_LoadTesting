
import { sleep } from 'k6';
import { clientLogin, createOpportunity } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = {
  stages: [
    { duration: '30s', target: 1 },
    { duration: '1m',  target: 1 },
    { duration: '30s', target: 0 }
  ],

  thresholds: {
    create_opportunity_success: ["rate>0.95"],
    create_opportunity_duration: ["p(95)<3000"],
    http_req_failed: ["rate<0.05"],
    checks: ["rate>0.95"],
  }
};

export function setup() {
  const { token } = clientLogin(
    testData.client.email,
    testData.client.password
  );

  if (!token) {
    throw new Error('Client token not extracted - aborting before the ramp');
  }

  return { token };
}

export default function (data) {
  createOpportunity(data.token);
  sleep(1);
}

export function handleSummary(data) {
  return summaryReport(data, 'opportunityLoad');
}
