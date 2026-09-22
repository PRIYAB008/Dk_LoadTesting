import http from 'k6/http';
import encoding from 'k6/encoding';
import { BASE_URL } from '../config/config.js';
import { jsonHeaders, checkOK, getJSON } from '../utils/helpers.js';

export function clientLogin(email, password) {

  const url = `${BASE_URL}/bx_block_login/login`;

  const payload = JSON.stringify({
    data: {
      type: 'email_account',
      attributes: {
        email: email,
        password: encoding.b64encode(password),
      },
    },
  });

  const response = http.post(
    url,
    payload,
    jsonHeaders()
  );

  checkOK(response, 'Client Login');

  const body = getJSON(response);
  const token =
    body?.meta?.token ||
    body?.token ||
    body?.data?.attributes?.token ||
    null;

  console.log(`Client Login | status=${response.status} token_extracted=${Boolean(token)}`);

  return {
    response: response,
    token: token,
  };
}