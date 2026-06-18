// Seeds the database from the original demo dataset. Idempotent: only runs when empty.
const bcrypt = require('bcryptjs');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'tapsys';

const USERS = [
  { id: 'u0', name: 'System Administrator', email: 'superadmin@tapsys.pk', role: 'Super Admin', dept: 'Administration', initials: 'SA' },
  { id: 'u1', name: 'Hamid Malik', email: 'hamid@tapsys.pk', role: 'Budget Owner', dept: 'Engineering', initials: 'HM' },
  { id: 'u2', name: 'Fatima Zahra', email: 'fatima@tapsys.pk', role: 'Requestor', dept: 'Engineering', initials: 'FZ' },
  { id: 'u3', name: 'Ali Hassan', email: 'ali@tapsys.pk', role: 'Procurement Lead', dept: 'Operations', initials: 'AH' },
  { id: 'u4', name: 'Usman Raza', email: 'usman@tapsys.pk', role: 'Finance / CFO', dept: 'Finance', initials: 'UR' },
  { id: 'u5', name: 'Zainab Ahmed', email: 'zainab@tapsys.pk', role: 'CEO / Founder', dept: 'Executive', initials: 'ZA' },
  { id: 'u6', name: 'Tariq Khan', email: 'tariq@tapsys.pk', role: 'IT Lead', dept: 'IT', initials: 'TK' },
  { id: 'u7', name: 'Amina Siddiqui', email: 'amina@tapsys.pk', role: 'Audit Committee', dept: 'Board', initials: 'AS' },
  { id: 'u8', name: 'Bilal Javed', email: 'bilal@tapsys.pk', role: 'Sales Lead', dept: 'Sales', initials: 'BJ' },
  { id: 'u9', name: 'Sara Khan', email: 'sara@tapsys.pk', role: 'Budget Owner', dept: 'HR', initials: 'SK' },
];

const dd = (o) => JSON.stringify(o);
const VENDORS = [
  { id: 'v1', name: 'TechSolutions Pvt Ltd', category: 'IT', ntn: '1234567-1', bank: 'HBL — AC: 01234567891', address: 'Plot 12, I-8 Islamabad', contact: 'info@techsolutions.pk', contactPerson: 'Kamran Sheikh', status: 'Active', riskTier: 'Medium', dd: dd({ entityVerified: true, ntnValidated: true, bankValidated: true, sanctionsCleared: true, blacklistCleared: true, antibriberyAttest: true, coiCleared: true, beneficialOwnership: true, financialStability: true, securityReview: true, references: true, adverseMedia: true }), avlSince: '2023-01-15', lastReview: '2024-01-10', preferred: true, notes: 'Primary IT hardware & software supplier. Security review complete.' },
  { id: 'v2', name: 'CloudServe Pakistan', category: 'IT', ntn: '2345678-2', bank: 'MCB — AC: 09876543210', address: 'Blue Area, Islamabad', contact: 'ops@cloudserve.pk', contactPerson: 'Sana Mirza', status: 'Active', riskTier: 'Low', dd: dd({ entityVerified: true, ntnValidated: true, bankValidated: true, sanctionsCleared: true, blacklistCleared: true, antibriberyAttest: true, coiCleared: true, beneficialOwnership: false, financialStability: true, securityReview: true, references: true, adverseMedia: true }), avlSince: '2022-06-01', lastReview: '2024-02-14', preferred: true, notes: 'AWS reseller and cloud infrastructure partner. Preferred vendor.' },
  { id: 'v3', name: 'PrintMasters Office Supplies', category: 'Administration', ntn: '3456789-3', bank: 'UBL — AC: 11223344556', address: 'G-9 Markaz, Islamabad', contact: 'orders@printmasters.pk', contactPerson: 'Rashid Mehmood', status: 'Active', riskTier: 'Low', dd: dd({ entityVerified: true, ntnValidated: true, bankValidated: true, sanctionsCleared: true, blacklistCleared: true, antibriberyAttest: true, coiCleared: false, beneficialOwnership: false, financialStability: false, securityReview: false, references: true, adverseMedia: false }), avlSince: '2023-03-20', lastReview: '2024-03-01', preferred: false, notes: 'Office supplies — low risk, baseline DD only.' },
  { id: 'v4', name: 'DataSoft Systems', category: 'IT', ntn: '4567890-4', bank: 'Allied — AC: 55667788990', address: 'SITE Industrial Area, Karachi', contact: 'sales@datasoft.pk', contactPerson: 'Imran Lodhi', status: 'Onboarding', riskTier: 'High', dd: dd({ entityVerified: true, ntnValidated: true, bankValidated: false, sanctionsCleared: true, blacklistCleared: true, antibriberyAttest: false, coiCleared: false, beneficialOwnership: false, financialStability: false, securityReview: false, references: false, adverseMedia: false }), avlSince: null, lastReview: null, preferred: false, notes: 'Pending enhanced due diligence. IT Lead disclosed prior employment — recused.' },
  { id: 'v5', name: 'QuickFix Services', category: 'Operations', ntn: '5678901-5', bank: 'Faysal — AC: 33445566778', address: 'Gulberg, Lahore', contact: 'info@quickfix.pk', contactPerson: 'Nadeem Shah', status: 'Suspended', riskTier: 'High', dd: dd({ entityVerified: true, ntnValidated: true, bankValidated: true, sanctionsCleared: true, blacklistCleared: true, antibriberyAttest: true, coiCleared: false, beneficialOwnership: true, financialStability: true, securityReview: false, references: true, adverseMedia: true }), avlSince: '2023-08-01', lastReview: '2024-02-01', preferred: false, notes: 'Suspended pending investigation of undisclosed COI. Under CFO review.' },
  { id: 'v6', name: 'FraudCo Pvt Ltd', category: 'Operations', ntn: '6789012-6', bank: '—', address: 'Unknown', contact: '—', contactPerson: '—', status: 'Blacklisted', riskTier: 'Critical', dd: dd({ entityVerified: false, ntnValidated: false, bankValidated: false, sanctionsCleared: false, blacklistCleared: false, antibriberyAttest: false, coiCleared: false, beneficialOwnership: false, financialStability: false, securityReview: false, references: false, adverseMedia: false }), avlSince: null, lastReview: null, preferred: false, notes: 'Blacklisted by Audit Committee 2024-01-08. Bid manipulation and forged documents. Indefinite ban.' },
];

