package com.workshop.inventory;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ServiceWorkerWebSettings;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** All website assets and inventory data remain inside the installed app. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://workshop.local/";
    private static final String ASSET_ROOT = "www/";
    private static final int CAMERA_REQUEST = 101;
    private static final int SAVE_REQUEST = 102;
    private static final int RESTORE_REQUEST = 103;
    private static final int MAX_BACKUP_BYTES = 20 * 1024 * 1024;
    private static final String CSP = "default-src 'self'; script-src 'self'; "
            + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
            + "connect-src 'self'; media-src blob:; frame-src 'none'; "
            + "object-src 'none'; base-uri 'none'; form-action 'none'";

    private final Object backupLock = new Object();
    private final ExecutorService fileIo = Executors.newSingleThreadExecutor();
    private WebView webView;
    private PermissionRequest pendingCamera;
    private boolean cameraPermissionPromptOpen;
    private boolean resumed;
    private volatile boolean destroyed;
    private boolean compatibilityNoticeShown;
    private String backupOperation;
    private String backupJson;
    private String backupFilename;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSafeBrowsingEnabled(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.setNetworkAvailable(false);

        // Packaged files are always available. A service worker is unnecessary;
        // intercept its requests too so a future change cannot add networking.
        ServiceWorkerController worker = ServiceWorkerController.getInstance();
        ServiceWorkerWebSettings workerSettings = worker.getServiceWorkerWebSettings();
        workerSettings.setAllowFileAccess(false);
        workerSettings.setAllowContentAccess(false);
        workerSettings.setBlockNetworkLoads(true);
        worker.setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return serveAsset(request);
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !trustedOrigin(request.getUrl());
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request);
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!trustedOrigin(Uri.parse(url))) {
                    view.stopLoading();
                    denyPendingCamera();
                }
            }

            @Override public void onPageFinished(WebView view, String url) {
                if (!trustedOrigin(Uri.parse(url)) || compatibilityNoticeShown) return;
                view.evaluateJavascript("(function(){return !(window.crypto && "
                        + "typeof window.crypto.randomUUID === 'function' && "
                        + "typeof Array.prototype.at === 'function' && window.indexedDB && "
                        + "navigator.mediaDevices && navigator.mediaDevices.getUserMedia);})()", result -> {
                    if (destroyed || !"true".equals(result)) return;
                    compatibilityNoticeShown = true;
                    new AlertDialog.Builder(MainActivity.this)
                            .setTitle("Android System WebView needs updating")
                            .setMessage("Workshop requires a current Android System WebView for local storage and camera scanning.")
                            .setPositiveButton("Close", (dialog, which) -> finish())
                            .setCancelable(false).show();
                });
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestCamera(request));
            }

            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> { if (pendingCamera == request) pendingCamera = null; });
            }
        });
        webView.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            // Blob downloads are replaced by the explicit local SAF bridge.
        });
        webView.addJavascriptInterface(new LocalFilesBridge(), "WorkshopAndroid");
        // Android 15 makes target-35 activities edge-to-edge. Keep the web
        // viewport inside system bars, including on older supported Android.
        FrameLayout shell = new FrameLayout(this);
        shell.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        shell.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(shell);
        shell.requestApplyInsets();
        webView.loadUrl(ORIGIN);
    }

    private static boolean trustedOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme())
                && "workshop.local".equals(uri.getEncodedAuthority());
    }

    private boolean trustedPage() {
        return !destroyed && webView != null && webView.getUrl() != null
                && trustedOrigin(Uri.parse(webView.getUrl()));
    }

    private WebResourceResponse serveAsset(WebResourceRequest request) {
        if (!trustedOrigin(request.getUrl())) return blocked(403, "Forbidden");
        if (!"GET".equals(request.getMethod()) && !"HEAD".equals(request.getMethod())) {
            return blocked(405, "Method Not Allowed");
        }
        String path = request.getUrl().getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        if (!path.startsWith("/") || path.contains("\\") || path.indexOf('\0') >= 0) {
            return blocked(403, "Forbidden");
        }
        for (String segment : path.split("/", -1)) {
            if (segment.equals(".") || segment.equals("..")) return blocked(403, "Forbidden");
        }
        String asset = path.substring(1);
        if (asset.isEmpty() || asset.endsWith("/")) return blocked(404, "Not Found");
        try {
            InputStream contents = getAssets().open(ASSET_ROOT + asset);
            if ("HEAD".equals(request.getMethod())) {
                contents.close();
                contents = new ByteArrayInputStream(new byte[0]);
            }
            return new WebResourceResponse(mime(asset), "UTF-8", 200, "OK", responseHeaders(), contents);
        } catch (IOException error) {
            return blocked(404, "Not Found");
        }
    }

    private static Map<String, String> responseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Security-Policy", CSP);
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Cache-Control", "no-store");
        headers.put("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
        return headers;
    }

    private static WebResourceResponse blocked(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason,
                responseHeaders(), new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    private static String mime(String filename) {
        String name = filename.toLowerCase(Locale.ROOT);
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".js") || name.endsWith(".mjs")) return "application/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private void requestCamera(PermissionRequest request) {
        String[] resources = request.getResources();
        if (!resumed || !trustedPage() || !trustedOrigin(request.getOrigin())
                || resources.length != 1 || !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resources[0])) {
            request.deny();
            return;
        }
        denyPendingCamera();
        pendingCamera = request;
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            completeCameraPermission();
        } else if (!cameraPermissionPromptOpen) {
            cameraPermissionPromptOpen = true;
            requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA_REQUEST);
        }
    }

    private void completeCameraPermission() {
        if (!resumed || pendingCamera == null) return;
        PermissionRequest request = pendingCamera;
        pendingCamera = null;
        if (trustedPage() && trustedOrigin(request.getOrigin())
                && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            request.deny();
        }
    }

    private void denyPendingCamera() {
        PermissionRequest request = pendingCamera;
        pendingCamera = null;
        if (request != null) request.deny();
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != CAMERA_REQUEST) return;
        cameraPermissionPromptOpen = false;
        if (results.length == 1 && results[0] == PackageManager.PERMISSION_GRANTED) {
            completeCameraPermission();
        } else {
            denyPendingCamera();
        }
    }

    public final class LocalFilesBridge {
        @JavascriptInterface public boolean isLocalApp() { return true; }

        @JavascriptInterface public boolean saveBackup(String filename, String json) {
            if (json == null || json.length() > MAX_BACKUP_BYTES) return false;
            synchronized (backupLock) {
                if (destroyed || backupOperation != null) return false;
                backupOperation = "save";
                backupJson = json;
                backupFilename = safeFilename(filename);
            }
            runOnUiThread(() -> openDocumentPicker(true));
            return true;
        }

        @JavascriptInterface public boolean chooseBackup() {
            synchronized (backupLock) {
                if (destroyed || backupOperation != null) return false;
                backupOperation = "restore";
            }
            runOnUiThread(() -> openDocumentPicker(false));
            return true;
        }
    }

    private static String safeFilename(String proposed) {
        String name = proposed == null ? "workshop-backup.json" : proposed;
        name = name.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (name.length() > 100) name = name.substring(0, 100);
        if (!name.endsWith(".json")) name += ".json";
        return name;
    }

    private void openDocumentPicker(boolean save) {
        if (!trustedPage()) { finishBackup(false, false, "Workshop is not open.", null); return; }
        Intent intent = new Intent(save ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        if (save) {
            synchronized (backupLock) { intent.putExtra(Intent.EXTRA_TITLE, backupFilename); }
        }
        try {
            startActivityForResult(intent, save ? SAVE_REQUEST : RESTORE_REQUEST);
        } catch (ActivityNotFoundException error) {
            finishBackup(false, false, "No local Files picker is available on this phone.", null);
        }
    }

    @Override public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SAVE_REQUEST && requestCode != RESTORE_REQUEST) return;
        final String operation;
        final String json;
        synchronized (backupLock) {
            operation = backupOperation;
            json = backupJson;
        }
        if (operation == null || destroyed) return;
        if ((requestCode == SAVE_REQUEST) != operation.equals("save")) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            finishBackup(false, true, null, null);
            return;
        }
        Uri document = data.getData();
        if (!"content".equals(document.getScheme())) {
            finishBackup(false, false, "Choose a backup through the local Files picker.", null);
            return;
        }
        fileIo.execute(() -> {
            try {
                if (operation.equals("save")) {
                    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                    if (bytes.length > MAX_BACKUP_BYTES) throw new IOException("Workshop backups must be smaller than 20 MB.");
                    new JSONObject(json);
                    try (OutputStream output = getContentResolver().openOutputStream(document, "wt")) {
                        if (output == null) throw new IOException("The backup file could not be opened.");
                        output.write(bytes);
                        output.flush();
                    }
                    runOnUiThread(() -> finishBackup(true, false, null, null));
                } else {
                    String restored = readBackup(document);
                    runOnUiThread(() -> finishBackup(true, false, null, restored));
                }
            } catch (Exception error) {
                String message = error instanceof JSONException || error instanceof CharacterCodingException
                        ? "This file is not a valid Workshop JSON backup."
                        : (error.getMessage() == null ? "The backup file could not be read or saved." : error.getMessage());
                runOnUiThread(() -> finishBackup(false, false, message, null));
            }
        });
    }

    private String readBackup(Uri document) throws IOException, JSONException {
        try (InputStream input = getContentResolver().openInputStream(document)) {
            if (input == null) throw new IOException("The backup file could not be opened.");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (bytes.size() + count > MAX_BACKUP_BYTES) throw new IOException("Choose a Workshop backup smaller than 20 MB.");
                bytes.write(buffer, 0, count);
            }
            String json = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
            new JSONObject(json);
            return json;
        }
    }

    private void finishBackup(boolean ok, boolean canceled, String error, String json) {
        final String operation;
        synchronized (backupLock) {
            operation = backupOperation;
            backupOperation = null;
            backupJson = null;
            backupFilename = null;
        }
        if (operation == null || !trustedPage()) return;
        try {
            JSONObject detail = new JSONObject();
            detail.put("operation", operation);
            detail.put("ok", ok);
            if (canceled) detail.put("canceled", true);
            if (error != null) detail.put("error", error);
            if (json != null) detail.put("json", json);
            String encoded = detail.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('workshop-native-backup',{detail:"
                    + encoded + "}));", null);
        } catch (JSONException errorBuildingResult) {
            throw new IllegalStateException(errorBuildingResult);
        }
    }

    private void notifyPause() {
        if (trustedPage()) webView.evaluateJavascript("window.dispatchEvent(new Event('workshop-native-pause'));", null);
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (webView != null) webView.onResume();
        completeCameraPermission();
    }

    @Override protected void onPause() {
        resumed = false;
        // Preserve the request while Android's runtime permission dialog is visible.
        if (!cameraPermissionPromptOpen) {
            denyPendingCamera();
            notifyPause();
        }
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onStop() {
        denyPendingCamera();
        notifyPause();
        super.onStop();
    }

    @Override public void onBackPressed() {
        if (!trustedPage()) { finish(); return; }
        webView.evaluateJavascript("(function(){if(document.querySelector('#modal-root [role=dialog]')){"
                + "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));"
                + "return true;}return false;})()", result -> {
            if (!destroyed && !"true".equals(result)) finish();
        });
    }

    @Override protected void onDestroy() {
        destroyed = true;
        denyPendingCamera();
        synchronized (backupLock) {
            backupOperation = null;
            backupJson = null;
        }
        fileIo.shutdownNow();
        if (webView != null) {
            webView.removeJavascriptInterface("WorkshopAndroid");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
