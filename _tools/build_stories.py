#!/usr/bin/env python3
"""Build standalone story pages from a complete Tattler issue page.

The complete issue page (for example november-2026.html) is the only place
story text is maintained. This script copies each story's markup out of it,
verbatim, into its own page under stories/, using a small metadata-only
manifest (for example _src/november-2026.json) for titles, descriptions and
sharing images.

    python3 _tools/build_stories.py _src/november-2026.json          # build
    python3 _tools/build_stories.py _src/november-2026.json --check  # stale?

Standard library only. Nothing is written unless every story, link, image and
metadata field validates first; --check writes nothing and exits 1 if any
generated page is missing or out of date.

What a future issue needs: its stories must be elements with unique ids (the
November page uses <section class="story" id=...> and, inside the
neighborhood section, <div class="brief" id=...>). Each manifest unit names
its id, how its headline becomes the page's h1 (promote an existing heading or
insert one), whether it needs its parent section's styling context, and any
issue-only parts to leave out. An issue built differently needs a different
manifest, and possibly a small change here; nothing assumes every month is
shaped like November.
"""
import argparse
import html
import json
import os
import re
import struct
import sys
import tempfile
from html.parser import HTMLParser

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'source', 'track', 'wbr'}
URL_ATTRS = ('href', 'src', 'poster')


class BuildError(Exception):
    pass


# ---------------------------------------------------------------- parsing

class Node:
    __slots__ = ('tag', 'attrs', 'start', 'open_end', 'close_start', 'end',
                 'parent', 'children')

    def __init__(self, tag, attrs, start, open_end, parent):
        self.tag, self.attrs = tag, attrs
        self.start, self.open_end = start, open_end
        self.close_start = self.end = None
        self.parent, self.children = parent, []

    def get(self, name, default=None):
        for k, v in self.attrs:
            if k == name:
                return v
        return default

    @property
    def classes(self):
        return (self.get('class') or '').split()

    def iter(self):
        yield self
        for c in self.children:
            yield from c.iter()


