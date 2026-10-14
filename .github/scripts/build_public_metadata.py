"""Build the canonical sitemap and Atom updates feed from public HTML."""
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
BASE = 'https://sabokrou.github.io'
SITEMAP = 'http://www.sitemaps.org/schemas/sitemap/0.9'
ATOM = 'http://www.w3.org/2005/Atom'


class PublicHTML(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.meta, self.links, self.title, self.news = {}, [], '', []
        self.in_title = False
        self.in_news = False
        self.item = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            self.meta[attrs.get('name') or attrs.get('property')] = attrs.get('content', '')
        elif tag == 'link':
            self.links.append(attrs)
        elif tag == 'title':
            self.in_title = True
        elif tag == 'ul' and 'news-list' in attrs.get('class', '').split():
            self.in_news = True
        elif tag == 'li' and self.in_news:
            self.item = {'id': attrs.get('id', ''), 'text': '', 'date': ''}
        elif tag == 'time' and self.item is not None:
            self.item['date'] = attrs.get('datetime', '')

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.item is not None:
            self.item['text'] += data

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        elif tag == 'li' and self.item is not None:
            self.news.append(self.item)
            self.item = None
        elif tag == 'ul':
            self.in_news = False

    @property
    def canonical(self):
        return next((x.get('href', '') for x in self.links if x.get('rel') == 'canonical'), '')


def modified(path):
    result = subprocess.run(['git', 'log', '-1', '--format=%cI', '--', str(path.relative_to(ROOT))], cwd=ROOT, text=True, capture_output=True, check=True)
    return result.stdout.strip() or datetime.now(timezone.utc).isoformat(timespec='seconds')


def stamp(value):
    date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def put(parent, tag, value, namespace):
    element = ET.SubElement(parent, f'{{{namespace}}}{tag}')
    element.text = value
    return element


def write_xml(path, element, namespace):
    ET.register_namespace('', namespace)
    ET.indent(element, space='  ')
    path.write_bytes(ET.tostring(element, encoding='utf-8', xml_declaration=True) + b'\n')


def build():
    pages = {}
    for path in sorted(ROOT.rglob('*.html')):
        parts = path.relative_to(ROOT).parts
        if any(x in {'.git', '.github', 'recruitment-assets', 'apply', 'hiring', 'team'} for x in parts):
            continue
        source = path.read_text()
        if 'site-refinements.css' not in source:
            continue
        page = PublicHTML(source)
        if not page.canonical.startswith(BASE + '/') or 'noindex' in page.meta.get('robots', '').lower():
            continue
        pages[page.canonical] = (path, page)
    sitemap = ET.Element(f'{{{SITEMAP}}}urlset')
    for canonical in sorted(pages):
        item = ET.SubElement(sitemap, f'{{{SITEMAP}}}url')
        put(item, 'loc', canonical, SITEMAP)
    write_xml(ROOT / 'sitemap.xml', sitemap, SITEMAP)

    entries = []
    for canonical, (path, page) in pages.items():
        if path.parent.parent.name == 'blog':
            entry = {'id': canonical, 'url': canonical, 'title': page.title.split(' | Mohammad Sabokrou')[0], 'summary': page.meta.get('description', ''), 'updated': stamp(modified(path))}
            published = page.meta.get('article:published_time', '')
            if published:
                entry['published'] = stamp(published)
            period = re.search(r'<p class="meta">([A-Za-z]+ \d{4})', path.read_text())
            entry['_sort'] = entry.get('published') or (datetime.strptime(period.group(1), '%B %Y').strftime('%Y-%m') if period else entry['updated'])
            entries.append(entry)
    news_path = ROOT / 'news/index.html'
    news = PublicHTML(news_path.read_text())
    for row in news.news:
        if not row['date']:
            continue
        date = stamp(row['date'])
        title = re.sub(r'^\d{1,2} \w+ \d{4}:\s*', '', row['text']).strip()
        url = BASE + '/news/#' + (row['id'] or 'update-' + row['date'])
        entries.append({'id': url, 'url': url, 'title': title, 'summary': title, 'published': date, 'updated': max(date, stamp(modified(news_path)))})
    entries.sort(key=lambda x: x.get('_sort') or x.get('published', x['updated']), reverse=True)
    feed = ET.Element(f'{{{ATOM}}}feed', {'{http://www.w3.org/XML/1998/namespace}lang': 'en'})
    put(feed, 'title', 'Mohammad Sabokrou — Updates and Writing', ATOM)
    put(feed, 'id', BASE + '/feed.xml', ATOM)
    ET.SubElement(feed, f'{{{ATOM}}}link', {'href': BASE + '/feed.xml', 'rel': 'self', 'type': 'application/atom+xml'})
    ET.SubElement(feed, f'{{{ATOM}}}link', {'href': BASE + '/news/'})
    author = ET.SubElement(feed, f'{{{ATOM}}}author')
    put(author, 'name', 'Mohammad Sabokrou', ATOM)
    put(author, 'uri', BASE + '/', ATOM)
    put(feed, 'updated', max(x['updated'] for x in entries), ATOM)
    for row in entries:
        entry = ET.SubElement(feed, f'{{{ATOM}}}entry')
        for key in ['id', 'title', 'updated', 'published']:
            if row.get(key):
                put(entry, key, row[key], ATOM)
        ET.SubElement(entry, f'{{{ATOM}}}link', {'href': row['url'], 'rel': 'alternate'})
        summary = put(entry, 'summary', row['summary'], ATOM)
        summary.set('type', 'text')
    write_xml(ROOT / 'feed.xml', feed, ATOM)
    print(f'Built {len(pages)} canonical sitemap pages and {len(entries)} Atom entries.')


if __name__ == '__main__':
    build()
