// Writes the iOS version into ios/App/App.xcodeproj/project.pbxproj from the root package.json, so the
// Windows, Android and iOS apps always ship the same version (Android does the same in app/build.gradle).
//
//   MARKETING_VERSION      (CFBundleShortVersionString) = "MAJOR.MINOR.PATCH" from package.json
//   CURRENT_PROJECT_VERSION (CFBundleVersion)           = MAJOR*10000 + MINOR*100 + PATCH, like the Android
//                                                          versionCode (0.4.0 -> 400)
//
// App Store Connect refuses a second upload with the same build number for the same version. To upload the
// same version again (for example a TestFlight fix), either raise the patch version in package.json (preferred,
// keeps Android and iOS aligned) or pass an upload counter:
//
//   node scripts/ios-version.mjs              -> 0.4.0 (400)
//   node scripts/ios-version.mjs --upload 2   -> 0.4.0 (400.2)   400 < 400.1 < 400.2 < 401
//
// `npm run sync:ios` runs this script without --upload. Run it with --upload right before Product > Archive.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const pbxproj = join(here, '..', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

function fail(message) {
  console.error('ios-version: ' + message);
  process.exit(1);
}

const args = process.argv.slice(2);
let upload = process.env.VEYVO_IOS_UPLOAD || '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--upload') upload = args[++i] || '';
  else if (args[i].startsWith('--upload=')) upload = args[i].slice('--upload='.length);
  else fail('unknown argument ' + args[i] + ' (usage: node scripts/ios-version.mjs [--upload N])');
}
if (upload !== '' && !/^[1-9]\d{0,3}$/.test(upload)) fail('--upload must be a whole number from 1 to 9999, got "' + upload + '"');

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version));
if (!m) fail('package.json version "' + version + '" is not MAJOR.MINOR.PATCH');
const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
if (minor > 99 || patch > 99) fail('minor and patch must stay below 100 for the build number scheme, got ' + version);

const marketing = major + '.' + minor + '.' + patch;
const build = String(major * 10000 + minor * 100 + patch) + (upload ? '.' + upload : '');

const before = readFileSync(pbxproj, 'utf8');
const marketingRe = /(\bMARKETING_VERSION = )[^;]*;/g;
const buildRe = /(\bCURRENT_PROJECT_VERSION = )[^;]*;/g;
const marketingCount = (before.match(marketingRe) || []).length;
const buildCount = (before.match(buildRe) || []).length;
if (marketingCount === 0 || buildCount === 0) fail('MARKETING_VERSION / CURRENT_PROJECT_VERSION not found in ' + pbxproj);

const after = before
  .replace(marketingRe, '$1' + marketing + ';')
  .replace(buildRe, '$1' + build + ';');
if (after !== before) writeFileSync(pbxproj, after);
console.log('iOS version ' + marketing + ' (' + build + ')' + (after === before ? ', already set' : ', written to project.pbxproj'));
