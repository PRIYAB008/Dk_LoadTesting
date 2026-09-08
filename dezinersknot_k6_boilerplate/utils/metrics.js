
import { Trend, Rate, Counter } from 'k6/metrics';
import { checkWrite, isWriteOk, logResponse } from './helpers.js';

export const STEPS = [

  'client_login',
  'client_profile',
  'create_opportunity',
  'offer_contract',
  'activate_contract',
  'add_milestone',
  'activate_milestone',
  'payment',
  'payment_verify',
  'review_work',
  'approve_work',
  'designer_login',
  'find_opportunities',
  'designer_opportunity_list',
  'send_proposal',
  'pending_contract_offers',
  'accept_contract',
  'submit_work',
  'admin_payment_stats',
];

const metrics = {};
for (const step of STEPS) {
  metrics[step] = {
    duration: new Trend(`${step}_duration`, true),
    success: new Rate(`${step}_success`),
    errors: new Counter(`${step}_errors`),
  };
}

export function record(step, response) {
  const m = metrics[step];
  const ok = isWriteOk(response);
  if (!m) return ok;

  m.duration.add(response.timings.duration);
  m.success.add(ok);
  if (!ok) m.errors.add(1);
  return ok;
}

export function track(step, label, response) {
  const ok = record(step, response);
  checkWrite(response, label);
  logResponse(label, response);
  return ok;
}
