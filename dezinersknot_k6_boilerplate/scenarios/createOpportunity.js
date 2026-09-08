
import { clientLogin, createOpportunity } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = clientLogin(
    testData.client.email,
    testData.client.password
  );

  if (!token) {
    throw new Error('Client token not extracted - cannot create opportunity');
  }

  const { response, opportunityId } = createOpportunity(token);
  console.log(`Create Opportunity | opportunityId = ${opportunityId}`);

  if (!opportunityId) {
    console.warn(
      'No opportunity id extracted. Check the response body above and ' +
      'update extractId() in utils/helpers.js with the real field name.'
    );
  }

  return response;
}

export function handleSummary(data) {
  return summaryReport(data, 'createOpportunity');
}
