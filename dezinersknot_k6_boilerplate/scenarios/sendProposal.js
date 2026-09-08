
import { clientLogin, createOpportunity } from '../flows/clientFlow.js';
import { designerLogin, findOpportunities, sendProposal } from '../flows/designerFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  let opportunityId = __ENV.OPPORTUNITY_ID || null;

  if (!opportunityId) {
    const { token: clientToken } = clientLogin(
      testData.client.email,
      testData.client.password
    );

    if (!clientToken) {
      throw new Error('Client token not extracted - cannot create an opportunity');
    }

    opportunityId = createOpportunity(clientToken).opportunityId;
  }

  if (!opportunityId) {
    throw new Error(
      'No opportunity id. Pass -e OPPORTUNITY_ID=<id>, or fix the id ' +
      'extraction in extractId() once the real response body is known.'
    );
  }

  console.log(`Send Proposal | using opportunityId = ${opportunityId}`);
  const { token: designerToken } = designerLogin(
    testData.designer.email,
    testData.designer.password
  );

  if (!designerToken) {
    throw new Error('Designer token not extracted - cannot send a proposal');
  }
  findOpportunities(designerToken);
  const { proposalId } = sendProposal(designerToken, opportunityId);
  console.log(`Send Proposal | proposalId = ${proposalId}`);
  if (!proposalId) {
    console.warn(
      'No proposal id extracted. Check the response body above and update ' +
      'extractId() in utils/helpers.js with the real field name.'
    );
  }
}

export function handleSummary(data) {
  return summaryReport(data, 'sendProposal');
}
