
import { clientLogin, verifyPayment } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = clientLogin(testData.client.email, testData.client.password);
  if (!token) throw new Error('Client token not extracted');

  const orderId = __ENV.ORDER_ID;
  if (!orderId) {
    throw new Error('Pass the Cashfree order id from a secure test-data source: -e ORDER_ID=<id>');
  }

  verifyPayment(token, orderId);
}

export function handleSummary(data) {
  return summaryReport(data, 'verifyPayment');
}
