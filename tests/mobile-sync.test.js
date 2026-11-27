// mobile/scripts/sync-web.mjs: build channels for the store copies in mobile/www, and the iOS project
// files that App Store Connect checks (Info.plist keys, privacy manifest, HealthKit entitlement).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const SYNC = path.join(ROOT, 'mobile', 'scripts', 'sync-web.mjs');
const IOS_APP = path.join(ROOT, 'mobile', 'ios', 'App', 'App');

let helpers = null;
async function sync() {
  if (!helpers) helpers = await import(pathToFileURL(SYNC).href);
  return helpers;
}

const codeLines = (text) => text.split('\n').filter((line) => {
  const t = line.trim();
  return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
});

test('stripChannelBlocks keeps github blocks only in the github channel', async () => {
  const { stripChannelBlocks } = await sync();
  const src = ['a();', '  // #if-channel github', '  updater();', '  // #end-channel', 'b();'].join('\n');
  assert.equal(stripChannelBlocks(src, 'github').text, ['a();', '  updater();', 'b();'].join('\n'));
  for (const channel of ['play', 'appstore']) {
    const out = stripChannelBlocks(src, channel);
    assert.equal(out.text, ['a();', 'b();'].join('\n'));
    assert.equal(out.removed, 1);
  }
  const multi = ['// #if-channel play, appstore', 'store();', '// #end-channel'].join('\n');
  assert.equal(stripChannelBlocks(multi, 'appstore').text, 'store();');
  assert.equal(stripChannelBlocks(multi, 'github').text, '');
});

test('stripChannelBlocks rejects broken markers', async () => {
  const { stripChannelBlocks } = await sync();
  assert.throws(() => stripChannelBlocks('// #if-channel github\nx();', 'play'), /never closed/);
  assert.throws(() => stripChannelBlocks('x();\n// #end-channel', 'play'), /without #if-channel/);
  assert.throws(() => stripChannelBlocks('// #if-channel github\n// #if-channel play\n// #end-channel\n// #end-channel', 'play'), /nested/);
  assert.throws(() => stripChannelBlocks('// #if-channel windows\n// #end-channel', 'play'), /unknown channel/);
});

test('setBuildChannel rewrites the channel of the real src/build-info.js', async () => {
  const { setBuildChannel } = await sync();
  const source = fs.readFileSync(path.join(ROOT, 'src', 'build-info.js'), 'utf8');
  for (const channel of ['play', 'appstore', 'github']) {
    const out = setBuildChannel(source, channel);
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.runInNewContext(out, sandbox);
    assert.equal(sandbox.VEYVO_BUILD.channel, channel);
  }
  assert.throws(() => setBuildChannel('const x = 1;', 'play'), /exactly one/);
});

test('store channels strip every GitHub updater call from the real src/ files and stay valid JS', async () => {
  const { stripChannelBlocks } = await sync();
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) files.push(p);
    }
  })(path.join(ROOT, 'src'));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const channel of ['play', 'appstore']) {
      const { text } = stripChannelBlocks(source, channel, path.relative(ROOT, file));
      assert.doesNotThrow(() => new vm.Script(text, { filename: file }), path.relative(ROOT, file) + ' (' + channel + ')');
      assert.deepEqual(codeLines(text).filter((line) => line.includes('api.github.com')), [], path.relative(ROOT, file));
    }
  }
});

const readText = (file) => fs.readFileSync(file, 'utf8');

