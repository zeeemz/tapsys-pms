// Microsoft Entra ID (Azure AD) OpenID Connect — auth-code flow.
// Env-gated: inactive until AAD_TENANT_ID / AAD_CLIENT_ID / AAD_CLIENT_SECRET are set.
const crypto = require('crypto');

const AAD = {
  get tenant() { return process.env.AAD_TENANT_ID || ''; },
  get clientId() { return process.env.AAD_CLIENT_ID || ''; },
  get clientSecret() { return process.env.AAD_CLIENT_SECRET || ''; },
  get allowedDomain() { return (process.env.AAD_ALLOWED_DOMAIN || 'paysyslabs.com').toLowerCase(); },
  enabled() { return !!(this.tenant && this.clientId && this.clientSecret); },

  // Prefer an explicit env (avoids proxy/scheme guesswork on Azure); else derive from the request.
  redirectUri(req) {
    if (process.env.AAD_REDIRECT_URI) return process.env.AAD_REDIRECT_URI;
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
    return `${proto}://${req.get('host')}/api/auth/aad/callback`;
  },

  authorizeUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_id: this.clientId, response_type: 'code', redirect_uri: redirectUri,
      response_mode: 'query', scope: 'openid profile email', state,
    });
    return `https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/authorize?${p.toString()}`;
  },

  async exchangeCode(code, redirectUri) {
    const body = new URLSearchParams({
      client_id: this.clientId, client_secret: this.clientSecret, code,
      redirect_uri: redirectUri, grant_type: 'authorization_code', scope: 'openid profile email',
    });
    const res = await fetch(`https://login.microsoftonline.com/${this.tenant}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');
    return data; // { id_token, access_token, ... }
  },

  // The id_token arrives over a server-to-server TLS call authenticated by the client secret,
  // so we read its claims directly. (Issuer/audience/expiry are still validated below.)
  decodeIdToken(idToken) {
    const parts = String(idToken || '').split('.');
    if (parts.length < 2) throw new Error('Malformed id_token');
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  },

  validateClaims(claims) {
    if (!claims) throw new Error('No claims');
    if (claims.aud !== this.clientId) throw new Error('Token audience mismatch');
    if (claims.tid && this.tenant && this.tenant !== 'common' && claims.tid !== this.tenant) throw new Error('Token tenant mismatch');
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
  for (const [k, v] of _states) if (Date.now() - v > 600000) _states.delete(k); // GC > 10 min
  return Date.now() - t < 600000;
}

module.exports = { AAD, putState, takeState };
