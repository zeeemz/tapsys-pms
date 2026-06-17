require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { prisma } = require('./db');
const { router } = require('./routes');
const { ensureSeed } = require('../prisma/seed');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// API
app.use('/api', router);

// Front-end (single self-contained index.html). Resolve from whichever layout is deployed:
// local repo (../../index.html), or a bundled copy under server/public (Azure/zip deploys).
const fs = require('fs');
const FRONTEND_CANDIDATES = [
  path.join(__dirname, '..', '..', 'index.html'),
  path.join(__dirname, '..', 'public', 'index.html'),
  path.join(__dirname, '..', 'index.html'),
];
const FRONTEND = FRONTEND_CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || FRONTEND_CANDIDATES[0];
app.get('/', (req, res) => res.sendFile(FRONTEND));
// SPA-style fallback for any non-API GET that isn't a file request.
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(FRONTEND));

const PORT = process.env.PORT || 7433;

(async () => {
  try {
    await ensureSeed(prisma);
  } catch (e) {
    console.error('[seed] failed:', e.message);
  }
  app.listen(PORT, () => console.log(`Tapsys PMS API + app listening on http://localhost:${PORT}`));
})();
