package ru.bildinfotech.raschety;

import ru.bildinfotech.shell.WebShellActivity;

/** «Расчёты» — поверочные расчёты КЖ, КМ, ОиФ, АР (резерв webcad.pro) без интернета. */
public class MainActivity extends WebShellActivity {
    @Override protected String startPage() { return "webcad.html"; }
    @Override protected String downloadsFolder() { return "Расчёты"; }
}
