

import { sleep } from 'k6';
import { clientLogin } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    client_login_success: ['rate>0.99'],
    client_login_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  }
};

export default function () {
  clientLogin(testData.client.email, testData.client.password);
  sleep(5);
}

export function handleSummary(data) {
  return summaryReport(data, 'clientLoad');
}
