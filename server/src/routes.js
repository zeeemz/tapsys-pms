const express = require('express');
const { prisma } = require('./db');
const { signToken, verifyPassword, authenticate, requireRole, requireStaff, requireVendor } = require('./auth');
const policy = require('./policy');
const tenders = require('./tenders');
const { addAudit, getConfig, nextProcId, publicUser, outVendor, outCoi, notify, notifyMany } = require('./util');
const pkrFmt = (n) => 'PKR ' + Number(n || 0).toLocaleString('en-US');

const router = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e); res.status(500).json({ error: e.message || 'Server error' });
});
const today = () => new Date().toISOString().split('T')[0];
const TENDER_INCLUDE = { invites: true, bids: true };

// Lazily emit "now live" / "closed" notifications as tenders cross those time boundaries
// (no scheduler needed — runs idempotently on each bootstrap via the notified flags).
async function sweepTenderNotifications() {
  const now = Date.now();
  const list = await prisma.tender.findMany({ include: TENDER_INCLUDE });
  for (const t of list) {
    const st = tenders.effectiveStatus(t, now);
    const invited = t.invites.map(i => 'vendor:' + i.vendorId);
    if (st === 'Live' && !t.liveNotified) {
      await prisma.tender.update({ where: { id: t.id }, data: { liveNotified: true } });
      await notifyMany(invited, `Bidding is now OPEN — ${t.ref}`, `The live revision window for "${t.title}" has started. All sealed bids are revealed and ranked lowest-first. Lower your bid to take the lead before the window closes.`, 'tender', t.ref);
    }
    if (st === 'Closed' && !t.closedNotified) {
      await prisma.tender.update({ where: { id: t.id }, data: { closedNotified: true } });
      const winner = tenders.rankBids(t.bids)[0];
      if (winner) {
        const vname = (await prisma.vendor.findUnique({ where: { id: winner.vendorId } }))?.name || 'vendor';
        await notify('vendor:' + winner.vendorId, `You won the tender — ${t.ref}`, `Congratulations — your bid of ${pkrFmt(winner.amount)} was the lowest for "${t.title}". Tapsys procurement will proceed to award and raise the purchase order.`, 'tender', t.ref);
        await notifyMany(invited.filter(r => r !== 'vendor:' + winner.vendorId), `Tender closed — ${t.ref}`, `Bidding for "${t.title}" has closed. Your bid was not the lowest this time. Thank you for participating.`, 'tender', t.ref);
        await notify(t.createdBy, `Tender closed — ${t.ref}`, `"${t.title}" has closed. Lowest bid: ${pkrFmt(winner.amount)} by ${vname}. You can now award and issue the PO.`, 'tender', t.ref);
      } else {
        await notify(t.createdBy, `Tender closed with no bids — ${t.ref}`, `"${t.title}" has closed without any bids submitted.`, 'tender', t.ref);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Bootstrap payload (role-scoped)
// ─────────────────────────────────────────────────────────────
async function buildBootstrap(principal) {
  const now = Date.now();
  await sweepTenderNotifications();
  const rid = principal.type === 'vendor' ? 'vendor:' + principal.id : principal.id;
  const myNotes = (await prisma.notification.findMany({ where: { recipientId: rid } })).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const allVendors = await prisma.vendor.findMany();
  const vendorMap = {}; allVendors.forEach(v => { vendorMap[v.id] = v.name; });

  if (principal.type === 'vendor') {
    const vid = principal.id;
    const [vendor, pos, invoices, tdrs] = await Promise.all([
      prisma.vendor.findUnique({ where: { id: vid } }),
      prisma.purchaseOrder.findMany({ where: { vendorId: vid } }),
      prisma.invoice.findMany({ where: { vendorId: vid } }),
      prisma.tender.findMany({ where: { invites: { some: { vendorId: vid } } }, include: TENDER_INCLUDE }),
    ]);
    const tenderViews = tdrs.map(t => tenders.serializeTender(t, principal, now, vendorMap)).filter(Boolean);
    return { mode: 'vendor', vendor: outVendor(vendor), purchaseOrders: pos, invoices, tenders: tenderViews, notifications: myNotes };
  }
  const [users, reqs, pos, quotes, receipts, invoices, coi, exceptions, overrides, audit, budgets, tdrs, cfg] = await Promise.all([
    prisma.user.findMany(),
    prisma.requisition.findMany({ include: { approvals: true } }),
    prisma.purchaseOrder.findMany(),
    prisma.quote.findMany(),
    prisma.receipt.findMany(),
    prisma.invoice.findMany(),
    prisma.coi.findMany(),
    prisma.exception.findMany(),
    prisma.overrideRequest.findMany(),
    prisma.auditLog.findMany(),
    prisma.budget.findMany({ include: { items: true } }),
    prisma.tender.findMany({ include: TENDER_INCLUDE }),
    getConfig(),
  ]);
  audit.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return {
    mode: 'staff',
    users: users.map(publicUser),
    vendors: allVendors.map(outVendor),
    requisitions: reqs,
    purchaseOrders: pos,
    quotes,
    receipts,
    invoices,
    coi: coi.map(outCoi),
    exceptions,
    overrideRequests: overrides,
    auditLog: audit,
    budgets,
    tenders: tdrs.map(t => tenders.serializeTender(t, principal, now, vendorMap)),
    notifications: myNotes,
    deptApprovalConfig: cfg.deptApprovalConfig,
  };
}

// ─────────────────────────────────────────────────────────────
// Public: health + auth
// ─────────────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({ ok: true, service: 'tapsys-pms', time: new Date().toISOString() }));

router.post('/auth/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && verifyPassword(password, user.passwordHash)) {
    const token = signToken({ sub: user.id, type: 'user', role: user.role });
    return res.json({ token, type: 'user', user: publicUser(user) });
  }
  // Vendors authenticate against the shared demo password (no per-vendor secret stored).
  const vendor = await prisma.vendor.findFirst({ where: { contact: { equals: email } } });
  if (vendor && vendor.status === 'Active' && password === (process.env.DEMO_PASSWORD || 'tapsys')) {
    const token = signToken({ sub: vendor.id, type: 'vendor', role: 'Vendor' });
    return res.json({ token, type: 'vendor', vendor: outVendor(vendor) });
  }
  return res.status(401).json({ error: 'Invalid email or password' });
}));

router.get('/auth/me', authenticate, wrap(async (req, res) => {
  if (req.user.type === 'vendor') return res.json({ type: 'vendor', vendor: outVendor(req.vendor) });
  res.json({ type: 'user', user: req.user });
}));

router.get('/bootstrap', authenticate, wrap(async (req, res) => {
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Requisitions
// ─────────────────────────────────────────────────────────────
router.post('/requisitions', authenticate, requireStaff, wrap(async (req, res) => {
  const b = req.body || {};
  const amount = parseFloat(b.amount || 0);
  if (!b.title || !b.category || !amount) return res.status(400).json({ error: 'Title, category and amount are required' });
  if (!b.justification || b.justification.trim().length < 20) return res.status(400).json({ error: 'Justification must be at least 20 characters' });
  const tier = policy.getDoaTier(amount);
  const src = policy.getSourcingRule(amount);
  const yr = new Date().getFullYear();
  const count = await prisma.requisition.count();
  const procurementId = await nextProcId();
  const draft = !!b.asDraft;
  const pr = await prisma.requisition.create({
    data: {
      ref: `PR-${yr}-${String(count + 1).padStart(3, '0')}`,
      procurementId,
      title: b.title, category: b.category, subType: b.subType || '', amount,
      multiYear: !!b.multiYear, recurring: !!b.recurring, dept: b.dept || req.user.dept,
      requestor: req.user.id, budgetOwner: req.user.id, budgetCode: b.budgetCode || '',
      justification: b.justification, soleSrc: !!b.soleSrc,
      dataHandling: b.category === 'IT', itSecReview: b.category === 'IT',
      status: draft ? 'Draft' : 'Pending Approval', doaTier: tier.tier, sourcingReq: src.minQ,
      createdAt: today(), requiredDate: b.requiredDate || '',
      coiDeclared: true, contractReview: policy.needsContractReview(amount, b.multiYear), notes: '',
    },
  });
  await addAudit(req.user.id, draft ? 'PR_DRAFT' : 'PR_SUBMITTED', pr.ref, draft ? 'Draft saved.' : 'Requisition submitted for approval.', procurementId);
  res.json(await buildBootstrap(req.user));
}));

router.post('/requisitions/:id/approve', authenticate, requireStaff, wrap(async (req, res) => {
  const comment = String(req.body.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'Approval comment is required' });
  const pr = await prisma.requisition.findUnique({ where: { id: req.params.id }, include: { approvals: true } });
  if (!pr) return res.status(404).json({ error: 'Requisition not found' });
  const cfg = await getConfig();
  if (!policy.canApprove(pr, req.user, cfg.deptApprovalConfig)) {
    return res.status(403).json({ error: 'You are not the next required approver for this requisition.' });
  }
  const prog = policy.approvalProgress(pr, cfg.deptApprovalConfig);
  await prisma.approval.create({ data: { prId: pr.id, role: prog.nextRole, userId: req.user.id, action: 'APPROVED', date: today(), comment } });
  const updated = await prisma.requisition.findUnique({ where: { id: pr.id }, include: { approvals: true } });
  const newProg = policy.approvalProgress(updated, cfg.deptApprovalConfig);
  if (newProg.complete) {
    const status = (pr.category === 'Sales' || pr.category === 'IT') ? 'In Sourcing' : 'Approved';
    await prisma.requisition.update({ where: { id: pr.id }, data: { status } });
  }
  await addAudit(req.user.id, 'PR_APPROVED', pr.ref, `Approved by ${req.user.role}. Comment: ${comment}`, pr.procurementId);
  res.json(await buildBootstrap(req.user));
}));

router.post('/requisitions/:id/reject', authenticate, requireStaff, wrap(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });
  const pr = await prisma.requisition.findUnique({ where: { id: req.params.id }, include: { approvals: true } });
  if (!pr) return res.status(404).json({ error: 'Requisition not found' });
  const cfg = await getConfig();
  if (!policy.canApprove(pr, req.user, cfg.deptApprovalConfig)) {
    return res.status(403).json({ error: 'You are not the current approver for this requisition.' });
  }
  await prisma.approval.create({ data: { prId: pr.id, role: req.user.role, userId: req.user.id, action: 'REJECTED', date: today(), comment: reason } });
  await prisma.requisition.update({ where: { id: pr.id }, data: { status: 'Rejected' } });
  await addAudit(req.user.id, 'PR_REJECTED', pr.ref, `Rejected by ${req.user.role}. Reason: ${reason}`, pr.procurementId);
  res.json(await buildBootstrap(req.user));
}));

