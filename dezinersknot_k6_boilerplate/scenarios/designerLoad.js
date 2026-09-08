import { designerLogin } from '../flows/designerFlow.js';
import { testData } from '../data/testData.js';
import { summaryReport } from '../utils/summary.js';

export const options = { vus: 1, iterations: 1 };

export default function () {
  designerLogin(testData.designer.email, testData.designer.password);

}

export function handleSummary(data) {
  return summaryReport(data, 'designerLoad');
}
