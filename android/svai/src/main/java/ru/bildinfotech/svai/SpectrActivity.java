package ru.bildinfotech.svai;

import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Экран «Прибор / Bluetooth». Три источника записей:
 *  1) данные приложения «Спектр» на этом же планшете (папка Spectr/data/Объект/Свая);
 *  2) файлы .wav/.zip, принятые штатным Bluetooth Android (передача файлов OBEX);
 *  3) прямое подключение к прибору по Bluetooth SPP: поток пишется в файл, из него
 *     автоматически вырезаются WAV-записи (если прибор передаёт файлы как есть).
 *     Если протокол прибора закрытый — снятый дамп нужен, чтобы дописать SpectrProtocol.
 */
public class SpectrActivity extends Activity {
    static final String EXTRA_PATHS = "paths", EXTRA_BASE = "base";
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int RC_BT_ON = 301;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private LinearLayout root, inboxList, deviceList;
    private final List<CheckBox> inboxChecks = new ArrayList<>();
    private TextView sppLog;
    private EditText cmd;
    private volatile BluetoothSocket socket;
    private volatile boolean reading;
    private WavStreamParser parser;
    private final List<File> captured = new ArrayList<>();
    private Button btnLoadCaptured;

    // ------------------------------------------------------------ пути

    static File sd() { return Environment.getExternalStorageDirectory(); }

    static List<File> spectrRoots() {
        List<File> out = new ArrayList<>();
        for (String p : new String[]{"Spectr/data", "spectr/data", "Spectr", "Download/Spectr/data"}) {
            File f = new File(sd(), p);
            if (f.isDirectory() && !out.contains(f)) out.add(f);
        }
        return out;
    }

    static List<File> bluetoothInboxes() {
        List<File> out = new ArrayList<>();
        for (String p : new String[]{"bluetooth", "Bluetooth", "Download/Bluetooth", "Download"}) {
            File f = new File(sd(), p);
            if (f.isDirectory()) {
                boolean dup = false;
                for (File o : out) try { dup |= o.getCanonicalPath().equals(f.getCanonicalPath()); } catch (Exception ignored) { }
                if (!dup) out.add(f);
            }
        }
        return out;
    }

    static List<File> listWavs(File dir) {
        List<File> out = new ArrayList<>();
        collect(dir, out, 0);
        return out;
    }

    private static void collect(File dir, List<File> out, int depth) {
        File[] kids = dir.listFiles();
        if (kids == null || depth > 6) return;
        for (File k : kids) {
            if (k.isDirectory()) collect(k, out, depth + 1);
            else if (k.getName().toLowerCase(Locale.ROOT).endsWith(".wav")) out.add(k);
        }
    }

    /** Распаковать архив во внутренний кэш; возвращает папку с именем архива. */
    static File unzip(Context c, File zip) {
        String name = zip.getName().replaceAll("(?i)\\.zip$", "");
        File out = new File(new File(c.getCacheDir(), "bt-unzip"), name);
        deleteTree(out);
        out.mkdirs();
        try (ZipInputStream zin = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            String outPath = out.getCanonicalPath() + File.separator;
            while ((e = zin.getNextEntry()) != null) {
                File f = new File(out, e.getName());
                if (!f.getCanonicalPath().startsWith(outPath)) continue; // защита от «../» в архиве
                if (e.isDirectory()) { f.mkdirs(); continue; }
                f.getParentFile().mkdirs();
                try (OutputStream os = new FileOutputStream(f)) {
                    int r;
                    while ((r = zin.read(buf)) > 0) os.write(buf, 0, r);
                }
            }
            return out;
        } catch (Exception ex) {
            return null;
        }
    }

