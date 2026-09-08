import http from 'k6/http';
import { BASE_URL } from '../config/config.js';
import { jsonHeaders, checkOK, getJSON } from '../utils/helpers.js';

export function clientLogin(email, password) {

  const url = `${BASE_URL}/bx_block_login/login`;

  const payload = JSON.stringify({
    data: {
      type: 'email_account',
      attributes: {
        email: email,
        password: password,
      },
    },
  });

  const response = http.post(
    url,
    payload,
    jsonHeaders()
  );

  checkOK(response, 'Client Login');

  console.log('Client Login Status:', response.status);
  console.log('Client Login Response:', response.body);

  const body = getJSON(response);
  const token =
    body?.meta?.token ||
    body?.token ||
    body?.data?.attributes?.token ||
    null;

  return {
    response: response,
    token: token,
  };
}