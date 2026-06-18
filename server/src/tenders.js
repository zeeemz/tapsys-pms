// Sealed-bid reverse-auction logic — all timing/visibility decided server-side.

function endsAtMs(t) {
  const open = Date.parse(t.openAt);
  return t.revisionEndsAt ? Date.parse(t.revisionEndsAt) : (open + (t.windowMin || 30) * 60000);
}

// Sealed (before openAt) -> Live (revision window) -> Closed (window elapsed).
function effectiveStatus(t, nowMs) {
  if (t.status === 'Cancelled') return 'Cancelled';
  if (nowMs < Date.parse(t.openAt)) return 'Sealed';
  return nowMs < endsAtMs(t) ? 'Live' : 'Closed';
}

function rankBids(bids) { return (bids || []).slice().sort((a, b) => a.amount - b.amount); }

// Build the view of a tender a given principal is allowed to see.
// Sealed phase: NO amounts are ever returned (to anyone). Live/Closed: amounts + ranking revealed.
function serializeTender(t, principal, nowMs, vendorMap) {
  const status = effectiveStatus(t, nowMs);
  const revealed = status === 'Live' || status === 'Closed';
  const invitedVendorIds = (t.invites || []).map(i => i.vendorId);
  const ranked = rankBids(t.bids || []);
  const base = {
    id: t.id, ref: t.ref, prId: t.prId, procurementId: t.procurementId, title: t.title, dept: t.dept,
    createdBy: t.createdBy, createdAt: t.createdAt, openAt: t.openAt,
    windowMin: t.windowMin, extensionMin: t.extensionMin,
    revisionEndsAt: t.revisionEndsAt || new Date(endsAtMs(t)).toISOString(),
    status, notes: t.notes, bidCount: (t.bids || []).length, invitedCount: invitedVendorIds.length,
  };

  if (principal.type === 'vendor') {
    if (!invitedVendorIds.includes(principal.id)) return null; // not invited -> cannot see at all
    const myBid = (t.bids || []).find(b => b.vendorId === principal.id);
    base.myBid = myBid ? { amount: myBid.amount, revisions: myBid.revisions } : null;
    if (revealed) {
      // Vendor sees every amount + rank, but competitors are anonymised by rank (their identity is not leaked).
      base.bids = ranked.map((b, i) => ({ rank: i + 1, amount: b.amount, isMe: b.vendorId === principal.id, label: b.vendorId === principal.id ? 'You' : `Vendor ${i + 1}` }));
      base.leaderIsMe = ranked[0] && ranked[0].vendorId === principal.id;
      base.winnerIsMe = status === 'Closed' && ranked[0] && ranked[0].vendorId === principal.id;
    } else {
      base.sealed = true; // amounts hidden during sealed phase
    }
    return base;
  }

  // Internal staff — full visibility (names included)
  base.invitedVendorIds = invitedVendorIds;
  base.invitedVendors = invitedVendorIds.map(vid => ({ id: vid, name: (vendorMap && vendorMap[vid]) || 'Vendor' }));
  base.awarded = !!t.selectedVendorId;
  base.selectedVendorId = t.selectedVendorId || null;
  if (revealed) {
    base.bids = ranked.map((b, i) => ({ rank: i + 1, vendorId: b.vendorId, vendorName: (vendorMap && vendorMap[b.vendorId]) || 'Vendor', amount: b.amount, revisions: b.revisions }));
    base.leaderVendorId = ranked[0] ? ranked[0].vendorId : null;
    base.winnerVendorId = status === 'Closed' && ranked[0] ? ranked[0].vendorId : null;
  } else {
    base.sealed = true;
    // Internal can see WHO was invited and who has submitted — but never the sealed amounts.
    base.bids = invitedVendorIds.map(vid => ({ vendorId: vid, vendorName: (vendorMap && vendorMap[vid]) || 'Vendor', submitted: (t.bids || []).some(b => b.vendorId === vid) }));
  }
  return base;
}

module.exports = { endsAtMs, effectiveStatus, rankBids, serializeTender };
