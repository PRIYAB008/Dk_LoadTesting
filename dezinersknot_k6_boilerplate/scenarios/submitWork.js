
import { designerLogin, submitWork } from '../flows/designerFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = designerLogin(testData.designer.email, testData.designer.password);
  if (!token) throw new Error('Designer token not extracted');

  const contractId = __ENV.CONTRACT_ID;
  const milestoneId = __ENV.MILESTONE_ID;
  if (!contractId || !milestoneId) {
    throw new Error('Pass both ids: -e CONTRACT_ID=<id> -e MILESTONE_ID=<id>');
  }

  submitWork(token, contractId, milestoneId);
}

export function handleSummary(data) {
  return summaryReport(data, 'submitWork');
}
