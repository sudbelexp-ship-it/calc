package ru.bildinfotech.svai;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Вырезает WAV-файлы из произвольного байтового потока Bluetooth SPP.
 * Ищет заголовок RIFF…WAVE, дочитывает объявленный размер и, если сразу за ним идёт
 * XML-блок метаданных прибора (&lt;META&gt;…&lt;/META&gt;), сохраняет его вместе с записью —
 * анализатор берёт из него объект, номер сваи и номер удара.
 *
 * Это «универсальный» адаптер: он сработает, если прибор передаёт файлы как есть.
 * Для закрытого протокола «Спектр» сюда добавляется отдельный разбор по снятому дампу.
 */
class WavStreamParser {
    interface Sink { void onWav(File f); }

    private static final int MAX_WAV = 64 * 1024 * 1024, MAX_META = 64 * 1024;
    private enum State { SEARCH, BODY, AFTER, META }

    private final File dir;
    private final Sink sink;
    private final ByteArrayOutputStream buf = new ByteArrayOutputStream();
    private State state = State.SEARCH;
    private long need;
    private int count;

    WavStreamParser(File dir, Sink sink) { this.dir = dir; this.sink = sink; }

    synchronized void feed(byte[] data, int len) {
        buf.write(data, 0, len);
        boolean progress = true;
        while (progress) progress = step();
    }

    private boolean step() {
        byte[] b = buf.toByteArray();
        switch (state) {
            case SEARCH: {
                int at = indexOf(b, "RIFF".getBytes(StandardCharsets.US_ASCII), 0);
                if (at < 0) { keepTail(b, 3); return false; }
                if (b.length - at < 12) { keep(b, at); return false; }
                if (!"WAVE".equals(new String(b, at + 8, 4, StandardCharsets.US_ASCII))) { keep(b, at + 1); return true; }
                long size = (b[at + 4] & 0xFFL) | (b[at + 5] & 0xFFL) << 8 | (b[at + 6] & 0xFFL) << 16 | (b[at + 7] & 0xFFL) << 24;
                if (size <= 4 || size > MAX_WAV) { keep(b, at + 1); return true; }
                need = 8 + size;
                keep(b, at);
                state = State.BODY;
                return true;
            }
            case BODY:
                if (b.length < need) return false;
                state = State.AFTER;
                return true;
            case AFTER: {
                if (b.length < need + 5) return false;
                String head = new String(b, (int) need, 5, StandardCharsets.US_ASCII);
                if (head.equals("<META") || head.equals("<?xml")) { state = State.META; return true; }
                emit(b, (int) need);
                return true;
            }
            case META: {
                int end = indexOf(b, "</META>".getBytes(StandardCharsets.US_ASCII), (int) need);
                if (end >= 0) { emit(b, end + 7); return true; }
                if (b.length - need > MAX_META) { emit(b, (int) need); return true; }
                return false;
            }
        }
        return false;
    }

    private void emit(byte[] b, int len) {
        String name = String.format(Locale.ROOT, "%03d_%s.wav", ++count,
                new SimpleDateFormat("yy_MM_dd_HH_mm_ss", Locale.ROOT).format(new Date()));
        File f = new File(dir, name);
        try (FileOutputStream os = new FileOutputStream(f)) { os.write(b, 0, len); }
        catch (Exception e) { return; }
        keep(b, len);
        state = State.SEARCH;
        sink.onWav(f);
    }

    private void keep(byte[] b, int from) {
        buf.reset();
        if (from < b.length) buf.write(b, from, b.length - from);
    }

    private void keepTail(byte[] b, int n) { keep(b, Math.max(0, b.length - n)); }

    private static int indexOf(byte[] hay, byte[] needle, int from) {
        outer:
        for (int i = Math.max(0, from); i <= hay.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) if (hay[i + j] != needle[j]) continue outer;
            return i;
        }
        return -1;
    }
}
