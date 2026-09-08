import http from 'k6/http';
import { BASE_URL } from '../config/config.js';
import { track } from '../utils/metrics.js';
import { jsonHeaders } from '../utils/helpers.js';


export function getAdminPaymentStats(token) {
  const url = `${BASE_URL}/bx_block_payment_admin/admin_payment_stats`;
  const response = http.get(url, jsonHeaders(token));
  track('admin_payment_stats', 'Admin Payment Stats', response);
  return { response };
}
