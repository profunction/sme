"""Generate standard native runner scaffolding without replacing product Dart code."""
import subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]/'mobile'
subprocess.run(['flutter','create','--no-pub','--project-name','nightbrew_fieldops','--org','com.nightbrew','--platforms=android,ios',str(root)],check=True)
# flutter create adds its counter-example test; our real tests have different filenames.
(root/'test/widget_test.dart').unlink(missing_ok=True)
(root/'analysis_options.yaml').write_text('analyzer:\n  exclude: [build/**]\n')
manifest=root/'android/app/src/main/AndroidManifest.xml'
text=manifest.read_text()
if 'android:allowBackup=' not in text:
    text=text.replace('<application','<application android:allowBackup="false" android:fullBackupContent="false"',1)
if 'android.permission.INTERNET' not in text:
    text=text.replace('<application','<uses-permission android:name="android.permission.INTERNET"/>\n    <application',1)
manifest.write_text(text)
# Cleartext access is only for explicit emulator debug builds. Release apps require HTTPS.
debug=root/'android/app/src/debug/AndroidManifest.xml'
text=debug.read_text()
if 'usesCleartextTraffic' not in text:text=text.replace('</manifest>','<application android:usesCleartextTraffic="true"/>\n</manifest>')
debug.write_text(text)
# Keychain-backed session storage, with no iCloud credential synchronization.
for name in ['DebugProfile.entitlements','Release.entitlements']:
    (root/'ios/Runner'/name).write_text('''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>keychain-access-groups</key><array><string>$(AppIdentifierPrefix)$(CFBundleIdentifier)</string></array></dict></plist>''')
project=root/'ios/Runner.xcodeproj/project.pbxproj'
text=project.read_text()
text=text.replace('PRODUCT_BUNDLE_IDENTIFIER = com.nightbrew.nightbrewFieldops;','PRODUCT_BUNDLE_IDENTIFIER = com.nightbrew.nightbrewFieldops;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = Runner/Release.entitlements;')
project.write_text(text)
