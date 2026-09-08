
import { clientLogin, clientOfferContract } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = clientLogin(testData.client.email, testData.client.password);
  if (!token) throw new Error('Client token not extracted');

  const proposalId = __ENV.PROPOSAL_ID;
  if (!proposalId) {
    throw new Error('Pass the proposal id: -e PROPOSAL_ID=<id> (from scenarios/sendProposal.js)');
  }

  const { contractId } = clientOfferContract(token, proposalId);
  console.log(`Client Offer Contract | contractId = ${contractId}`);
}

export function handleSummary(data) {
  return summaryReport(data, 'clientOfferContract');
}
