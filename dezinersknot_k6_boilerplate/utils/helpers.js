import { check } from 'k6';

export function jsonHeaders(token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.token = token;
  return { headers };
}

export function getJSON(response) {
  try {
    return response.json();
  } catch (e) {
    return null;
  }
}

export function check2xx(response, name) {
  return check(response, {
    [`${name} - status is 2xx`]: r => r.status >= 200 && r.status < 300
  });
}
export function checkOK(response, name) {
  return check2xx(response, name);
}

export function isWriteOk(response) {
  if (response.status < 200 || response.status >= 300) return false;

  const body = getJSON(response);
  if (!body || typeof body !== 'object') return true;

  if (body.errors !== undefined) return false;
  if (body.error !== undefined) return false;
  if (body.success === false) return false;
  return true;
}

export function checkWrite(response, name) {
  return check(response, {
    [`${name} - write succeeded`]: r => isWriteOk(r)
  });
}

export function failureReason(response) {
  const body = getJSON(response);
  let detail = '';

  if (body && body.errors) {
    const e = body.errors;
    detail = typeof e === 'string' ? e : JSON.stringify(Array.isArray(e) ? e[0] : e);
  } else if (body && body.error) {
    detail = typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
  } else if (body && body.message) {
    detail = String(body.message);
  }

  return `HTTP ${response.status}${detail ? ' - ' + detail.slice(0, 160) : ''}`;
}

// Per-request body logging is fine for the vus:1 debug scenarios but costs
// real throughput at 60 VUs, where it prints thousands of full bodies. QUIET
// keeps failures visible and drops the rest. Default is unchanged.
const QUIET = __ENV.QUIET === 'true';

export function logResponse(name, response) {
  const ok = isWriteOk(response);

  if (QUIET) {
    if (!ok) console.log(`${name} | ${failureReason(response)}`);
    return;
  }

  console.log(`${name} | status=${response.status} ok=${ok}`);
  if (!ok) console.log(`${name} | ${failureReason(response)}`);
  console.log(`${name} | body=${response.body}`);
}

export function extractToken(response) {
  const body = getJSON(response);
  return (
    body?.meta?.token ||
    body?.token ||
    body?.access ||
    null
  );
}

function idOf(row) {
  if (!row) return null;
  if (row.id !== undefined && row.id !== null) return String(row.id);
  if (row.attributes?.id !== undefined && row.attributes?.id !== null) {
    return String(row.attributes.id);
  }
  return null;
}

export function extractId(response, extraKeys = []) {
  const body = getJSON(response);
  if (!body) return null;

  const keys = ['data', 'work_opportunity', 'proposal', 'contract', 'milestone']
    .concat(extraKeys);

  const candidates = [body];
  for (const key of keys) {
    const v = body[key];
    if (!v) continue;
    candidates.push(v);
    if (v.data) candidates.push(v.data);
  }

  for (const c of candidates) {
    const id = idOf(Array.isArray(c) ? c[0] : c);
    if (id) return id;
  }
  return null;
}
