import sanitizeHtml from 'sanitize-html';

/**
 * Strip scripting from admin-authored answer HTML.
 *
 * `answerHtml` is written by content staff in a rich-text editor and rendered
 * with dangerouslySetInnerHTML on the reader page. Nothing sanitised it, and
 * reader auth tokens live in localStorage — so a single <script> saved into an
 * answer (by a compromised content account, or a paste from an untrusted
 * source) would exfiltrate the bearer token of every reader who opened that
 * topic. Sanitising on write means the stored document is already safe, so a
 * future template that forgets to escape cannot resurrect the hole.
 *
 * The allowlist is built from what the editor can actually produce (tiptap:
 * StarterKit + Image, TextAlign, TextStyle, Highlight, Table, Sub/Superscript,
 * Link). Anything outside that was not authored here and has no business in an
 * answer.
 */

// tiptap writes these as inline styles — dropping them would visibly rewrite
// every existing answer, so they are allowed, but only with values that cannot
// carry a payload (no url(), no expression(), no javascript:).
const SAFE_COLOR = [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/, /^hsla?\([\d\s.,%]+\)$/, /^[a-zA-Z]+$/];
const SAFE_LENGTH = [/^-?[\d.]+(px|pt|em|rem|%|ch)$/];

const allowedStyles: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': {
    color: SAFE_COLOR,
    'background-color': SAFE_COLOR,
    'font-family': [/^[\w\s,'"-]+$/],
    'font-size': SAFE_LENGTH,
    'text-align': [/^(left|right|center|justify)$/],
    'margin-left': SAFE_LENGTH,
    'text-indent': SAFE_LENGTH,
    'text-decoration': [/^(underline|line-through|none)$/],
    width: SAFE_LENGTH,
    height: SAFE_LENGTH,
  },
};

const options: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'div', 'span',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'mark', 'sub', 'sup', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li',
    'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  ],
  allowedAttributes: {
    '*': ['style', 'class'],
    a: ['href', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan', 'scope'],
    col: ['span'],
    ol: ['start', 'type'],
  },
  allowedStyles,
  // data: is deliberately absent for links but kept for images: the editor can
  // paste a screenshot as a data URI, and an <img> cannot execute one.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  // A link out of an answer opens in a new tab; noopener stops the opened page
  // from reaching back through window.opener.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
  // Drop the contents too, not just the tag — otherwise the script body is left
  // behind as visible text in the middle of the answer.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed'],
};

/** Sanitised copy of the HTML. Empty/undefined passes through untouched. */
export const sanitizeAnswerHtml = (html?: unknown): string | undefined => {
  if (html === undefined || html === null) return undefined;
  if (typeof html !== 'string' || html.trim() === '') return '';
  return sanitizeHtml(html, options);
};

/** Applies sanitizeAnswerHtml to a payload's answerHtml, if it carries one. */
export const sanitizeQuestionPayload = <T extends Record<string, unknown>>(payload: T): T => {
  if (!payload || !('answerHtml' in payload)) return payload;
  return { ...payload, answerHtml: sanitizeAnswerHtml(payload.answerHtml) };
};
