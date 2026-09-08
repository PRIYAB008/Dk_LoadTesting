import { getAdminPaymentStats } from '../flows/adminFlow.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {

}

export function handleSummary(data) {
  return summaryReport(data, 'adminLoad');
}
