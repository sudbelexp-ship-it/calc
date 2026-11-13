"""Expand HTML/Markdown tables into page/table/row/column positions."""
import re
from html import unescape
from html.parser import HTMLParser


def caption_id(text):
    """Read an explicit caption identifier, allowing letter spacing and doubt wrappers.

    Never infer a missing digit (e.g. OCR «АЛ» must not become «А.1»).
    """
    plain = re.sub(r'\[\?|\]', '', text)
    m = re.search(r'т\s*а\s*б\s*л\s*и\s*ц[аы][ \t]*([А-Яа-яA-Za-z][ \t]*\.[ \t]*\d+(?:\.\d+)*|\d+(?:\.\d+)*)', plain, re.I)
    return re.sub(r'[ \t]+', '', m[1]) if m else None


class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.page = 0
        self.table = None
        self.row = None
        self.cell = None
        self.section = None

    def handle_comment(self, text):
        m = re.match(r'\s*стр\.\s*(\d+)', text)
        if m:
            self.page = int(m[1])

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table':
            self.table = dict(rows=[], page=self.page)
        elif tag in ('thead', 'tbody', 'tfoot'):
            self.section = tag
        elif tag == 'tr' and self.table is not None:
            self.row = dict(cells=[], section=self.section, page=self.page)
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = dict(text='', head=tag == 'th', page=self.page,
                             rs=max(1, int(attrs.get('rowspan', 1))),
                             cs=max(1, int(attrs.get('colspan', 1))))
        elif tag == 'br' and self.cell is not None:
            self.cell['text'] += '\n'

    def handle_data(self, text):
        if self.cell is not None:
            self.cell['text'] += text

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row['cells'].append(self.cell)
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.table['rows'].append(self.row)
            self.row = None
        elif tag in ('thead', 'tbody', 'tfoot'):
            self.section = None
        elif tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def expanded(table):
    grid = {}
    data = []
    for ri, row in enumerate(table['rows']):
        c = 0
        for cell in row['cells']:
            while (ri, c) in grid:
                c += 1
            for dr in range(cell['rs']):
                for dc in range(cell['cs']):
                    grid[(ri + dr, c + dc)] = dict(cell)
            c += cell['cs']
        head = row['section'] == 'thead' or any(x['head'] for x in row['cells'])
        if not head:
            cols = [ci for rr, ci in grid if rr == ri]
            data.append([grid.get((ri, ci), dict(text='', page=row['page']))
                         for ci in range(max(cols, default=-1) + 1)])
    return data, max((c for r, c in grid), default=-1) + 1


def shape(html):
    p = Tables()
    p.feed(html)
    if not p.tables:
        return 0, 0, False
    rows, cols = expanded(p.tables[0])
    return len(rows), cols, any(len(r) != cols for r in rows)


def tables_in(text):
    """Yield table id, rows; continuation fragments share an increasing row offset."""
    text = text.split('## Сомнительные места')[0]
    pattern = re.compile(r'<table\b.*?</table>|(?:^\s*\|[^\n]*\|\s*$\n?){2,}', re.S | re.M)
    result = []
    offsets = {}
    previous_end = 0
    for match in pattern.finditer(text):
        before = text[:match.start()]
        # Doubt markers may wrap only the numeric part: «А.[?1]».
        # Never inherit an unrelated caption from a preceding table.
        caption_area = re.sub(r'\[\?|\]', '', text[previous_end:match.start()])
        titles = [caption_id(line) for line in caption_area.splitlines() if len(line) < 160]
        titles = [title for title in titles if title]
        check = re.match(r'\s*<!--\s*таблица\s+([^:]+):\s*строк\s+\d+', text[match.end():], re.I)
        name = check[1].strip() if check else (titles[-1] if titles else f'unnamed-{len(result)+1}')
        # Slugging crops uses Latin A/B; actual captions remain unchanged.
        name = name.translate(str.maketrans({'A': 'А', 'B': 'Б'})) if re.match(r'^[AB]\.\d', name) else name
        marks = list(re.finditer(r'<!--\s*стр\.\s*(\d+)', before))
        page = int(marks[-1][1]) if marks else 0
        raw = match.group()
        if raw.lstrip().startswith('<table'):
            p = Tables()
            p.page = page
            p.feed(raw)
            rows, width = expanded(p.tables[0])
        else:
            lines = raw.strip().splitlines()
            cells = [[x.strip() for x in line.strip().strip('|').split('|')] for line in lines]
            sep = next((i for i, row in enumerate(cells)
                        if all(re.fullmatch(r':?-{2,}:?', x) for x in row)), None)
            if sep is None:
                continue
            rows = [[dict(text=unescape(x), page=page) for x in row] for row in cells[sep + 1:]]
            width = len(cells[0])
        start = offsets.get(name, 0)
        offsets[name] = start + len(rows)
        result.append(dict(name=name, page=page, start=start, rows=rows, width=width,
                           span=(match.start(), match.end())))
        previous_end = match.end()
    return result
