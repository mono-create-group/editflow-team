const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = html.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < html.length; i += 1) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function inboxContext(jobs) {
  const context = vm.createContext({ URL, Date, Intl, PORTAL_JOBS: jobs });
  const names = [
    '_videoSafeUrl',
    '_videoWorkflow',
    '_videoSubmissionEpoch',
    '_videoLatestSubmissionEvent',
    '_videoSubmissionReviewItems',
  ];
  vm.runInContext(names.map(functionSource).join('\n'), context);
  return context;
}

test('inbox includes only initial or revision drafts that still await director review', () => {
  const jobs = [
    { id: 'initial', _portalUid: 'u1', status: '初稿提出済み', workflow: { stage: 'director_review', round: 1 }, title: '初稿', evidenceUrl: 'https://example.com/initial', updatedAt: 100 },
    { id: 'revision', _portalUid: 'u2', status: '修正稿提出済み', workflow: { stage: 'director_review', round: 2 }, title: '修正稿', evidenceUrl: 'https://example.com/revision', updatedAt: 300 },
    { id: 'approved', _portalUid: 'u3', status: 'D確認OK', workflow: { stage: 'client_submission', round: 1 }, title: '確認済み', evidenceUrl: 'https://example.com/approved', updatedAt: 400 },
    { id: 'editing', _portalUid: 'u4', status: '修正中', workflow: { stage: 'editing', round: 2 }, title: '修正中', updatedAt: 500 },
    { id: 'legacy', _portalUid: 'u5', status: '初稿提出済み', title: '旧初稿', evidenceUrl: 'https://example.com/legacy', updatedAt: 200 },
    { id: 'fb', _portalUid: 'u6', status: 'FB待ち', title: '旧FB待ち', updatedAt: 600 },
  ];
  const context = inboxContext(jobs);
  const items = vm.runInContext('_videoSubmissionReviewItems()', context);
  assert.deepEqual(Array.from(items, item => item.id), ['revision', 'legacy', 'initial']);
  assert.deepEqual(Array.from(items, item => item.kind), ['修正稿', '初稿', '初稿']);
});

test('current-round submission event supplies the review link and submitted time', () => {
  const jobs = [{
    id: 'round-2', _portalUid: 'editor', status: '修正稿提出済み', workflow: { stage: 'director_review', round: 2 },
    title: '案件', evidenceUrl: 'https://example.com/job-latest', updatedAt: 999,
    progressEvents: [
      { type: 'editor_submitted', status: '初稿提出済み', round: 1, at: 100, evidenceUrl: 'https://example.com/round-1' },
      { type: 'editor_submitted', status: '修正稿提出済み', round: 2, at: 200, evidenceUrl: 'https://example.com/round-2' },
    ],
  }];
  const context = inboxContext(jobs);
  const item = vm.runInContext('_videoSubmissionReviewItems()[0]', context);
  assert.equal(item.evidenceUrl, 'https://example.com/round-2');
  assert.equal(item.submittedAt, 200);
  assert.equal(item.round, 2);
});

test('a missing current-round event never falls back to an older draft link', () => {
  const jobs = [{
    id: 'broken-round-2', _portalUid: 'editor', status: '修正稿提出済み', workflow: { stage: 'director_review', round: 2 },
    title: '修正稿', evidenceUrl: 'https://example.com/current-job-link', updatedAt: 999,
    progressEvents: [{ type: 'editor_submitted', status: '初稿提出済み', round: 1, at: 100, evidenceUrl: 'https://example.com/stale-round-1' }],
  }];
  const context = inboxContext(jobs);
  const item = vm.runInContext('_videoSubmissionReviewItems()[0]', context);
  assert.equal(item.evidenceUrl, 'https://example.com/current-job-link');
  assert.equal(item.submittedAt, 999);
});

test('malformed or missing evidence stays visible without creating a clickable URL', () => {
  const jobs = [{ id: 'missing', _portalUid: 'editor', status: '初稿提出済み', workflow: { stage: 'director_review', round: 1 }, title: 'リンク不足', evidenceUrl: 'javascript:alert(1)', updatedAt: 10 }];
  const context = inboxContext(jobs);
  const item = vm.runInContext('_videoSubmissionReviewItems()[0]', context);
  assert.equal(item.id, 'missing');
  assert.equal(item.evidenceUrl, '');
});

