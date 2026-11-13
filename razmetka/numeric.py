"""Exact numeric tokens and doubt spans. Never discard a sign or change precision."""
import re
from decimal import Decimal, InvalidOperation

NUMBER = re.compile(r'(?<!\d)(?:[+−–—±-][ \t]*)?\d+(?:[.,]\d+)?(?:[eE][+−-]?\d+)?')
DOUBT = re.compile(r'\[\?[^\]]*\]')


def normalize(text):
    return re.sub(r'[ \t]+', '', text.replace(',', '.').replace('−', '-').replace('–', '-'))


def tokens(text):
    spans = [(m.start(), m.end()) for m in DOUBT.finditer(text)]
    # Removing inline [?] inside a number must not split 1,[?3] into 1 and 3.
    clean, mask = [], []
    for i, ch in enumerate(text):
        if ch == ']' and any(a <= i < b for a, b in spans):
            continue
        if any(i in (a, a + 1) for a, b in spans):
            continue
        clean.append(ch)
        mask.append(any(a <= i < b for a, b in spans))
    out = []
    for m in NUMBER.finditer(''.join(clean)):
        out.append((normalize(m.group()), any(mask[m.start():m.end()])))
    return out


def values(text):
    return [v for v, flagged in tokens(text)]


def scalar(text):
    clean = re.sub(r'\[\?([^\]]*)\]', r'\1', text).strip()
    if not re.fullmatch(NUMBER.pattern, clean):
        return None
    try:
        return float(Decimal(normalize(clean)))
    except InvalidOperation:
        return None


def mark_word(word, reason, alt=None):
    word['c'] = min(word.get('c', 1), .5)
    reasons = word.setdefault('reasons', [])
    if reason not in reasons:
        reasons.append(reason)
    if alt is not None:
        word['alt'] = alt

