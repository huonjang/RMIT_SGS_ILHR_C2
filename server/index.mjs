/**
 * Blind Portfolio Review demo API — ciphertext only, ephemeral in-memory storage.
 * No admin credentials or Tide private keys are handled by this server.
 * Run: node server/index.mjs (Node >= 20)
 * Important: token signature/realm role verification is an MVP; DPoP-bound
 * access tokens require DPoP proof verification for production deployments.
 */
import http from 'node:http';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const ISSUER = process.env.TIDE_ISSUER || 'http://localhost:8080/realms/blind';
const CLIENT_ID = process.env.TIDE_CLIENT_ID || 'blind-client';
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5137';
const ROLES = {
  reviewer: 'reviewer',
  staff: 'staff',
  admin: 'blind_admin',
  submitter: 'blind_submitter',
};
const initial = [
  { id: 'P-001', title: 'Low-resource NLP Classifier', track: 'AI Research',
    summary: 'Built a text classifier with a lightweight training pipeline, evaluation and failure analysis.',
    skills: ['Python', 'PyTorch', 'NLP'], rubric: ['Technical reasoning', 'Originality', 'Evidence'],
    stage: 'blind_review', ciphertext: null, reviews: [], audit: [] },
  { id: 'P-002', title: 'Campus Accessibility Mapper', track: 'Software Engineering',
    summary: 'Prototype for reporting inaccessible routes with usability testing and annotated maps.',
    skills: ['React', 'UX Research', 'APIs'], rubric: ['Technical reasoning', 'Impact', 'Communication'],
    stage: 'blind_review', ciphertext: null, reviews: [], audit: [] },
  { id: 'P-003', title: 'Anomaly Detection for Network Logs', track: 'Cybersecurity',
    summary: 'Exploration of unsupervised anomaly signals, baseline metrics and false-positive analysis.',
    skills: ['Security', 'Data Analysis', 'Python'], rubric: ['Technical reasoning', 'Originality', 'Evidence'],
    stage: 'blind_review', ciphertext: null, reviews: [], audit: [] },
];
const portfolios = new Map(initial.map(x => [x.id, x]));
const stages = ['blind_review', 'evaluated', 'identity_reveal'];
// FAST DEMO: P-001 uses the existing Tide 'identity' E2EE roles.
// P-002/P-003 retain distinct tags and require their own scoped Tide roles.
const tagFor = (id) => id === 'P-001' ? 'identity' : `identity_${id.toLowerCase().replace('-', '')}`;
const encryptRole = (id) => `_tide_${tagFor(id)}.selfencrypt`;
let jwks = { keys: [], fetched: 0 };

