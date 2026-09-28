# VEYVO

VEYVO is a Windows running journal. Add your existing runs or import training history, then log each run's distance, time, and perceived effort (1–10). The app suggests a conservative next easy run using fixed rules. The weekly calendar shows recorded sessions, milestones, unavailable days, and the next suggested run. Future workouts are set after you log the result and how you felt.

## Windows

Run `npm start` for development. Run `npm test` for running and clock rules. `npm run build` creates the Windows installer and portable app. Strava import remains available. The Settings page can export run history as JSON.

The web app and its account sync have been removed. Local running data remains in the Windows app. The JSON export includes runs and journey milestones and can help transfer them to a future iPhone app.

## Shared training chat

In Settings → Connections, paste a public `chatgpt.com/share/...` link, preview the verified records, and import. VEYVO stores the link and history only on this computer. It checks the link when opened and hourly while running, and skips duplicate runs. The parser records runs only when both distance and time can be verified from the conversation; incomplete sessions appear as milestones. The shared page is not a live ChatGPT Project API. If ChatGPT keeps the share as a snapshot, new messages will not appear until the shared link is updated or replaced. Runs entered directly in VEYVO or imported from Strava remain the reliable ongoing journal.
