"""Refresh recent arXiv preprints, retaining reviewed thumbnail choices."""
import calendar
import datetime as dt
import difflib
import html
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from render_publications import HERE, render

NS = {'a': 'http://www.w3.org/2005/Atom', 'x': 'http://arxiv.org/schemas/atom'}


def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'SabokrouAcademicWebsite/1.0 (publications metadata refresh)'})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read()


def normalized(text):
    return re.sub(r'[^a-z0-9]', '', html.unescape(text).lower())


def publication_match(title):
    url = 'https://api.crossref.org/works?' + urllib.parse.urlencode({'query.title': title, 'rows': 5})
    records = json.loads(get(url))['message']['items']
    for record in records:
        if record.get('type') not in ('journal-article', 'proceedings-article', 'book-chapter'):
            continue
        if not any(normalized(a.get('family', '')) == 'sabokrou' for a in record.get('author', [])):
            continue
        score = max((difflib.SequenceMatcher(None, normalized(title), normalized(t)).ratio() for t in record.get('title', [])), default=0)
        if score >= 0.93:
            return record.get('DOI') or 'matching publication record'
    return None


def refresh(today=None):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    absolute_month = today.year * 12 + today.month - 1 - 6
    year, month0 = divmod(absolute_month, 12)
    cutoff = dt.date(year, month0 + 1, min(today.day, calendar.monthrange(year, month0 + 1)[1]))
    query = f'au:Sabokrou AND submittedDate:[{cutoff:%Y%m%d}0000 TO {today:%Y%m%d}2359]'
    url = 'https://export.arxiv.org/api/query?' + urllib.parse.urlencode({'search_query': query, 'start': 0, 'max_results': 100, 'sortBy': 'submittedDate', 'sortOrder': 'descending'})
    root = ET.fromstring(get(url))
    total = int(root.findtext('{http://a9.com/-/spec/opensearch/1.1/}totalResults', default='0'))
    if total > 100:
        raise RuntimeError('Recent arXiv results require pagination; existing preprints were preserved.')
    old = json.loads((HERE / 'preprints.json').read_text())
    reviewed = {r['arxiv_id']: r for r in old['papers']}
    published = json.loads((HERE / 'papers.json').read_text())
    published_titles = {normalized(r['title']) for r in published}
    published_ids = {m.group(1) for r in published if (m := re.search(r'arxiv.org/(?:abs|pdf)/([0-9.]+)', r['paper']))}
    papers, excluded = [], []
    for entry in root.findall('a:entry', NS):
        text = lambda key, prefix='a': ' '.join(entry.findtext(prefix + ':' + key, default='', namespaces=NS).split())
        authors = [a.findtext('a:name', default='', namespaces=NS) for a in entry.findall('a:author', NS)]
        if not any(normalized(a) in ('mohammadsabokrou', 'msabokrou') for a in authors):
            continue
        aid = re.search(r'/abs/([0-9.]+)', text('id')).group(1)
        first = dt.date.fromisoformat(text('published')[:10])
        if not cutoff <= first <= today:
            continue
        title, comment, journal, doi = text('title'), text('comment', 'x'), text('journal_ref', 'x'), text('doi', 'x')
        reason = None
        if aid in published_ids or normalized(title) in published_titles:
            reason = 'Already listed as a published paper'
        elif journal and 'arxiv' not in journal.lower():
            reason = 'Journal/conference reference: ' + journal
        elif doi and not doi.lower().startswith('10.48550/'):
            reason = 'Publication DOI: ' + doi
        elif re.search(r'\b(accepted|published|to appear|withdrawn)\b', comment, re.I):
            reason = comment
        else:
            matched = publication_match(title)
            if matched:
                reason = 'Matching Crossref publication: ' + matched
        if reason:
            excluded.append({'arxiv_id': aid, 'reason': reason})
            continue
        row = dict(reviewed.get(aid, {}))
        summary = text('summary')
        code = re.search(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', summary)
        row.update(id=row.get('id', 'arxiv-' + aid.replace('.', '-')), arxiv_id=aid, title=title,
                   authors=', '.join('<strong>Mohammad Sabokrou</strong>' if normalized(a) in ('mohammadsabokrou', 'msabokrou') else html.escape(a) for a in authors),
                   year=first.year, meta='Preprint · ' + first.isoformat(), topic=row.get('topic', 'Recent research'),
                   paper='https://arxiv.org/abs/' + aid, pdf='https://arxiv.org/pdf/' + aid,
                   code=code.group(0).rstrip('.') if code else row.get('code'),
                   image=row.get('image', 'unreviewed-preprint.webp'), image_kind=row.get('image_kind', 'pending-figure-review'),
                   first_posted=first.isoformat(), publication_status='preprint', comment=comment,
                   verified_at=today.isoformat(), publication_checks=['arXiv metadata', 'Known publications', 'Crossref title and author match'])
        papers.append(row)
    papers.sort(key=lambda r: r['first_posted'], reverse=True)
    result = {'checked_at': today.isoformat(), 'window_start': cutoff.isoformat(), 'window_end': today.isoformat(), 'papers': papers, 'excluded': excluded}
    # All source checks must succeed before changing the existing file.
    (HERE / 'preprints.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    result = refresh()
    fragment = render()
    destination = HERE / 'index.html'
    existing = destination.read_text()
    start = existing.index('<div id="academic-publications-preview">')
    end = existing.rindex('</body>')
    destination.write_text(existing[:start] + fragment + existing[end:])
    print(f"Updated {len(result['papers'])} recent preprints; excluded {len(result['excluded'])} known publications.")
