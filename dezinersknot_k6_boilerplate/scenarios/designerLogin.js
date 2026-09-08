
import { designerLogin } from '../flows/designerFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = designerLogin(testData.designer.email, testData.designer.password);
  console.log(`Designer Login | token extracted = ${Boolean(token)}`);
}

export function handleSummary(data) {
  return summaryReport(data, 'designerLogin');
}
