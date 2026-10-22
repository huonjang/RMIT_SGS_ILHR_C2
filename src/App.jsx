import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTideCloak } from '@tidecloak/react';
import './blind-review.css';

const API = 'http://localhost:8787/api';
const ROLE = {
  reviewer: 'reviewer', staff: 'staff', admin: 'blind_admin',
  submitter: 'blind_submitter',
};
// FAST DEMO: P-001 uses the existing Tide 'identity' E2EE roles.
// P-002/P-003 retain distinct tags and require their own scoped Tide roles.
const tagFor = (id) => id === 'P-001' ? 'identity' : `identity_${id.toLowerCase().replace('-', '')}`;
const encryptRole = (id) => `_tide_${tagFor(id)}.selfencrypt`;
const decryptRole = (id) => `_tide_${tagFor(id)}.selfdecrypt`;
const STAGE_LABEL = {
  blind_review: '01 / Blind review',
  evaluated: '02 / Evaluation complete',
  identity_reveal: '03 / Identity reveal',
};

export default function App() {
  const {
    authenticated, isInitializing, isLoading, initError, login, logout,
    token, hasRealmRole, getValueFromToken, doEncrypt, doDecrypt,
  } = useTideCloak();
  const [portfolios, setPortfolios] = useState([]);
  const [selectedId, setSelectedId] = useState('P-001');
  const [ciphertext, setCiphertext] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState('');
  const [score, setScore] = useState(4);
  const [notes, setNotes] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleDetails, setRoleDetails] = useState([]);

  // Tide-controlled roles. There is deliberately no switcher to impersonate them.
  const has = (role) => Boolean(authenticated && hasRealmRole?.(role));
  const isAdmin = has(ROLE.admin) || has('tide-realm-admin');
  const isStaff = has(ROLE.staff);
  const isReviewer = has(ROLE.reviewer);
  const isSubmitter = has(ROLE.submitter);
  const canEncrypt = has(encryptRole(selectedId)) && (isStaff || isSubmitter || isAdmin);
  const canDecrypt = has(decryptRole(selectedId));
  const roleName = isAdmin ? 'Administrator' : isStaff ? 'Staff' : isReviewer ? 'Reviewer' : isSubmitter ? 'Submitter' : 'No review role';
  const person = authenticated
    ? (getValueFromToken?.('preferred_username') || getValueFromToken?.('name') || 'Authenticated user')
    : 'Guest';
  const selected = useMemo(() => portfolios.find(x => x.id === selectedId) ?? null, [portfolios, selectedId]);

  useEffect(() => {
    // Preserve the SDK's authentication callback. Remove its URL only AFTER init completes.
    if (location.pathname === '/auth/redirect' && !isInitializing && authenticated) {
      history.replaceState(null, '', '/');
    }
  }, [isInitializing, authenticated]);

  const api = useCallback(async (path, options = {}) => {
    if (!token) throw new Error('TideCloak access token is not available yet. Sign in again.');
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      });
    } catch {
      throw new Error('Demo API is offline. Run: node server/index.mjs');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.detail || `API HTTP ${response.status}`);
    return body;
  }, [token]);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [data, me] = await Promise.all([api('/portfolios'), api('/me')]);
      setPortfolios(data.portfolios);
      setRoleDetails(me.roles || []);
      setApiError('');
    } catch (error) {
      setApiError(error.message);
    }
  }, [api, token]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setIdentity(null); setCiphertext(null); setMessage(''); }, [selectedId]);

  async function perform(action) {
    setBusy(true);
    setMessage('');
    try { await action(); }
    catch (error) { setMessage(`⚠ ${error.message || String(error)}`); }
    finally { setBusy(false); }
  }

  async function sealIdentity(event) {
    event.preventDefault();
    await perform(async () => {
      if (!canEncrypt) throw new Error(`Tide role ${encryptRole(selectedId)} and submitter/staff permission required.`);
      if (!name.trim() || !email.trim()) throw new Error('Enter a synthetic name and email.');
      // CRITICAL: plaintext exists only in the submitter's browser and is never posted to API.
      const plaintext = JSON.stringify({ fullName: name.trim(), email: email.trim() });
      const [encrypted] = await doEncrypt([{ data: plaintext, tags: [tagFor(selectedId)] }]);
      await api(`/portfolios/${selectedId}/identity`, {
        method: 'PUT', body: JSON.stringify({ encrypted }),
      });
      setName(''); setEmail(''); setIdentity(null);
      setMessage('✓ Identity encrypted in the browser; API stored ciphertext only.');
      await reload();
    });
  }

  async function attemptReveal() {
    await perform(async () => {
      if (!authenticated) throw new Error('Sign in first.');
      const { encrypted, stage } = await api(`/portfolios/${selectedId}/identity`);
      setCiphertext(encrypted);
      setIdentity(null);
      if (!encrypted) throw new Error('No encrypted identity yet. Add one using a submitter/staff account.');
      // Do not simulate denial. Attempt the REAL Tide decryption even for reviewers.
      // If a reviewer accidentally has selfdecrypt, that is a REAL security failure.
      let decrypted;
      try {
        [decrypted] = await doDecrypt([{ encrypted, tags: [tagFor(selectedId)] }]);
      } catch (error) {
        setMessage(`✓ Tide decrypt denied: ${error?.message || 'Missing required decryption permission'}`);
        return;
      }
      // A successful decrypt outside authorised stage/role is a real security misconfiguration.
      // Never render the decrypted identity on an unauthorised screen.
      if (stage !== 'identity_reveal') {
        setMessage(`🚨 SECURITY MISCONFIGURATION: Tide decrypted BEFORE reveal. Revoke ${decryptRole(selectedId)} from this account!`);
        return;
      }
      if (!isStaff) {
        setMessage('🚨 SECURITY MISCONFIGURATION: non-staff account can decrypt. Revoke its decrypt role!');
        return;
      }
      const decoded = JSON.parse(typeof decrypted === 'string' ? decrypted : new TextDecoder().decode(decrypted));
      setIdentity(decoded);
      setMessage('✓ Tide decrypted identity for authorised staff in reveal stage.');
    });
  }

  async function sendReview(event) {
    event.preventDefault();
    await perform(async () => {
      await api(`/portfolios/${selectedId}/reviews`, {
        method: 'POST', body: JSON.stringify({ score: Number(score), notes: notes.trim() }),
      });
      setNotes('');
      setMessage('✓ Anonymous review submitted.');
      await reload();
    });
  }

  async function advance() {
    await perform(async () => {
      const result = await api(`/portfolios/${selectedId}/stage`, { method: 'POST' });
      setMessage(result.stage === 'identity_reveal'
        ? `✓ Reveal stage reached. NEXT: approve grant of ${decryptRole(selectedId)} to staff in Tide QEA; require staff re-login.`
        : '✓ Evaluation closed. Advance once more to reveal stage when approved.');
      await reload();
    });
  }

  if (isInitializing) return <main className="br-app br-loading">Connecting securely to TideCloak…</main>;

  return (
    <div className="br-app">
      <div className="br-shell">
        <header className="br-topbar">
          <div className="br-brand"><span className="br-logo">B</span><span>BlindReview</span><small>powered by TideCloak</small></div>
          <div className="br-login">
            <span className={`br-dot ${authenticated ? 'br-on' : ''}`} />
            <span>{authenticated ? `${person} · ${roleName}` : 'Not signed in'}</span>
            {authenticated
              ? <button onClick={() => logout()} className="br-button br-secondary">Log out</button>
              : <button onClick={() => login()} disabled={isLoading} className="br-button">Sign in with Tide</button>}
          </div>
        </header>
        <section className="br-hero">
          <div><p className="br-eyebrow">EDUCATION · FAIRNESS · ENCRYPTED IDENTITY</p>
            <h1>Judge the work.<br /><span>Not the person.</span></h1>
            <p className="br-lead">Review samples anonymously, record an evidence-based score, and reveal applicant identity only at the authorised stage.</p>
          </div>
          <div className="br-promise"><span>THE TRUST GUARANTEE</span><strong>Identity is encrypted, not merely hidden.</strong><p>Reviewer access checks happen in the Tide decrypt operation, not just through CSS.</p></div>
        </section>
        {initError && <div role="alert" className="br-alert br-error">TideCloak: {initError.message}</div>}
        <div className="br-banner">PROTOTYPE · Synthetic applicants only. Role checks come from Tide tokens; reveal-role grants and revocations require Tide QEA approval. API data is in-memory.</div>
        {authenticated && <div className="br-status"><strong>Your Tide permissions:</strong>
          <span>{roleName}</span><span>Encrypt: {canEncrypt ? 'Yes' : 'No'}</span><span>Decrypt: {canDecrypt ? 'Yes' : 'No'}</span>
        </div>}
        {authenticated && roleName === 'No review role' && <div className="br-alert">Your account is signed in but has no BlindReview realm role yet. An administrator must assign one in TideCloak and approve it through QEA.</div>}
        {isReviewer && canDecrypt && <div className="br-alert br-error" role="alert">SECURITY MISCONFIGURATION: Reviewer has Tide identity decrypt permission. Revoke it before running the blind-review demo.</div>}
        {apiError && <div className="br-alert br-error" role="alert">{apiError}<button className="br-link" onClick={reload}>Retry</button></div>}
        {message && <div className={`br-alert ${message.includes('SECURITY') ? 'br-error' : ''}`} role="status">{message}</div>}
        <div className="br-layout">
          <aside className="br-sidebar">
            <div className="br-sidehead"><strong>Portfolios</strong><span>{portfolios.length} submissions</span></div>
            {portfolios.map(x => <button key={x.id} onClick={() => setSelectedId(x.id)}
              className={`br-portfolio ${selectedId === x.id ? 'br-selected' : ''}`}>
              <small>{x.id} · {x.track}</small><strong>{x.title}</strong>
              <span>{STAGE_LABEL[x.stage]}</span>
            </button>)}
            {!authenticated && <p className="br-muted">Sign in to view anonymous portfolios.</p>}
            <button className="br-button br-secondary br-refresh" onClick={reload} disabled={!authenticated}>Refresh data</button>
          </aside>
          <main className="br-content">
            {!selected ? <div className="br-empty">{authenticated ? 'Assign a Tide role and start the API server to load portfolios.' : 'Sign in with your Tide account to begin.'}</div> : <>
              <div className="br-titleline"><div><span className="br-eyebrow">{selected.id} / ANONYMOUS SUBMISSION</span><h2>{selected.title}</h2></div>
                <span className="br-pill">{STAGE_LABEL[selected.stage]}</span></div>
              <div className="br-card"><div className="br-kicker">WORK SAMPLE</div><p>{selected.summary}</p>
                <div className="br-tags">{selected.skills.map(s => <span key={s}>{s}</span>)}</div></div>
              <div className="br-card"><div className="br-kicker">EVALUATION CRITERIA</div>
                <div className="br-tags">{selected.rubric.map(x => <span key={x}>{x}</span>)}</div></div>
              <div className="br-card br-identity">
                <div className="br-card-title"><div><div className="br-kicker">ENCRYPTED IDENTITY</div><h3>Applicant identity</h3></div>
                  <span className="br-pill">{selected.hasIdentity ? 'Ciphertext stored' : 'Not yet sealed'}</span></div>
                <p>Raw identity is not included in the work sample or API response. A reviewer can still try Tide decryption, which must be denied without the correct cryptographic role.</p>
                <div className="br-actions"><button className="br-button br-outline" onClick={attemptReveal} disabled={!selected.hasIdentity || busy}>Attempt Tide decrypt</button>
                  <span>{selected.stage === 'identity_reveal' ? 'Stage allows authorised staff reveal' : 'Blind review: decrypt permission must remain withheld'}</span></div>
                {ciphertext && <details className="br-cipher"><summary>Inspect stored ciphertext (not plaintext)</summary><code>{typeof ciphertext === 'string' ? ciphertext.slice(0, 180) : JSON.stringify(ciphertext).slice(0, 180)}…</code></details>}
                {identity && <div className="br-revealed"><strong>{identity.fullName}</strong><span>{identity.email}</span></div>}
              </div>
              {canEncrypt && selected.stage === 'blind_review' && selected.reviews.length === 0 && <form className="br-card br-form" onSubmit={sealIdentity}>
                <div className="br-kicker">SUBMITTER / STAFF · ENCRYPT WITH TIDE</div><h3>Seal a synthetic identity</h3>
                <p>Enter demo-only details. The browser encrypts them before anything is uploaded.</p>
                <div className="br-fields"><label>Fake applicant name<input required autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="Demo Applicant A" /></label>
                  <label>Fake email<input type="email" required autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder="applicant-a@example.test" /></label></div>
                <button className="br-button" disabled={busy}>Encrypt & save ciphertext</button>
              </form>}
              {isReviewer && selected.stage === 'blind_review' && <form className="br-card br-form" onSubmit={sendReview}>
                <div className="br-kicker">REVIEWER ONLY</div><h3>Submit your blind assessment</h3>
                <label>Score (1–5)<select value={score} onChange={e => setScore(Number(e.target.value))}>{[1,2,3,4,5].map(x => <option value={x} key={x}>{x} / 5</option>)}</select></label>
                <label>Evidence & feedback<textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe evidence from the work, not the applicant's identity" required maxLength={800} /></label>
                <button className="br-button" disabled={busy || !selected.hasIdentity}>Submit score</button>
              </form>}
              <section className="br-card"><div className="br-kicker">RECORDED REVIEWS</div><h3>Evaluation history</h3>
                {selected.reviews.length ? selected.reviews.map((r, idx) => <div className="br-review" key={`${r.actor}-${idx}`}><strong>{r.actor} · {r.score}/5</strong><p>{r.notes}</p></div>)
                  : <p className="br-muted">No reviews yet. Work must be scored before progressing.</p>}
              </section>
              {isAdmin && <div className="br-card br-admin"><div className="br-kicker">ADMIN WORKFLOW · SERVER-ENFORCED ROLE</div><h3>Advance review stage</h3>
                <p>Stages progress in order: Blind review → Evaluation complete → Identity reveal. This action does not automatically grant Tide selfdecrypt permission.</p>
                <button className="br-button" onClick={advance} disabled={busy || selected.stage === 'identity_reveal' || !selected.reviews.length}>Advance to next stage</button>
                {selected.stage === 'identity_reveal' && <p className="br-muted">Now grant <code>{decryptRole(selectedId)}</code> to authorised Staff via Tide Console → QEA Approvals, then re-login as Staff.</p>}
              </div>}
              <div className="br-card"><div className="br-kicker">AUDIT TRAIL</div>
                {selected.audit?.length ? selected.audit.map((entry, idx) => <p className="br-audit" key={idx}><time>{new Date(entry.time).toLocaleTimeString()}</time> {entry.action} · {entry.actor}</p>) : <p className="br-muted">Stage and review actions appear here.</p>}
              </div>
            </>}
          </main>
        </div>
        <footer className="br-footer">Blind Portfolio Review · Synthetic data only · Revocation blocks future authorized decrypts after effective policy/session updates; it cannot recall copies already revealed.</footer>
      </div>
    </div>
  );
}
