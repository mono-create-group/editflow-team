#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const host = '127.0.0.1';
const port = Number(process.env.DM_WORKFLOW_MOCK_PORT || 8767);
const dmApi = 'https://script.google.com/macros/s/AKfycbzftG_O0GsR_8_TYwUwSGfSFPMCjXscWfw0jmTIB54H8NrH0SnjgH445IDDOKoHnNt8XA/exec';
const invoiceApi = 'https://script.google.com/macros/s/AKfycbzdPQa24h5Ly1diKnjVwyjFl3Qn_vKGsyDVHD5hhlesG-IEBMpXKYlU4Lz2aDAKJkYwLw/exec';
const requests = [];

function json(res, body, status = 200) {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
  res.end(JSON.stringify(body));
}

function html(res, file) {
  let body = fs.readFileSync(path.join(root, file), 'utf8');
  body = body.split(dmApi).join('/api/dm');
  body = body.split(invoiceApi).join('/api/invoice');
  // Confirmation dialogs are replaced only in this isolated browser fixture so
  // the whole workflow can run unattended without weakening production checks.
  body = body.split('confirm(').join('(function(){return true;})(');
  res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dm-entry.html')) return html(res, 'dm-entry.html');
  if (req.method === 'GET' && url.pathname === '/dm-manual.html') return html(res, 'dm-manual.html');
  if (req.method === 'GET' && url.pathname === '/_requests') return json(res, {requests});

  if (url.pathname === '/api/dm' && req.method === 'GET') {
    const action = url.searchParams.get('action') || '';
    requests.push({method: 'GET', action});
    if (action === 'igname_list') return json(res, {success: true, names: [
      {n: 'mono.create｜隔離確認1', ai: false, by: ''},
      {n: 'mono.create｜隔離確認2', ai: true, by: ''},
      {n: 'mono.create｜使用中', ai: false, by: '別スタッフ'}
    ]});
    if (action === 'igname_claim') return json(res, {success: true, name: url.searchParams.get('name'), staff: url.searchParams.get('staff')});
    if (action === 'showcase_list') return json(res, {success: true, list: [
      {id: 'qa-showcase', g: '隔離確認用', url: 'https://example.test/demo'}
    ]});
    if (action === 'dmfaq_ask') return json(res, {ok: true, matched: true, answer: '隔離環境の回答です。', faq_id: 'qa'});
    return json(res, {success: false, error: 'unknown_action'}, 400);
  }

  if ((url.pathname === '/api/dm' || url.pathname === '/api/invoice') && req.method === 'POST') {
    try {
      const data = JSON.parse(await readBody(req) || '{}');
      requests.push({
        method: 'POST',
        action: data.action || '',
        hasAgreement: data.agree_ver === 'v1',
        hasInvoice: !!data.file_base64,
        invoiceBytes: data.file_base64 ? Buffer.from(data.file_base64, 'base64').length : 0
      });
      if (url.pathname === '/api/invoice') return json(res, data.action === 'invoice_upload' ? {ok: true, url: 'https://example.test/invoice'} : {ok: false, error: 'unknown_action'}, data.action === 'invoice_upload' ? 200 : 400);
      if (data.action === 'dmstaff_apply' || data.action === 'dmstaff_igreport') return json(res, {success: true});
      if (data.action === 'showcase_add' || data.action === 'showcase_del') return json(res, {success: true});
      return json(res, {success: false, error: 'unknown_action'}, 400);
    } catch (error) {
      return json(res, {success: false, error: error.message}, 400);
    }
  }

  res.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
  res.end('not found');
});

server.listen(port, host, () => process.stdout.write(`DM workflow mock ready: http://${host}:${port}\n`));
