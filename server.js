'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR   = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ── Static frontend ────────────────────────────────────────────────────────
app.use(express.static(PUBLIC_DIR));
app.use(express.json());

// ── Data API ───────────────────────────────────────────────────────────────
// Serve every JSON file in /data/ via  GET /api/<filename-without-extension>
// This replaces the browser's fetch('./config.json') calls with /api/config etc.
const DATA_FILES = [
  'config',
  'tuning_inputs',
  'b2b_data',
  'external_market_data',
  'ute_data',
  'inflation_data',
];

DATA_FILES.forEach((name) => {
  app.get(`/api/${name}`, (req, res) => {
    const filePath = path.join(DATA_DIR, `${name}.json`);
    fs.readFile(filePath, 'utf8', (err, raw) => {
      if (err) {
        console.error(`[data] Could not read ${name}.json:`, err.message);
        return res.status(404).json({ error: `${name}.json not found` });
      }
      try {
        res.json(JSON.parse(raw));
      } catch (parseErr) {
        console.error(`[data] JSON parse error in ${name}.json:`, parseErr.message);
        res.status(500).json({ error: `Invalid JSON in ${name}.json` });
      }
    });
  });
});

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const status = {};
  DATA_FILES.forEach((name) => {
    status[name] = fs.existsSync(path.join(DATA_DIR, `${name}.json`));
  });
  res.json({ ok: true, dataFiles: status });
});

// ── Catch-all → index.html ─────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Verdantas Market Tool v7`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Server  → http://localhost:${PORT}`);
  console.log(`  Health  → http://localhost:${PORT}/api/health`);
  console.log(`  Press Ctrl+C to stop\n`);
});