class _Tree(HTMLParser):
    """Records each element's exact source offsets, so markup can be copied
    verbatim. Void elements never take an end tag; any other mismatch is an
    error rather than a guess."""

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.text = text
        self.line_starts = [0]
        for m in re.finditer('\n', text):
            self.line_starts.append(m.end())
        self.root = Node('#root', [], 0, 0, None)
        self.stack = [self.root]

    def _offset(self):
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def _open(self, tag, attrs, closed):
        start = self._offset()
        raw = self.get_starttag_text()
        node = Node(tag, attrs, start, start + len(raw), self.stack[-1])
        self.stack[-1].children.append(node)
        if closed or tag in VOID:
            node.close_start = node.end = node.open_end
        else:
            self.stack.append(node)

    def handle_starttag(self, tag, attrs):
        self._open(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        self._open(tag, attrs, True)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        off = self._offset()
        top = self.stack[-1]
        if len(self.stack) == 1 or top.tag != tag:
            line = self.getpos()[0]
            raise BuildError(f'unexpected </{tag}> at line {line} '
                             f'(open element: <{top.tag}>)')
        top.close_start = off
        top.end = self.text.index('>', off) + 1
        self.stack.pop()


def parse(text):
    tree = _Tree(text)
    tree.feed(text)
    tree.close()
    if len(tree.stack) != 1:
        open_tags = ', '.join(f'<{n.tag}>' for n in tree.stack[1:])
        raise BuildError(f'unclosed elements at end of document: {open_tags}')
    tree.root.end = len(text)
    return tree.root


def matches(node, selector):
    """'tag', '.class', 'tag.class' or 'tag.class.other'."""
    tag, _, cls = selector.partition('.')
    if tag and node.tag != tag:
        return False
    return all(c in node.classes for c in cls.split('.') if c)


def select(node, selector):
    return [n for n in node.iter() if n is not node and matches(n, selector)]


def ids_in(node):
    found = {}
    for n in node.iter():
        i = n.get('id')
        if i:
            found.setdefault(i, []).append(n)
    return found


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def visible_text(fragment):
    p = _Text()
    p.feed(fragment)
    p.close()
    return ' '.join(' '.join(p.parts).split())


# ---------------------------------------------------------------- links

SCHEME = re.compile(r'^[a-zA-Z][a-zA-Z0-9+.-]*:')


def rewrite_url(value, unit_ids, issue_ids, issue_file, root, problems):
    """Return the URL as seen from stories/."""
    if value is None:
        return value
    v = value.strip()
    if v == '' or SCHEME.match(v) or v.startswith('//') or v.startswith('/'):
        return value
    if v.startswith('#'):
        frag = v[1:]
        if frag in unit_ids:
            return value
        if frag in issue_ids:
            return f'../{issue_file}{v}'
        problems.append(f'fragment link {v} has no target in the issue')
        return value
    path, _, rest = v.partition('#')
    path = path.split('?')[0]
    if not os.path.exists(os.path.join(root, path)):
        problems.append(f'link or resource {path} does not exist in the site')
    elif rest and path == issue_file and rest not in issue_ids:
        problems.append(f'link {v} points at a missing issue anchor')
    return '../' + v


def rewrite_srcset(value, *args):
    out = []
    for part in value.split(','):
        bits = part.strip().split(None, 1)
        if not bits:
            continue
        url = rewrite_url(bits[0], *args)
        out.append(url + (' ' + bits[1] if len(bits) > 1 else ''))
    return ', '.join(out)


def start_tag(tag, attrs):
    out = '<' + tag
    for k, v in attrs:
        out += f' {k}' if v is None else f' {k}="{html.escape(v, quote=True)}"'
    return out + '>'


def rewrite_tag_attrs(node, args):
    new, changed = [], False
    for k, v in node.attrs:
        nv = v
        if k in URL_ATTRS:
            nv = rewrite_url(v, *args)
        elif k == 'srcset' and v:
            nv = rewrite_srcset(v, *args)
        changed |= nv != v
        new.append((k, nv))
    return new, changed


def copy_relocated(text, node, args, remove=(), rename=None, attrs_override=None):
    """Source of `node` with links rewritten for stories/, `remove` subtrees
    dropped and, optionally, one descendant renamed (e.g. h3 -> h1)."""
    edits = []
    removed = [(n.start, n.end) for n in remove]

    def inside_removed(n):
        return any(s <= n.start and n.end <= e for s, e in removed)

    for n in node.iter():
        if inside_removed(n):
            continue
        attrs, changed = rewrite_tag_attrs(n, args)
        if n is node and attrs_override is not None:
            attrs, changed = attrs_override(attrs), True
        tag = n.tag
        if rename and n is rename[0]:
            tag, changed = rename[1], True
            if n.close_start != n.end:
                edits.append((n.close_start, n.end, f'</{tag}>'))
        if changed:
            edits.append((n.start, n.open_end, start_tag(tag, attrs)))
    for s, e in removed:
        # take the removed element's own line with it
        nl = text.rfind('\n', node.start, s)
        line_start = nl + 1 if nl != -1 else s
        if text[line_start:s].strip() == '':
            s = line_start
            if text[e:e + 1] == '\n':
                e += 1
        edits.append((s, e, ''))
    out = text[node.start:node.end]
    base = node.start
    for s, e, r in sorted(edits, key=lambda x: x[0], reverse=True):
        out = out[:s - base] + r + out[e - base:]
    return out


# ---------------------------------------------------------------- images

def image_size(path):
    with open(path, 'rb') as f:
        head = f.read(32)
        if head[:8] == b'\x89PNG\r\n\x1a\n':
            return struct.unpack('>II', head[16:24])
        if head[:2] != b'\xff\xd8':
            raise BuildError(f'{path}: not a PNG or JPEG')
        f.seek(2)
        while True:
            b = f.read(1)
            while b and b != b'\xff':
                b = f.read(1)
            while b == b'\xff':
                b = f.read(1)
            if not b:
                raise BuildError(f'{path}: no JPEG size marker')
            m = b[0]
            if m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
                continue
            seg = struct.unpack('>H', f.read(2))[0]
            if m in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                     0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack('>xHH', f.read(5))
                return w, h
            f.seek(seg - 2, 1)


# ---------------------------------------------------------------- pages

STORY_CSS = """
/* standalone story pages (generated) */
.wrap p.storyorigin{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:11.5px;
  letter-spacing:.08em; text-transform:uppercase; color:#6b645c; margin:18px 0 0; }
.storyorigin a,.storyreturn a{ color:var(--ink); border-bottom:2px solid var(--red);
  text-decoration:none; }
.storyorigin a:hover,.storyreturn a:hover{ color:var(--red); }
.storypage .story:first-of-type{ margin-top:16px; }
.storypage h1.phead{ max-width:22ch; }
.storypage .story.single .strip{ margin-bottom:6px; }
.wrap p.storyreturn{ font-family:Archivo,Arial,sans-serif; font-weight:900; font-size:14px;
  letter-spacing:.04em; text-transform:uppercase; margin:8px 0 0; }
.storynav{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px 24px;
  border-top:2px solid var(--ink); border-bottom:1px solid var(--ink); padding:14px 0;
  margin:30px 0 0; }
.storynav a{ display:block; color:var(--ink); text-decoration:none; }
.storynav .lab{ display:block; font-family:'IBM Plex Mono',ui-monospace,monospace;
  font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#6b645c; margin:0 0 4px; }
.storynav .ttl{ display:block; font-family:Archivo,Arial,sans-serif; font-weight:900;
  font-size:16px; line-height:1.15; text-transform:uppercase; }
.storynav a:hover .ttl{ color:var(--red); }
.storynav .next{ text-align:right; grid-column:2; }
/* one Share button after the story (story-share.js); the issue links stay separate */
.share-block{ border-top:1px solid var(--rule); margin:34px 0 0; padding-top:22px; }
.share-block button{ display:inline-flex; align-items:center; gap:9px; min-height:46px; margin:0;
  border:1px solid var(--ink); border-radius:30px; background:transparent; color:var(--ink);
  padding:12px 20px; font:600 14px/1.2 Archivo,Arial,sans-serif; cursor:pointer; }
.share-block button:hover{ background:var(--ink); color:var(--paper); }
.share-block button:focus-visible{ outline:3px solid var(--red); outline-offset:4px; }
.share-block button[hidden],.share-block #share-manual[hidden]{ display:none; }
.wrap .share-block #share-status{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:12px;
  line-height:1.5; margin:12px 0 0; }
.share-block #share-manual input{ display:block; width:100%; max-width:560px; margin-top:6px; padding:12px;
  border:1px solid var(--ink); border-radius:0; background:#fff; color:var(--ink);
  font:14px 'IBM Plex Mono',ui-monospace,monospace; }
/* arriving from the issue's "Share this story" link keeps the story's ending in view */
#share-story{ scroll-margin-top:40vh; }
@media (max-width:560px){
  .storynav{ grid-template-columns:minmax(0,1fr); }
  .storynav .next{ grid-column:1; text-align:left; }
}
"""


SHARE_ICON = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
              'stroke-width="1.7" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8"/></svg>')


