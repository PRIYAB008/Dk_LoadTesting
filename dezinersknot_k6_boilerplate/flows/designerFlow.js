import http from 'k6/http';
import { BASE_URL } from '../config/config.js';
import { payloads } from '../data/payloads.js';
import { track } from '../utils/metrics.js';
import { jsonHeaders, extractToken, extractId } from '../utils/helpers.js';

export function designerLogin(email, password) {
  const url = `${BASE_URL}/bx_block_login/login`;
  const payload = JSON.stringify({
    data: { type: 'email_account', attributes: { email, password } }
  });
  const response = http.post(url, payload, jsonHeaders());
  track('designer_login', 'Designer Login', response);
  return { response, token: extractToken(response) };
}

export function findOpportunities(token) {
  const url = `${BASE_URL}/bx_block_landingpage2/work_opportunities/find_work_opportunities?page=1&per_page=18&sort=recently_listed&saved_listing=false`;
  const response = http.get(url, jsonHeaders(token));
  track('find_opportunities', 'Find Opportunities', response);
  return { response };
}

export function designerOpportunityList(token) {
  const url = `${BASE_URL}/bx_block_joblisting/proposals/work_opportunities_with_contracts`;
  const response = http.get(url, jsonHeaders(token));
  track('designer_opportunity_list', 'Designer Opportunity List', response);
  return { response };
}

export function sendProposal(token, opportunityId) {
  const url = `${BASE_URL}/bx_block_joblisting/proposals`;
  const response = http.post(
    url,
    JSON.stringify(payloads.sendProposal(opportunityId)),
    jsonHeaders(token)
  );
  track('send_proposal', 'Send Proposal', response);
  return { response, proposalId: extractId(response) };
}

export function pendingContractOffers(token) {
  const url = `${BASE_URL}/bx_block_cfproposalmanagement/contract_offers/pending_list_proposal`;
  const response = http.get(url, jsonHeaders(token));
  track('pending_contract_offers', 'Pending Contract Offers', response);
  return { response };
}

export function acceptContract(token, contractId, opportunityId) {
  const url = `${BASE_URL}/bx_block_dashboard/contracts/accept_contract`;
  const response = http.put(
    url,
    JSON.stringify(payloads.acceptContract(contractId, opportunityId)),
    jsonHeaders(token)
  );
  track('accept_contract', 'Accept Contract', response);
  return { response };
}

export function submitWork(token, contractId, milestoneId) {
  const fields = payloads.submitWork(contractId, milestoneId);
  const boundary = `----k6Boundary${__VU}-${__ITER}`;
  const parts = [];

  function field(name, value) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`
    );
  }

  field('work_submission[contract_id]', String(fields.contract_id));
  for (const link of fields.submission_links) {
    field('work_submission[submission_links][]', link);
  }
  field('work_submission[message]', fields.message);
  field('work_submission[contract_milestone_id]', String(fields.contract_milestone_id));
  field('work_submission[contract_milestone_type]', String(fields.contract_milestone_type));
  parts.push(`--${boundary}--\r\n`);

  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/designer_work_submissions/submit_work`;
  const response = http.post(url, parts.join(''), {
    headers: {
      token: token,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
  });

  track('submit_work', 'Submit Work', response);
  return { response };
}
