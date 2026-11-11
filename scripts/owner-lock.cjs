#!/usr/bin/env node
'use strict';
// 会長だけログインできる状態（2026-11-11 会長指示）の ON/OFF と状態確認。
//
//   node scripts/owner-lock.cjs status   現在の状態を表示
//   node scripts/owner-lock.cjs on       会長以外を全員ロックアウト（firestore.rules / index.html / editor.html）
//   node scripts/owner-lock.cjs off      ロックを解除し、元の権限に戻す
//
// このスクリプトはファイルを書き換えるだけ。反映には、Firestore ルールのデプロイと
// 静的ファイルの公開（git push）が別に必要。access/ や accessRequests/ の記録は触らない。
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const BEGIN = '// BEGIN OWNER LOCK';
const END = '// END OWNER LOCK';
const REGION = new RegExp(`( *)${BEGIN}[\\s\\S]*?${END}`);

const OWNER_EMAILS = ["'nakamurakouta512@gmail.com'", "'mono.create.group@gmail.com'"];

const LOCKED = `    ${BEGIN}
    // ===== 会長だけログインできる状態（2026-11-11 会長指示） =====
    // 会長のアカウント（ownerEmail）以外は、サインインしていても Firestore を一切
    // 読み書きできない（承認済みのスタッフ・編集者・ディレクターも含む）。
    // 他の関数はすべて signedIn() を通して「誰か」を判定するので、ここで止めれば
    // 会長以外の経路（self・editor・coreStaff・approved・hasRole など）がまとめて閉じる。
    // access/ や accessRequests/ などの記録は消していない。
    // 解除: node scripts/owner-lock.cjs off → ルールをデプロイ（OPERATIONS.md 参照）
    function ownerEmail() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email in [
          ${OWNER_EMAILS[0]},
          ${OWNER_EMAILS[1]}
        ];
    }

    function signedIn() {
      return ownerEmail();
    }

    function owner() {
      return ownerEmail();
    }
    ${END}`;

const UNLOCKED = `    ${BEGIN}
    // 会長だけログインできる状態は解除中（元の権限）。有効にする: node scripts/owner-lock.cjs on
    function signedIn() {
      return request.auth != null;
    }

    function owner() {
      return signedIn()
        && request.auth.token.email_verified == true
        && request.auth.token.email in [
          ${OWNER_EMAILS[0]},
          ${OWNER_EMAILS[1]}
        ];
    }
    ${END}`;

function rulesState(text) {
  const match = text.match(REGION);
  if (!match) throw new Error('firestore.rules に OWNER LOCK の区間がありません');
  return match[0].includes('function ownerEmail()') ? 'on' : 'off';
}
function applyRules(text, mode) {
  rulesState(text);
  return text.replace(REGION, () => (mode === 'on' ? LOCKED : UNLOCKED));
}

// アプリ側（index.html / editor.html）のスイッチ。`const OWNER_ONLY_LOCK=true;` の true/false を入れ替える。
const FLAG = /(const OWNER_ONLY_LOCK=)(true|false)(;)/;
function flagState(text) {
  const match = text.match(FLAG);
  if (!match) throw new Error('OWNER_ONLY_LOCK のスイッチがありません');
  return match[2] === 'true' ? 'on' : 'off';
}
function applyFlag(text, mode) {
  flagState(text);
  return text.replace(FLAG, (all, a, b, c) => `${a}${mode === 'on' ? 'true' : 'false'}${c}`);
}

const FILES = [
  ['firestore.rules', rulesState, applyRules],
  ['index.html', flagState, applyFlag],
  ['editor.html', flagState, applyFlag],
];

function main(argv) {
  const mode = argv[0] || 'status';
  if (!['status', 'on', 'off'].includes(mode)) {
    console.error('usage: node scripts/owner-lock.cjs [status|on|off]');
    return 2;
  }
  for (const [name, state, apply] of FILES) {
    const file = path.join(root, name);
    const text = fs.readFileSync(file, 'utf8');
    if (mode !== 'status') {
      const next = apply(text, mode);
      if (next !== text) fs.writeFileSync(file, next, 'utf8');
    }
    console.log(`${name}: ${state(fs.readFileSync(file, 'utf8'))}`);
  }
  return 0;
}

module.exports = { LOCKED, UNLOCKED, applyRules, rulesState, applyFlag, flagState, OWNER_EMAILS };
if (require.main === module) process.exit(main(process.argv.slice(2)));
