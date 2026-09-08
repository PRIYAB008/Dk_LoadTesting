
import { designerLogin, acceptContract } from '../flows/designerFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = designerLogin(testData.designer.email, testData.designer.password);
  if (!token) throw new Error('Designer token not extracted');
  const contractId = __ENV.CONTRACT_ID;
  const opportunityId = __ENV.OPPORTUNITY_ID;
  if (!contractId || !opportunityId) {
    throw new Error('Pass both ids: -e CONTRACT_ID=<id> -e OPPORTUNITY_ID=<id>');
  }

  acceptContract(token, contractId, opportunityId);
}

export function handleSummary(data) {
  return summaryReport(data, 'acceptContract');
}
