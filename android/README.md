# Workshop — local Android inventory

The Android app source is prepared for Android 8.0 or later. It bundles the inventory interface and barcode decoder and keeps stock, jobs, scanning name and transaction history in the phone's private WebView IndexedDB storage. It has **no internet permission**, stock server, account or hosting requirement.

**An installable APK has not been built.** This workspace lacks the Android SDK platform and build tools, and no tools have been downloaded. Native Android code has not been compiled or tested on a phone. The source archive is not an installable app.

## Phone use once an APK is built

1. Save `workshop.apk` on the Android phone and open it in Files. Android may ask you to allow installation from the file-opening app. No PC or internet is needed to use Workshop.
2. Open Workshop and enter the name recorded on stock transactions.
3. Add a material, tap **Scan** beside Barcode, allow Workshop camera access, and scan its label. Save its name/unit, then record its opening quantity using **Stock In**.
4. Create a job with a client and description. **Stock Out** always requires an active destination job. Use **Return Stock** from the job to bring unused materials back to the Workshop.
5. Open a job for its complete material history and taken/returned/net summary.

The bundled html5-qrcode 2.3.8 decoder supports EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, ITF and QR. It prefers the rear camera. Camera access requires the Android camera permission; a denied permission can be enabled in Android Settings → Apps → Workshop → Permissions. Camera hardware and Android System WebView behavior still need device verification.

## Records and backups

Tap **Ready offline / Saved on this phone**, then **Save backup**. Android's document picker requests local storage; choose a folder on the phone. Success is shown only after the file write finishes. Use **Restore backup** to select a Workshop JSON backup smaller than 20 MB. Restoration validates the complete stock ledger before saving and requires an empty inventory. Canceling the picker leaves inventory unchanged.

Clearing app data, uninstalling Workshop, or losing the phone removes records that have not been backed up. Keep copies of your backup outside the app's private storage. Android automatic app backup is disabled; backups are deliberate file saves. App updates must preserve the package ID, signing key and asset origin to retain the existing database. The application never clears IndexedDB during startup or update.

## Stock integrity

Every movement uses one IndexedDB readwrite transaction to save both Workshop quantity and its permanent audit record. A failed write rolls back both. Stock-out requires an existing Active job; returns require an existing job and cannot exceed its net materials. Completed jobs retain their history and accept returns. Duplicate confirmations are idempotent, including across connections.

Audit records contain item/unit, positive whole quantity, date/time, client/job, scanning name, Workshop quantity before/after and a sequence preserving recording order if the phone clock changes. Job summaries show taken, returned and net quantities.

## Local Android build

This is an authoring step, not a requirement for using the app on a phone. No Gradle, Maven or npm dependency download is needed. A builder must already have Node.js 24+, Java with its compiler/keytool modules, `zip`, Android SDK platform 35 or later and Android build tools containing `aapt2`, `d8`, `zipalign` and `apksigner`.

```sh
node scripts/build-android.mjs --check --sdk /path/to/already-installed/android-sdk
node scripts/build-android.mjs --sdk /path/to/already-installed/android-sdk
```

The build script never downloads tools or accesses a repository. It stages the app under `assets/www`, compiles the platform-only Activity, aligns/signs/verifies the APK, and outputs `android/build/workshop.apk`. It creates a private signing key and password in the gitignored `android/signing/` directory on the first successful build. Preserve those files privately for updates. Increase `--version-code` for subsequent releases; `--version-name` is optional.

The native wrapper uses a fixed virtual HTTPS origin, `https://workshop.local/`, served directly from APK assets through WebView interception. This is not a network address or running server. External requests/navigation are blocked; file/content URL access stays disabled. Camera requests grant video capture only for this local origin. Backups use Android's document picker through a small JavaScript bridge. Native launch does not register a service worker or need an initial online install.

## Verification and remaining checks

`node scripts/build.mjs` and `npm test` validate the phone storage, scanner lifecycle, actual EAN-13 raster decoder, offline web package and Android bridge behavior. The IndexedDB test dependency is in-memory; these checks do not establish physical phone persistence. Native Android source and build commands still require an SDK build and real-device checks.

Before calling the APK ready, verify: first launch in airplane mode; barcode registration and stock scanning; denied camera permission followed by retry; camera release on background/close; Workshop 4 + 3 = 7, then 7 − 2 = 5 assigned to a job; returns 20 − 4 = 16 net; restart persistence; local backup save, cancel and empty-inventory restore; and an APK update preserving records.

The older PWA, SQLite/PC implementation and Sites configuration remain in source for reference. No site has been published. The Android build packages the static interface only and does not use those servers or hosting configuration. `npm start` is an optional authoring preview, not the phone installation route.
