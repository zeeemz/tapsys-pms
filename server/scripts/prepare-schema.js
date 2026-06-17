// Stamps the Prisma datasource provider based on DATABASE_URL, so the same
// models work on SQLite locally and PostgreSQL in production with no manual edits.
const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch (_) {}

const url = process.env.DATABASE_URL || 'file:./dev.db';
let provider = 'sqlite';
if (/^postgres(ql)?:\/\//i.test(url)) provider = 'postgresql';
else if (/^mysql:\/\//i.test(url)) provider = 'mysql';
else if (/^file:/i.test(url)) provider = 'sqlite';

const tplPath = path.join(__dirname, '..', 'prisma', 'schema.template.prisma');
const outPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const tpl = fs.readFileSync(tplPath, 'utf8');
fs.writeFileSync(outPath, tpl.replace(/__PROVIDER__/g, provider));
console.log(`[prepare-schema] provider="${provider}" (from DATABASE_URL scheme)`);
