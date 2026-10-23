package ru.bildinfotech.svai;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.FileObserver;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import ru.bildinfotech.shell.WebShellActivity;

/**
 * «Анализ свай» — сейсмоакустический контроль длины и сплошности свай по записям прибора «Спектр».
 * Помимо веб-анализатора: экран «Прибор / Bluetooth» и автоприём файлов, присланных по Bluetooth.
 */
public class MainActivity extends WebShellActivity {
    static final int RC_DEVICE = 201;

    private final List<FileObserver> observers = new ArrayList<>();
    private final Set<String> arrived = new LinkedHashSet<>();
    private AlertDialog arrivedDialog;

    @Override protected String startPage() { return "pile-analyzer.html"; }
    @Override protected String downloadsFolder() { return "Анализ свай"; }

    @Override
    protected void configureWebView(WebView w) {
        w.addJavascriptInterface(new SvaiBridge(), "AndroidSvai");
    }

    /** window.AndroidSvai в странице анализатора. */
    public class SvaiBridge {
        @JavascriptInterface
        public void openDevice() {
            ui.post(() -> startActivityForResult(new Intent(MainActivity.this, SpectrActivity.class), RC_DEVICE));
        }
    }

    /** Кнопка «Прибор / Bluetooth» рядом с «Открыть файлы…». */
    @Override
    protected String extraJs() {
        return "(function(){var f=document.getElementById('btnOpenFiles');"
                + "if(!f||document.getElementById('btnDevice'))return;"
                + "var b=document.createElement('button');b.id='btnDevice';b.textContent='Прибор / Bluetooth…';"
                + "b.title='Данные «Спектр» на планшете, файлы, принятые по Bluetooth, прямое подключение';"
                + "b.onclick=function(){AndroidSvai.openDevice()};f.parentNode.insertBefore(b,f.nextSibling);})();";
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        for (File dir : SpectrActivity.bluetoothInboxes()) watch(dir);
    }

    @Override
    protected void onDestroy() {
        for (FileObserver o : observers) o.stopWatching();
        super.onDestroy();
    }

    /** Следим за папкой входящих Bluetooth: как только прибор/телефон прислал .wav или .zip — предлагаем загрузить. */
    private void watch(File dir) {
        if (!dir.isDirectory()) return;
        FileObserver o = new FileObserver(dir.getAbsolutePath(), FileObserver.CLOSE_WRITE | FileObserver.MOVED_TO) {
            @Override
            public void onEvent(int event, String path) {
                if (path == null) return;
                String low = path.toLowerCase(Locale.ROOT);
                if (!low.endsWith(".wav") && !low.endsWith(".zip")) return;
                File f = new File(dir, path);
                ui.post(() -> onArrived(f));
            }
        };
        o.startWatching();
        observers.add(o);
    }

    private void onArrived(File f) {
        arrived.add(f.getAbsolutePath());
        if (arrivedDialog != null && arrivedDialog.isShowing()) arrivedDialog.dismiss();
        arrivedDialog = new AlertDialog.Builder(this)
                .setTitle("Принято по Bluetooth: " + arrived.size())
                .setMessage(new File(f.getAbsolutePath()).getName() + (arrived.size() > 1 ? " и др." : ""))
                .setPositiveButton("Загрузить в анализ", (d, w) -> {
                    List<File> files = new ArrayList<>();
                    for (String p : arrived) files.add(new File(p));
                    arrived.clear();
                    loadFiles(files, null);
                })
                .setNegativeButton("Позже", (d, w) -> arrived.clear())
                .show();
    }

    /** .zip распаковываются (структура «Объект/Свая/удар.wav» сохраняется), .wav передаются как есть. */
    void loadFiles(List<File> files, File base) {
        io.execute(() -> {
            List<File> wavs = new ArrayList<>();
            File zipBase = null;
            for (File f : files) {
                if (f.getName().toLowerCase(Locale.ROOT).endsWith(".zip")) {
                    File out = SpectrActivity.unzip(this, f);
                    if (out != null) { zipBase = out; wavs.addAll(SpectrActivity.listWavs(out)); }
                } else wavs.add(f);
            }
            if (wavs.isEmpty()) { toast("Нет файлов .wav"); return; }
            File b = base != null ? base : (files.size() == 1 && zipBase != null ? zipBase : null);
            ui.post(() -> deliverLocalFiles(wavs, b));
        });
    }

    @Override
    protected void onActivityResult(int rc, int result, Intent data) {
        if (rc == RC_DEVICE) {
            if (result != RESULT_OK || data == null) return;
            String[] paths = data.getStringArrayExtra(SpectrActivity.EXTRA_PATHS);
            String base = data.getStringExtra(SpectrActivity.EXTRA_BASE);
            if (paths == null || paths.length == 0) return;
            List<File> files = new ArrayList<>();
            for (String p : paths) files.add(new File(p));
            loadFiles(files, base == null ? null : new File(base));
            return;
        }
        super.onActivityResult(rc, result, data);
    }
}