    static void deleteTree(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    // ------------------------------------------------------------ UI

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(0xFFF0F0F6);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = dp(16);
        root.setPadding(p, p, p, p);
        sv.addView(root);
        setContentView(sv);

        TextView title = text("Прибор «Спектр» и Bluetooth", 22, true);
        root.addView(title);

        section("Данные «Спектр» на этом планшете",
                "Если на планшете стоит приложение прибора — его записи лежат в папке Spectr/data/Объект/Свая. Нажмите на объект, чтобы открыть его целиком.");
        buildSpectr();

        section("Принято по Bluetooth",
                "Отправьте записи с прибора или телефона на этот планшет по Bluetooth (файлы .wav или архив .zip). Новые файлы появятся здесь и в уведомлении.");
        inboxList = card();
        buildInbox();
        LinearLayout row = hrow();
        row.addView(button("Обновить", v -> buildInbox()));
        row.addView(button("Загрузить выбранные", v -> returnInbox()));
        root.addView(row);

        section("Прямое подключение по Bluetooth (SPP)",
                "Для приборов, которые передают данные через последовательный порт Bluetooth. Сопрягите прибор в настройках Android, затем выберите его здесь. "
                        + "Весь поток пишется в файл; записи WAV вырезаются автоматически. Если прибор шлёт данные в своём формате — "
                        + "сохранённый дамп нужен, чтобы добавить поддержку протокола.");
        deviceList = card();
        buildDevices();
        LinearLayout cmdRow = hrow();
        cmd = new EditText(this);
        cmd.setHint("Команда прибору (текст или HEX: 0x02 0x41…)");
        cmd.setInputType(InputType.TYPE_CLASS_TEXT);
        cmd.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        cmdRow.addView(cmd);
        cmdRow.addView(button("Отправить", v -> send()));
        root.addView(cmdRow);
        LinearLayout ctl = hrow();
        ctl.addView(button("Отключиться", v -> disconnect()));
        btnLoadCaptured = button("Загрузить принятые WAV (0)", v -> returnCaptured());
        btnLoadCaptured.setEnabled(false);
        ctl.addView(btnLoadCaptured);
        root.addView(ctl);
        sppLog = text("Не подключено", 12, false);
        sppLog.setTypeface(Typeface.MONOSPACE);
        sppLog.setTextIsSelectable(true);
        LinearLayout logCard = card();
        logCard.addView(sppLog);
    }

    @Override
    protected void onDestroy() {
        disconnect();
        super.onDestroy();
    }

