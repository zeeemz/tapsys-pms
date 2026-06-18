// Microsoft Entra ID (Azure AD) OpenID Connect — auth-code flow.
// Configuration comes from the DB (set by a Super Admin in the back office),
// falling back to environment variables. SSO is inactive until tenant+client+secret are present.
const crypto = require('crypto');
const { prisma } = require('./db');

const AAD = {
  // Effective configuration: DB value first, then env fallback.
  async cfg() {
    let c = null;
    try { c = await prisma.config.findUnique({ where: { id: 'singleton' } }); } catch (e) {}
    const pick = (db, env) => (db && db.length ? db : (process.env[env] || ''));
    const tenant = pick(c && c.aadTenantId, 'AAD_TENANT_ID');
    const clientId = pick(c && c.aadClientId, 'AAD_CLIENT_ID');
    const clientSecret = pick(c && c.aadClientSecret, 'AAD_CLIENT_SECRET');
    const allowedDomain = (pick(c && c.aadAllowedDomain, 'AAD_ALLOWED_DOMAIN') || 'paysyslabs.com').toLowerCase();
    const redirectUri = pick(c && c.aadRedirectUri, 'AAD_REDIRECT_URI');
    return { tenant, clientId, clientSecret, allowedDomain, redirectUri, enabled: !!(tenant && clientId && clientSecret) };
  },

  redirectUriFor(req, cfg) {
    if (cfg.redirectUri) return cfg.redirectUri;
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
    return `${proto}://${req.get('host')}/api/auth/aad/callback`;
  },

  authorizeUrl(cfg, state, redirectUri) {
    const p = new URLSearchParams({
      client_id: cfg.clientId, response_type: 'code', redirect_uri: redirectUri,
      response_mode: 'query', scope: 'openid profile email', state,
    });
    return `https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/authorize?${p.toString()}`;
  },

  async exchangeCode(cfg, code, redirectUri) {
    const body = new URLSearchParams({
      client_id: cfg.clientId, client_secret: cfg.clientSecret, code,
      redirect_uri: redirectUri, grant_type: 'authorization_code', scope: 'openid profile email',
    });
    const res = await fetch(`https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');
    return data;
  },

  decodeIdToken(idToken) {
    const parts = String(idToken || '').split('.');
    if (parts.length < 2) throw new Error('Malformed id_token');
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  },

  validateClaims(cfg, claims) {
    if (!claims) throw new Error('No claims');
    if (claims.aud !== cfg.clientId) throw new Error('Token audience mismatch');
    if (claims.tid && cfg.tenant && cfg.tenant !== 'common' && claims.tid !== cfg.tenant) throw new Error('Token tenant mismatch');
    if (claims.exp && Date.now() / 1000 > claims.exp) throw new Error('Token expired');
    return true;
  },

  emailFromClaims(claims) {
    return (claims.email || claims.preferred_username || claims.upn || '').toLowerCase();
  },

  randomState() { return crypto.randomBytes(16).toString('hex'); },
};

// Short-lived state store (single instance) to mitigate CSRF on the callback.
const _states = new Map();
function putState(s) { _states.set(s, Date.now()); }
function takeState(s) {
  const t = _states.get(s); if (!t) return false;
  _states.delete(s);
  for (const [k, v] of _states) if (Date.now() - v > 600000) _states.delete(k);
  return Date.now() - t < 600000;
}

module.exports = { AAD, putState, takeState };
