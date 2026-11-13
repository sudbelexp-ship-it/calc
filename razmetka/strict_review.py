"""Conservative review policy: machine agreement is not human verification."""
import re
from numeric import NUMBER


def mark_numbers(md):
    # Keep comments, attributes, image URLs and existing doubts intact. Visible numbers
    # (including generated formula numbers) are marked. No value is changed.
    protected = re.compile(r'<!--.*?-->|</?(?:table|thead|tbody|tfoot|tr|th|td|br|sup|sub|i|b|strong|em|p|a|span|div)\b[^>]*>|!\[[^\]]*\]\([^)]*\)|\[\?[^\]]*\]', re.S | re.I)
    out, pos = [], 0
    for m in protected.finditer(md):
        out.append(NUMBER.sub(lambda n: '[?' + n.group() + ']', md[pos:m.start()]))
        out.append(m.group())
        pos = m.end()
    out.append(NUMBER.sub(lambda n: '[?' + n.group() + ']', md[pos:]))
    return ''.join(out)