const REQS = [
  { id: 'pr1', ref: 'PR-2024-001', procurementId: 'PROC-2024-00001', title: 'MacBook Pro Laptops — Engineering Team', category: 'IT', subType: 'Hardware', amount: 2250000, multiYear: false, recurring: false, dept: 'Engineering', requestor: 'u2', budgetOwner: 'u1', budgetCode: 'ENG-IT-2024-Q1', justification: '5x MacBook Pro M3 for incoming engineering hires. Required to meet onboarding schedule.', soleSrc: false, dataHandling: false, itSecReview: true, status: 'Pending Approval', doaTier: 2, sourcingReq: 1, createdAt: '2024-03-14', requiredDate: '2024-04-01', coiDeclared: true, contractReview: false, notes: '', approvals: [{ role: 'Budget Owner', userId: 'u1', action: 'APPROVED', date: '2024-03-15', comment: 'Aligned with approved headcount budget. Proceed.' }] },
  { id: 'pr2', ref: 'PR-2024-002', procurementId: 'PROC-2024-00002', title: 'Salesforce CRM — Annual Enterprise License', category: 'Sales', subType: 'CRM / Sales Enablement Software', amount: 8750000, multiYear: false, recurring: true, dept: 'Sales', requestor: 'u8', budgetOwner: 'u8', budgetCode: 'SALES-CRM-2024', justification: 'Replace legacy spreadsheet CRM. Evaluated 3 vendors; Salesforce scores highest on integration and support.', soleSrc: false, dataHandling: true, itSecReview: true, status: 'In Sourcing', doaTier: 3, sourcingReq: 2, createdAt: '2024-03-10', requiredDate: '2024-05-01', coiDeclared: true, contractReview: true, notes: 'IT security review completed 2024-03-14.', approvals: [{ role: 'Budget Owner', userId: 'u8', action: 'APPROVED', date: '2024-03-11', comment: 'Approved. Budgeted in Sales FY24 plan.' }, { role: 'Procurement Lead', userId: 'u3', action: 'APPROVED', date: '2024-03-13', comment: 'Sourcing underway. Three quotes obtained.' }, { role: 'Finance / CFO', userId: 'u4', action: 'APPROVED', date: '2024-03-15', comment: 'Budget confirmed. Proceed to vendor selection.' }] },
  { id: 'pr3', ref: 'PR-2024-003', procurementId: 'PROC-2024-00003', title: 'Office Supplies & Stationery — Q1 2024', category: 'Administration', subType: 'Office Supplies', amount: 425000, multiYear: false, recurring: false, dept: 'Engineering', requestor: 'u2', budgetOwner: 'u1', budgetCode: 'ADMIN-SUP-2024-Q1', justification: 'Quarterly office supplies replenishment. Standard items: paper, toner, stationery, cleaning supplies.', soleSrc: false, dataHandling: false, itSecReview: false, status: 'Paid', doaTier: 1, sourcingReq: 1, createdAt: '2024-03-01', requiredDate: '2024-03-10', coiDeclared: true, contractReview: false, notes: 'Emergency verbal approval ratified within 2 business days per Section 8.', approvals: [{ role: 'Budget Owner', userId: 'u1', action: 'APPROVED', date: '2024-03-02', comment: 'Standard quarterly supplies. Approved.' }] },
  { id: 'pr4', ref: 'PR-2024-004', procurementId: 'PROC-2024-00004', title: 'Data Centre Migration — Core Infrastructure', category: 'IT', subType: 'IT Managed Services', amount: 47500000, multiYear: false, recurring: false, dept: 'IT', requestor: 'u6', budgetOwner: 'u1', budgetCode: 'IT-INFRA-2024', justification: 'Migrate on-premise data centre to co-location. Reduces CAPEX ~30%, improves DR. Formal RFP completed; TechSolutions selected.', soleSrc: false, dataHandling: true, itSecReview: true, status: 'Pending Approval', doaTier: 4, sourcingReq: 3, createdAt: '2024-03-08', requiredDate: '2024-06-01', coiDeclared: true, contractReview: true, notes: 'Awaiting CEO approval. Legal review initiated.', approvals: [{ role: 'Budget Owner', userId: 'u1', action: 'APPROVED', date: '2024-03-09', comment: 'Approved per capital budget allocation.' }, { role: 'Procurement Lead', userId: 'u3', action: 'APPROVED', date: '2024-03-12', comment: 'Formal RFP completed. TechSolutions recommended.' }, { role: 'Finance / CFO', userId: 'u4', action: 'APPROVED', date: '2024-03-18', comment: 'Budget validated. Contract review required before PO.' }] },
  { id: 'pr5', ref: 'PR-2024-005', procurementId: 'PROC-2024-00005', title: 'AWS Cloud Infrastructure — 3-Year Commitment', category: 'IT', subType: 'Cloud / Infrastructure', amount: 18000000, multiYear: true, recurring: true, dept: 'IT', requestor: 'u6', budgetOwner: 'u1', budgetCode: 'IT-CLOUD-2024', justification: '3-year AWS Reserved Instances for production. 40% saving vs on-demand. Total committed PKR 18M over 36 months.', soleSrc: false, dataHandling: true, itSecReview: true, status: 'PO Issued', doaTier: 3, sourcingReq: 3, createdAt: '2024-02-20', requiredDate: '2024-03-01', coiDeclared: true, contractReview: true, notes: 'Multi-year committed value PKR 18M approved at full value.', approvals: [{ role: 'Budget Owner', userId: 'u1', action: 'APPROVED', date: '2024-02-21', comment: 'Approved. Multi-year commitment within IT capital plan.' }, { role: 'Procurement Lead', userId: 'u3', action: 'APPROVED', date: '2024-02-23', comment: 'CloudServe selected. 3 quotes obtained.' }, { role: 'Finance / CFO', userId: 'u4', action: 'APPROVED', date: '2024-02-26', comment: 'Full PKR 18M commitment approved per Tier 3.' }] },
];

