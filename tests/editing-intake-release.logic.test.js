const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('native intake required assets are atomic with paired app, portal and cache release',()=>{
 const sw=read('sw.js'),index=read('index.html'),v=index.match(/const APP_VERSION='([^']+)'/)[1];
 assert.ok(sw.includes(`const CACHE='mcshanai-${v}'`));assert.ok(read('editor-features.js').includes(`const PORTAL_APP_VERSION='${v}'`));
 assert.ok(index.includes(`editing-intake-integration.js?v=${v}`));
 const required=sw.match(/const REQUIRED_URLS=(\[[^;]+\]);/)[1];
 for(const asset of ['editing-intake-integration.js','editing-intake/app.js','editing-intake/presentation.js']){assert.ok(required.includes(`'./${asset}'`));assert.ok(fs.statSync(path.join(root,asset)).size>0);}
});
test('generated UI files correspond exactly to current intake source fingerprints',()=>{
 const manifest=JSON.parse(read('editing-intake/manifest.json'));
 for(const [name,hash]of Object.entries(manifest.sha256)){const source=fs.readFileSync(path.resolve(root,'../chatwork/lp/editing-intake-app/public',name));assert.equal(crypto.createHash('sha256').update(source).digest('hex'),hash);}
 assert.equal(read('editing-intake/app.js'),fs.readFileSync(path.resolve(root,'../chatwork/lp/editing-intake-app/public/app.js'),'utf8'));
});
test('bridge can retry failed bundle loads instead of preserving a permanently failed host',async()=>{
 const scripts=[];const parent={append(){}};const placeholder={textContent:'',replaceWith(){},parentNode:parent};
 const document={currentScript:{src:'http://localhost/editing-intake-integration.js?v=test'},createElement:tag=>tag==='script'?{setAttribute(){},remove(){}}:{id:'',parentNode:parent,remove(){},attachShadow(){return {innerHTML:'',textContent:''};}},head:{append(s){scripts.push(s);queueMicrotask(()=>s.onerror());}}};
 const context={document,URL,Promise,Error,queueMicrotask};vm.runInNewContext(read('editing-intake-integration.js'),context);
 const options={isOwner:()=>true,getUser:()=>({uid:'fixture-owner'})};await context.EditflowEditingIntake.renderInto(placeholder,options);assert.equal(scripts.length,2);
 await context.EditflowEditingIntake.renderInto(placeholder,options);assert.equal(scripts.length,4);
 assert.ok(scripts.every(s=>s.src.endsWith('?v=test')));
});
