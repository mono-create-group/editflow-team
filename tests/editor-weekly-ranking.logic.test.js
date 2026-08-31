const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const features=fs.readFileSync(path.resolve(__dirname,'..','editor-features.js'),'utf8');

test('weekly ranking is an on-demand current Monday JST reader',()=>{
  assert.match(features,/function currentJstMonday\(\)/);
  assert.match(features,/timeZone:'Asia\/Tokyo'/);
  assert.match(features,/view==='ranking'/);
  assert.match(features,/db\.collection\('editor_weekly_rankings'\)\.doc\(week\)\.onSnapshot/);
  assert.match(features,/function stopWeeklyRankingSubscription\(\)/);
  assert.match(features,/stopWeeklyRankingSubscription\(\);feature\.weeklyRanking=null/);
  assert.match(features,/window\.EditflowFirestoreQuota\?\.isOpen\?\.\(\)/);
});

test('ranking keeps only public aggregate fields and marks the signed-in editor',()=>{
  assert.match(features,/function sanitizedWeeklyRankingRows\(data\)/);
  for(const field of ['editorUid','editorName','rank','delivered','onTimeRate','averageQuality','qualityEvaluationRate','qualityEvaluationCount','score'])assert.match(features,new RegExp(field));
  assert.doesNotMatch(features.slice(features.indexOf('function sanitizedWeeklyRankingRows'),features.indexOf('function weeklyRankingRate')),/qualityNote|note|amount|pay/);
  assert.match(features,/row\.editorUid===portalUid\(\)\?' <span class="pill green">あなた<\/span>'/);
  assert.match(features,/納品 \$\{row\.delivered\}本/);
  assert.match(features,/納期遵守 \$\{weeklyRankingRate\(row\.onTimeRate\)\}/);
  assert.match(features,/品質平均/);
  assert.match(features,/評価母数/);
  assert.match(features,/品質評価率 .*参考/);
});

test('ranking is present in the editor navigation and render route',()=>{
  assert.match(features,/\['ranking','編集者ランキング'\]/);
  assert.match(features,/view==='ranking'\)body=weeklyRankingHtml\(\)/);
});
