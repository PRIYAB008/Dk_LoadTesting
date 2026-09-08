
import { clientLogin, clientProfile } from '../flows/clientFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  const { token } = clientLogin(testData.client.email, testData.client.password);
  if (!token) throw new Error('Client token not extracted');

  const profileId = __ENV.PROFILE_ID;
  if (!profileId) {
    throw new Error('Pass the profile id: -e PROFILE_ID=<id>');
  }

  clientProfile(token, profileId);
}

export function handleSummary(data) {
  return summaryReport(data, 'clientProfile');
}
