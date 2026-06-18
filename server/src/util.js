const { prisma } = require('./db');

async function addAudit(userId, action, entity, detail, procId = '') {
  return prisma.auditLog.create({
    data: { ts: new Date().toISOString(), userId: userId || null, action, entity, detail, procId: procId || '' },
  });
}

async function getConfig() {
  let c = await prisma.config.findUnique({ where: { id: 'singleton' } });
  if (!c) c = await prisma.config.create({ data: { id: 'singleton' } });
  let deptApprovalConfig = {};
  try { deptApprovalConfig = JSON.parse(c.deptApprovalConfig || '{}'); } catch (_) {}
  return { raw: c, deptApprovalConfig, procIdSeq: c.procIdSeq };
}

async function nextProcId() {
  const c = await getConfig();
  const seq = (c.procIdSeq || 0) + 1;
  await prisma.config.update({ where: { id: 'singleton' }, data: { procIdSeq: seq } });
  const yr = new Date().getFullYear();
  return `PROC-${yr}-${String(seq).padStart(5, '0')}`;
}

// Strip secrets / parse JSON fields for client consumption.
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, dept: u.dept, initials: u.initials };
}
function outVendor(v) {
  let dd = {}; try { dd = JSON.parse(v.dd || '{}'); } catch (_) {}
  return { ...v, dd };
}
function outCoi(c) {
  let procRefs = []; try { procRefs = JSON.parse(c.procRefs || '[]'); } catch (_) {}
  return { ...c, procRefs };
}

// Create an email-style notification for a recipient (user id or 'vendor:<id>').
async function notify(recipientId, subject, body, refType = 'tender', refId = '') {
  if (!recipientId) return;
  return prisma.notification.create({ data: { recipientId, subject, body, category: refType, refType, refId, ts: new Date().toISOString(), read: false } });
}
async function notifyMany(recipientIds, subject, body, refType = 'tender', refId = '') {
  for (const r of (recipientIds || [])) await notify(r, subject, body, refType, refId);
}

module.exports = { addAudit, getConfig, nextProcId, publicUser, outVendor, outCoi, notify, notifyMany };
