const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { prisma } = require('./db');

const SECRET = process.env.JWT_SECRET || 'local-dev-secret-not-for-production';

function signToken(payload) { return jwt.sign(payload, SECRET, { expiresIn: '12h' }); }
function hashPassword(pw) { return bcrypt.hashSync(pw, 10); }
function verifyPassword(pw, hash) { return bcrypt.compareSync(pw, hash); }

// Populates req.auth = { type, id, role } and, for staff, req.user (full user record).
async function authenticate(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  let payload;
  try { payload = jwt.verify(token, SECRET); } catch (e) { return res.status(401).json({ error: 'Invalid or expired session' }); }
  req.auth = payload;
  if (payload.type === 'user') {
    const u = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!u) return res.status(401).json({ error: 'Account not found' });
    req.user = { id: u.id, name: u.name, email: u.email, role: u.role, dept: u.dept, type: 'user' };
  } else if (payload.type === 'vendor') {
    const v = await prisma.vendor.findUnique({ where: { id: payload.sub } });
    if (!v || v.status !== 'Active') return res.status(401).json({ error: 'Vendor access revoked' });
    req.vendor = v;
    req.user = { id: v.id, name: v.contactPerson || v.name, role: 'Vendor', type: 'vendor', vendorId: v.id };
  } else {
    return res.status(401).json({ error: 'Unknown principal' });
  }
  next();
}

// Role gate for internal staff. Pass a list of allowed roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || req.user.type !== 'user') return res.status(403).json({ error: 'Staff access required' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}. You are ${req.user.role}.` });
    }
    next();
  };
}

function requireStaff(req, res, next) {
  if (!req.user || req.user.type !== 'user') return res.status(403).json({ error: 'Staff access required' });
  next();
}

function requireVendor(req, res, next) {
  if (!req.user || req.user.type !== 'vendor') return res.status(403).json({ error: 'Vendor access required' });
  next();
}

module.exports = { signToken, hashPassword, verifyPassword, authenticate, requireRole, requireStaff, requireVendor };
