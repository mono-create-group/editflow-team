// 会長だけログインできる状態（firestore.rules の OWNER LOCK）の検査。
//
//  1. ロックを外したルールでは、承認済みスタッフ・編集者・互換スタッフが元どおり読める（検査用の材料が有効なことの証明）
//  2. ロックを入れたルールでは、会長以外（承認済みの全役割・互換スタッフ・未承認・未サインイン・
//     メール未確認の会長アドレス）が、ルール内の全ての match の get/list/create/update/delete を拒否される
//     （例外は元から全員に公開されている sales_candidates の読み取りだけ）
//  3. 会長（2つのアドレス）は、ロック中も主要な読み書きができる
//
// 全ての match は firestore.rules を読んで自動で列挙する。新しい match を足しても、この検査が自動で対象にする。
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, collectionGroup, getDocs,
} = require('firebase/firestore');
const { applyRules, rulesState } = require('../scripts/owner-lock.cjs');

const root = path.resolve(__dirname, '..');
const rulesText = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const projectId = 'demo-editflow-owner-lock';
const claims = (email, verified = true) => ({ email, email_verified: verified });

const OWNER_EMAILS = ['nakamurakouta512@gmail.com', 'mono.create.group@gmail.com'];
// 元から全員に読み取りが公開されているコレクション（ログインとは無関係・ルールに `allow get, list: if true`）。
const PUBLIC_READ = new Set(['sales_candidates']);

if (rulesState(rulesText) !== 'on') {
  console.error('FAILED: firestore.rules is not locked. Run `node scripts/owner-lock.cjs on` before this test.');
  process.exit(1);
}

// ---- firestore.rules から match を全部列挙する（インデントで入れ子を判定） ----
function listTemplates(text) {
  const stack = [];
  const templates = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^(\s*)match (\/\S+) \{/);
    if (!match) continue;
    const indent = match[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const base = stack.length ? stack[stack.length - 1].path : '';
    if (match[2].startsWith('/databases/')) { stack.push({ indent, path: '' }); continue; }
    const full = base + match[2];
    stack.push({ indent, path: full });
    templates.push(full);
  }
  return templates;
}

function fill(template) {
  const segments = template.split('/').filter(Boolean).flatMap((segment) => {
    const wildcard = segment.match(/^\{(\w+)=\*\*\}$/);
    if (wildcard) return wildcard[1] === 'document' ? ['mcapp'] : ['editor_portals', 'direct1'];
    const variable = segment.match(/^\{(\w+)\}$/);
    if (variable) return [variable[1] === 'uid' ? 'direct1' : 'x1'];
    return [segment];
  });
  return segments;
}

const docPaths = [];
for (const template of listTemplates(rulesText)) {
  const segments = fill(template);
  if (segments.length % 2 !== 0) continue; // コレクション側の match は文書パスにならない
  const docPath = segments.join('/');
  if (!docPaths.includes(docPath)) docPaths.push(docPath);
}
// shared/{document=**} は深い階層の文書も対象
docPaths.push('shared/mcapp/sub/deep1');

const collectionOf = (docPath) => docPath.split('/').slice(0, -1).join('/');
const newSiblingOf = (docPath) => `${collectionOf(docPath)}/${docPath.split('/').pop()}-new`;
const topCollection = (docPath) => docPath.split('/')[0];

const results = { pass: 0, failures: [] };
function record(ok, label) {
  if (ok) results.pass += 1;
  else results.failures.push(label);
}
async function expectDeny(label, promise) {
  try { await assertFails(promise); record(true, label); } catch (_) { record(false, `許可されてしまった: ${label}`); }
}
async function expectAllow(label, promise) {
  try { await assertSucceeds(promise); record(true, label); } catch (e) { record(false, `拒否された: ${label} (${String(e.message || e).slice(0, 90)})`); }
}