const POS = [
  { id: 'po1', ref: 'PO-2024-001', prId: 'pr3', procurementId: 'PROC-2024-00003', vendorId: 'v3', description: 'Office Supplies & Stationery Q1 2024', amount: 421000, issuedBy: 'u3', issuedAt: '2024-03-03', deliveryDate: '2024-03-08', status: 'Delivered', terms: 'Net 30', notes: '' },
  { id: 'po2', ref: 'PO-2024-002', prId: 'pr5', procurementId: 'PROC-2024-00005', vendorId: 'v2', description: 'AWS Cloud Infrastructure — 3-Year Reserved Instances', amount: 18000000, issuedBy: 'u3', issuedAt: '2024-02-28', deliveryDate: '2024-03-05', status: 'Received', terms: 'Net 45 — Annual invoicing', notes: 'Multi-year contract. CloudServe acts as AWS reseller.' },
  { id: 'po3', ref: 'PO-2024-003', prId: 'pr4', procurementId: 'PROC-2024-00004', vendorId: 'v1', description: 'Data Centre Migration Services', amount: 47500000, issuedBy: null, issuedAt: null, deliveryDate: null, status: 'Draft', terms: 'Milestone-based', notes: 'PO pending CEO approval of PR-2024-004.' },
];

const QUOTES = [
  { id: 'q1', prId: 'pr2', vendorId: 'v1', vendorName: 'Salesforce (via TechSolutions)', amount: 9200000, submittedAt: '2024-03-12', score: 72, notes: 'Full enterprise suite. Higher cost. Strong integration.' },
  { id: 'q2', prId: 'pr2', vendorId: null, vendorName: 'Zoho CRM', amount: 7800000, submittedAt: '2024-03-12', score: 65, notes: 'Lower cost. Limited enterprise integrations.' },
  { id: 'q3', prId: 'pr2', vendorId: null, vendorName: 'Microsoft Dynamics 365', amount: 8500000, submittedAt: '2024-03-13', score: 78, notes: 'Best overall score. Strong MS ecosystem fit.' },
];