test('client submission text is a paste-ready message built from the draft kind, title, and link', () => {
  // 編集者から初稿が届いたら、そのまま先方へ貼り付けて送れる文面をコピーできる。
  const context = inboxContext([]);
  vm.runInContext(functionSource('_videoClientSubmissionText'), context);
  const text = vm.runInContext(
    `_videoClientSubmissionText({kind:'初稿',title:'17若く見える人と老けて見える人の決定的な違いってありますか？.mp4',evidenceUrl:'https://drive.google.com/file/d/1Lm4ySITeOnQ3AcblbKE6VGs62EjyGjn5/view?usp=sharing'})`,
    context,
  );
  assert.equal(text, [
    '【初稿提出】',
    'お世話になっております！',
    '下記動画の初稿を提出いたします。',
    'ご確認のほど、よろしくお願いいたします。',
    '',
    '【17若く見える人と老けて見える人の決定的な違いってありますか？.mp4】',
    '--------------------------------------------',
    '◇ドライブリンク',
    'https://drive.google.com/file/d/1Lm4ySITeOnQ3AcblbKE6VGs62EjyGjn5/view?usp=sharing',
  ].join('\n'));
  const revision = vm.runInContext(`_videoClientSubmissionText({kind:'修正稿',title:'案件A',evidenceUrl:'https://example.com/r2'})`, context);
  assert.match(revision, /^【修正稿提出】\n/);
  assert.match(revision, /下記動画の修正稿を提出いたします。/);
  // 提出リンクが無い・危険なスキームなら文面を作らない。
  assert.equal(vm.runInContext(`_videoClientSubmissionText({kind:'初稿',title:'x',evidenceUrl:''})`, context), '');
  assert.equal(vm.runInContext(`_videoClientSubmissionText({kind:'初稿',title:'x',evidenceUrl:'javascript:alert(1)'})`, context), '');
});

test('the copy button appears only next to a registered submission link and never writes to Firestore', () => {
  const source = functionSource('rVideoSubmissions');
  assert.match(source, /copyVideoClientSubmissionText\(\$\{JSON\.stringify\(item\.portalUid\)\},\$\{JSON\.stringify\(item\.id\)\}\)/);
  assert.match(source, /先方提出文をコピー/);
  // ボタンは提出リンクがある分岐（`item.evidenceUrl?`）の中だけに出る。
  const branch = source.slice(source.indexOf('${item.evidenceUrl?`'), source.indexOf('提出リンク未登録'));
  assert.match(branch, /先方提出文をコピー/);
  const copy = functionSource('copyVideoClientSubmissionText');
  assert.match(copy, /if\(!_videoCanEdit\(\)\)return;/);
  assert.match(copy, /_videoSubmissionReviewItems\(\)\.find\(/);
  assert.match(copy, /navigator\.clipboard\.writeText\(txt\)/);
  assert.doesNotMatch(copy, /onSnapshot|fbDb|batch\.|\.set\(|\.update\(|\.add\(|save\(\)/);
});

test('submission cards surface the project-management and Framer links recorded on the submission event', () => {
  const jobs = [{
    id: 'links', _portalUid: 'editor', status: '初稿提出済み', workflow: { stage: 'director_review', round: 1 }, title: 'リンク付き', updatedAt: 10,
    progressEvents: [{ type: 'editor_submitted', status: '初稿提出済み', round: 1, at: 10, evidenceUrl: 'https://example.com/draft', pmUrl: 'https://pm.example.com/case', framerUrl: 'javascript:alert(1)' }],
  }];
  const item = vm.runInContext('_videoSubmissionReviewItems()[0]', inboxContext(jobs));
  assert.equal(item.pmUrl, 'https://pm.example.com/case');
  assert.equal(item.framerUrl, '', 'unsafe Framer link is dropped');
  const source = functionSource('rVideoSubmissions');
  assert.match(source, /\$\{item\.pmUrl\?`<a class="btn btn-g btn-sm" href="\$\{esc\(item\.pmUrl\)\}" target="_blank" rel="noopener noreferrer">プロマネリンク<\/a>`:'<span class="video-submission-missing">プロマネリンク未登録<\/span>'\}/);
  assert.match(source, /\$\{item\.framerUrl\?`<a class="btn btn-g btn-sm" href="\$\{esc\(item\.framerUrl\)\}" target="_blank" rel="noopener noreferrer">Framer<\/a>`:''\}/);
});

test('page reuses existing portal memory and review modal without its own writes or listeners', () => {
  const source = functionSource('rVideoSubmissions');
  assert.match(source, /_videoSubmissionReviewItems\(\)/);
  assert.match(source, /openPortalJobModal/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
  assert.match(source, /提出リンク未登録/);
  assert.doesNotMatch(source, /onSnapshot|fbDb|batch\.|\.set\(|\.update\(|\.add\(/);
  assert.doesNotMatch(source, /ownPay|clientUnitPrice|profit|editorPayAmount/);
});

test('navigation exposes submission review to owner and scoped video directors only', () => {
  assert.match(html, /\{id:'videosubmissions',label:'提出確認'/);
  assert.match(html, /'動画編集ディレクター':\[[^\]]*'videosubmissions'/);
  assert.match(html, /videosubmissions:rVideoSubmissions/);
  assert.match(html, /GUIDE_PAGE_GROUPS=[\s\S]*'videosubmissions'/);
  assert.doesNotMatch(html, /'AIコンサルタント':\[[^\]]*'videosubmissions'/);
});
