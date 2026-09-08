
import { designerLogin, findOpportunities } from '../flows/designerFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = designerLogin(testData.designer.email, testData.designer.password);
  if (!token) throw new Error('Designer token not extracted');

  findOpportunities(token);
}

export function handleSummary(data) {
  return summaryReport(data, 'findOpportunities');
}