router.post('/requisitions/:id/cancel', authenticate, requireStaff, wrap(async (req, res) => {
  const pr = await prisma.requisition.findUnique({ where: { id: req.params.id } });
  if (!pr) return res.status(404).json({ error: 'Requisition not found' });
  if (['Paid', 'Cancelled', 'Rejected'].includes(pr.status)) return res.status(400).json({ error: 'Cannot cancel a closed requisition' });
  await prisma.requisition.update({ where: { id: pr.id }, data: { status: 'Cancelled' } });
  await addAudit(req.user.id, 'PR_CANCELLED', pr.ref, `Requisition cancelled by ${req.user.name}.`, pr.procurementId);
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Quotes
// ─────────────────────────────────────────────────────────────
router.post('/quotes', authenticate, requireStaff, wrap(async (req, res) => {
  const b = req.body || {};
  const amount = parseFloat(b.amount || 0);
  if (!b.prId || !b.vendorName || !amount) return res.status(400).json({ error: 'PR, vendor name and amount required' });
  const pr = await prisma.requisition.findUnique({ where: { id: b.prId } });
  if (!pr) return res.status(404).json({ error: 'Requisition not found' });
  await prisma.quote.create({ data: { prId: b.prId, vendorId: b.vendorId || null, vendorName: b.vendorName, amount, submittedAt: b.submittedAt || today(), score: parseInt(b.score || 0, 10), notes: b.notes || '' } });
  await addAudit(req.user.id, 'QUOTE_ADDED', pr.ref, `Quote from ${b.vendorName} added: PKR ${amount.toLocaleString()}`, pr.procurementId);
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Purchase Orders  (issue — Procurement Lead only)
// ─────────────────────────────────────────────────────────────
router.post('/purchase-orders', authenticate, requireRole('Procurement Lead'), wrap(async (req, res) => {
  const b = req.body || {};
  const pr = await prisma.requisition.findUnique({ where: { id: b.prId } });
  if (!pr) return res.status(404).json({ error: 'Requisition not found' });
  if (!['Approved', 'In Sourcing'].includes(pr.status)) return res.status(400).json({ error: 'PR must be fully approved before a PO can be issued' });
  const vendor = await prisma.vendor.findUnique({ where: { id: b.vendorId } });
  if (!vendor || vendor.status !== 'Active') return res.status(400).json({ error: 'Vendor must be on the Approved Vendor List' });
  const amount = parseFloat(b.amount || pr.amount);
  const yr = new Date().getFullYear();
  const count = await prisma.purchaseOrder.count();
  const po = await prisma.purchaseOrder.create({
    data: {
      ref: `PO-${yr}-${String(count + 1).padStart(3, '0')}`, prId: pr.id, procurementId: pr.procurementId,
      vendorId: vendor.id, description: pr.title, amount, issuedBy: req.user.id, issuedAt: today(),
      deliveryDate: b.deliveryDate || '', status: 'Open', terms: b.terms || 'Net 30', notes: b.notes || '',
    },
  });
  await prisma.requisition.update({ where: { id: pr.id }, data: { status: 'PO Issued' } });
  await addAudit(req.user.id, 'PO_ISSUED', po.ref, `PO issued to ${vendor.name} for PKR ${amount.toLocaleString()}`, pr.procurementId);
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Receipts  (confirm — staff, with SoD)
// ─────────────────────────────────────────────────────────────
router.post('/receipts', authenticate, requireStaff, wrap(async (req, res) => {
  const b = req.body || {};
  const po = await prisma.purchaseOrder.findUnique({ where: { id: b.poId } });
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  if (po.status !== 'Open') return res.status(400).json({ error: 'This PO is not awaiting receipt' });
  if (po.issuedBy === req.user.id) return res.status(403).json({ error: 'SoD violation: the person who issued the PO cannot confirm its receipt.' });
  const receipt = await prisma.receipt.create({
    data: { poId: po.id, receivedBy: req.user.id, receivedAt: b.receivedAt || today(), qty: 'As per PO', condition: b.condition || 'Good', notes: b.notes || '', signed: true },
  });
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'Received' } });
  if (po.prId) {
    const pr = await prisma.requisition.findUnique({ where: { id: po.prId } });
    if (pr && pr.status === 'PO Issued') await prisma.requisition.update({ where: { id: pr.id }, data: { status: 'Goods Received' } });
  }
  await addAudit(req.user.id, 'RECEIPT_CONFIRMED', po.ref, `Goods/services received by ${req.user.name}.`, po.procurementId);
  // Re-evaluate any invoice that was waiting on this receipt
  const pending = await prisma.invoice.findMany({ where: { poId: po.id, matchStatus: 'Pending Receipt' } });
  for (const inv of pending) {
    const matched = inv.amount === po.amount;
    await prisma.invoice.update({
      where: { id: inv.id },
      data: {
        receiptId: receipt.id, matchStatus: matched ? 'Matched' : 'Discrepancy', status: matched ? 'Matched' : 'Discrepancy',
        discrepancy: matched ? null : `Invoice amount PKR ${inv.amount.toLocaleString()} ${inv.amount > po.amount ? 'exceeds' : 'is below'} PO amount PKR ${po.amount.toLocaleString()}. Requires Finance review.`,
      },
    });
    if (po.prId) await prisma.requisition.update({ where: { id: po.prId }, data: { status: 'Invoiced' } }).catch(() => {});
    await addAudit(req.user.id, matched ? 'INVOICE_MATCHED' : 'MATCH_DISCREPANCY', inv.vendorRef, matched ? `Three-way match completed for ${inv.vendorRef} after receipt.` : `Three-way match failed for ${inv.vendorRef}.`, po.procurementId);
  }
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Invoices  (record — Procurement Lead or Finance; pay/resolve — Finance)
// ─────────────────────────────────────────────────────────────
async function createInvoice({ po, vendorRef, amount, invoiceDate, dueDate, notes, submittedBy }) {
  const receipt = await prisma.receipt.findFirst({ where: { poId: po.id } });
  const hasReceipt = !!receipt;
  const matched = amount === po.amount;
  const matchStatus = !hasReceipt ? 'Pending Receipt' : (matched ? 'Matched' : 'Discrepancy');
  const inv = await prisma.invoice.create({
    data: {
      poId: po.id, receiptId: receipt ? receipt.id : null, vendorRef, vendorId: po.vendorId, amount,
      invoiceDate: invoiceDate || today(), dueDate: dueDate || '', status: matchStatus, matchStatus,
      discrepancy: matchStatus === 'Discrepancy' ? `Invoice amount PKR ${amount.toLocaleString()} ${amount > po.amount ? 'exceeds' : 'is below'} PO amount PKR ${po.amount.toLocaleString()}. Requires Finance review.` : null,
      paidAt: null, notes: notes || '', procurementId: po.procurementId, submittedBy: submittedBy || null,
    },
  });
  if (hasReceipt && po.prId) await prisma.requisition.update({ where: { id: po.prId }, data: { status: 'Invoiced' } }).catch(() => {});
  return { inv, matchStatus };
}

router.post('/invoices', authenticate, requireRole('Procurement Lead', 'Finance / CFO'), wrap(async (req, res) => {
  const b = req.body || {};
  const amount = parseFloat(b.amount || 0);
  if (!b.poId || !b.vendorRef || !amount) return res.status(400).json({ error: 'PO, invoice ref and amount required' });
  const po = await prisma.purchaseOrder.findUnique({ where: { id: b.poId } });
  if (!po) return res.status(404).json({ error: 'PO not found' });
  if (po.status !== 'Received') return res.status(400).json({ error: 'Invoice can only be recorded against a received PO' });
  if (await prisma.invoice.findFirst({ where: { poId: po.id } })) return res.status(400).json({ error: 'An invoice already exists for this PO' });
  const { inv, matchStatus } = await createInvoice({ po, vendorRef: b.vendorRef, amount, invoiceDate: b.invoiceDate, dueDate: b.dueDate, notes: b.notes });
  const matched = matchStatus === 'Matched';
  await addAudit(req.user.id, matched ? 'INVOICE_MATCHED' : 'MATCH_DISCREPANCY', inv.vendorRef, matched ? `Invoice ${inv.vendorRef} recorded and matched against ${po.ref}.` : `Invoice ${inv.vendorRef} recorded against ${po.ref} — match failed.`, po.procurementId);
  res.json(await buildBootstrap(req.user));
}));

router.post('/invoices/:id/pay', authenticate, requireRole('Finance / CFO'), wrap(async (req, res) => {
  const inv = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.matchStatus !== 'Matched') return res.status(400).json({ error: 'Only fully matched invoices can be paid' });
  if (inv.paidAt) return res.status(400).json({ error: 'Invoice already paid' });
  if (inv.receiptId) {
    const receipt = await prisma.receipt.findUnique({ where: { id: inv.receiptId } });
    if (receipt && receipt.receivedBy === req.user.id) return res.status(403).json({ error: 'SoD violation: you confirmed receipt for this PO and cannot also release payment.' });
  }
  await prisma.invoice.update({ where: { id: inv.id }, data: { paidAt: today(), status: 'Paid' } });
  const po = await prisma.purchaseOrder.findUnique({ where: { id: inv.poId } });
  if (po) {
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'Delivered' } });
    if (po.prId) await prisma.requisition.update({ where: { id: po.prId }, data: { status: 'Paid' } }).catch(() => {});
  }
  await addAudit(req.user.id, 'PAYMENT_RELEASED', inv.vendorRef, `Payment of PKR ${inv.amount.toLocaleString()} released for ${po ? po.ref : ''}.`, inv.procurementId);
  res.json(await buildBootstrap(req.user));
}));

router.post('/invoices/:id/resolve', authenticate, requireRole('Finance / CFO'), wrap(async (req, res) => {
  const { action, note } = req.body || {};
  if (!note || !String(note).trim()) return res.status(400).json({ error: 'A resolution note is required' });
  const inv = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const po = await prisma.purchaseOrder.findUnique({ where: { id: inv.poId } });
  if (action === 'reject') {
    await prisma.invoice.update({ where: { id: inv.id }, data: { notes: `${inv.notes || ''} [Credit note requested ${today()}: ${note}]` } });
    await addAudit(req.user.id, 'MATCH_DISCREPANCY', inv.vendorRef, `Discrepancy unresolved — credit note requested. ${note}`, inv.procurementId);
  } else {
    const data = { matchStatus: 'Matched', status: 'Matched', discrepancy: null, notes: `${inv.notes || ''} [Resolved ${today()}: ${note}]` };
    if (action === 'adjust' && po) data.amount = po.amount;
    await prisma.invoice.update({ where: { id: inv.id }, data });
    await addAudit(req.user.id, 'INVOICE_MATCHED', inv.vendorRef, `Discrepancy resolved (${action === 'adjust' ? 'adjusted to PO amount' : 'accepted as-is'}). ${note}`, inv.procurementId);
  }
  res.json(await buildBootstrap(req.user));
}));

// Vendor self-service invoice submission
router.post('/vendor/invoices', authenticate, requireVendor, wrap(async (req, res) => {
  const b = req.body || {};
  const amount = parseFloat(b.amount || 0);
  if (!b.poId || !b.vendorRef || !amount) return res.status(400).json({ error: 'PO, invoice number and amount required' });
  const po = await prisma.purchaseOrder.findUnique({ where: { id: b.poId } });
  if (!po || po.vendorId !== req.user.vendorId) return res.status(403).json({ error: 'This purchase order does not belong to your company' });
  if (!['Received', 'Open', 'Delivered'].includes(po.status)) return res.status(400).json({ error: 'This PO is not open for invoicing' });
  if (await prisma.invoice.findFirst({ where: { poId: po.id } })) return res.status(400).json({ error: 'An invoice already exists for this PO' });
  const { inv, matchStatus } = await createInvoice({ po, vendorRef: b.vendorRef, amount, invoiceDate: b.invoiceDate, dueDate: b.dueDate, notes: b.notes, submittedBy: 'vendor:' + req.user.vendorId });
  const action = matchStatus === 'Matched' ? 'INVOICE_MATCHED' : matchStatus === 'Discrepancy' ? 'MATCH_DISCREPANCY' : 'INVOICE_RECEIVED';
  const detail = matchStatus === 'Pending Receipt'
    ? `Invoice ${inv.vendorRef} submitted via Vendor Portal against ${po.ref} — awaiting receipt confirmation.`
    : matchStatus === 'Matched'
      ? `Invoice ${inv.vendorRef} submitted via Vendor Portal and matched against ${po.ref}.`
      : `Invoice ${inv.vendorRef} submitted via Vendor Portal against ${po.ref} — match failed.`;
  await addAudit('vendor:' + req.user.vendorId, action, inv.vendorRef, detail, po.procurementId);
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Vendors
// ─────────────────────────────────────────────────────────────
router.post('/vendors', authenticate, requireRole('Procurement Lead', 'Finance / CFO'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.category || !b.ntn) return res.status(400).json({ error: 'Name, category and NTN required' });
  const existing = await prisma.vendor.findFirst({ where: { ntn: b.ntn } });
  if (existing) {
    if (existing.status === 'Blacklisted') return res.status(400).json({ error: 'This NTN is on the Blacklist Register and cannot be added.' });
    return res.status(400).json({ error: 'A vendor with this NTN already exists.' });
  }
  const dd = JSON.stringify({ entityVerified: false, ntnValidated: false, bankValidated: false, sanctionsCleared: false, blacklistCleared: true, antibriberyAttest: false, coiCleared: false, beneficialOwnership: false, financialStability: false, securityReview: false, references: false, adverseMedia: false });
  const v = await prisma.vendor.create({ data: { name: b.name, category: b.category, ntn: b.ntn, bank: 'Pending validation', address: b.address || '', contact: b.contact || '', contactPerson: b.contactPerson || '', status: 'Onboarding', riskTier: b.riskTier || 'Medium', dd, preferred: false, notes: '' } });
  await addAudit(req.user.id, 'VENDOR_ONBOARDING', v.id, `New vendor ${b.name} added to onboarding queue.`);
  res.json(await buildBootstrap(req.user));
}));

router.post('/vendors/:id/approve', authenticate, requireRole('Procurement Lead', 'Finance / CFO'), wrap(async (req, res) => {
  const v = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  await prisma.vendor.update({ where: { id: v.id }, data: { status: 'Active', avlSince: today(), lastReview: today() } });
  await addAudit(req.user.id, 'VENDOR_APPROVED', v.id, `${v.name} approved to Approved Vendor List.`);
  res.json(await buildBootstrap(req.user));
}));

router.post('/vendors/:id/suspend', authenticate, requireRole('Finance / CFO', 'Audit Committee'), wrap(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Reason required' });
  const v = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  await prisma.vendor.update({ where: { id: v.id }, data: { status: 'Suspended', notes: `${v.notes} [SUSPENDED: ${reason}]` } });
  await addAudit(req.user.id, 'VENDOR_SUSPENDED', v.id, `Vendor suspended. Reason: ${reason}`);
  res.json(await buildBootstrap(req.user));
}));

router.post('/vendors/:id/blacklist', authenticate, requireRole('Finance / CFO', 'Audit Committee'), wrap(async (req, res) => {
  const { grounds, detail, duration } = req.body || {};
  if (!grounds || !detail) return res.status(400).json({ error: 'Grounds and evidence detail required' });
  const v = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!v) return res.status(404).json({ error: 'Vendor not found' });
  await prisma.vendor.update({ where: { id: v.id }, data: { status: 'Blacklisted', notes: `BLACKLISTED (${duration || 'Indefinite'}). Grounds: ${grounds}. ${detail}` } });
  await addAudit(req.user.id, 'VENDOR_BLACKLISTED', v.id, `Blacklisted (${duration || 'Indefinite'}). Grounds: ${grounds}.`);
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// COI, waivers, overrides
// ─────────────────────────────────────────────────────────────
router.post('/coi', authenticate, requireStaff, wrap(async (req, res) => {
  const b = req.body || {};
  const none = !!b.none;
  if (!none && !String(b.relationship || '').trim()) return res.status(400).json({ error: 'Describe the relationship or declare none' });
  const refs = Array.isArray(b.procRefs) ? b.procRefs : String(b.procRefs || '').split(',').map(s => s.trim()).filter(Boolean);
  await prisma.coi.create({ data: { userId: req.user.id, declaredAt: today(), party: none ? 'None' : (b.party || 'None'), relationship: none ? 'No conflicts declared' : b.relationship, procRefs: JSON.stringify(refs), status: 'Active', recused: false, reviewNote: '' } });
  await addAudit(req.user.id, 'COI_DECLARED', 'COI', none ? `No conflicts declared by ${req.user.name}.` : `COI declared by ${req.user.name} re: ${b.party}.`);
  res.json(await buildBootstrap(req.user));
}));

router.post('/exceptions', authenticate, requireStaff, wrap(async (req, res) => {
  const b = req.body || {};
  if (!String(b.reason || '').trim()) return res.status(400).json({ error: 'Justification required' });
  const count = await prisma.exception.count();
  const yr = new Date().getFullYear();
  const ref = `WAV-${yr}-${String(count + 1).padStart(3, '0')}`;
  await prisma.exception.create({ data: { ref, type: b.type || 'Other', policySection: b.policySection || '', prRef: b.prRef || '', requestedBy: req.user.id, requestedAt: today(), status: 'Pending', reason: b.reason, duration: 'As specified', compensatingControls: '', notes: '' } });
  await addAudit(req.user.id, 'WAIVER_REQUESTED', ref, `Waiver request submitted: ${b.type || 'Other'}`);
  res.json(await buildBootstrap(req.user));
}));

router.post('/overrides', authenticate, requireStaff, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.prRef || !b.proposedVendor || !String(b.justification || '').trim()) return res.status(400).json({ error: 'PR ref, proposed vendor and justification required' });
  const count = await prisma.overrideRequest.count();
  const yr = new Date().getFullYear();
  const id = `OR-${yr}-${String(count + 1).padStart(3, '0')}`;
  await prisma.overrideRequest.create({ data: { id, prRef: b.prRef, requestedBy: req.user.id, requestedAt: today(), recommendedVendor: b.recommendedVendor || 'Per evaluation', proposedVendor: b.proposedVendor, justification: b.justification, status: 'Pending AC Review' } });
  await addAudit(req.user.id, 'OVERRIDE_REQUESTED', id, `Override request submitted. Proposed vendor: ${b.proposedVendor}`);
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Config: department approval chains (admin)
// ─────────────────────────────────────────────────────────────
router.put('/config/dept-approval', authenticate, requireRole('Finance / CFO', 'CEO / Founder'), wrap(async (req, res) => {
  const { dept, config } = req.body || {};
  if (!dept) return res.status(400).json({ error: 'Department required' });
  const cfg = await getConfig();
  const all = cfg.deptApprovalConfig || {};
  all[dept] = config || {};
  await prisma.config.update({ where: { id: 'singleton' }, data: { deptApprovalConfig: JSON.stringify(all) } });
  await addAudit(req.user.id, 'SETTINGS_UPDATED', dept, `Approval chain configured for ${dept} department.`);
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Budgets — CFO sets fiscal-year budgets with sub-items
// ─────────────────────────────────────────────────────────────
router.put('/budgets', authenticate, requireRole('Finance / CFO'), wrap(async (req, res) => {
  const b = req.body || {};
  const dept = String(b.dept || '').trim();
  const fiscalYear = String(b.fiscalYear || '').trim();
  if (!dept || !fiscalYear) return res.status(400).json({ error: 'Department and fiscal year are required' });
  const items = Array.isArray(b.items) ? b.items.filter(i => i && i.name).map(i => ({ name: String(i.name), amount: parseFloat(i.amount || 0) })) : [];
  const total = items.reduce((s, i) => s + i.amount, 0);
  const existing = await prisma.budget.findFirst({ where: { dept, fiscalYear } });
  if (existing) {
    await prisma.budgetItem.deleteMany({ where: { budgetId: existing.id } });
    await prisma.budget.update({ where: { id: existing.id }, data: { code: b.code || existing.code, total, items: { create: items } } });
  } else {
    await prisma.budget.create({ data: { dept, fiscalYear, code: b.code || dept.slice(0, 4).toUpperCase(), total, spent: 0, committed: 0, items: { create: items } } });
  }
  await addAudit(req.user.id, 'BUDGET_UPDATED', `${dept} ${fiscalYear}`, `Budget set for ${dept} (${fiscalYear}): ${items.length} line item(s), total PKR ${total.toLocaleString()}.`);
  res.json(await buildBootstrap(req.user));
}));

// ─────────────────────────────────────────────────────────────
// Tenders — sealed-bid reverse auction
// ─────────────────────────────────────────────────────────────
router.post('/tenders', authenticate, requireRole('Procurement Lead'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.title || !b.openAt) return res.status(400).json({ error: 'Title and bid-opening time are required' });
  const vendorIds = Array.isArray(b.vendorIds) ? b.vendorIds : [];
  if (vendorIds.length < 1) return res.status(400).json({ error: 'Invite at least one vendor' });
  // Validate invited vendors are Active AVL
  const vs = await prisma.vendor.findMany({ where: { id: { in: vendorIds } } });
  if (vs.some(v => v.status !== 'Active')) return res.status(400).json({ error: 'All invited vendors must be Active on the AVL' });
  const pr = b.prId ? await prisma.requisition.findUnique({ where: { id: b.prId } }) : null;
  const yr = new Date().getFullYear();
  const count = await prisma.tender.count();
  const tender = await prisma.tender.create({
    data: {
      ref: `TND-${yr}-${String(count + 1).padStart(3, '0')}`, prId: pr ? pr.id : null, procurementId: pr ? pr.procurementId : '',
      title: b.title, dept: pr ? pr.dept : (b.dept || ''), createdBy: req.user.id, createdAt: new Date().toISOString(),
      openAt: new Date(b.openAt).toISOString(), windowMin: parseFloat(b.windowMin || 30), extensionMin: parseFloat(b.extensionMin || 10),
      status: 'Sealed', notes: b.notes || '',
      invites: { create: vendorIds.map(vid => ({ vendorId: vid })) },
    },
  });
  await addAudit(req.user.id, 'TENDER_OPENED', tender.ref, `Tender ${tender.ref} opened for sealed bids — ${vendorIds.length} vendor(s) invited. Bids open ${new Date(tender.openAt).toLocaleString()}.`, tender.procurementId);
  await notifyMany(vendorIds.map(v => 'vendor:' + v), `Invitation to bid — ${tender.ref}`, `You are invited to submit a sealed bid for "${tender.title}". Bids open ${new Date(tender.openAt).toLocaleString()}. Submit your sealed bid any time before then — it stays confidential (hidden from Tapsys and other vendors) until opening, when the live revision window begins.`, 'tender', tender.ref);
  res.json(await buildBootstrap(req.user));
}));

// Submit or revise a bid (invited vendor only). Sealed before open; revise-DOWN only after open.
router.post('/tenders/:id/bid', authenticate, requireVendor, wrap(async (req, res) => {
  const amount = parseFloat(req.body.amount || 0);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'A valid bid amount is required' });
  const t = await prisma.tender.findUnique({ where: { id: req.params.id }, include: TENDER_INCLUDE });
  if (!t) return res.status(404).json({ error: 'Tender not found' });
  const vid = req.user.vendorId;
  if (!t.invites.some(i => i.vendorId === vid)) return res.status(403).json({ error: 'You are not invited to this tender' });
  const now = Date.now();
  const status = tenders.effectiveStatus(t, now);
  if (status === 'Cancelled') return res.status(400).json({ error: 'This tender has been cancelled' });
  if (status === 'Closed') return res.status(400).json({ error: 'Bidding has closed for this tender' });

  const existing = t.bids.find(x => x.vendorId === vid);
  const nowIso = new Date().toISOString();

  if (status === 'Sealed') {
    // Free to submit/replace a sealed bid before opening.
    if (existing) await prisma.bid.update({ where: { id: existing.id }, data: { amount, updatedAt: nowIso } });
    else await prisma.bid.create({ data: { tenderId: t.id, vendorId: vid, amount, revisions: 0, createdAt: nowIso, updatedAt: nowIso } });
    await addAudit('vendor:' + vid, 'BID_SUBMITTED', t.ref, `Sealed bid submitted for ${t.ref}.`, t.procurementId);
    return res.json(await buildBootstrap(req.user));
  }

  // status === 'Live': revise-down only
  if (existing && amount >= existing.amount) {
    return res.status(400).json({ error: `New bid must be lower than your current bid (PKR ${existing.amount.toLocaleString()}).` });
  }
  const leaderBefore = tenders.rankBids(t.bids)[0];
  if (existing) await prisma.bid.update({ where: { id: existing.id }, data: { amount, revisions: existing.revisions + 1, updatedAt: nowIso } });
  else await prisma.bid.create({ data: { tenderId: t.id, vendorId: vid, amount, revisions: 1, createdAt: nowIso, updatedAt: nowIso } });

  // Anti-snipe: if the leader (lowest) changed, extend the window so everyone gets another chance.
  const fresh = await prisma.tender.findUnique({ where: { id: t.id }, include: TENDER_INCLUDE });
  const leaderAfter = tenders.rankBids(fresh.bids)[0];
  let extended = false;
  const leadChanged = !leaderBefore || (leaderAfter && leaderAfter.vendorId !== leaderBefore.vendorId);
  if (leadChanged) {
    const curEnds = tenders.endsAtMs(fresh);
    const newEnds = Math.max(curEnds, now + (t.extensionMin || 10) * 60000);
    if (newEnds > curEnds) { await prisma.tender.update({ where: { id: t.id }, data: { revisionEndsAt: new Date(newEnds).toISOString() } }); extended = true; }
  }
  await addAudit('vendor:' + vid, 'BID_REVISED', t.ref, `Bid revised down to PKR ${amount.toLocaleString()} for ${t.ref}${extended ? ` — lead changed, window extended ${t.extensionMin}m.` : '.'}`, t.procurementId);
  // Notify on lead change: new leader + everyone they overtook.
  if (leadChanged && leaderAfter) {
    const invited = fresh.invites.map(i => 'vendor:' + i.vendorId);
    await notify('vendor:' + leaderAfter.vendorId, `You now lead — ${t.ref}`, `Your revised bid of ${pkrFmt(leaderAfter.amount)} is now the lowest for "${t.title}". The window may extend if another vendor undercuts you.`, 'tender', t.ref);
    await notifyMany(invited.filter(r => r !== 'vendor:' + leaderAfter.vendorId), `You've been outbid — ${t.ref}`, `A lower bid of ${pkrFmt(leaderAfter.amount)} now leads "${t.title}". The window was extended — revise your bid lower to retake the lead before it closes.`, 'tender', t.ref);
  }
  res.json(await buildBootstrap(req.user));
}));

// Award the tender to the lowest bidder (Procurement Lead), once closed.
router.post('/tenders/:id/award', authenticate, requireRole('Procurement Lead'), wrap(async (req, res) => {
  const t = await prisma.tender.findUnique({ where: { id: req.params.id }, include: TENDER_INCLUDE });
  if (!t) return res.status(404).json({ error: 'Tender not found' });
  if (tenders.effectiveStatus(t, Date.now()) !== 'Closed') return res.status(400).json({ error: 'Tender bidding is still in progress' });
  const winner = tenders.rankBids(t.bids)[0];
  if (!winner) return res.status(400).json({ error: 'No bids were submitted' });
  await prisma.tender.update({ where: { id: t.id }, data: { status: 'Closed', selectedVendorId: winner.vendorId } });
  const vname = (await prisma.vendor.findUnique({ where: { id: winner.vendorId } }))?.name || 'vendor';
  await addAudit(req.user.id, 'TENDER_AWARDED', t.ref, `Tender ${t.ref} awarded to ${vname} at PKR ${winner.amount.toLocaleString()} (lowest bid).`, t.procurementId);
  await notify('vendor:' + winner.vendorId, `Tender awarded to you — ${t.ref}`, `"${t.title}" has been formally awarded to you at ${pkrFmt(winner.amount)}. Tapsys procurement will issue the purchase order shortly.`, 'tender', t.ref);
  res.json(await buildBootstrap(req.user));
}));

// Notifications — mark the caller's notifications as read
router.post('/notifications/read-all', authenticate, wrap(async (req, res) => {
  const rid = req.user.type === 'vendor' ? 'vendor:' + req.user.vendorId : req.user.id;
  await prisma.notification.updateMany({ where: { recipientId: rid, read: false }, data: { read: true } });
  res.json(await buildBootstrap(req.user));
}));

module.exports = { router, buildBootstrap };
