# VEYVO web

Private mobile and desktop browser app. Sign in with the same ChatGPT account on each device. Durable per-user D1 records use optimistic revisions; stale writes are rejected. NVIDIA keys are AES-GCM encrypted, bound to user ID, with KEY_ENCRYPTION_SECRET supplied through Sites secrets. Keys never appear in API reads or browser storage.

NVIDIA model: nvidia/nemotron-3.5-lightning-30b-a3b. Users provide their own NVIDIA key in Settings. Free prototype availability and limits are controlled by NVIDIA. No live NVIDIA key was available during development; provider requests are covered with mocks, not a live model test.

Automatic adaptation runs when the app is open, after data/day changes, with a durable server lease, input fingerprint and 30-minute failure cooldown. It uses the current week, real last-28-day running evidence, available days, effort and volume limits. Chat cannot edit a plan. The volume cap is a product guardrail, not a medical safety guarantee.

Windows history can be exported from desktop Settings and imported here. This is an explicit migration; the Electron app retains separate local data. Use the web on both devices for ongoing synchronization. Strava activities already imported on Windows transfer as runs; direct Strava authorization on this website is not implemented.

`npm test` tests calendar, inputs, plan guards and mocked NVIDIA responses. `npx tsc --noEmit` checks types. `npm run build` produces the Worker. `tests/api.integration.mjs` tests the built Worker at http://127.0.0.1:3001 using disposable local users (identity headers are ONLY injected locally; production trusts the Sites dispatcher). Create local DB from Drizzle migrations before this test. The negative origin test is last because the local Wrangler proxy aborts its unread body and can interrupt a following request.

The optional WebMCP add-run tool is feature-detected and uses the same API action. No supported WebMCP browser validation context was available; its browser contract remains unverified. No browser visual QA was requested/performed.

PWA uses a manifest and network-only service worker with an offline notice. It deliberately does not cache private responses or queue offline mutations. An internet connection is required. Hosted access is owner-only.
