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

// Front-end (single self-contained index.html at the repo root).
const FRONTEND = path.join(__dirname, '..', '..', 'index.html');
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
