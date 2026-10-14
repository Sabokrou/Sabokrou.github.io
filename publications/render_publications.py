"""Render the publications page from reviewed paper and preprint records."""
import argparse
import base64
import datetime as dt
import html
import json
import mimetypes
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
esc = html.escape


def article(row, inline=False):
    links = ''.join(
        f'<a class="btn pub-resource" href="{esc(row[key])}" target="_blank" rel="noopener" aria-label="{label} for {esc(row["title"])}">{label} ↗</a>'
        for key, label in [('paper', 'Paper'), ('pdf', 'PDF'), ('code', 'Code')]
        if row.get(key)
    )
    file = ROOT / 'images/publications' / row['image']
    if file.exists():
        source = ('data:' + mimetypes.guess_type(file)[0] + ';base64,' + base64.b64encode(file.read_bytes()).decode()) if inline else '/images/publications/' + row['image']
        alt = ('Concept illustration for ' if row['image_kind'] == 'generated-illustration' else 'Figure from ') + row['title']
        visual = f'<img src="{source}" alt="{esc(alt)}" loading="lazy" decoding="async"><span class="pub-fallback" hidden>{esc(row["meta"])}</span>'
    else:
        visual = f'<span class="pub-fallback">arXiv preprint</span>'
    note = 'Illustration' if row['image_kind'] == 'generated-illustration' else ('Paper figure' if file.exists() else 'Figure pending review')
    attrs = f' data-first-posted="{row["first_posted"]}" data-publication-status="{row["publication_status"]}"' if row.get('first_posted') else ''
    return f'<article class="pub-entry" id="paper-{row["id"]}" data-year="{row["year"]}" data-topic="{esc(row["topic"])}"{attrs}><div class="pub-visual-box"><a class="pub-thumb" href="{esc(row["paper"])}" target="_blank" rel="noopener" aria-label="Read {esc(row["title"])}">{visual}</a><span class="pub-image-credit">{note}</span></div><div class="pub-details"><p class="pub-meta"><span class="pub-venue">{esc(row["meta"])}</span><span>{esc(row["topic"])}</span></p><h3><a href="{esc(row["paper"])}" target="_blank" rel="noopener">{esc(row["title"])}</a></h3><p class="pub-authors">{row["authors"]}</p><div class="pub-resources">{links}</div></div></article>'


def render(inline=False):
    rows = json.loads((HERE / 'papers.json').read_text())
    preprints = json.loads((HERE / 'preprints.json').read_text())['papers']
    rows.sort(key=lambda r: -r['year'])
    years = sorted({r['year'] for r in rows + preprints}, reverse=True)
    topics = sorted({r['topic'] for r in rows + preprints})
    template = (ROOT / '.github/site-templates/publications.html').read_text()
    template = template.replace('@@COUNT@@', str(len(rows) + len(preprints)))
    template = template.replace('@@TOPICS@@', ''.join(f'<option value="{esc(t)}">{esc(t)}</option>' for t in topics))
    template = template.replace('@@YEARS@@', '<button class="btn" data-year-filter="all" aria-pressed="true" type="button">All years</button>' + ''.join(f'<button class="btn" data-year-filter="{y}" aria-pressed="false" type="button">{y}</button>' for y in years))
    content = '<section class="pub-year-section pub-preprint-section" aria-labelledby="pub-preprint-title"><div class="pub-year-heading"><h2 id="pub-preprint-title">Recent preprints</h2><span>' + str(len(preprints)) + ' preprints</span></div><p class="pub-preprint-policy">First posted on arXiv in the last six months · no known journal or conference publication</p>' + ''.join(article(r, inline) for r in preprints) + '</section>'
    for year in years:
        group = [r for r in rows if r['year'] == year]
        if group:
            content += f'<section class="pub-year-section" aria-labelledby="pub-year-{year}"><div class="pub-year-heading"><h2 id="pub-year-{year}">{year}</h2><span>{len(group)} papers</span></div>' + ''.join(article(r, inline) for r in group) + '</section>'
    return template.replace('@@PAPERS@@', content)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview')
    args = parser.parse_args()
    if args.preview:
        Path(args.preview).write_text(render(inline=True))
    else:
        fragment = render()
        metadata = (ROOT / '.github/site-templates/publications-head.html').read_text()
        (HERE / 'index.html').write_text('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Selected Publications | Mohammad Sabokrou</title><meta name="description" content="Selected publications by year, with paper figures, resource links and recent arXiv preprints."><link rel="canonical" href="https://sabokrou.github.io/publications/"><link rel="icon" href="/images/profile.jpeg">' + metadata + '<link rel="stylesheet" href="/assets/css/minimal-site.css"><link rel="stylesheet" href="/assets/css/publications.css"><link rel="stylesheet" href="/assets/css/site-refinements.css?v=f8aeea06fcab"></head><body class="page-publications">' + fragment + '</body></html>')
