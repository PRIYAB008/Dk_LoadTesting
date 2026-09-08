import { clientLogin } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  clientLogin(testData.client.email, testData.client.password);
}

export function handleSummary(data) {
  return summaryReport(data, 'clientLogin');
}
