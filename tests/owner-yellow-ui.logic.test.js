const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '..', 'owner-yellow-ui.css'), 'utf8');

test('yellow owner theme defines an ink and yellow visual system without purple primary tokens', () => {
  assert.match(css, /--owner-yellow:#ffc800/);
  assert.match(css, /--owner-ink:#1d1d1f/);
  assert.match(css, /--app-primary:var\(--owner-yellow-strong\)/);
  const authoredValues = css.replace(/style\*="#(?:6d28d9|7c3aed|5b21b6|faf5ff|ede9fe)"/gi, 'legacy-selector');
  assert.doesNotMatch(authoredValues, /#(?:4f46e5|6d28d9|7c3aed|3730a3)/i);
});

test('theme covers desktop navigation, shared workspace surfaces, and financial pages', () => {
  for (const selector of [
    '#sidebar', '.nav-item.active', '.app-header', '.app-view-tabs', '.app-kanban-column',
    '.app-attention-card', '.app-metric', '.profit-group-card', '.payment-row', '.modal',
    '.video-subcase-row', '.month-grid',
  ]) assert.ok(css.includes(selector), selector);
  assert.match(css, /\.btn-p,\.btn\.primary\{background:var\(--owner-yellow\)!important/);
  assert.match(css, /\.modal-hdr,\.mhdr\{background:#fff;color:var\(--owner-ink\);border-bottom:3px solid var\(--owner-yellow\)/);
});

test('reference-style owner shell is white and uses yellow only as an accent', () => {
  assert.match(css, /#sidebar\{width:264px[^}]*background:#fff/);
  assert.match(css, /body::before\{display:none\}/);
  assert.match(css, /\.btn-p,\.btn\.primary\{background:var\(--owner-yellow\)!important/);
  assert.match(css, /\.app-brand-logo\{display:block;width:min\(166px,100%\)/);
});

test('mobile drawer and bottom navigation remain bounded at narrow widths', () => {
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /#mob-drawer\{width:min\(292px,84vw\)/);
  assert.match(css, /#main\{padding:calc\(env\(safe-area-inset-top\) \+ 58px\) 14px calc\(env\(safe-area-inset-bottom\) \+ 84px\);max-width:100%;overflow-x:hidden\}/);
  assert.match(css, /\.video-deadline-alert\{max-width:100%;min-width:0;white-space:normal;overflow-wrap:anywhere\}/);
});

test('theme retains visible keyboard focus and respects reduced motion', () => {
  assert.match(css, /button:focus-visible,input:focus-visible/);
  assert.match(css, /outline-color:var\(--owner-yellow-strong\)!important/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test('late manager feature styles are forcefully brought into the yellow owner system', () => {
  assert.match(css, /\.manager-state-guidance\{[\s\S]*?border-left:3px solid var\(--owner-yellow-strong\)!important/);
  assert.match(css, /\.manager-state-guidance b\{color:var\(--owner-ink\)!important\}/);
  for (const selector of [
    '.manager-relation-row', '.manager-operation-disclosure', '#manager-board-publish',
    '.manager-board-subcase-scroll', '.manager-board-subcase', '.manager-account-row',
  ]) assert.ok(css.includes(selector), selector);
});

test('real project, client, profit and payment DOM has the rectangular business treatment', () => {
  for (const selector of [
    '.board-wrap', '.board-col', '.board-col-hdr', '.proj-card', '.client-card', '.client-hdr',
    '.rev-tab.act', '.profit-group-card', '.profit-group-head', '.profit-row', '.payment-row',
    '.video-progress-stage.active',
  ]) assert.ok(css.includes(selector), selector);
  assert.match(css, /\.board-col-hdr\{[^}]*border-radius:8px!important/);
  assert.match(css, /\.rev-tab\.act\{background:var\(--owner-yellow-soft\)!important;color:var\(--owner-ink\)!important/);
});

test('retired inline purple literals are neutralised and never authored as theme values', () => {
  for (const retired of ['#7c3aed', '#6d28d9', '#5b21b6', '#faf5ff', '#ede9fe']) {
    assert.match(css, new RegExp(`style\\*="${retired.replace('#', '\\#')}"`));
  }
  const declarations = css.replace(/body \[style\*[\s\S]*?\{[\s\S]*?\}/g, '');
  assert.doesNotMatch(declarations, /#(?:7c3aed|6d28d9|5b21b6|faf5ff|ede9fe)/i);
});

test('375 and 390 pixel owner pages do not retain desktop minimum widths', () => {
  assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.board-wrap\{display:grid;grid-template-columns:minmax\(0,1fr\);width:100%;min-width:0;max-width:100%;overflow-x:hidden/);
  assert.match(css, /\.board-col\{width:100%;min-width:0;max-width:none\}/);
  assert.match(css, /@media\(max-width:390px\)/);
  assert.match(css, /#main,#video-workspace,\.board-wrap,\.board-col,\.client-card,\.profit-group-list,\.profit-group-card,\.manager-operation-body,\.manager-board-subcase-scroll\{width:100%;min-width:0;max-width:100%;overflow-x:hidden\}/);
});

test('reference global navigation is icon-led, briefly labelled, and keeps large mobile targets', () => {
  assert.match(css, /\.ref-global-tabs\{position:relative;z-index:30;display:flex;justify-content:center;max-width:100%;overflow:visible/);
  assert.match(css, /\.ref-primary-tabs>button,\.ref-more-tabs>summary\{[^}]*flex:0 0 64px[^}]*min-height:56px/);
  assert.match(css, /\.ref-global-tabs svg\{display:block;width:24px;height:24px/);
  assert.match(css, /button\[data-tooltip\]:hover::after,\.ref-primary-tabs>button\[data-tooltip\]:focus-visible::after/);
  assert.match(css, /\.ref-more-tabs-menu\{[^}]*grid-template-columns:repeat\(2,minmax\(130px,1fr\)\)/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.ref-owner-page\{margin:0 0 78px\}/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.ref-topbar-module\{min-width:44px;min-height:44px/);
  assert.match(css, /\.ref-topbar-module select\{[^}]*appearance:none/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*?\.ref-topbar-module select\{position:absolute;inset:0;[^}]*opacity:0/);
  assert.match(css, /\.ref-primary-tabs>button,\.ref-more-tabs>summary\{flex-basis:52px;width:52px;min-width:52px;min-height:54px\}/);
});
