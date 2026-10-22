# BlindReview — Blind Portfolio Review

**BlindReview lets teams assess portfolios anonymously, then reveal an applicant’s identity only to authorised staff at the appropriate stage.**

## 1. Vision & originality

A staged education or recruitment review: assess work and evidence first, reveal identity later. Applicants are represented by portfolio IDs rather than names during evaluation.

## 2. Trust constraint insight

Hiding identity on a webpage does not protect it from a privileged server or reviewer. BlindReview stores encrypted identity separately from review content, so seeing a portfolio does not imply permission to decrypt its owner’s details.

## 3. Value & impact

Reviewers can focus on demonstrated skills, reducing opportunities for identity-based bias. Applicants get a more privacy-conscious assessment process.

## 4. Why TideCloak matters

TideCloak provides sign-in, roles and tag-based encryption/decryption. Staff encrypt synthetic names and emails in the browser; the API stores ciphertext. Reviewers lack Tide’s decrypt permission. A later grant to authorised staff can be protected by Tide’s quorum approvals when configured.

## 5. Prototype & storytelling

The demo follows **Staff seals identity → Reviewer fails to decrypt and submits a score → Admin advances the stage → Tide role grant is approved → Authorised Staff decrypts**. The denied and successful decrypt attempts use TideCloak, not simulated UI checks.

## Run locally

1. Run TideCloak on Docker (`:8080`). Configure test users with `staff`, `reviewer`, `blind_admin` and the required `_tide_identity.selfencrypt` / `.selfdecrypt` permissions. Withhold decrypt permission until reveal.
2. Save the Tide adapter as `public/tidecloak.json`; allow `http://localhost:5137` (web origin) and `http://localhost:5137/*` (redirect).
3. Run in **separate terminals**:

   ```
   npm install
   node server/index.mjs
   ```

   ```
   npm run dev
   ```

4. Open **http://localhost:5137** (API: `:8787`).

**Scope:** Stage changes are app-level; Tide roles control decryption. Quorum requires appropriate Tide configuration. Data is synthetic and stored in memory.
