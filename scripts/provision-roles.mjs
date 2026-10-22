/**
 * Request creation of TideCloak Realm roles via the standard Management API.
 * IMPORTANT: does NOT bypass Tide QEA. HTTP 202 means pending approval.
 * Supply an authorised Tide realm-admin access token via TIDE_ADMIN_TOKEN.
 * Never put admin tokens in frontend code, Git, or a committed .env file.
 */
const HOST = process.env.TIDE_HOST || 'http://localhost:8080';
const REALM = process.env.TIDE_REALM || 'blind';
const TOKEN = process.env.TIDE_ADMIN_TOKEN;
if (!TOKEN) {
  console.error('Missing TIDE_ADMIN_TOKEN. For hackathon use Tide Console > Advanced > Roles to create these roles and approve in QEA.');
  process.exit(1);
}
const definitions = [
  ['blind_reviewer', 'Review anonymous work and submit scores. Never grant identity decrypt.'],
  ['blind_staff', 'Manage applicant workflow; decrypt requires specific portfolio-stage approval.'],
  ['blind_admin', 'Advance review stage; does not imply identity decrypt.'],
  ['blind_submitter', 'Submit an encrypted synthetic identity for a portfolio.'],
  ...['p001', 'p002', 'p003'].flatMap(id => [
    [`_tide_identity_${id}.selfencrypt`, `Encrypt identity for portfolio ${id.toUpperCase()}.`],
    [`_tide_identity_${id}.selfdecrypt`, `Decrypt identity ONLY when portfolio ${id.toUpperCase()} is at reveal stage.`],
  ]),
];
for (const [name, description] of definitions) {
  try {
    const response = await fetch(`${HOST}/admin/realms/${encodeURIComponent(REALM)}/roles`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    const body = await response.text();
    const status = response.status;
    if (status === 202) console.log(`[${name}] QEA request queued (202). Approve/commit in Tide Console.`);
    else if (status === 201 || status === 204) console.log(`[${name}] Created (${status}).`);
    else if (status === 409) console.log(`[${name}] Already exists or conflicting request (409): inspect roles & QEA.`);
    else console.log(`[${name}] HTTP ${status}: ${body.slice(0, 180)}`);
  } catch (error) {
    console.error(`[${name}] Request failed: ${error.message}`);
  }
}
console.log(`\nNEXT: Visit ${HOST}/realms/${REALM}/tide-console/ → QEA Approvals.`);
console.log('Assign blind_reviewer / blind_staff / blind_admin to distinct accounts; approve each change.');
console.log('Assign matching _tide_identity_p001.selfencrypt etc. to submitter/staff.');
console.log('ONLY after reveal for P-001, assign _tide_identity_p001.selfdecrypt to authorised staff (likewise other portfolios).');
console.log('NEVER assign any selfdecrypt role to default-roles-blind or reviewer.');
console.log('Sign out/in or refresh tokens after any role assignment/revocation.');
