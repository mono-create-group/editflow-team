'use strict';

// The historical DM contract test reads a sibling Apps Script checkout.  Keep
// the test source unchanged, while allowing an explicitly supplied local file
// to be used only for that exact read during an opt-in test run.
const fs = require('node:fs');
const path = require('node:path');

const source = process.env.EDITFLOW_DM_BACKEND_FILE;
if (!source) throw new Error('EDITFLOW_DM_BACKEND_FILE is required for the DM backend test.');
const resolvedSource = path.resolve(source);
if (!fs.statSync(resolvedSource).isFile()) throw new Error(`DM backend file is not readable: ${resolvedSource}`);

const expected = path.resolve(__dirname, '..', '..', 'automation', 'poitto_hp_backend', 'Code.js');
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function redirectDmBackend(file, ...args) {
  if (path.resolve(String(file)) === expected) return originalReadFileSync.call(this, resolvedSource, ...args);
  return originalReadFileSync.call(this, file, ...args);
};
