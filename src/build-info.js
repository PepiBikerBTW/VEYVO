/*
 * build-info.js - the distribution channel this copy of VEYVO was built for. index.html loads it
 * first, before every other script. Classic script, no DOM access, no network.
 *
 *   'github'    the Windows app and the Android APK from the GitHub releases (this file as committed)
 *   'play'      the Google Play build: `node mobile/scripts/sync-web.mjs --channel play` rewrites this
 *               file in mobile/www/src and removes the GitHub-only code (the APK self-updater), because
 *               Play's Device and Network Abuse policy allows updates only through Google Play.
 *   'appstore'  the Apple App Store build (`npm run sync:ios` in mobile/), stripped the same way.
 *
 * Code reads the channel through VeyvoPlatform.build ({ channel, store }) and VeyvoUI.app.build,
 * never from this global directly. A missing or unknown value counts as 'github'.
 */
globalThis.VEYVO_BUILD = Object.freeze({ channel: 'github' });
