# Workshop — Android browser app

Workshop is a browser app for Android Chrome. Stock, jobs, scanning name and permanent material history are stored on the phone in IndexedDB. The barcode decoder is included with the app files. There is no inventory server or stock sync. The inventory uses the scanning name saved on your phone. GitHub Pages serves the app files publicly; stock and job data remain in each phone’s private browser storage.

The browser package is static and can be installed from its secure hosting link. Phone-camera behavior and actual installed-browser persistence remain unverified on a physical device.

## Enable the installation link

The source is linked to `Thomas-Beer-Carpentry/Inventory`. The `Publish Workshop browser app` GitHub Actions workflow builds and checks the static app, then deploys its files to GitHub Pages. It uses pinned official actions and does not need npm dependency installation or a personal access token.

The owner must enable Pages once: open the repository’s **Settings → Pages**, then set **Build and deployment → Source** to **GitHub Actions**. This setting cannot be changed through the connected GitHub tools. The workflow’s standard token cannot enable a disabled Pages site.

If the first workflow attempt failed before Pages was enabled, open **Actions → Publish Workshop browser app** and use **Run workflow** on `main`, or rerun that failed attempt. The successful deployment provides the installation URL. The expected project address is `https://thomas-beer-carpentry.github.io/Inventory/`; it is not a confirmed live link until deployment succeeds.

## Install and use on a phone

Android Chrome's live camera and offline installation need a trustworthy browser origin:

- The usual route is an initial **HTTPS** load. Add Workshop to the Home Screen and wait for **Ready offline**. The app's files are then cached on the phone. Stock entry, job history, returns and barcode scanning can run without an internet connection afterward.
- A local-only route is possible if the phone **already has a local web server**. Extract the browser package into that server's web root and open its fixed `http://localhost:<port>/` or `http://127.0.0.1:<port>/` address in Chrome. These loopback addresses are a secure-context exception; the server must run on the phone, not on a PC or another device. Load the app and wait for Ready offline before testing with that server stopped. Keep the same address/port to keep the same app storage.

Opening `index.html` from Android Files or opening the ZIP directly is not a reliable app installation. Local file/content URLs do not provide this app's root module paths and service-worker setup. An ordinary HTTP address on another device also does not provide the required camera context.

Once installed:

1. Enter the name recorded on transactions.
2. Choose **Add item**. Enter the material name, unit and opening quantity together; scan or enter a barcode if wanted. Continue to the confirmation, then choose **Confirm stock in**.
3. Create a job with its client and description. **Stock Out** requires an Active destination job.
4. Open that job to return unused stock and see its complete history and taken/returned/net material summary.

The Workshop stock list and material count show only materials with a quantity greater than zero. When the last quantity is taken to a job, the row disappears. Its saved material name, unit, barcode and transaction history remain on the phone. Stock In can select these saved materials, and a return makes the row appear again.

Stock rows show a large quantity first, then the material name and last movement, with Stock In alongside. They wrap to fit the phone screen without horizontal scrolling. Barcodes remain saved and searchable but are hidden from the stock list. Material units include bottles and tubs.

Barcodes are optional. Materials without one remain available in the manual material selectors for Stock In, Stock Out and returns. Add Material has two steps: details and quantity, then confirmation. The material and its opening stock-in audit are saved together only when confirmed; cancellation leaves stock unchanged.

Descriptions are needed only when registering a new material. Scanning or typing an already saved barcode in Add Material fills its saved name and unit in the first popup; enter the quantity and continue to confirmation. Barcodes remain text, including leading zeroes, and saved materials are reused rather than duplicated.

Open a job and choose **Delete job** to remove it and its material list from Active and Completed jobs. It moves to **Deleted**, retaining the permanent transactions visible in Activity. Deletion does not change Workshop quantities or automatically return materials. Deleted jobs cannot receive new stock-outs; their history still allows bounded returns of unused materials. **Restore job** puts the job in Completed, where it can be reopened explicitly.

The scanner supports EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, ITF and QR and prefers the rear camera. If the preview is wide or blurry, use the **Camera** selector above the preview to choose the main rear camera. A successfully selected camera is remembered on this phone for this app address. Choose **Automatic rear camera** to reset it. Chrome may not expose every physical lens separately. Continuous autofocus is requested when the chosen camera supports it; unsupported focus controls do not prevent scanning.

Keep the complete barcode inside the frame and hold it steady: acceptance requires at least three matching readings across separate frames over 250 ms, and EAN/UPC readings must pass their check digit. It decodes the bars or QR pattern; the displayed text is the encoded value. Repeated agreement reduces transient misreads but does not guarantee every label is read correctly. Manual barcode entry is also available. First setup reports a failure if service-worker installation fails or offline readiness cannot be confirmed; it does not leave the app waiting indefinitely.

## Keep the records

Use the installed Home Screen app at the same origin consistently. Tap **Saved on this phone / Ready offline** to set the scanning name, download a JSON backup, or restore a backup into an empty inventory. Save backup copies in the phone's Files app before changing phones, clearing browser data or removing the app. Clearing storage or losing the phone removes unbacked-up records. Backups smaller than 20 MB are accepted; validation replays the complete stock history before restoring anything.

Each movement saves Workshop quantity and the permanent audit record in one IndexedDB transaction. Stock-out requires an Active job; returns cannot exceed that job's net materials. Completed jobs keep their history and accept returns. Duplicate confirmations are idempotent. Audit records snapshot item/unit, quantity, date/time, client/job, scanning user and Workshop before/after stock. A recording sequence preserves history order if the phone clock changes.

## Local packaging and verification

```sh
node scripts/build.mjs
npm test
python3 scripts/package-browser.py
```

The static website is in `dist/client`; the browser ZIP is `dist/workshop-browser.zip`. Serve its app files together at a fixed root or project directory. Imports, manifest and service-worker paths are relative, so both `/` and `/Inventory/` work. Keep the trailing slash on the installation URL. Each project path has its own database/cache; the original root database name is preserved. The package script rebuilds locally and requires only Node.js 24+ and Python 3; it makes no downloads or network requests. Hosting only serves these files and receives no inventory writes. It is not required during normal use after caching.

Tests cover transactional stock/job rules, zero-stock filtering, saved barcode reuse, job deletion/restoration, returns, failed writes, concurrent updates, duplicate confirmations, backup validation, scanner lifecycle, lens switching and saved preferences, autofocus failure, conflicting/stale barcode readings, EAN/UPC check digits, an actual EAN-13 bar-only decoder fixture, cached offline resources, and first service-worker installation failure/readiness timeouts. App and camera-control tests use simulated browser boundaries; physical lens availability, focus and accuracy on real labels still need device checks. The IndexedDB test substitute is in-memory; physical phone persistence and installed-app airplane-mode launch also need device checks.

The native Android source is retained under `android/`; see `android/README.md` for its separate status. It has not been built into an APK. Legacy SQLite/PC code and Sites configuration are reference source and are not used by GitHub Pages or the browser inventory. Hosting serves only the static browser app; Workshop inventory is not stored on that host.
