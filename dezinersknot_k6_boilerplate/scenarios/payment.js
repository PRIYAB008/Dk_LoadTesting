
import { clientLogin, makePayment } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';
import { safeIdentifier } from '../utils/helpers.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = clientLogin(testData.client.email, testData.client.password);
  if (!token) throw new Error('Client token not extracted');

  const contractId = __ENV.CONTRACT_ID;
  const milestoneId = __ENV.MILESTONE_ID;
  if (!contractId || !milestoneId) {
    throw new Error('Pass both ids: -e CONTRACT_ID=<id> -e MILESTONE_ID=<id>');
  }

  const { orderId, alreadyPaid } = makePayment(token, contractId, milestoneId);
  console.log(
    `Payment | order_id=${safeIdentifier(orderId)} already_paid=${alreadyPaid}`
  );
}

export function handleSummary(data) {
  return summaryReport(data, 'payment');
}