(async () => {
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: rulesText } });
  try {
    // ---- 材料（ルールを外して投入） ----
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const access = [
        ['direct1', { uid: 'direct1', email: 'direct1@example.com', approved: true, roles: ['動画編集者'], editorKind: 'direct', workerId: 'worker-direct1' }],
        ['external1', { uid: 'external1', email: 'external1@example.com', approved: true, roles: ['動画編集者'], editorKind: 'external', directorUid: 'dir1', workerId: 'worker-external1' }],
        ['hybrid1', { uid: 'hybrid1', email: 'hybrid1@example.com', approved: true, roles: ['動画編集者', 'Webデザイナー'], editorKind: 'direct' }],
        ['sales1', { uid: 'sales1', email: 'sales1@example.com', approved: true, roles: ['営業'], editorKind: 'direct' }],
        ['dir1', { uid: 'dir1', email: 'dir1@example.com', approved: true, roles: ['動画編集ディレクター'], workerId: 'worker-dir1' }],
      ];
      for (const [uid, data] of access) await setDoc(doc(db, 'access', uid), data);
      // 互換期間（enforced:false）: 名簿にあるメールのスタッフは、承認記録が無くても旧アプリを使えていた
      await setDoc(doc(db, 'system', 'access_control'), { enforced: false, phase: 'compatibility', compatibilityEmails: ['compat1@example.com'] });
      for (const docPath of docPaths) {
        await setDoc(doc(db, docPath), { seed: true, uid: 'direct1', editorUid: 'direct1', title: '材料', status: '進行中' });
      }
    });

    // ---- 1. ロックを外したルールでは、非オーナーが元どおり読める（材料が有効な証明） ----
    const unlockedEnv = await initializeTestEnvironment({ projectId: `${projectId}-off`, firestore: { rules: applyRules(rulesText, 'off') } });
    try {
      await unlockedEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'access', 'direct1'), { uid: 'direct1', email: 'direct1@example.com', approved: true, roles: ['動画編集者'], editorKind: 'direct' });
        await setDoc(doc(db, 'access', 'sales1'), { uid: 'sales1', email: 'sales1@example.com', approved: true, roles: ['営業'], editorKind: 'direct' });
        await setDoc(doc(db, 'system', 'access_control'), { enforced: false, phase: 'compatibility', compatibilityEmails: ['compat1@example.com'] });
        await setDoc(doc(db, 'shared', 'mcapp'), { seed: true });
      });
      const off = (uid, email) => unlockedEnv.authenticatedContext(uid, claims(email)).firestore();
      await expectAllow('[ロックなし] 承認済みの編集者は自分の access を読める', getDoc(doc(off('direct1', 'direct1@example.com'), 'access', 'direct1')));
      await expectAllow('[ロックなし] 承認済みの営業スタッフは shared/mcapp を読める', getDoc(doc(off('sales1', 'sales1@example.com'), 'shared', 'mcapp')));
      await expectAllow('[ロックなし] 互換期間の名簿スタッフは shared/mcapp を読める', getDoc(doc(off('compat1', 'compat1@example.com'), 'shared', 'mcapp')));
    } finally {
      await unlockedEnv.cleanup();
    }

    // ---- 2. ロック中は、会長以外は全ての match で全操作が拒否される ----
    const identities = {
      '未サインイン': () => env.unauthenticatedContext().firestore(),
      '未承認の他人': () => env.authenticatedContext('unknown1', claims('unknown1@example.com')).firestore(),
      '承認済みの直接編集者': () => env.authenticatedContext('direct1', claims('direct1@example.com')).firestore(),
      '承認済みの外部編集者': () => env.authenticatedContext('external1', claims('external1@example.com')).firestore(),
      '承認済みの兼務（編集者+Web）': () => env.authenticatedContext('hybrid1', claims('hybrid1@example.com')).firestore(),
      '承認済みの営業スタッフ': () => env.authenticatedContext('sales1', claims('sales1@example.com')).firestore(),
      '承認済みのディレクター': () => env.authenticatedContext('dir1', claims('dir1@example.com')).firestore(),
      '互換期間の名簿スタッフ': () => env.authenticatedContext('compat1', claims('compat1@example.com')).firestore(),
      'メール未確認の会長アドレス': () => env.authenticatedContext('spoof1', claims(OWNER_EMAILS[0], false)).firestore(),
      '会長に似たアドレス': () => env.authenticatedContext('spoof2', claims(`${OWNER_EMAILS[0]}.evil`)).firestore(),
    };
    for (const [who, makeDb] of Object.entries(identities)) {
      const db = makeDb();
      for (const docPath of docPaths) {
        const isPublic = PUBLIC_READ.has(topCollection(docPath));
        const label = (op) => `[ロック中/${who}] ${op} ${docPath}`;
        if (isPublic) {
          await expectAllow(label('get(公開)'), getDoc(doc(db, docPath)));
          await expectAllow(label('list(公開)'), getDocs(collection(db, collectionOf(docPath))));
        } else {
          await expectDeny(label('get'), getDoc(doc(db, docPath)));
          await expectDeny(label('list'), getDocs(collection(db, collectionOf(docPath))));
        }
        await expectDeny(label('create'), setDoc(doc(db, newSiblingOf(docPath)), { title: '新規', uid: 'direct1', status: '進行中' }));
        await expectDeny(label('update'), updateDoc(doc(db, docPath), { title: '改竄' }));
        await expectDeny(label('delete'), deleteDoc(doc(db, docPath)));
      }
      for (const group of ['editor_jobs', 'editor_invoices', 'editor_profile', 'invoice_authorizations']) {
        await expectDeny(`[ロック中/${who}] collectionGroup ${group}`, getDocs(collectionGroup(db, group)));
      }
      // アクセス申請（通知の出どころ）を、どの経路でも作れないこと
      await expectDeny(`[ロック中/${who}] 自分名義のアクセス申請を作成`, setDoc(doc(db, 'accessRequests', 'direct1'), {
        uid: 'direct1', email: 'direct1@example.com', name: '申請者', status: 'pending',
      }));
    }

    // ---- 2b. 比較: 同じ操作をロックなしで流すと、非オーナーの何件かが許可される ----
    // （許可が0件なら、この検査は何も試していない。ロックがこの許可を全て閉じていることの証拠になる）
    const differentialEnv = await initializeTestEnvironment({ projectId: `${projectId}-diff`, firestore: { rules: applyRules(rulesText, 'off') } });
    let openedWithoutLock = 0;
    try {
      await differentialEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        for (const uid of ['direct1', 'external1', 'hybrid1', 'sales1', 'dir1']) {
          const roles = { direct1: ['動画編集者'], external1: ['動画編集者'], hybrid1: ['動画編集者', 'Webデザイナー'], sales1: ['営業'], dir1: ['動画編集ディレクター'] }[uid];
          await setDoc(doc(db, 'access', uid), { uid, email: `${uid}@example.com`, approved: true, roles, editorKind: uid === 'external1' ? 'external' : 'direct', directorUid: uid === 'external1' ? 'dir1' : '' });
        }
        await setDoc(doc(db, 'system', 'access_control'), { enforced: false, phase: 'compatibility', compatibilityEmails: ['compat1@example.com'] });
        for (const docPath of docPaths) await setDoc(doc(db, docPath), { seed: true, uid: 'direct1', editorUid: 'direct1', title: '材料', status: '進行中' });
      });
      for (const [uid, email] of [['direct1', 'direct1@example.com'], ['external1', 'external1@example.com'], ['sales1', 'sales1@example.com'], ['dir1', 'dir1@example.com'], ['compat1', 'compat1@example.com'], ['unknown1', 'unknown1@example.com']]) {
        const db = differentialEnv.authenticatedContext(uid, claims(email)).firestore();
        for (const docPath of docPaths) {
          if (PUBLIC_READ.has(topCollection(docPath))) continue;
          for (const operation of [() => getDoc(doc(db, docPath)), () => getDocs(collection(db, collectionOf(docPath)))]) {
            try { await assertSucceeds(operation()); openedWithoutLock += 1; } catch (_) { /* 元から拒否 */ }
          }
        }
      }
    } finally {
      await differentialEnv.cleanup();
    }
    console.log(`ロックなしなら非オーナーが読める操作: ${openedWithoutLock} 件（ロック中は 0 件）`);
    record(openedWithoutLock >= 20, `比較の材料が足りない（ロックなしで許可が ${openedWithoutLock} 件しかない）`);

    // ---- 3. 会長は、ロック中も主要な読み書きができる ----
    for (const email of OWNER_EMAILS) {
      const db = env.authenticatedContext('owner1', claims(email)).firestore();
      const who = `会長(${email})`;
      await expectAllow(`[ロック中/${who}] shared/mcapp を読む`, getDoc(doc(db, 'shared', 'mcapp')));
      await expectAllow(`[ロック中/${who}] shared/mcapp を更新`, updateDoc(doc(db, 'shared', 'mcapp'), { ownerCheck: email }));
      await expectAllow(`[ロック中/${who}] access 一覧を読む`, getDocs(collection(db, 'access')));
      await expectAllow(`[ロック中/${who}] access/direct1 を読む`, getDoc(doc(db, 'access', 'direct1')));
      await expectAllow(`[ロック中/${who}] system/access_control を読む`, getDoc(doc(db, 'system', 'access_control')));
      await expectAllow(`[ロック中/${who}] 編集者の案件を読む`, getDoc(doc(db, 'editor_portals', 'direct1', 'editor_jobs', 'x1')));
      await expectAllow(`[ロック中/${who}] 売上の台帳を読む`, getDoc(doc(db, 'owner_job_finance', 'x1')));
      await expectAllow(`[ロック中/${who}] users/owner1 を書く`, setDoc(doc(db, 'users', 'owner1'), { json_mcapp: '{}' }));
      await expectAllow(`[ロック中/${who}] アクセス申請を読む`, getDoc(doc(db, 'accessRequests', 'x1')));
    }
  } finally {
    await env.cleanup();
  }

  console.log(`PASS ${results.pass} checks, FAIL ${results.failures.length}`);
  console.log(`covered ${docPaths.length} document paths x 10 identities`);
  if (results.failures.length) {
    for (const failure of results.failures.slice(0, 40)) console.error(`FAIL ${failure}`);
    if (results.failures.length > 40) console.error(`... and ${results.failures.length - 40} more`);
    process.exit(1);
  }
})().catch((error) => { console.error(error); process.exit(1); });
