package ru.bildinfotech.shell;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Общая оболочка для веб-калькуляторов БИЛДИНФОТЕХ.
 * Страницы лежат в assets/web и открываются по адресу https://appassets.androidplatform.net/assets/web/…,
 * поэтому работают без интернета, а localStorage сохраняется между запусками.
 */
public abstract class WebShellActivity extends Activity {
    protected static final String TAG = "BIT-Shell";
    protected static final String HOST = "appassets.androidplatform.net";
    private static final int RC_FILES = 101, RC_TREE = 102, RC_PERMS = 103;
    private static final long MAX_COPY_BYTES = 300L * 1024 * 1024;
    private static final int MIN_WEBVIEW_MAJOR = 90;

    protected WebView web;
    protected final Handler ui = new Handler(Looper.getMainLooper());
    protected final ExecutorService io = Executors.newSingleThreadExecutor();

    private WebViewAssetLoader loader;
    private File pickedRoot;
    private int pickedSeq = 0;
    private ValueCallback<Uri[]> fileCallback;
    private int folderReq = -1;
    private String folderExt = "";
    private boolean pageReady = false;
    private final List<String> deliverQueue = new ArrayList<>();
    private String shellJs;

    /** Имя стартовой страницы в assets/web, например "webcad.html". */
    protected abstract String startPage();

    /** Подпапка в «Загрузки/БИЛДИНФОТЕХ» для сохранённых файлов. */
    protected abstract String downloadsFolder();

    /** Дополнительные JS-интерфейсы конкретного приложения. */
    protected void configureWebView(WebView w) { }

    /** Дополнительный JS, выполняемый после shell.js на каждой странице. */
    protected String extraJs() { return ""; }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        pickedRoot = new File(getCacheDir(), "picked");
        deleteTree(pickedRoot);
        pickedRoot.mkdirs();

        loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .addPathHandler("/picked/", new WebViewAssetLoader.InternalStoragePathHandler(this, pickedRoot))
                .build();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "AndroidShell");
        web.setWebViewClient(new ShellClient());
        web.setWebChromeClient(new ShellChrome());
        configureWebView(web);

        if (state != null) web.restoreState(state);
        else web.loadUrl("https://" + HOST + "/assets/web/" + startPage());

        checkWebViewVersion();
        askStoragePermission();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) { web.goBack(); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    // ---------------------------------------------------------------- WebView

    private class ShellClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            return loader.shouldInterceptRequest(req.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) {
                String p = u.getPath() == null ? "" : u.getPath();
                return p.endsWith("/index.html"); // каталога сайта в приложении нет
            }
            return true; // приложение офлайн, внешние ссылки не открываем
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            pageReady = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            view.evaluateJavascript(shellJs() + "\n" + extraJs(), null);
        }
    }

    private class ShellChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            try {
                startActivityForResult(i, RC_FILES);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, m.sourceId() + ":" + m.lineNumber() + " " + m.message());
            return true;
        }
    }

    private String shellJs() {
        if (shellJs == null) shellJs = readAsset("shell/shell.js");
        return shellJs;
    }

    /** Мост, доступный странице как window.AndroidShell. Методы вызываются не из UI-потока. */
    public class Bridge {
        @JavascriptInterface
        public void ready() {
            ui.post(() -> {
                pageReady = true;
                for (String json : deliverQueue) callJs("window.__shell.folderResult(-1," + json + ")");
                deliverQueue.clear();
            });
        }

        @JavascriptInterface
        public void log(String msg) { Log.w(TAG, msg); }

        @JavascriptInterface
        public void saveFile(String name, String mime, String b64) {
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            io.execute(() -> saveDownload(name, mime, data));
        }

        @JavascriptInterface
        public void print(String title) {
            ui.post(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                String job = title == null || title.isEmpty() ? "Отчёт" : title;
                pm.print(job, web.createPrintDocumentAdapter(job),
                        new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
            });
        }

        @JavascriptInterface
        public void pickFolder(int req, String ext) {
            ui.post(() -> {
                folderReq = req;
                folderExt = ext == null ? "" : ext.toLowerCase(Locale.ROOT);
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                try { startActivityForResult(i, RC_TREE); }
                catch (ActivityNotFoundException e) { toast("Нет системного диалога выбора папки"); }
            });
        }
    }

    protected void callJs(String js) {
        ui.post(() -> web.evaluateJavascript(js, null));
    }

    // ---------------------------------------------------------------- результаты диалогов

    @Override
    protected void onActivityResult(int rc, int result, Intent data) {
        super.onActivityResult(rc, result, data);
        if (rc == RC_FILES) {
            if (fileCallback == null) return;
            Uri[] uris = null;
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    uris = new Uri[data.getClipData().getItemCount()];
                    for (int k = 0; k < uris.length; k++) uris[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    uris = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(uris);
            fileCallback = null;
        } else if (rc == RC_TREE) {
            final int req = folderReq;
            final String ext = folderExt;
            if (result != RESULT_OK || data == null || data.getData() == null) return;
            final Uri tree = data.getData();
            toast("Чтение папки…");
            io.execute(() -> {
                try {
                    JSONArray list = copyTree(tree, ext);
                    if (list.length() == 0) { toast("В папке нет подходящих файлов"); return; }
                    callJs("window.__shell.folderResult(" + req + "," + list + ")");
                } catch (Exception e) {
                    Log.e(TAG, "tree", e);
                    toast("Не удалось прочитать папку: " + e.getMessage());
                }
            });
        }
    }

    // ---------------------------------------------------------------- доставка файлов в страницу

    /**
     * Передать странице файлы с диска (данные «Спектр», входящие Bluetooth).
     * base — папка, относительно родителя которой строится путь rel (имя base входит в путь,
     * как у webkitRelativePath). Если base == null, путь — только имя файла.
     */
    protected void deliverLocalFiles(List<File> files, File base) {
        io.execute(() -> {
            try {
                File session = newSession();
                JSONArray list = new JSONArray();
                long total = 0;
                String parent = base == null || base.getParentFile() == null ? null : base.getParentFile().getAbsolutePath();
                for (File f : files) {
                    if (!f.isFile()) continue;
                    total += f.length();
                    if (total > MAX_COPY_BYTES) break;
                    String rel = parent != null && f.getAbsolutePath().startsWith(parent + "/")
                            ? f.getAbsolutePath().substring(parent.length() + 1) : f.getName();
                    try (InputStream in = new FileInputStream(f)) {
                        list.put(stage(session, rel, in, f.lastModified()));
                    }
                }
                String json = list.toString();
                ui.post(() -> {
                    if (pageReady) callJs("window.__shell.folderResult(-1," + json + ")");
                    else deliverQueue.add(json);
                });
            } catch (Exception e) {
                Log.e(TAG, "deliver", e);
                toast("Не удалось загрузить файлы: " + e.getMessage());
            }
        });
    }

    private File newSession() {
        File d = new File(pickedRoot, String.valueOf(++pickedSeq));
        deleteTree(d);
        d.mkdirs();
        return d;
    }

    private JSONObject stage(File session, String rel, InputStream in, long mtime) throws Exception {
        File out = new File(session, rel);
        out.getParentFile().mkdirs();
        try (OutputStream os = new FileOutputStream(out)) { copy(in, os); }
        StringBuilder url = new StringBuilder("https://" + HOST + "/picked/" + session.getName());
        for (String seg : rel.split("/")) url.append('/').append(URLEncoder.encode(seg, "UTF-8").replace("+", "%20"));
        String name = out.getName();
        JSONObject o = new JSONObject();
        o.put("name", name);
        o.put("rel", rel);
        o.put("url", url.toString());
        o.put("mime", mimeOf(name));
        o.put("mtime", mtime);
        return o;
    }

    private JSONArray copyTree(Uri tree, String ext) throws Exception {
        ContentResolver cr = getContentResolver();
        File session = newSession();
        JSONArray out = new JSONArray();
        String rootId = DocumentsContract.getTreeDocumentId(tree);
        String rootName = displayName(DocumentsContract.buildDocumentUriUsingTree(tree, rootId));
        long[] total = {0};
        walk(cr, tree, rootId, rootName == null ? "Папка" : rootName, ext, session, out, total, 0);
        return out;
    }

    private void walk(ContentResolver cr, Uri tree, String docId, String rel, String ext, File session,
                      JSONArray out, long[] total, int depth) throws Exception {
        if (depth > 6) return;
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
        String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED};
        try (Cursor c = cr.query(children, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                long size = c.isNull(3) ? 0 : c.getLong(3), mtime = c.isNull(4) ? 0 : c.getLong(4);
                String childRel = rel + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    walk(cr, tree, id, childRel, ext, session, out, total, depth + 1);
                } else if (ext.isEmpty() || name.toLowerCase(Locale.ROOT).endsWith(ext)) {
                    total[0] += size;
                    if (total[0] > MAX_COPY_BYTES) return;
                    try (InputStream in = cr.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id))) {
                        if (in != null) out.put(stage(session, childRel, in, mtime));
                    }
                }
            }
        }
    }

    private String displayName(Uri doc) {
        try (Cursor c = getContentResolver().query(doc, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return null;
    }

    // ---------------------------------------------------------------- сохранение

    protected File downloadsDir() {
        File d = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "БИЛДИНФОТЕХ/" + downloadsFolder());
        d.mkdirs();
        return d;
    }

    private void saveDownload(String name, String mime, byte[] data) {
        try {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]+", "_").trim();
            if (safe.isEmpty()) safe = "file";
            File dir = downloadsDir();
            File f = new File(dir, safe);
            int n = 1;
            while (f.exists()) {
                int dot = safe.lastIndexOf('.');
                String b = dot > 0 ? safe.substring(0, dot) : safe, e = dot > 0 ? safe.substring(dot) : "";
                f = new File(dir, b + " (" + (n++) + ")" + e);
            }
            try (OutputStream os = new FileOutputStream(f)) { os.write(data); }
            MediaScannerConnection.scanFile(this, new String[]{f.getAbsolutePath()}, null, null);
            final File saved = f;
            ui.post(() -> new AlertDialog.Builder(this)
                    .setTitle("Файл сохранён")
                    .setMessage("Загрузки/БИЛДИНФОТЕХ/" + downloadsFolder() + "/" + saved.getName())
                    .setPositiveButton("Открыть", (d, w) -> openFile(saved, mime))
                    .setNegativeButton("Закрыть", null)
                    .show());
        } catch (Exception e) {
            Log.e(TAG, "save", e);
            toast("Не удалось сохранить: " + e.getMessage() + ". Разрешите доступ к памяти в настройках приложения.");
        }
    }

    protected void openFile(File f, String mime) {
        try {
            Uri u = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            String type = mime == null || mime.isEmpty() ? mimeOf(f.getName()) : mime;
            Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(u, type)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(i);
        } catch (Exception e) {
            toast("Нет приложения, чтобы открыть этот файл");
        }
    }

    // ---------------------------------------------------------------- служебное

    private void checkWebViewVersion() {
        PackageInfo p = WebViewCompat.getCurrentWebViewPackage(this);
        if (p == null || p.versionName == null) return;
        int major;
        try { major = Integer.parseInt(p.versionName.split("\\.")[0]); } catch (Exception e) { return; }
        if (major < MIN_WEBVIEW_MAJOR) {
            new AlertDialog.Builder(this)
                    .setTitle("Устарел Android System WebView")
                    .setMessage("Установлена версия " + p.versionName + ". Для расчётов нужна " + MIN_WEBVIEW_MAJOR
                            + " или новее — установите свежий APK Android System WebView из комплекта прошивки.")
                    .setPositiveButton("Понятно", null)
                    .show();
        }
    }

    protected void askStoragePermission() {
        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE,
                    Manifest.permission.WRITE_EXTERNAL_STORAGE}, RC_PERMS);
        }
    }

    protected void toast(String msg) {
        ui.post(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    protected String readAsset(String path) {
        try (InputStream in = getAssets().open(path)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            copy(in, bo);
            return bo.toString("UTF-8");
        } catch (Exception e) {
            Log.e(TAG, "asset " + path, e);
            return "";
        }
    }

    protected static String mimeOf(String name) {
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        if ("wav".equals(ext)) return "audio/wav";
        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return m == null ? "application/octet-stream" : m;
    }

    protected static void copy(InputStream in, OutputStream out) throws java.io.IOException {
        byte[] buf = new byte[64 * 1024];
        int r;
        while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
    }

    protected static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
