"""Logical rows for wide sortament tables; coordinates come from text, not digits."""
import re
import numpy as np
from cells import row_bands, numeric_word
from table_data import caption_id


def column(xs, word):
    return max(0,min(len(xs)-2,int(np.searchsorted(xs,(word['x0']+word['x1'])/2)-1)))


def aligned_fragments(tables, words, gray):
    from tables import line_masks, _cells
    horiz,vert=line_masks(gray)
    out=[]
    for t in tables:
        if out:
            top=out[-1];gap=t['bbox'][1]-top['bbox'][3]
            same_columns=len(top['xs'])==len(t['xs']) and len(t['xs'])>=11
            interior=same_columns and all(abs(a-b)<9 for a,b in zip(top['xs'][1:-1],t['xs'][1:-1]))
            edge_tolerance=float(np.median(np.diff(t['xs'])))*.6
            aligned=interior and abs(top['xs'][0]-t['xs'][0])<edge_tolerance and abs(top['xs'][-1]-t['xs'][-1])<edge_tolerance
            between=[w for w in words if top['bbox'][3]<(w['y0']+w['y1'])/2<t['bbox'][1] and top['bbox'][0]<(w['x0']+w['x1'])/2<top['bbox'][2]]
            caption=any(caption_id(' '.join(w['t'] for w in band)) for cy,band in row_bands(between))
            nums=sum(numeric_word(w['t']) for w in between)
            if aligned and 0<=gap<gray.shape[0]*.18 and not caption and nums>=len(t['xs'])//2:
                ys=top['ys']+t['ys'];xs=list(top['xs'])
                xs[0]=min(xs[0],t['xs'][0]);xs[-1]=max(xs[-1],t['xs'][-1])
                top.update(xs=xs,ys=ys,cells=_cells(horiz,vert,xs,ys),bbox=tuple(int(round(v)) for v in (xs[0],ys[0],xs[-1],ys[-1])))
                continue
        out.append(t)
    return out


def normalize(table, words):
    """Create common numeric row crops before recognition, preserving section labels.

    Limited to wide tables with a strong numeric majority in each detected row.
    Missing values are left missing. No value is copied by numerical reasoning.
    """
    xs=table['xs'];C=len(xs)-1
    if C<10:
        return table
    x0,y0,x1,y1=table['bbox']
    # An open bottom rule is common: numeric rows continue below the last line.
    # Extend only over a contiguous, strongly aligned block; a footer cannot pass
    # the column quorum. Never fabricate a missing row or its values.
    tail=[]
    for cy,band in row_bands([w for w in words if x0<=(w['x0']+w['x1'])/2<=x1 and (w['y0']+w['y1'])/2>=y1]):
        numeric=[w for w in band if numeric_word(w['t'])]
        cols={column(xs,w) for w in numeric}
        height=float(np.median([w['y1']-w['y0'] for w in band]))
        last=tail[-1][0] if tail else y1
        if len(cols)<max(3,int(np.ceil(C*.4))) or cy-last>height*3:
            break
        tail.append((cy,band))
    if tail:
        y1=max(w['y1'] for cy,band in tail for w in band)+5
        table['bbox']=tuple(int(round(v)) for v in (x0,y0,x1,y1))
    ws=[w for w in words if x0<=(w['x0']+w['x1'])/2<=x1 and y0<=(w['y0']+w['y1'])/2<=y1]
    candidates=row_bands([w for w in ws if numeric_word(w['t'])])
    bands=[(cy,band) for cy,band in candidates if len({column(xs,w) for w in band})>=max(3,int(np.ceil(C*.30)))]
    if len(bands)<3:
        return table
    first=bands[0][0]
    hr=max(0,min(len(table['ys'])-2,int(np.searchsorted(table['ys'],first)-1)))
    start=table['ys'][hr]
    # Text-only category rows belong in tbody, not in the repeated column header.
    groups=[]
    for cy,band in row_bands([w for w in ws if (w['y0']+w['y1'])/2>=start]):
        letters=sum(len(re.findall('[А-Яа-яЁё]',w['t'])) for w in band)
        left=min(w['x0'] for w in band);right=max(w['x1'] for w in band)
        if letters>=10 and sum(numeric_word(w['t']) for w in band)<=1 and left>x0+(x1-x0)*.12 and right<x1-(x1-x0)*.08:
            if min(abs(cy-b[0]) for b in bands)>np.median([w['y1']-w['y0'] for w in band]):
                groups.append((cy,band))
    entries=sorted([(cy,'number',band) for cy,band in bands]+[(cy,'section',band) for cy,band in groups])
    if entries[-1][0]>y1:
        return table
    body_ys=[float(start)]+[(a[0]+b[0])/2 for a,b in zip(entries,entries[1:])]+[float(y1)]
    header=[]
    for c in table['cells']:
        if c['r']<hr:
            head=dict(c);head['rs']=min(c['rs'],hr-c['r'])
            head['bbox']=(c['bbox'][0],c['bbox'][1],c['bbox'][2],min(c['bbox'][3],start))
            header.append(head)
    body=[]
    for i,(cy,kind,band) in enumerate(entries):
        for col in (range(1) if kind=='section' else range(C)):
            body.append(dict(r=hr+i,c=col,rs=1,cs=C if kind=='section' else 1,
                bbox=(xs[col],body_ys[i],xs[-1] if kind=='section' else xs[col+1],body_ys[i+1])))
    # Preserve a visibly merged numeric cell instead of cutting its one printed
    # value into two crops. Only original cell geometry is evidence for rowspan.
    for original in table['cells']:
        if original['cs']!=1:
            continue
        a,b,c,d=original['bbox']
        if b<start:
            continue
        inside=[w for w in ws if a<=(w['x0']+w['x1'])/2<=c and b<=(w['y0']+w['y1'])/2<=d]
        if len(inside)!=1 or not numeric_word(inside[0]['t']):
            continue
        covered=[i for i,(cy,kind,band) in enumerate(entries) if b<cy<d and kind=='number']
        if len(covered)<2 or covered!=list(range(covered[0],covered[-1]+1)):
            continue
        col=original['c'];first,last=covered[0],covered[-1]
        body=[cell for cell in body if not (cell['c']==col and hr+first<=cell['r']<=hr+last)]
        body.append(dict(r=hr+first,c=col,rs=last-first+1,cs=1,
                         bbox=(xs[col],body_ys[first],xs[col+1],body_ys[last+1])))
    table.update(ys=list(table['ys'][:hr])+body_ys,cells=header+body,
                 logical_rows=True,header_rows=hr)
    return table