const RECEIPTS = [
  { id: 'r1', poId: 'po1', receivedBy: 'u1', receivedAt: '2024-03-09', qty: 'All items as per PO', condition: 'Good', notes: 'All items received and verified.', signed: true },
  { id: 'r2', poId: 'po2', receivedBy: 'u6', receivedAt: '2024-03-06', qty: 'AWS Reserved Instances activated', condition: 'N/A — cloud service', notes: 'Service activation confirmed.', signed: true },
];

const INVOICES = [
  { id: 'inv1', poId: 'po1', receiptId: 'r1', vendorRef: 'INV-PM-2024-045', vendorId: 'v3', amount: 421000, invoiceDate: '2024-03-09', dueDate: '2024-04-08', status: 'Paid', matchStatus: 'Matched', discrepancy: null, paidAt: '2024-03-28', notes: '', procurementId: 'PROC-2024-00003', submittedBy: null },
  { id: 'inv2', poId: 'po2', receiptId: 'r2', vendorRef: 'INV-CS-2024-112', vendorId: 'v2', amount: 18150000, invoiceDate: '2024-03-07', dueDate: '2024-04-21', status: 'Discrepancy', matchStatus: 'Discrepancy', discrepancy: 'Invoice PKR 18,150,000 exceeds PO PKR 18,000,000 by PKR 150,000. Vendor claims setup fee not in PO. Under investigation.', paidAt: null, notes: 'CFO contacted CloudServe for credit note or amended PO. Do not release payment until resolved.', procurementId: 'PROC-2024-00005', submittedBy: null },
];

const COI = [
  { id: 'coi1', userId: 'u6', declaredAt: '2024-03-05', party: 'DataSoft Systems', relationship: 'Former employer (IT Lead was CTO at DataSoft 2019–2022)', procRefs: JSON.stringify(['pr4']), status: 'Active', recused: true, reviewedBy: 'u4', reviewNote: 'Conflict confirmed. Tariq Khan recused from all DataSoft-related steps.' },
  { id: 'coi2', userId: 'u2', declaredAt: '2024-03-01', party: 'PrintMasters Office Supplies', relationship: 'Family member (sibling) employed as sales rep', procRefs: JSON.stringify(['pr3']), status: 'Resolved', recused: false, reviewedBy: 'u4', reviewNote: 'Reviewed by CFO. Low-value, low-risk. Not material. No recusal required but disclosed.' },
  { id: 'coi3', userId: 'u3', declaredAt: '2024-03-05', party: 'None', relationship: 'No conflicts to declare', procRefs: JSON.stringify([]), status: 'Active', recused: false, reviewedBy: null, reviewNote: '' },
];