function b64url(s) { return Buffer.from(s, 'base64url'); }
function parsePart(s) { return JSON.parse(b64url(s).toString('utf8')); }
async function getJwks() {
  if (Date.now() - jwks.fetched < 60_000 && jwks.keys.length) return jwks.keys;
  const resp = await fetch(`${ISSUER}/protocol/openid-connect/certs`, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error('TideCloak JWKS unavailable');
  const data = await resp.json();
  jwks = { keys: data.keys, fetched: Date.now() };
  return data.keys;
}
async function verifyAccessToken(raw) {
  if (!raw || raw.length > 16000) throw new Error('Missing or oversized access token');
  const parts = raw.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parsePart(encodedHeader);
  const claims = parsePart(encodedPayload);
  if (!['EdDSA', 'RS256', 'ES256', 'PS256'].includes(header.alg)) throw new Error('Unsupported token algorithm');
  if (!header.kid) throw new Error('Missing key ID');
  const keys = await getJwks();
  const jwk = keys.find(k => k.kid === header.kid && (!k.alg || k.alg === header.alg));
  if (!jwk) throw new Error('Unknown token signing key');
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const signingInput = Buffer.from(`${encodedHeader}.${encodedPayload}`);
  const signature = b64url(encodedSignature);
  const algorithm = header.alg === 'EdDSA' ? null : 'sha256';
  const options = header.alg === 'ES256'
    ? { key, dsaEncoding: 'ieee-p1363' }
    : header.alg === 'PS256'
      ? { key, padding: 6, saltLength: 32 }
      : key;
  if (!cryptoVerify(algorithm, signingInput, options, signature)) throw new Error('Invalid JWT signature');
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER || !claims.sub || !Number.isFinite(claims.exp) || claims.exp <= now ||
      (claims.nbf && claims.nbf > now + 30)) throw new Error('Expired or wrong-realm token');
  // Keycloak typically puts its browser client in azp, not necessarily aud.
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.azp !== CLIENT_ID && !audiences.includes(CLIENT_ID)) throw new Error('Token not issued for this app');
  return {
    sub: claims.sub,
    roles: Array.isArray(claims.realm_access?.roles) ? claims.realm_access.roles : [],
    actor: `user-${createHash('sha256').update(claims.sub).digest('hex').slice(0, 8)}`,
  };
}
function send(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}
function anyRole(user, ...roles) { return roles.some(r => user.roles.includes(r)); }
function isAdmin(user) { return anyRole(user, ROLES.admin, 'tide-realm-admin'); }
function metadata(item) {
  return { id: item.id, title: item.title, track: item.track, summary: item.summary,
    skills: item.skills, rubric: item.rubric, stage: item.stage, hasIdentity: item.ciphertext !== null,
    reviews: item.reviews.map(r => ({ actor: r.actor, score: r.score, notes: r.notes, createdAt: r.createdAt })),
    audit: item.audit };
}
async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk.toString('utf8');
    if (text.length > 150000) throw new Error('Request too large');
  }
  return JSON.parse(text || '{}');
}
const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin && origin !== ALLOWED_ORIGIN) return send(res, 403, { error: 'Origin not allowed' });
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, issuer: ISSUER });
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return send(res, 401, { error: 'Sign in to TideCloak first' });
    let user;
    try { user = await verifyAccessToken(auth.slice(7)); }
    catch (e) { return send(res, 401, { error: 'Invalid/expired Tide token', detail: e.message }); }
    if (!anyRole(user, ROLES.reviewer, ROLES.staff, ROLES.submitter) && !isAdmin(user))
      return send(res, 403, { error: 'Tide role is not yet assigned' });
    if (url.pathname === '/api/me' && req.method === 'GET')
      return send(res, 200, { actor: user.actor, roles: user.roles });
    if (url.pathname === '/api/portfolios' && req.method === 'GET')
      return send(res, 200, { portfolios: Array.from(portfolios.values(), metadata) });
    const match = url.pathname.match(/^\/api\/portfolios\/(P-\d{3})(?:\/(identity|reviews|stage))?$/);
    if (!match) return send(res, 404, { error: 'Unknown route' });
    const item = portfolios.get(match[1]);
    if (!item) return send(res, 404, { error: 'Portfolio not found' });
    const action = match[2];
    if (action === 'identity' && req.method === 'GET')
      return send(res, 200, { id: item.id, stage: item.stage, encrypted: item.ciphertext });
    if (action === 'identity' && req.method === 'PUT') {
      if (!anyRole(user, encryptRole(item.id)) || (!anyRole(user, ROLES.submitter, ROLES.staff) && !isAdmin(user)))
        return send(res, 403, { error: 'Missing submitter/staff and Tide selfencrypt roles' });
      if (item.stage !== 'blind_review' || item.reviews.length) return send(res, 409, { error: 'Identity locked once review begins' });
      const data = await readBody(req);
      if (!data.encrypted || (typeof data.encrypted !== 'string' && typeof data.encrypted !== 'object'))
        return send(res, 400, { error: 'Tide ciphertext required' });
      item.ciphertext = data.encrypted;
      item.audit.unshift({ time: new Date().toISOString(), actor: user.actor, action: 'Encrypted identity uploaded' });
      return send(res, 200, { ok: true });
    }
    if (action === 'reviews' && req.method === 'POST') {
      if (!anyRole(user, ROLES.reviewer)) return send(res, 403, { error: 'Only reviewers may submit scores' });
      if (item.stage !== 'blind_review') return send(res, 409, { error: 'Review stage closed' });
      if (!item.ciphertext) return send(res, 409, { error: 'Seal identity before reviewing' });
      if (item.reviews.some(r => r.userId === user.sub)) return send(res, 409, { error: 'One review per reviewer' });
      const body = await readBody(req);
      if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5 ||
          typeof body.notes !== 'string' || !body.notes.trim() || body.notes.length > 800)
        return send(res, 400, { error: 'Score 1–5 and 1–800 character notes required' });
      item.reviews.push({ userId: user.sub, actor: user.actor, score: body.score, notes: body.notes.trim(), createdAt: new Date().toISOString() });
      item.audit.unshift({ time: new Date().toISOString(), actor: user.actor, action: 'Anonymous review submitted' });
      return send(res, 201, { ok: true });
    }
    if (action === 'stage' && req.method === 'POST') {
      if (!isAdmin(user)) return send(res, 403, { error: 'Only blind_admin can advance stages' });
      const position = stages.indexOf(item.stage);
      if (position === stages.length - 1) return send(res, 409, { error: 'Already at final stage' });
      if (!item.reviews.length) return send(res, 409, { error: 'At least one review must be submitted first' });
      item.stage = stages[position + 1];
      item.audit.unshift({ time: new Date().toISOString(), actor: user.actor, action: `Advanced to ${item.stage}` });
      return send(res, 200, { stage: item.stage, note: 'Grant selfdecrypt to Staff through Tide QEA only after identity_reveal' });
    }
    return send(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    const isInput = error instanceof SyntaxError || error.message === 'Request too large';
    console.error('API error:', error.message);
    return send(res, isInput ? 400 : 500, { error: isInput ? 'Invalid request body' : 'Internal error' });
  }
});
server.listen(PORT, HOST, () => console.log(`Blind Portfolio API: http://${HOST}:${PORT}`));
