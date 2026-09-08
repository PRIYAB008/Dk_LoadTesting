import http from 'k6/http';
import { BASE_URL } from '../config/config.js';
import { payloads } from '../data/payloads.js';
import { track } from '../utils/metrics.js';
import { jsonHeaders, extractToken, extractId, getJSON } from '../utils/helpers.js';

export function clientLogin(email, password) {
  const url = `${BASE_URL}/bx_block_login/login`;
  const payload = JSON.stringify({
    data: { type: 'email_account', attributes: { email, password } }
  });
  const response = http.post(url, payload, jsonHeaders());
  track('client_login', 'Client Login', response);
  return { response, token: extractToken(response) };
}

export function clientProfile(token, profileId) {
  const url = `${BASE_URL}/bx_block_profile/profiles/${profileId}`;
  const response = http.get(url, jsonHeaders(token));
  track('client_profile', 'Client Profile', response);
  return { response };
}

export function createOpportunity(token) {
  const url = `${BASE_URL}/bx_block_landingpage2/work_opportunities`;
  const response = http.post(
    url,
    JSON.stringify(payloads.createOpportunity()),
    jsonHeaders(token)
  );
  track('create_opportunity', 'Create Opportunity', response);
  return { response, opportunityId: extractId(response) };
}

export function clientOfferContract(token, proposalId) {
  const url = `${BASE_URL}/bx_block_dashboard/contracts`;
  const response = http.post(
    url,
    JSON.stringify(payloads.offerContract(proposalId)),
    jsonHeaders(token)
  );
  track('offer_contract', 'Client Offer Contract', response);
  return { response, contractId: extractId(response, ['contracts']) };
}

export function activateContract(token, contractId) {
  const url = `${BASE_URL}/bx_block_dashboard/contracts/activate_contract`;
  const response = http.put(
    url,
    JSON.stringify(payloads.activateContract(contractId)),
    jsonHeaders(token)
  );
  track('activate_contract', 'Activate Contract', response);
  return { response };
}

export function addMilestone(token, contractId) {
  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/add_milestone`;
  const response = http.post(
    url,
    JSON.stringify(payloads.addMilestone(contractId)),
    jsonHeaders(token)
  );
  track('add_milestone', 'Add Milestone', response);
  return { response, milestoneId: extractId(response, ['milestones']) };
}

export function activateMilestone(token, contractId, milestoneId) {
  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/activate_milestone/`;
  const response = http.put(
    url,
    JSON.stringify(payloads.activateMilestone(contractId, milestoneId)),
    jsonHeaders(token)
  );
  track('activate_milestone', 'Activate Milestone', response);
  return { response };
}

export function makePayment(token, contractId, milestoneId) {
  if (__ENV.ALLOW_PAYMENT !== 'true') {
    throw new Error(
      'makePayment blocked: this creates a real Cashfree order. ' +
      'Re-run with -e ALLOW_PAYMENT=true only against an approved sandbox.'
    );
  }

  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/payment_from_cashfree`;
  const response = http.post(
    url,
    JSON.stringify(payloads.payment(contractId, milestoneId)),
    jsonHeaders(token)
  );
  track('payment', 'Make Payment', response);

  const body = getJSON(response);
  const orderId = body?.cashfree_order?.order_id || null;
  const alreadyPaid = body?.already_paid === true || body?.upi_in_progress === true;

  return { response, orderId, alreadyPaid };
}

export function verifyPayment(token, orderId) {
  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/verify_cashfree_payment`;
  const response = http.post(
    url,
    JSON.stringify(payloads.verifyPayment(orderId)),
    jsonHeaders(token)
  );
  track('payment_verify', 'Verify Payment', response);
  return { response };
}

export function reviewWork(token, contractId) {
  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/designers_contracts/list_milestones?id=${contractId}`;
  const response = http.get(url, jsonHeaders(token));
  track('review_work', 'Review Work', response);
  const body = getJSON(response);
  return { response, milestones: body?.combined_milestones || [] };
}

export function approveWork(token, contractId, milestoneId) {
  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/approve_milestone/`;
  const response = http.put(
    url,
    JSON.stringify(payloads.approveWork(contractId, milestoneId)),
    jsonHeaders(token)
  );
  track('approve_work', 'Approve Work', response);
  return { response };
}
