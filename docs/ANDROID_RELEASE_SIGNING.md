# Android upload signing

Release builds use the private upload key configured in `apps/bunya_app/android/key.properties`. They never fall back to the Android debug key. Debug builds retain their normal development signing.

The local setup created on 7 September 2026 keeps the keystore and a recovery copy of its properties outside the repository:

- `%USERPROFILE%\.bunya\signing\android\upload-keystore.jks`
- `%USERPROFILE%\.bunya\signing\android\key.properties`

Access to that folder and the local project properties file is restricted to the current Windows user and SYSTEM. The randomly generated password is stored only in those private properties files and is never printed or written in project documentation. The keystore and properties are ignored by Git.

## Custody and recovery

The owner must securely back up both files to an owner-controlled password manager or encrypted backup before relying on this machine as the only copy. No cloud backup or transfer has been performed. Do not share the private key or its password in chat or commit them to source control.

On a new workstation, restore the keystore securely, copy the properties file to `apps/bunya_app/android/key.properties`, update `storeFile` to the restored absolute location (forward slashes work on Windows), and restrict access to the file. Do not generate a replacement key for routine updates.

When enrolling the app in Play App Signing, this key is the upload key. Google Play app signing has not yet been configured; its distribution certificate can differ from this upload certificate. A future reset of an enrolled upload key requires the Play Console recovery process.

## Build

From the repository root:

```powershell
powershell -NoProfile -File apps/bunya_app/tool/build-appbundle.ps1
```

The build reads only public Supabase client configuration from `.env.local` and uses `https://www.buniahksa.com` as the API origin. Output is `apps/bunya_app/build/app/outputs/bundle/release/app-release.aab`; obfuscation symbols are under `apps/bunya_app/build/symbols/release-aab`. Preserve the symbols with their matching release.

The package identifier remains `com.buniahksa.app`. Increment the version/build number in `pubspec.yaml` before a later upload after a version code has been used in Play Console.

Verify the AAB signature with `jarsigner -verify`, and inspect the certificate with `keytool -printcert -jarfile`. A self-signed upload certificate is expected; an `Android Debug` certificate is not.

Successful signing/building does not imply Play Console enrollment, store review, native push, payment flows, or iOS release validation is complete.