const EXCEPTIONS = [
  { id: 'exc1', ref: 'WAV-2024-001', type: 'Emergency Purchase', policySection: 'Section 8', prRef: 'PR-2024-003', requestedBy: 'u1', approvedBy: 'u4', requestedAt: '2024-03-01', approvedAt: '2024-03-03', status: 'Approved', reason: 'Urgent replenishment — office ran out of critical supplies. Verbal approval ratified within 2 business days per Section 8.', duration: 'One-time', compensatingControls: 'Full documentation. Three-way match completed. CFO ratified.', notes: '' },
  { id: 'exc2', ref: 'WAV-2024-002', type: 'Sole-Source Justification', policySection: 'Section 9', prRef: 'PR-2024-005', requestedBy: 'u6', approvedBy: null, requestedAt: '2024-02-22', approvedAt: null, status: 'Pending', reason: 'AWS Reserved Instances only via AWS or authorised reseller. CloudServe is the only authorised AWS reseller on the AVL in Pakistan.', duration: 'Per contract term', compensatingControls: 'Enhanced vendor due diligence completed. Security review complete.', notes: 'Awaiting Audit Committee quarterly review.' },
];

const AUDIT = [
  { ts: '2024-03-01T09:00:00.000Z', userId: 'u2', action: 'PR_SUBMITTED', entity: 'PR-2024-003', detail: 'Purchase Requisition submitted for approval.', procId: 'PROC-2024-00003' },
  { ts: '2024-03-02T10:15:00.000Z', userId: 'u1', action: 'PR_APPROVED', entity: 'PR-2024-003', detail: 'Approved by Budget Owner (T1 — full approval).', procId: 'PROC-2024-00003' },
  { ts: '2024-03-03T08:30:00.000Z', userId: 'u3', action: 'PO_ISSUED', entity: 'PO-2024-001', detail: 'Purchase Order issued to PrintMasters Office Supplies.', procId: 'PROC-2024-00003' },
  { ts: '2024-03-03T09:00:00.000Z', userId: 'u4', action: 'WAIVER_APPROVED', entity: 'WAV-2024-001', detail: 'Emergency purchase waiver approved and ratified by CFO.', procId: '' },
  { ts: '2024-03-06T11:00:00.000Z', userId: 'u6', action: 'RECEIPT_CONFIRMED', entity: 'PO-2024-002', detail: 'Goods/services received and confirmed by IT Lead.', procId: 'PROC-2024-00005' },
  { ts: '2024-03-07T14:00:00.000Z', userId: 'vendor:v2', action: 'INVOICE_RECEIVED', entity: 'INV-CS-2024-112', detail: 'Invoice received from CloudServe Pakistan. Amount PKR 18,150,000.', procId: 'PROC-2024-00005' },
  { ts: '2024-03-08T09:30:00.000Z', userId: 'u4', action: 'MATCH_DISCREPANCY', entity: 'INV-CS-2024-112', detail: 'Three-way match failed: invoice exceeds PO by PKR 150,000. Investigation initiated.', procId: 'PROC-2024-00005' },
  { ts: '2024-03-09T10:00:00.000Z', userId: 'u1', action: 'RECEIPT_CONFIRMED', entity: 'PO-2024-001', detail: 'Office supplies received and signed off by Budget Owner.', procId: 'PROC-2024-00003' },
  { ts: '2024-03-09T11:00:00.000Z', userId: 'u4', action: 'INVOICE_MATCHED', entity: 'INV-PM-2024-045', detail: 'Three-way match successful: reconciled at PKR 421,000.', procId: 'PROC-2024-00003' },
  { ts: '2024-03-28T15:00:00.000Z', userId: 'u4', action: 'PAYMENT_RELEASED', entity: 'INV-PM-2024-045', detail: 'Payment released to PrintMasters Office Supplies. PKR 421,000.', procId: 'PROC-2024-00003' },
  { ts: '2024-03-14T09:00:00.000Z', userId: 'u2', action: 'PR_SUBMITTED', entity: 'PR-2024-001', detail: 'Purchase Requisition submitted for MacBook Pro laptops.', procId: 'PROC-2024-00001' },
  { ts: '2024-03-18T16:00:00.000Z', userId: 'u4', action: 'PR_APPROVED', entity: 'PR-2024-004', detail: 'Approved by Finance/CFO. Tier 4 — awaiting CEO approval.', procId: 'PROC-2024-00004' },
  { ts: '2024-01-08T09:00:00.000Z', userId: 'u7', action: 'VENDOR_BLACKLISTED', entity: 'v6', detail: 'FraudCo Pvt Ltd blacklisted by Audit Committee. Bid manipulation and forged documents.', procId: '' },
];

