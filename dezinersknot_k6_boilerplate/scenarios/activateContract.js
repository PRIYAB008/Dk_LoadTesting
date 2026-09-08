
import { clientLogin, activateContract } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = clientLogin(testData.client.email, testData.client.password);
  if (!token) throw new Error('Client token not extracted');

  const contractId = __ENV.CONTRACT_ID;
  if (!contractId) {
    throw new Error('Pass the contract id: -e CONTRACT_ID=<id>');
  }

  activateContract(token, contractId);
}

export function handleSummary(data) {
  return summaryReport(data, 'activateContract');
}
