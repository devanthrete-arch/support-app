# Autoflex support desk

Central Autoflex operator website for AF-010. React/TypeScript/Vite; default port **5176**. Customer support threads live in `customer-web` at `/support/:id`. Operators have a separate token key and actor boundary; this app does not load the center store or customer account store.

## Local development

1. Apply backend migrations through `1730000000008` and run `npm run workshop:bootstrap`, then `npm run start:workshop`. Alternatively run `PORT=3002 npm run start:memory` for throwaway data.
2. In this directory: `npm ci`, copy `.env.example` to `.env.local`, and set `VITE_AUTOFLEX_API_URL` to that API. `VITE_SUPPORT_LOCAL_AUTH=true` explicitly enables named local accounts.
3. `npm run dev` → `http://localhost:5176/requests`.

| Mobile | Operator | Role |
| --- | --- | --- |
| 9845000011 | Neha Patel | Agent |
| 9845000012 | Kabir Das | Agent |
| 9845000013 | Ananya Rao | Manager |

Other numbers are refused. Bootstrap reruns never reactivate disabled support profiles. Production `main.ts` never registers the local session endpoint. Real IAM sign-in/provisioning is tracked in AF-013; leave local auth disabled in production builds.

## Workflows

Claim an open request before replying or taking private notes. Public messages, resolutions, closures and reopen explanations reach the customer; notes, assignment, priority and internal waiting changes do not. Agents work their own assignments. Managers can reassign active work and close or reopen terminal requests. Inactive-owner work remains visible for manager recovery.

Every new command uses `If-Match` and an `Idempotency-Key`. An uncertain result pauses other commands and offers an exact retry. A version conflict preserves the draft and requires refreshing/reviewing the current conversation. A successful save remains saved when its following refresh fails. Refresh runs every 30 seconds and on focus while visible; no full-page refresh is needed.

## Verification

- `npm run typecheck`
- `npm run build`
- With Vite running, open `/tests/commands.html`. It mounts the actual request component with controlled API responses and reports four browser regression scenarios: independent drafts, response loss/replay, version conflict, and committed save/read failure. No backend or session is used by that harness.

See `../development-documents/architecture/support-work-queue-runbook.md` for migration preflight, provisioning, PostgreSQL concurrency tests and operational recovery.
