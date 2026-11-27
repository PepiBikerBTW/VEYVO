# Windows app releases

The user clarified that no custom domain is required and requested the Windows app release. Domain and website launch work are outside this release.

- Keep the existing VEYVO application icon and favicon.
- Run unit and Electron UI tests before publishing.
- Publish the installer, portable build and updater metadata together.
- The privacy policy and support page (cs + en, publisher Josef Kožíšek, effective 1. 12. 2026) are written in `site/` and go live on GitHub Pages (`.github/workflows/pages.yml`, https://pepibikerbtw.github.io/VEYVO/) once the owner enables Pages; until then do not claim they are published. Terms of use remain pending.

Design rules: no purple gradients, pill buttons, invented metrics or reviews, emoji icons, generated photos, marketing filler, or cursor effects. Nutrition guidance is source-based educational content requested by the user.

Motion: the user wants nice, polished animations (updated 2026-11-26). Use purposeful motion such as page and card transitions, number count-ups, chart draw-ins, progress fills and micro-interactions on buttons and check-ins. Keep it smooth (transform/opacity, 60 fps) and respect `prefers-reduced-motion`.

Product direction (2026-11-26): built for the owner first, others later. Keep the profile and goal editable instead of hardcoded. The UI is Czech and English with a working language switch. Structured workouts should be exportable to all major watch brands (Garmin, Apple Watch, Coros, Suunto, Polar, others).