test('iOS Info.plist, privacy manifest and entitlements carry the App Store settings', () => {
  const info = readText(path.join(IOS_APP, 'Info.plist'));
  assert.match(info, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  assert.match(info, /<key>NSHealthShareUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/);
  assert.doesNotMatch(info, /UIBackgroundModes/);
  assert.match(info, /<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<\/array>/);

  const privacy = readText(path.join(IOS_APP, 'PrivacyInfo.xcprivacy'));
  assert.match(privacy, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(privacy, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  assert.match(privacy, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  assert.match(privacy, /NSPrivacyAccessedAPICategoryUserDefaults<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>CA92\.1<\/string>/);
  assert.match(privacy, /NSPrivacyAccessedAPICategoryFileTimestamp<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>C617\.1<\/string>/);

  const entitlements = readText(path.join(IOS_APP, 'App.entitlements'));
  assert.match(entitlements, /<key>com\.apple\.developer\.healthkit<\/key>\s*<true\/>/);
  assert.match(entitlements, /<key>com\.apple\.developer\.healthkit\.access<\/key>\s*<array\/>/);

  for (const lang of ['en', 'cs']) {
    const strings = fs.readFileSync(path.join(IOS_APP, lang + '.lproj', 'InfoPlist.strings'), 'utf8');
    assert.match(strings, /^"NSHealthShareUsageDescription" = "[^"]{20,}";$/m, lang);
  }

  const pbx = fs.readFileSync(path.join(IOS_APP, '..', 'App.xcodeproj', 'project.pbxproj'), 'utf8');
  assert.equal((pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || []).length, 2);
  assert.equal((pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.veyvo\.coach;/g) || []).length, 2);
  assert.equal((pbx.match(/TARGETED_DEVICE_FAMILY = 1;/g) || []).length, 2);
  assert.match(pbx, /PrivacyInfo\.xcprivacy in Resources/);
  assert.match(pbx, /InfoPlist\.strings in Resources/);
});

// ---------------------------------------------------------------- the app's own Swift plugins (JS <-> Swift contract)

const swift = (name) => readText(path.join(IOS_APP, name));
const swiftMethods = (source) => [...source.matchAll(/CAPPluginMethod\(name: "([A-Za-z]+)", returnType: CAPPluginReturnPromise\)/g)].map((m) => m[1]);

test('VeyvoWorkoutKit and VeyvoHealth: plugin names and methods match what src/platform.js calls', () => {
  const platform = readText(path.join(ROOT, 'src', 'platform.js'));
  const plugins = {
    'VeyvoWorkoutKitPlugin.swift': { jsName: 'VeyvoWorkoutKit', methods: ['isSupported', 'preview', 'schedule', 'listScheduled', 'clearScheduled'] },
    'VeyvoHealthPlugin.swift': { jsName: 'VeyvoHealth', methods: ['isAvailable', 'requestAuthorization', 'importRuns'] }
  };
  for (const [file, want] of Object.entries(plugins)) {
    const source = swift(file);
    assert.match(source, new RegExp('public let jsName = "' + want.jsName + '"'), file);
    assert.match(source, /public class \w+: CAPPlugin, CAPBridgedPlugin \{/, file + ' is a bridged Capacitor plugin');
    assert.deepEqual(swiftMethods(source), want.methods, file + ' pluginMethods');
    for (const method of want.methods) {
      assert.match(source, new RegExp('@objc func ' + method + '\\(_ call: CAPPluginCall\\)'), file + ' implements ' + method);
      assert.match(platform, new RegExp("call\\('" + method + "'"), 'platform.js calls ' + want.jsName + '.' + method);
    }
    assert.match(platform, new RegExp("hasPlugin\\('" + want.jsName + "'\\)"), 'platform.js looks for ' + want.jsName);
  }
  // every error code the Swift side rejects with has a cs + en text
  globalThis.window = globalThis.window || {};
  const Platform = require('../src/platform.js');
  const codes = new Set();
  for (const file of Object.keys(plugins)) for (const m of swift(file).matchAll(/"((?:watch|health)_[a-z_]+)"/g)) codes.add(m[1]);
  assert.ok(codes.size >= 9, [...codes].join(', '));
  for (const code of codes) for (const locale of ['cs', 'en']) assert.ok(Platform.MESSAGES[locale].error[code], code + ' ' + locale);
  // the request fields the plugins read are the ones watchPayload / health.importRuns send
  const wk = swift('VeyvoWorkoutKitPlugin.swift');
  for (const key of ['workoutJson', 'planId', 'indoor', 'date', 'hour']) assert.match(wk, new RegExp('call\\.get(?:String|Bool|Int)\\("' + key + '"\\)'), 'WorkoutKit reads ' + key);
  const hk = swift('VeyvoHealthPlugin.swift');
  for (const key of ['since', 'limit']) assert.match(hk, new RegExp('call\\.get(?:String|Int)\\("' + key + '"\\)'), 'Health reads ' + key);
  for (const key of ['healthId', 'startDate', 'date', 'startTime', 'distanceKm', 'movingSeconds', 'averageHeartrate', 'maxHeartrate', 'sourceName']) {
    assert.match(hk, new RegExp('"' + key + '"'), 'Health rows carry ' + key);
  }
});

test('the native plugins are registered by the bridge subclass, compiled by the App target, read-only for Health', () => {
  const bridge = swift('VeyvoBridgeViewController.swift');
  assert.match(bridge, /class VeyvoBridgeViewController: CAPBridgeViewController/);
  assert.match(bridge, /override func capacitorDidLoad\(\)/);
  assert.match(bridge, /bridge\?\.registerPluginInstance\(VeyvoWorkoutKitPlugin\(\)\)/);
  assert.match(bridge, /bridge\?\.registerPluginInstance\(VeyvoHealthPlugin\(\)\)/);
  assert.match(swift('SceneDelegate.swift'), /window\?\.rootViewController = VeyvoBridgeViewController\(\)/);
  assert.match(swift(path.join('Base.lproj', 'Main.storyboard')), /customClass="VeyvoBridgeViewController" customModule="App" customModuleProvider="target"/);

  const pbx = readText(path.join(IOS_APP, '..', 'App.xcodeproj', 'project.pbxproj'));
  const ids = [...pbx.matchAll(/^\t\t([0-9A-F]{24}) \/\*/gm)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'object ids are unique');
  for (const file of ['VeyvoBridgeViewController.swift', 'VeyvoWorkoutKitPlugin.swift', 'VeyvoHealthPlugin.swift']) {
    const ref = new RegExp('([0-9A-F]{24}) /\\* ' + file.replace('.', '\\.') + ' \\*/ = \\{isa = PBXFileReference; lastKnownFileType = sourcecode\\.swift; path = ' + file.replace('.', '\\.') + '; sourceTree = "<group>"; \\};').exec(pbx);
    assert.ok(ref, file + ' has a file reference');
    const build = new RegExp('([0-9A-F]{24}) /\\* ' + file.replace('.', '\\.') + ' in Sources \\*/ = \\{isa = PBXBuildFile; fileRef = ' + ref[1]).exec(pbx);
    assert.ok(build, file + ' has a build file');
    const sources = /\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//.exec(pbx)[1];
    assert.ok(sources.includes(build[1] + ' /* ' + file + ' in Sources */'), file + ' is in the Sources phase');
    const group = /504EC3061FED79650016851F \/\* App \*\/ = \{([\s\S]*?)\};/.exec(pbx)[1];
    assert.ok(group.includes(ref[1] + ' /* ' + file + ' */'), file + ' is in the App group');
  }
  // WorkoutKit exists from iOS 17 only: weak-linked so iOS 15 and 16 still launch
  assert.equal((pbx.match(/OTHER_LDFLAGS = \(\s*"\$\(inherited\)",\s*"-weak_framework",\s*WorkoutKit,\s*\);/g) || []).length, 2);
  const wk = swift('VeyvoWorkoutKitPlugin.swift');
  const guarded = wk.split('\n').filter((line) => /WorkoutScheduler|WorkoutPlan\(|CustomWorkout\(|\.workoutPreview\(/.test(line) && !line.trim().startsWith('//'));
  assert.ok(guarded.length > 5);
  assert.match(wk, /#if canImport\(WorkoutKit\)\nimport WorkoutKit\n#endif/);
  assert.equal((wk.match(/@available\(iOS 17\.0, \*\)/g) || []).length, 4, 'builder, preview host, preview session and scheduler are iOS 17+');
  assert.equal((wk.match(/if #available\(iOS 17\.0, \*\)/g) || []).length, 5, 'every plugin method checks iOS 17 at run time');

  const hk = swift('VeyvoHealthPlugin.swift');
  assert.match(hk, /requestAuthorization\(toShare: nil, read: readTypes\)/, 'Health access is read only');
  assert.doesNotMatch(hk, /\.save\(|HKWorkoutBuilder|toShare: \[/, 'VEYVO never writes to Health');
  assert.doesNotMatch(readText(path.join(IOS_APP, 'Info.plist')), /NSHealthUpdateUsageDescription/, 'no write permission text for a read-only app');
  // the types read are the ones the permission text promises (workouts with distance, duration and heart rate)
  assert.deepEqual([...hk.matchAll(/quantityType\(forIdentifier: \.(\w+)\)/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort(), ['distanceWalkingRunning', 'heartRate']);
});

test('Android Auto Backup leaves out Capacitor Preferences, where the intervals.icu API key lives', () => {
  const main = path.join(ROOT, 'mobile', 'android', 'app', 'src', 'main');
  const manifest = fs.readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:fullBackupContent="@xml\/backup_rules"/);
  assert.match(manifest, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
  // platform.js keeps only secrets in Preferences; its Android store is SharedPreferences group 'CapacitorStorage'.
  assert.match(fs.readFileSync(path.join(ROOT, 'src', 'platform.js'), 'utf8'), /plugin\('Preferences'\)\.set\(\{ key: SECRET_PREFIX \+ name/);
  const exclude = /<exclude domain="sharedpref" path="CapacitorStorage\.xml" \/>/;
  assert.match(fs.readFileSync(path.join(main, 'res', 'xml', 'backup_rules.xml'), 'utf8'), exclude);
  const rules = fs.readFileSync(path.join(main, 'res', 'xml', 'data_extraction_rules.xml'), 'utf8');
  assert.match(rules.slice(rules.indexOf('<cloud-backup>'), rules.indexOf('</cloud-backup>')), exclude);
});
