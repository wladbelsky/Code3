// Config for tools/preview.spec.js (the Workshop preview render) — the test config with this folder as testDir
const path = require('path');
const base = require('../playwright.config.js');
module.exports = Object.assign({}, base, { testDir: __dirname, testMatch: 'preview.spec.js', reporter: [['list']],
  webServer: Object.assign({}, base.webServer, { cwd: path.join(__dirname, '..') }) });
