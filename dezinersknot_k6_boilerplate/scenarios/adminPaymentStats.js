
import { clientLogin } from '../flows/clientFlow.js';
import { getAdminPaymentStats } from '../flows/adminFlow.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const email = __ENV.ADMIN_EMAIL;
  const password = __ENV.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Pass admin credentials: -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=...');
  }
  const { token } = clientLogin(email, password);
  if (!token) throw new Error('Admin token not extracted');

  getAdminPaymentStats(token);
}

export function handleSummary(data) {
  return summaryReport(data, 'adminPaymentStats');
}
