const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const editor = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');

function functionSource(name) {
  const start = editor.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be defined`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < editor.length; i += 1) {
    if (editor[i] === '{') { depth += 1; opened = true; }
    if (editor[i] === '}' && opened && --depth === 0) return editor.slice(start, i + 1);
  }
  assert.fail(`${name} must have a complete function body`);
}

test('embedded WebView users receive a browser-opening guide and a copyable portal URL', () => {
  const source = functionSource('isEmbeddedAuthBrowser');
  for (const signal of ['chatwork', 'line', 'wv', 'webview']) {
    assert.match(source.toLowerCase(), new RegExp(signal), `embedded browser signal ${signal} is checked`);
  }
  assert.match(source, /standalone/, 'an installed iPhone PWA is checked separately from embedded iOS WebViews');
  assert.match(functionSource('isStandalonePortal'), /standalone|display-mode/i, 'iOS PWA mode is checked separately from an in-app browser');
  assert.match(editor, /外部ブラウザ(?:\(|（)?Safari|Chrome|Safari\/Chrome/);
  assert.match(editor, /URLをコピー|リンクをコピー|アドレスをコピー/);
  assert.match(editor, /navigator\.clipboard\.writeText|execCommand\('copy'\)/);
  assert.match(editor, /isEmbeddedAuthBrowser\(\)/);
});

test('Google sign-in prevents double activation and announces the busy state accessibly', () => {
  const login = functionSource('googleLogin');
  assert.match(login, /inFlight|loginInFlight|authInFlight/, 'an in-flight guard is required');
  assert.match(login, /return/, 'a second activation exits before opening another popup');
  assert.match(login, /disabled\s*=\s*true/);
  assert.match(login, /aria-busy/);
  assert.match(login, /finally/);
  assert.match(login, /disabled\s*=\s*false/);
});

test('authentication failures are classified into plain-language recovery messages', () => {
  const source = functionSource('authErrorMessage');
  for (const code of [
    'auth/popup-closed-by-user',
    'auth/popup-blocked',
    'auth/operation-not-supported-in-this-environment',
    'auth/network-request-failed',
    'auth/unauthorized-domain',
    'auth/too-many-requests',
    'timeout',
  ]) assert.match(source, new RegExp(code.replace(/[/.]/g, '\\$&')));
  for (const phrase of ['閉じ', 'ポップアップ', '通信', '許可', '時間']) {
    assert.match(source, new RegExp(phrase), `recovery wording includes ${phrase}`);
  }
  assert.match(functionSource('googleLogin'), /authErrorMessage\(/);
});

test('authErrorMessage returns a distinct recoverable state for every supported failure code', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functionSource('authErrorMessage')}\nthis.authErrorMessage = authErrorMessage;`, context);
  const cases = [
    ['auth/popup-closed-by-user', 'warn', /閉じ/],
    ['auth/popup-blocked', 'warn', /ポップアップ/],
    ['auth/operation-not-supported-in-this-environment', 'warn', /Safari|Chrome/],
    ['auth/network-request-failed', 'danger', /通信/],
    ['auth/unauthorized-domain', 'danger', /許可/],
    ['auth/too-many-requests', 'warn', /時間/],
    ['auth/timeout', 'warn', /時間/],
  ];
  for (const [code, kind, wording] of cases) {
    const result = context.authErrorMessage({ code });
    assert.equal(result.kind, kind, code);
    assert.match(result.message, wording, code);
  }
});

test('isEmbeddedAuthBrowser recognises in-app iOS contexts without rejecting regular browsers', () => {
  const source = functionSource('isEmbeddedAuthBrowser');
  const check = (userAgent, standalone = false) => {
    const context = { navigator: { userAgent, standalone }, window: { navigator: { standalone } } };
    vm.createContext(context);
    vm.runInContext(`${source}\nthis.check = isEmbeddedAuthBrowser;`, context);
    return context.check();
  };
  assert.equal(check('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Chatwork/1.0 Mobile'), true);
  assert.equal(check('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Line/13.1.0 Mobile'), true);
  assert.equal(check('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'), true);
  assert.equal(check('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', true), false);
  assert.equal(check('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1'), false);
  assert.equal(check('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'), false);
});

test('normal iPhone Safari and installed PWA can use sign-in, while embedded views cannot start OAuth', () => {
  const login = functionSource('googleLogin');
  assert.match(login, /isEmbeddedAuthBrowser\(\)/);
  assert.match(login, /signInWithPopup/);
  assert.match(login, /signInWithRedirect/);
  assert.match(login, /canUseRedirectAuth\(\)/);
  const screen = functionSource('loginScreen');
  assert.match(screen, /isStandalonePortal\(\)/);
  assert.match(screen, /isMobilePortal\(\)/);
  assert.match(screen, /googleLogin\('redirect'\)/);
});

test('mobile browser guidance opens the same-origin Firebase login page for reliable redirect auth', () => {
  assert.match(editor, /https:\/\/editflow-mono-create\.firebaseapp\.com\/editor\.html/);
  const portalUrl = functionSource('portalLoginUrl');
  assert.match(portalUrl, /PORTAL_AUTH_URL/);
  assert.match(portalUrl, /canUseRedirectAuth\(\)/);
  assert.match(functionSource('authBrowserHelpHtml'), /portalLoginUrl\(\)/);
});

test('withAuthTimeout resolves, rejects, and releases a short timeout without leaving a hanging promise', async () => {
  const context = { Promise, setTimeout, clearTimeout, Error };
  vm.createContext(context);
  vm.runInContext(`${functionSource('withAuthTimeout')}\nthis.withAuthTimeout = withAuthTimeout;`, context);
  await assert.doesNotReject(() => context.withAuthTimeout(Promise.resolve('ok'), 25));
  await assert.rejects(() => context.withAuthTimeout(Promise.reject(new Error('network')), 25), /network/);
  await assert.rejects(() => context.withAuthTimeout(new Promise(() => {}), 5), error => error?.code === 'auth/timeout');
});

test('Firebase bootstrap is recoverable and auth state has a 15-second watchdog with reload guidance', () => {
  const init = functionSource('initializePortalFirebase');
  assert.match(init, /try\s*\{/);
  assert.match(init, /catch\s*\(/);
  assert.match(init, /firebase\.initializeApp/);
  assert.match(init, /onAuthStateChanged/);
  assert.match(init, /15\s*\*\s*1000|15000/);
  assert.match(init, /renderAuthRecovery\(/);
  const recovery = functionSource('renderAuthRecovery');
  assert.match(recovery, /再読み込み|もう一度/);
  assert.match(editor, /auth-retry/);
  assert.match(editor, /onclick="location\.reload\(\)"/);
});

test('logout retains the existing session when sign-out fails', () => {
  const logout = functionSource('logout');
  assert.match(logout, /try\s*\{[\s\S]*?auth\.signOut\(\)/);
  assert.match(logout, /catch\s*\([\s\S]*?(toast|renderAuthRecovery)/);
  const failurePath = logout.slice(logout.indexOf('catch'));
  assert.doesNotMatch(failurePath, /location\.href\s*=|location\.reload\(/, 'a failed logout must not force a local logged-out screen');
});

test('the sign-in and bootstrap paths do not write to Firestore', () => {
  const authPaths = [
    functionSource('googleLogin'),
    functionSource('initializePortalFirebase'),
    functionSource('renderAuthRecovery'),
  ].join('\n');
  assert.doesNotMatch(authPaths, /\.set\(|\.update\(|\.add\(|\.delete\(|\.batch\(|\.runTransaction\(/);
});