    private void buildSpectr() {
        LinearLayout c = card();
        List<File> roots = spectrRoots();
        if (roots.isEmpty()) {
            c.addView(text("Папка Spectr/data не найдена. Если приложение прибора установлено, откройте его хотя бы раз и проверьте разрешение на память.", 14, false));
            return;
        }
        int shown = 0;
        for (File r : roots) {
            File[] objs = r.listFiles(File::isDirectory);
            if (objs == null) continue;
            Arrays.sort(objs, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
            for (File obj : objs) {
                List<File> wavs = listWavs(obj);
                if (wavs.isEmpty()) continue;
                File[] piles = obj.listFiles(File::isDirectory);
                String sub = (piles == null ? 0 : piles.length) + " свай, " + wavs.size() + " ударов · "
                        + new SimpleDateFormat("dd.MM.yyyy", Locale.ROOT).format(new Date(obj.lastModified()));
                Button b = button(obj.getName() + "\n" + sub, v -> finishWith(wavs, obj));
                b.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
                b.setAllCaps(false);
                c.addView(b, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
                if (++shown >= 60) return;
            }
        }
        if (shown == 0) c.addView(text("В папке прибора пока нет записей .wav", 14, false));
    }

    private void buildInbox() {
        inboxList.removeAllViews();
        inboxChecks.clear();
        List<File> files = new ArrayList<>();
        for (File d : bluetoothInboxes()) {
            File[] kids = d.listFiles(f -> f.isFile() && f.getName().toLowerCase(Locale.ROOT).matches(".*\\.(wav|zip)$"));
            if (kids != null) files.addAll(Arrays.asList(kids));
        }
        files.sort((a, b) -> Long.compare(b.lastModified(), a.lastModified()));
        if (files.isEmpty()) {
            inboxList.addView(text("Нет принятых файлов .wav / .zip", 14, false));
            return;
        }
        SimpleDateFormat fmt = new SimpleDateFormat("dd.MM HH:mm", Locale.ROOT);
        for (File f : files.subList(0, Math.min(files.size(), 200))) {
            CheckBox cb = new CheckBox(this);
            cb.setText(f.getName() + "   " + fmt.format(new Date(f.lastModified())) + "   " + (f.length() / 1024) + " КБ");
            cb.setTag(f);
            inboxList.addView(cb);
            inboxChecks.add(cb);
        }
    }

    private void returnInbox() {
        List<File> sel = new ArrayList<>();
        for (CheckBox cb : inboxChecks) if (cb.isChecked()) sel.add((File) cb.getTag());
        if (sel.isEmpty()) { toast("Отметьте файлы"); return; }
        finishWith(sel, null);
    }

    private void finishWith(List<File> files, File base) {
        String[] paths = new String[files.size()];
        for (int k = 0; k < paths.length; k++) paths[k] = files.get(k).getAbsolutePath();
        Intent r = new Intent().putExtra(EXTRA_PATHS, paths);
        if (base != null) r.putExtra(EXTRA_BASE, base.getAbsolutePath());
        setResult(RESULT_OK, r);
        finish();
    }

    // ------------------------------------------------------------ SPP

    private void buildDevices() {
        deviceList.removeAllViews();
        BluetoothAdapter bt = BluetoothAdapter.getDefaultAdapter();
        if (bt == null) { deviceList.addView(text("Bluetooth на устройстве не найден", 14, false)); return; }
        if (!bt.isEnabled()) {
            deviceList.addView(button("Включить Bluetooth", v -> startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), RC_BT_ON)));
            return;
        }
        if (bt.getBondedDevices().isEmpty()) {
            deviceList.addView(text("Нет сопряжённых устройств. Сопрягите прибор: Настройки → Bluetooth.", 14, false));
        }
        for (BluetoothDevice d : bt.getBondedDevices()) {
            String n = d.getName() == null ? d.getAddress() : d.getName();
            Button b = button(n + "  ·  " + d.getAddress(), v -> connect(d));
            b.setAllCaps(false);
            deviceList.addView(b, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        }
        deviceList.addView(button("Настройки Bluetooth", v -> startActivity(new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS))));
    }

    @Override
    protected void onActivityResult(int rc, int result, Intent data) {
        super.onActivityResult(rc, result, data);
        if (rc == RC_BT_ON) buildDevices();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (deviceList != null && socket == null) buildDevices();
    }

    private void connect(BluetoothDevice d) {
        disconnect();
        log("Подключение к " + d.getName() + "…");
        new Thread(() -> {
            BluetoothAdapter.getDefaultAdapter().cancelDiscovery();
            BluetoothSocket s = null;
            try {
                s = d.createRfcommSocketToServiceRecord(SPP);
                s.connect();
            } catch (Exception first) {
                try { // часть приборов не публикует SDP-запись SPP — пробуем канал 1 напрямую
                    if (s != null) s.close();
                    s = (BluetoothSocket) d.getClass().getMethod("createRfcommSocket", int.class).invoke(d, 1);
                    s.connect();
                } catch (Exception second) {
                    log("Не удалось подключиться: " + first.getMessage());
                    return;
                }
            }
            socket = s;
            readLoop(d, s);
        }, "spp").start();
    }

