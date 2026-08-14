/**
 * Telegram Bot API — outbound only.
 *
 * One `fetch` to https://api.telegram.org/bot<token>/sendMessage. No SDK, no
 * dependency; the server is on native fetch already.
 *
 * WHO THIS CAN REACH
 *   The admin — yes, once. A bot can only message a chat that has already
 *   started it (or a group it has been added to), so the admin taps /start once
 *   and we store the resulting numeric chat id in TELEGRAM_ADMIN_CHAT_ID.
 *
 *   A buyer — NO. There is no way to message an arbitrary Telegram user from a
 *   phone number, an email, or a @username. Telegram has no such API and never
 *   has; the chat id only exists after that person messages the bot. So book
 *   buyers cannot receive a Telegram alert from us, and nothing in this file
 *   pretends otherwise. WhatsApp is the buyer channel.
 *
 * Nothing here throws. Every function resolves with a result object so a caller
 * on an order path can never be broken by Telegram being down.
 */
import config from '../../config';

export interface TelegramSendResult {
  ok: boolean;
  /** True when we deliberately did nothing (no token / no chat id configured). */
  skipped?: boolean;
  reason?: string;
  status?: number;
  chatId?: string;
}

const API_BASE = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

/** AbortSignal.timeout exists on Node 17.3+; guard anyway so a stub can't crash us. */
const timeoutSignal = (): AbortSignal | undefined => {
  try {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(TIMEOUT_MS)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Configured admin chat ids, split and cleaned. Read per call so tests can flip it. */
const adminChatIds = (): string[] =>
  String(config.alerts.telegram.admin_chat_ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const isConfigured = (): boolean =>
  !!config.alerts.telegram.bot_token && adminChatIds().length > 0;

/**
 * Send one plain-text message. Resolves — never rejects.
 *
 * Plain text on purpose: no parse_mode is set, so a book title containing `<`
 * or `*` cannot trigger Telegram's "can't parse entities" 400 and silently cost
 * the admin the whole notification.
 */
const sendMessage = async (chatId: string, text: string): Promise<TelegramSendResult> => {
  const token = config.alerts.telegram.bot_token;

  if (!token) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN is not set — skipping send.');
    return { ok: false, skipped: true, reason: 'no-bot-token', chatId };
  }
  if (!chatId) {
    console.warn('[telegram] no chat id given — skipping send.');
    return { ok: false, skipped: true, reason: 'no-chat-id' };
  }

  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: timeoutSignal(),
    });

    if (!res.ok) {
      // Telegram puts the real reason in the body ("chat not found", "bot was
      // blocked by the user"...). A status code alone is not debuggable.
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 400);
      } catch {
        /* body already consumed or unreadable — the status still tells us something */
      }
      console.error(`[telegram] send failed (HTTP ${res.status}) chat=${chatId}: ${detail}`);
      return { ok: false, status: res.status, reason: detail || `http-${res.status}`, chatId };
    }

    return { ok: true, status: res.status, chatId };
  } catch (err) {
    // Network down, DNS failure, timeout, or a stubbed fetch that threw.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] send threw for chat=${chatId}: ${msg}`);
    return { ok: false, reason: msg, chatId };
  }
};

/** Fan out to every configured admin chat. Resolves with one result per chat. */
const sendToAdmins = async (text: string): Promise<TelegramSendResult[]> => {
  const ids = adminChatIds();
  if (!config.alerts.telegram.bot_token) {
    console.warn('[telegram] TELEGRAM_BOT_TOKEN is not set — admin alert skipped.');
    return [{ ok: false, skipped: true, reason: 'no-bot-token' }];
  }
  if (ids.length === 0) {
    console.warn('[telegram] TELEGRAM_ADMIN_CHAT_ID is not set — admin alert skipped.');
    return [{ ok: false, skipped: true, reason: 'no-chat-id' }];
  }
  // allSettled, not all: one blocked chat must not cancel the others. sendMessage
  // already never rejects, so this is belt and braces.
  const settled = await Promise.allSettled(ids.map((id) => sendMessage(id, text)));
  return settled.map((s) =>
    s.status === 'fulfilled'
      ? s.value
      : { ok: false, reason: s.reason instanceof Error ? s.reason.message : String(s.reason) }
  );
};

export const TelegramService = {
  isConfigured,
  adminChatIds,
  sendMessage,
  sendToAdmins,
};