def jsonld(data):
    return json.dumps(data, indent=2, ensure_ascii=False).replace('</', '<\\/')


def esc(s):
    return html.escape(s, quote=True)


def load_manifest(path):
    with open(path, encoding='utf-8') as f:
        m = json.load(f)
    for key in ('issue', 'issue_name', 'date_published', 'site', 'stories_dir',
                'path_prefix', 'units'):
        if key not in m:
            raise BuildError(f'manifest is missing "{key}"')
    seen_ids, seen_slugs = set(), set()
    for u in m['units']:
        for key in ('id', 'slug', 'discovery_headline', 'discovery_description',
                    'article_headline', 'heading', 'og_image', 'og_image_alt'):
            if not u.get(key):
                raise BuildError(f'unit {u.get("id", "?")}: missing "{key}"')
        if u['id'] in seen_ids:
            raise BuildError(f'duplicate manifest id: {u["id"]}')
        if u['slug'] in seen_slugs:
            raise BuildError(f'duplicate manifest slug: {u["slug"]}')
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', u['slug']):
            raise BuildError(f'unit {u["id"]}: slug must be lowercase-hyphenated')
        seen_ids.add(u['id'])
        seen_slugs.add(u['slug'])
    return m


def build(root, manifest_path):
    """Return {relative output path: page text}. Raises BuildError on any
    problem; never writes."""
    m = load_manifest(os.path.join(root, manifest_path))
    issue_file = m['issue']
    with open(os.path.join(root, issue_file), encoding='utf-8') as f:
        text = f.read()
    doc = parse(text)
    issue_ids = ids_in(doc)
    dupes = sorted(i for i, ns in issue_ids.items() if len(ns) > 1)
    if dupes:
        raise BuildError(f'duplicate ids in {issue_file}: {", ".join(dupes)}')
    site = m['site'].rstrip('/') + '/'
    issue_url = site + issue_file
    units = m['units']

    def node_for(uid):
        if uid not in issue_ids:
            raise BuildError(f'manifest id "{uid}" not found in {issue_file}')
        return issue_ids[uid][0]

    nodes = [node_for(u['id']) for u in units]
    order = [n.start for n in nodes]
    if order != sorted(order):
        raise BuildError('manifest units are not in the issue\'s printed order')

    def one(parent, selector, what):
        found = [n for n in parent.children if matches(n, selector)] or select(parent, selector)
        if len(found) != 1:
            raise BuildError(f'{what}: expected one "{selector}", found {len(found)}')
        return found[0]

    def path_for(u):
        return f'{m["stories_dir"]}/{m["path_prefix"]}{u["slug"]}.html'

    head = one(doc, 'head', 'issue')
    style = one(head, 'style', 'issue head')
    fonts = [n for n in head.children if n.tag == 'link' and 'fonts.g' in (n.get('href') or '')]
    beacon = [n for n in doc.iter() if n.tag == 'script'
              and 'cloudflareinsights' in (n.get('src') or '')]
    if len(beacon) != 1:
        raise BuildError(f'expected one analytics beacon in the issue, found {len(beacon)}')
    body = one(doc, 'body', 'issue')
    wrap = one(body, 'div.wrap', 'issue body')
    sitebar = one(wrap, 'nav.sitebar', 'issue')
    payup = one(wrap, 'div.payup', 'issue')
    colophon = one(wrap, 'div.colophon', 'issue')
    footnav = one(body, 'div.tt-footnav', 'issue')

    pages, problems = {}, []

    for idx, (u, node) in enumerate(zip(units, nodes)):
        where = f'unit {u["id"]}'
        unit_ids = set(ids_in(node))
        args = (unit_ids, issue_ids, issue_file, root, problems)
        local = lambda n: copy_relocated(text, n, (set(), issue_ids, issue_file, root, problems))

        # the quiet "Share this story" link belongs to the issue only
        shares = select(node, 'p.sharelink')
        if len(shares) != 1:
            raise BuildError(f'{where}: expected one share link in the issue, found {len(shares)}')
        share_href = select(shares[0], 'a')[0].get('href')
        if share_href != path_for(u) + '#share-story':
            raise BuildError(f'{where}: share link points at {share_href}, '
                             f'expected {path_for(u)}#share-story')
        remove = list(shares)
        for sel in u.get('exclude', []):
            found = select(node, sel)
            if not found:
                raise BuildError(f'{where}: nothing matches exclude selector "{sel}"')
            remove += found

        heading = u['heading']
        rename, inserted = None, ''
        if 'promote' in heading:
            h = select(node, heading['promote'])
            if len(h) != 1:
                raise BuildError(f'{where}: expected one heading "{heading["promote"]}", found {len(h)}')
            rename = (h[0], 'h1')
            if visible_text(text[h[0].start:h[0].end]) != u['article_headline']:
                raise BuildError(f'{where}: heading text differs from article_headline')
        elif 'insert' in heading:
            inserted = f'\n  <h1 class="{esc(heading.get("class", "phead"))}">{esc(heading["insert"])}</h1>'
        else:
            raise BuildError(f'{where}: heading needs "promote" or "insert"')

        fragment = copy_relocated(text, node, args, remove=remove, rename=rename)
        if u.get('context') == 'parent':
            parent = node.parent
            if parent is None or not matches(parent, 'section.story'):
                raise BuildError(f'{where}: parent is not a section.story')
            strip = [c for c in parent.children if matches(c, 'div.strip')]
            # the parent's styling context, without its id or container heading
            open_tag = start_tag(parent.tag, [(k, (v + ' single') if k == 'class' else v)
                                              for k, v in parent.attrs if k != 'id'])
            content = (open_tag + '\n  ' + (local(strip[0]) if strip else '') + inserted
                       + '\n  ' + fragment + '\n  </section>')
        else:
            if inserted:
                raise BuildError(f'{where}: "insert" headings need parent context')
            content = fragment

        # body text must match the issue unit exactly
        issue_text = visible_text(copy_relocated(text, node, (set(), set(), '', root, []),
                                                 remove=remove))
        page_text = visible_text(fragment)
        if issue_text != page_text:
            raise BuildError(f'{where}: story text differs from the issue')

        og_rel = f'{m["stories_dir"]}/{u["og_image"]}'
        og_path = os.path.join(root, og_rel)
        if not os.path.exists(og_path):
            raise BuildError(f'{where}: sharing image {og_rel} is missing')
        ow, oh = image_size(og_path)
        if (ow, oh) != (1200, 630):
            raise BuildError(f'{where}: sharing image is {ow}x{oh}, expected 1200x630')

        url = site + path_for(u)
        og_url = site + og_rel
        title = f'{u["discovery_headline"]} | Monroe Street Tattler'
        desc = u['discovery_description']
        ld = {
            '@context': 'https://schema.org',
            '@graph': [
                {
                    '@type': 'NewsArticle',
                    'headline': u['discovery_headline'],
                    'description': desc,
                    'url': url,
                    'mainEntityOfPage': url,
                    'inLanguage': 'en-US',
                    'isAccessibleForFree': True,
                    'datePublished': m['date_published'],
                    'author': {'@type': 'Organization', 'name': 'The Monroe Street Tattler'},
                    'publisher': {'@type': 'NewsMediaOrganization',
                                  'name': 'The Monroe Street Tattler', 'url': site},
                    'image': og_url,
                    'isPartOf': {'@type': 'PublicationIssue', 'name': m['issue_name'],
                                 'url': issue_url},
                },
                {
                    '@type': 'BreadcrumbList',
                    'itemListElement': [
                        {'@type': 'ListItem', 'position': 1, 'name': 'The Monroe Street Tattler', 'item': site},
                        {'@type': 'ListItem', 'position': 2, 'name': 'Past Issues', 'item': site + 'issues.html'},
                        {'@type': 'ListItem', 'position': 3, 'name': m['issue_name'], 'item': issue_url},
                        {'@type': 'ListItem', 'position': 4, 'name': u['discovery_headline']},
                    ],
                },
            ],
        }

        def navlink(v, cls, label):
            return (f'\n    <a class="{cls}" href="{esc(m["path_prefix"] + v["slug"] + ".html")}">'
                    f'<span class="lab">{label}</span>'
                    f'<span class="ttl">{esc(v["discovery_headline"])}</span></a>')
        nav = ''
        if idx > 0:
            nav += navlink(units[idx - 1], 'prev', '&larr; Previous story')
        if idx < len(units) - 1:
            nav += navlink(units[idx + 1], 'next', 'Next story &rarr;')
        back = f'../{issue_file}#{u["id"]}'

        support = [c for c in payup.children
                   if matches(c, 'p.payhead') or matches(c, 'div.paybtns') or matches(c, 'p.payfine')]
        support_html = '\n  <div class="payup">' + ''.join('\n    ' + local(c) for c in support) + '\n  </div>'

        page = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{esc(url)}">