    private void readLoop(BluetoothDevice d, BluetoothSocket s) {
        String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(new Date());
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                "БИЛДИНФОТЕХ/Анализ свай/Bluetooth " + stamp);
        dir.mkdirs();
        File dump = new File(dir, "поток_" + stamp + ".bin");
        parser = new WavStreamParser(dir, f -> ui.post(() -> {
            captured.add(f);
            btnLoadCaptured.setText("Загрузить принятые WAV (" + captured.size() + ")");
            btnLoadCaptured.setEnabled(true);
            log("Принята запись: " + f.getName());
        }));
        log("Подключено. Поток пишется в: Загрузки/БИЛДИНФОТЕХ/Анализ свай/Bluetooth " + stamp);
        reading = true;
        long total = 0;
        try (InputStream in = s.getInputStream(); OutputStream os = new FileOutputStream(dump)) {
            byte[] buf = new byte[8192];
            int r;
            while (reading && (r = in.read(buf)) > 0) {
                os.write(buf, 0, r);
                os.flush();
                parser.feed(buf, r);
                total += r;
                final long t = total;
                final String hex = hex(buf, Math.min(r, 32));
                ui.post(() -> sppLog.setText("Принято байт: " + t + "\nПоследний пакет: " + hex + "\n\n" + sppHistory()));
            }
        } catch (Exception e) {
            if (reading) log("Соединение прервано: " + e.getMessage());
        } finally {
            reading = false;
            log("Отключено. Принято байт: " + total);
        }
    }

    private void send() {
        BluetoothSocket s = socket;
        if (s == null) { toast("Сначала подключитесь к прибору"); return; }
        String t = cmd.getText().toString().trim();
        if (t.isEmpty()) return;
        new Thread(() -> {
            try {
                byte[] data = parseCommand(t);
                s.getOutputStream().write(data);
                log("→ " + hex(data, data.length));
            } catch (Exception e) { log("Ошибка отправки: " + e.getMessage()); }
        }).start();
    }

    /** «0x02 0x41 0x0D» или «02 41 0D» — байты; иначе — текст + CR LF. */
    static byte[] parseCommand(String t) throws Exception {
        if (t.matches("(?i)(0x)?[0-9a-f]{2}(\\s+(0x)?[0-9a-f]{2})*")) {
            String[] p = t.trim().split("\\s+");
            byte[] b = new byte[p.length];
            for (int k = 0; k < p.length; k++) b[k] = (byte) Integer.parseInt(p[k].replaceFirst("(?i)^0x", ""), 16);
            return b;
        }
        return (t + "\r\n").getBytes("UTF-8");
    }

    private void disconnect() {
        reading = false;
        BluetoothSocket s = socket;
        socket = null;
        if (s != null) try { s.close(); } catch (Exception ignored) { }
    }

    private void returnCaptured() {
        if (captured.isEmpty()) return;
        disconnect();
        finishWith(new ArrayList<>(captured), null);
    }

    // ------------------------------------------------------------ helpers

    private final StringBuilder history = new StringBuilder();

    private synchronized String sppHistory() { return history.toString(); }

    private void log(String m) {
        synchronized (this) {
            history.insert(0, new SimpleDateFormat("HH:mm:ss ", Locale.ROOT).format(new Date()) + m + "\n");
            if (history.length() > 4000) history.setLength(4000);
        }
        ui.post(() -> { if (sppLog != null) sppLog.setText(sppHistory()); });
    }

    static String hex(byte[] b, int n) {
        StringBuilder sb = new StringBuilder();
        for (int k = 0; k < n; k++) sb.append(String.format(Locale.ROOT, "%02X ", b[k]));
        return sb.toString().trim();
    }

    private void toast(String m) { Toast.makeText(this, m, Toast.LENGTH_LONG).show(); }

    private int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(0xFF18182A);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private void section(String title, String hint) {
        TextView h = text(title, 17, true);
        h.setPadding(0, dp(20), 0, dp(4));
        h.setTextColor(0xFF3A31A8);
        root.addView(h);
        TextView t = text(hint, 13, false);
        t.setTextColor(0xFF6C6C86);
        t.setPadding(0, 0, 0, dp(8));
        root.addView(t);
    }

    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackgroundColor(Color.WHITE);
        c.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(8);
        root.addView(c, lp);
        return c;
    }

    private LinearLayout hrow() {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        return r;
    }

    private Button button(String s, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        return b;
    }
}
