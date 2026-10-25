import http from 'k6/http';
import { BASE_URL } from '../config/config.js';
import { payloads } from '../data/payloads.js';
import { track } from '../utils/metrics.js';
import { jsonHeaders, extractId } from '../utils/helpers.js';

const CHAT = `${BASE_URL}/bx_block_chat`;

// Find-or-open is idempotent and gated server-side: only the two parties of
// the proposal can open it, so call it with the client or designer token.
export function openConversation(token, proposalId) {
  const response = http.post(
    `${CHAT}/conversations`,
    JSON.stringify(payloads.openConversation(proposalId)),
    jsonHeaders(token)
  );
  track('chat_open', 'Chat Open Conversation', response);
  return { response, conversationId: extractId(response) };
}

export function chatUnreadCount(token) {
  const response = http.get(`${CHAT}/conversations/unread_count`, jsonHeaders(token));
  track('chat_unread_count', 'Chat Unread Count', response);
  return { response };
}

export function listConversations(token) {
  const response = http.get(`${CHAT}/conversations`, jsonHeaders(token));
  track('chat_inbox', 'Chat Inbox', response);
  return { response };
}

export function sendMessage(token, conversationId, text) {
  const response = http.post(
    `${CHAT}/conversations/${conversationId}/messages`,
    JSON.stringify(payloads.chatMessage(text)),
    jsonHeaders(token)
  );
  track('chat_send_message', 'Chat Send Message', response);
  return { response, messageId: extractId(response) };
}

export function listMessages(token, conversationId) {
  const response = http.get(
    `${CHAT}/conversations/${conversationId}/messages`,
    jsonHeaders(token)
  );
  track('chat_list_messages', 'Chat List Messages', response);
  return { response };
}

export function markConversationRead(token, conversationId, messageId) {
  const response = http.put(
    `${CHAT}/conversations/${conversationId}/mark_as_read`,
    JSON.stringify(payloads.markRead(messageId)),
    jsonHeaders(token)
  );
  track('chat_mark_read', 'Chat Mark Read', response);
  return { response };
}