<link rel="icon" href="../favicon.ico">

<meta property="og:type" content="article">
<meta property="og:site_name" content="The Monroe Street Tattler">
<meta property="og:url" content="{esc(url)}">
<meta property="og:title" content="{esc(u["discovery_headline"])}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:image" content="{esc(og_url)}">
<meta property="og:image:width" content="{ow}">
<meta property="og:image:height" content="{oh}">
<meta property="og:image:alt" content="{esc(u["og_image_alt"])}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(u["discovery_headline"])}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{esc(og_url)}">
<meta name="twitter:image:alt" content="{esc(u["og_image_alt"])}">
{chr(10).join(text[n.start:n.end] for n in fonts)}
<script type="application/ld+json">
{jsonld(ld)}
</script>
{text[style.start:style.end]}
<style>{STORY_CSS}</style>
<!-- Cloudflare Web Analytics -->
{text[beacon[0].start:beacon[0].end]}
<!-- End Cloudflare Web Analytics -->
</head>
<body class="storypage">
<div class="wrap">

  {local(sitebar)}

  <p class="storyorigin">From the {esc(m["issue_name"])} issue &middot; <a href="{esc(back)}">Read it in the complete paper</a></p>

  {content}

  <div class="share-block"><button id="share-story" type="button" data-share-url="{esc(url)}" data-share-title="{esc(u["discovery_headline"])}" aria-label="Share this story: {esc(u["discovery_headline"])}" aria-controls="share-status" hidden>{SHARE_ICON} Share this story</button><p id="share-status" role="status"></p><div id="share-manual" hidden><input readonly aria-label="Story link"></div></div>

  <p class="storyreturn"><a href="{esc(back)}">&larr; Back to this story in the complete {esc(m["issue_name"])} issue</a></p>

  <nav class="storynav" aria-label="More stories from the {esc(m["issue_name"])} issue">{nav}
  </nav>
{support_html}

  {local(colophon)}

