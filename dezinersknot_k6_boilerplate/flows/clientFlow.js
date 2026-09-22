import http from 'k6/http';
import encoding from 'k6/encoding';
import { BASE_URL } from '../config/config.js';
import { payloads } from '../data/payloads.js';
import { track, trackPaymentOrder, trackPaymentStatus } from '../utils/metrics.js';
import { jsonHeaders, extractToken, extractId, getJSON } from '../utils/helpers.js';
import { assertPaymentOrdersEnabled } from '../config/payment.js';

export function clientLogin(email, password) {
  const url = `${BASE_URL}/bx_block_login/login`;
  const payload = JSON.stringify({
    data: { type: 'email_account', attributes: { email, password: encoding.b64encode(password) } }
  });
  const response = http.post(url, payload, jsonHeaders());
  track('client_login', 'Client Login', response, { allowBody: false });
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

function firstResourceId(rows) {
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (row?.id !== undefined && row.id !== null) return String(row.id);
    if (row?.attributes?.id !== undefined && row.attributes.id !== null) {
      return String(row.attributes.id);
    }
  }
  return null;
}

function milestoneRows(body) {
  const candidates = [
    body?.combined_milestones,
    body?.milestones,
    body?.contract_milestones,
    body?.data?.combined_milestones,
    body?.data?.attributes?.combined_milestones,
    body?.data?.attributes?.milestones,
    body?.contract?.milestones,
  ];
  const directMatch = candidates.find((rows) => Array.isArray(rows));
  if (directMatch) return directMatch;
  const queue = [body];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      if (Array.isArray(value) && key.toLowerCase().includes('milestone')) {
        return value;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return [];
}

function responseShape(body) {
  if (!body || typeof body !== 'object') return 'non-json';
  const keys = Object.keys(body);
  const dataKeys = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? Object.keys(body.data)
    : [];
  const attributeKeys = body.data?.attributes && typeof body.data.attributes === 'object'
    ? Object.keys(body.data.attributes)
    : [];
  return `root=[${keys.join(',')}] data=[${dataKeys.join(',')}] attributes=[${attributeKeys.join(',')}]`;
}

// The client must read its own contract details. Calling the designer route
// with a client token is rejected with 403.
export function getContractMilestones(token, contractId) {
  const url =
    `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/active_contract_details` +
    `?data[attributes][contract_id]=${encodeURIComponent(contractId)}`;
  const response = http.get(url, jsonHeaders(token));
  track('contract_milestones', 'Contract Milestones', response);
  const body = getJSON(response);
  const milestones = milestoneRows(body);
  const milestoneId = firstResourceId(milestones);
  if (!milestoneId) {
    console.log(`Contract Milestones | no milestone ID; ${responseShape(body)}`);
  }
  return { response, milestones, milestoneId };
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
  assertPaymentOrdersEnabled();

  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/payment_from_cashfree`;
  const response = http.post(
    url,
    JSON.stringify(payloads.payment(contractId, milestoneId)),
    jsonHeaders(token)
  );

  const body = getJSON(response);
  const orderId = body?.cashfree_order?.order_id || null;
  const paymentSessionId =
    body?.payment_session_id ||
    body?.cashfree_order?.payment_session_id ||
    null;
  const alreadyPaid = body?.already_paid === true || body?.upi_in_progress === true;
  const orderCreated = trackPaymentOrder(response, orderId, paymentSessionId);

  return { response, orderId, paymentSessionId, alreadyPaid, orderCreated };
}

export function verifyPayment(token, orderId) {
  const url = `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/verify_cashfree_payment`;
  const response = http.post(
    url,
    JSON.stringify(payloads.verifyPayment(orderId)),
    jsonHeaders(token)
  );
  const statusValid = trackPaymentStatus(response, orderId);
  return { response, statusValid };
}

export function reviewWork(token, contractId) {
  const url =
    `${BASE_URL}/bx_block_cfdesignersidecontractmanagement/client_contracts/active_contract_details` +
    `?data[attributes][contract_id]=${encodeURIComponent(contractId)}`;
  const response = http.get(url, jsonHeaders(token));
  track('review_work', 'Review Work', response);
  const body = getJSON(response);
  return { response, milestones: milestoneRows(body) };
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