const FY = 'FY2024-25';
const BUDGETS = [
  { dept: 'Engineering', fiscalYear: FY, code: 'ENG', spent: 3200000, committed: 2250000, items: [
    { name: 'Headcount Tooling & Equipment', amount: 2500000 }, { name: 'Workstations & Hardware', amount: 1500000 }, { name: 'Training & Certifications', amount: 1000000 } ] },
  { dept: 'IT', fiscalYear: FY, code: 'IT', spent: 18000000, committed: 47500000, items: [
    { name: 'Software & SaaS', amount: 10000000 }, { name: 'Cloud & Infrastructure', amount: 10000000 }, { name: 'Hardware & Devices', amount: 5000000 } ] },
  { dept: 'Sales', fiscalYear: FY, code: 'SALES', spent: 5750000, committed: 8750000, items: [
    { name: 'CRM & Sales Tools', amount: 8750000 }, { name: 'Events & Conferences', amount: 2000000 }, { name: 'Marketing Collateral', amount: 1250000 } ] },
  { dept: 'Operations', fiscalYear: FY, code: 'OPS', spent: 1200000, committed: 0, items: [
    { name: 'Third-Party Services', amount: 2000000 }, { name: 'Facilities & Maintenance', amount: 1000000 } ] },
  { dept: 'HR', fiscalYear: FY, code: 'HR', spent: 500000, committed: 0, items: [
    { name: 'Recruitment & Hiring', amount: 2000000 }, { name: 'HR & Payroll Systems', amount: 1500000 }, { name: 'Training & L&D', amount: 1500000 } ] },
];

async function seed(prisma) {
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  for (const u of USERS) await prisma.user.create({ data: { ...u, passwordHash: hash } });
  for (const v of VENDORS) await prisma.vendor.create({ data: v });
  for (const r of REQS) {
    const { approvals, ...rest } = r;
    await prisma.requisition.create({ data: { ...rest, approvals: { create: approvals.map(a => ({ role: a.role, userId: a.userId, action: a.action, date: a.date, comment: a.comment })) } } });
  }
  for (const p of POS) await prisma.purchaseOrder.create({ data: p });
  for (const q of QUOTES) await prisma.quote.create({ data: q });
  for (const r of RECEIPTS) await prisma.receipt.create({ data: r });
  for (const i of INVOICES) await prisma.invoice.create({ data: i });
  for (const c of COI) await prisma.coi.create({ data: c });
  for (const e of EXCEPTIONS) await prisma.exception.create({ data: e });
  for (const a of AUDIT) await prisma.auditLog.create({ data: a });
  for (const b of BUDGETS) {
    const total = b.items.reduce((s, i) => s + i.amount, 0);
    await prisma.budget.create({ data: { dept: b.dept, fiscalYear: b.fiscalYear, code: b.code, spent: b.spent, committed: b.committed, total, items: { create: b.items.map(i => ({ name: i.name, amount: i.amount })) } } });
  }
  await prisma.config.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', deptApprovalConfig: '{}', procIdSeq: 5 }, update: {} });
  console.log(`[seed] Seeded ${USERS.length} users, ${VENDORS.length} vendors, ${REQS.length} requisitions.`);
}

// Runs only when the DB is empty.
async function ensureSeed(prisma) {
  const n = await prisma.user.count();
  if (n > 0) { console.log(`[seed] ${n} users present — skipping seed.`); return; }
  await seed(prisma);
}

module.exports = { seed, ensureSeed, DEMO_PASSWORD };

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  ensureSeed(prisma).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
}