</div>

{local(footnav)}
<script src="../story-share.js" defer></script>
</body>
</html>
'''
        out_doc = parse(page)
        h1s = [n for n in out_doc.iter() if n.tag == 'h1']
        if len(h1s) != 1:
            raise BuildError(f'{where}: page would have {len(h1s)} h1 elements')
        out_ids = ids_in(out_doc)
        for n in out_doc.iter():
            href = n.get('href') or ''
            if href.startswith('#') and href[1:] not in out_ids:
                problems.append(f'{where}: in-page link {href} has no target')
        pages[path_for(u)] = page

    if problems:
        raise BuildError('\n  '.join(['link problems:'] + sorted(set(problems))))
    return pages


def write_pages(root, pages):
    """Write every page via a temporary file in its own directory, only after
    build() has validated all of them."""
    for rel in pages:
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
    temps = []
    try:
        for rel, page in pages.items():
            d = os.path.dirname(os.path.join(root, rel))
            fd, tmp = tempfile.mkstemp(dir=d, prefix='.build-', suffix='.html')
            with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
                f.write(page)
            os.chmod(tmp, 0o644)
            temps.append((tmp, os.path.join(root, rel)))
        for tmp, dest in temps:
            os.replace(tmp, dest)
    finally:
        for tmp, _ in temps:
            if os.path.exists(tmp):
                os.remove(tmp)


def stale(root, pages, manifest):
    out = []
    for rel, page in pages.items():
        p = os.path.join(root, rel)
        if not os.path.exists(p):
            out.append(f'missing: {rel}')
        else:
            with open(p, encoding='utf-8') as f:
                if f.read() != page:
                    out.append(f'out of date: {rel}')
    d = os.path.join(root, manifest['stories_dir'])
    if os.path.isdir(d):
        for name in sorted(os.listdir(d)):
            rel = f'{manifest["stories_dir"]}/{name}'
            if (name.startswith(manifest['path_prefix']) and name.endswith('.html')
                    and rel not in pages):
                out.append(f'not in manifest: {rel}')
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('manifest', help='manifest path, relative to the site root')
    ap.add_argument('--check', action='store_true',
                    help='write nothing; exit 1 if generated pages are missing or stale')
    ap.add_argument('--root', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    help='site root (default: the folder above _tools)')
    a = ap.parse_args(argv)
    try:
        pages = build(a.root, a.manifest)
        manifest = load_manifest(os.path.join(a.root, a.manifest))
    except BuildError as e:
        print(f'build_stories: {e}', file=sys.stderr)
        return 2
    if a.check:
        problems = stale(a.root, pages, manifest)
        for p in problems:
            print(p)
        print(f'{len(pages)} story pages checked: '
              + ('up to date' if not problems else f'{len(problems)} problem(s)'))
        return 1 if problems else 0
    write_pages(a.root, pages)
    for rel in pages:
        print('wrote', rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
