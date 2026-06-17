// Procurement policy rules — the single source of truth, enforced server-side.

const DOA = [
  { tier: 1, max: 1500000, color: 'success', approvers: ['Budget Owner'] },
  { tier: 2, max: 7500000, color: 'info', approvers: ['Budget Owner', 'Procurement Lead'] },
  { tier: 3, max: 30000000, color: 'warning', approvers: ['Budget Owner', 'Procurement Lead', 'Finance / CFO'] },
  { tier: 4, max: 75000000, color: 'danger', approvers: ['Budget Owner', 'Procurement Lead', 'Finance / CFO', 'CEO / Founder'] },
  { tier: 5, max: Infinity, color: 'purple', approvers: ['Budget Owner', 'Procurement Lead', 'Finance / CFO', 'CEO / Founder', 'Audit Committee'] },
];

const SOURCING = [
  { max: 1500000, label: 'Single quote acceptable', minQ: 1, rfp: false },
  { max: 7500000, label: 'Min. 2 written quotes required', minQ: 2, rfp: false },
  { max: 30000000, label: 'Min. 3 written quotes required', minQ: 3, rfp: false },
  { max: Infinity, label: 'Formal RFP / RFQ required', minQ: 3, rfp: true },
];

const CONTRACT_REVIEW_THRESHOLD = 15000000;

function getDoaTier(amount) { return DOA.find(t => amount <= t.max) || DOA[4]; }
function getSourcingRule(amount) { return SOURCING.find(t => amount <= t.max) || SOURCING[3]; }

// Returns the required approver chain for a PR, honouring per-department overrides.
function requiredChain(pr, deptConfig) {
  const cfg = (deptConfig || {})[pr.dept] || {};
  const tier = DOA.find(t => t.tier === pr.doaTier) || DOA[0];
  return cfg[pr.doaTier] || tier.approvers;
}

function approvalProgress(pr, deptConfig) {
  const required = requiredChain(pr, deptConfig);
  const given = pr.approvals || [];
  const givenRoles = given.filter(a => a.action === 'APPROVED').map(a => a.role);
  const nextRole = required.find(r => !givenRoles.includes(r)) || null;
  const complete = required.every(r => givenRoles.includes(r));
  return { required, givenRoles, nextRole, complete };
}

function canApprove(pr, user, deptConfig) {
  if (!user || user.type === 'vendor') return false;
  if (pr.status !== 'Pending Approval') return false;
  const prog = approvalProgress(pr, deptConfig);
  if (prog.complete) return false;
  if (prog.nextRole !== user.role) return false;
  if ((pr.approvals || []).some(a => a.userId === user.id && a.action === 'APPROVED')) return false;
  return true;
}

function needsContractReview(amount, multiYear) { return amount >= CONTRACT_REVIEW_THRESHOLD || !!multiYear; }

module.exports = {
  DOA, SOURCING, CONTRACT_REVIEW_THRESHOLD,
  getDoaTier, getSourcingRule, requiredChain, approvalProgress, canApprove, needsContractReview,
};
