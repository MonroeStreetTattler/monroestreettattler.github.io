#!/usr/bin/env python3
"""Build the four standalone October 2026 story pages from the issue.

The reporting lives in one place, october-2026.html. This script copies each
story's paragraphs out of the issue exactly as they are, wraps them in the
standalone story layout, and checks that nothing was added, dropped or
reordered. Boundaries and page headings come from october-stories.json.

    python3 _tools/build_october_stories.py           write the four pages
    python3 _tools/build_october_stories.py --check   fail if a page is stale
    python3 _tools/build_october_stories.py --cards DIR
                                    also write 1200x630 card HTML into DIR
                                    (rendered to PNG separately)

Standard library only. Output is deterministic: no dates, no randomness.
"""
import html
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = Path(__file__).resolve().parent / "october-stories.json"
ENDMARK = '<span class="endmark" aria-hidden="true"></span>'
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "source", "track", "wbr"}


class Fail(Exception):
    pass


def need(ok, message):
    if not ok:
        raise Fail(message)


# ---------- reading the issue ----------

class _Blocks(HTMLParser):
    """Top-level elements of a fragment, each with its exact source text."""

    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.line_starts = [0]
        for m in re.finditer("\n", text):
            self.line_starts.append(m.end())
        self.depth = 0
        self.start = None
        self.found = []

    def _at(self):
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            if self.depth == 0:
                at = self._at()
                self.found.append((tag, dict(attrs), at, at + len(self.get_starttag_text())))
            return
        if self.depth == 0:
            self.start = (tag, dict(attrs), self._at())
        self.depth += 1

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        self.depth -= 1
        if self.depth == 0:
            at = self._at()
            end = self.text.index(">", at) + 1
            name, attrs, begin = self.start
            need(name == tag, f"unbalanced <{name}> closed by </{tag}>")
            self.found.append((name, attrs, begin, end))

    def handle_data(self, data):
        need(self.depth > 0 or not data.strip(), f"loose text between blocks: {data.strip()[:60]!r}")


def blocks(fragment):
    p = _Blocks(fragment)
    p.feed(fragment)
    p.close()
    need(p.depth == 0, "fragment ends inside an element")
    return [{"tag": t, "attrs": a, "raw": fragment[b:e]} for t, a, b, e in p.found]


def text_of(raw):
    return html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()


def inner(raw):
    return raw[raw.index(">") + 1:raw.rindex("<")]


def is_share_link(block, output):
    return (block["tag"] == "p" and block["attrs"].get("class") == "byline"
            and f'href="{output}#share-story"' in block["raw"])


def is_header(block):
    cls = block["attrs"].get("class", "")
    return (block["tag"] in ("h3", "h4") or (block["tag"] == "p" and cls in ("deck", "byline"))
            or (block["tag"] == "div" and cls == "lh"))


def extract(issue, story, index_html):
    """Return the story's header facts and its body blocks, exactly as in the issue."""
    need(issue.count(story["start"]) == 1, f"{story['key']}: start marker not unique")
    need(issue.count(story["next"]) == 1, f"{story['key']}: next marker not unique")
    a = issue.index(story["start"])
    z = issue.index(story["next"])
    need(a < z, f"{story['key']}: markers out of order")
    top = blocks(issue[a:z])

    if top[0]["tag"] == "div" and top[0]["attrs"].get("class") == "barb":
        container, rest = top[0], top[1:]
        items = blocks(inner(container["raw"]))
    else:
        container, rest, items = None, [], top

    header = []
    while items and is_header(items[0]):
        header.append(items.pop(0))
    hits = [i for i, b in enumerate(items) if story["through"] in b["raw"]]
    need(len(hits) == 1, f"{story['key']}: 'through' text found {len(hits)} times")
    body, after = items[:hits[0] + 1], items[hits[0] + 1:] + rest

    # what follows the story inside its range is accounted for, never silently dropped
    after = [b for b in after if not is_share_link(b, story["output"])]
    if story.get("excluded_after") == "repeated in #signs":
        signs = blocks(issue[z:issue.index("</div>", issue.index('<div class="pair">', z)) + 6])
        sign_ps = [b["raw"] for b in signs if b["tag"] == "p"]
        left = [b for b in after if not (b["tag"] == "div" and b["attrs"].get("class") == "clearfix")]
        need([b["raw"] for b in left] == sign_ps[:len(left)] and len(left) == 2,
             f"{story['key']}: text after the story is not the repeated #signs opening")
    else:
        need(not after, f"{story['key']}: unexpected content after the story: {after[:1]!r}")

    facts = {"labels": [], "deck": None, "head": None}
    for b in header:
        cls = b["attrs"].get("class", "")
        if b["tag"] == "h4":
            facts["head"] = text_of(b["raw"])
        elif cls == "deck":
            facts["deck"] = text_of(b["raw"])
        else:
            facts["labels"].append(text_of(b["raw"]))

    # headings and decks must already exist in published copy
    need(story["label"] in facts["labels"], f"{story['key']}: label not in the issue header")
    if story["headline_source"] == "issue":
        need(facts["head"] == story["headline"], f"{story['key']}: headline differs from the issue")
    else:
        cover = [text_of(m) for m in re.findall(
            r'<h1 class="splashline">.*?</h1>|<a class="teaser"[^>]*>.*?</a>', issue, re.S)]
        need(story["headline"] in cover, f"{story['key']}: headline is not a cover headline")
    if story["deck_source"] == "issue":
        need(facts["deck"] == story["deck"], f"{story['key']}: deck differs from the issue")
    else:
        need(story["deck"] in text_of(index_html), f"{story['key']}: deck not on the homepage")
    return [b["raw"] for b in body], container is not None


# ---------- writing a page ----------

def rebase(raw):
    """Point the issue's root-relative asset paths at the root from stories/."""
    return re.sub(r'\b(src|href)="(?!https?:|mailto:|#|/|\.\./)([^"]+)"', r'\1="../\2"', raw)


def with_endmark(body, story):
    marks = sum(b.count(ENDMARK) for b in body)
    if "endmark_on" in story:
        need(marks == 0, f"{story['key']}: issue already marks this story")
        hits = [i for i, b in enumerate(body) if story["endmark_on"] in b]
        need(len(hits) == 1, f"{story['key']}: endmark paragraph found {len(hits)} times")
        i = hits[0]
        need(body[i].endswith("</p>"), f"{story['key']}: endmark paragraph is not a <p>")
        body = body[:i] + [body[i][:-4] + ENDMARK + "</p>"] + body[i + 1:]
    else:
        need(marks == 1 and body[-1].endswith(ENDMARK + "</p>"),
             f"{story['key']}: issue's end square is missing or misplaced")
    return body


def esc(text):
    return html.escape(text, quote=True)


SHARE_ICON = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
              'stroke-width="1.7" aria-hidden="true"><path d="M12 16V3m-4 4 4-4 4 4M5 12v8h14v-8"/></svg>')


def card_alt(story, site):
    alt = f"The Monroe Street Tattler. {story['card_kicker'].replace(' · ', ', ')}. {story['headline']}. {story['deck']}"
    alt = alt if alt.endswith(".") else alt + "."
    if story.get("card_photo_alt"):
        alt += f" Photo: {story['card_photo_alt']}."
    return alt + " MonroeStreetTattler.com"


def page(story, body, boxed, manifest):
    site = manifest["site"]
    url = site + story["output"]
    image = site + story["card"]
    anchor = story["start"].split('id="')[1].split('"')[0]
    alt = card_alt(story, site)
    title = f"{story['headline']} | The Monroe Street Tattler"
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "NewsArticle",
                "headline": story["headline"],
                "description": story["deck"],
                "url": url,
                "mainEntityOfPage": url,
                "inLanguage": "en-US",
                "isAccessibleForFree": True,
                "author": {"@type": "Organization", "name": "The Monroe Street Tattler"},
                "publisher": {"@type": "NewsMediaOrganization", "name": "The Monroe Street Tattler", "url": site},
                "image": image,
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "The Monroe Street Tattler", "item": site},
                    {"@type": "ListItem", "position": 2, "name": manifest["issue_title"], "item": site + manifest["source"]},
                    {"@type": "ListItem", "position": 3, "name": story["headline"]},
                ],
            },
        ],
    }
    article = "\n".join("  " + rebase(b) for b in body)
    if boxed:
        article = '  <div class="barb">\n' + article + "\n  </div>"
    related = "".join(
        f'<a href="{Path(o["output"]).name}"><p>{esc(manifest["issue_title"])}</p><h3>{esc(o["headline"])}</h3></a>'
        for o in manifest["stories"] if o is not story)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(story['deck'])}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Monroe Street Tattler">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{esc(story['headline'])}">
<meta property="og:description" content="{esc(story['deck'])}">
<meta property="og:image" content="{image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(story['headline'])}">
<meta name="twitter:description" content="{esc(story['deck'])}">
<meta name="twitter:image" content="{image}">
<meta name="twitter:image:alt" content="{esc(alt)}">
<link rel="icon" type="image/x-icon" href="../favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;900&family=IBM+Plex+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="../tattler.css">
<link rel="stylesheet" href="october-stories.css">
<script type="application/ld+json">
{json.dumps(ld, indent=2, ensure_ascii=False)}
</script>
<!-- Cloudflare Web Analytics -->
<script
  type="module"
  src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{{"token": "b4b7990d0c27478ea9b605f098b4ad3c"}}'>
</script>
<!-- End Cloudflare Web Analytics -->
<!-- Generated from {manifest['source']} by _tools/build_october_stories.py. Edit the issue, then rebuild. -->
</head>
<body>
<div class="sheet">

<header class="tt-head pad">
  <div class="tt-brand">
    <div class="wordmark"><a href="../index.html" style="color:inherit;text-decoration:none;"><span>The Monroe Street</span><span>Tattler</span></a></div>
    <p class="tag">Urgent Reports on Matters of Limited Public Importance</p>
  </div>
  <nav class="tt-nav">
    <a href="../october-2026.html">Latest Issue</a>
    <a href="../issues.html">Past Issues</a>
    <a class="tt-sub" href="../index.html#delivery">Subscribe</a>
    <a class="tt-coffee" href="https://ko-fi.com/monroestreettattler#checkoutModal" target="_blank" rel="noopener">&#9749; Buy Us a Coffee</a>
  </nav>
</header>

<main class="story-shell">
<section class="story-top"><p class="kicker">{esc(manifest['issue_title'])} · The Monroe Street Tattler</p><h1>{esc(story['headline'])}</h1><p class="deck">{esc(story['deck'])}</p><p class="byline">{esc(story['label'])}</p></section>
<article class="story-text">
{article}
</article>
<div class="share-block"><button id="share-story" type="button" data-share-url="{url}" data-share-title="{esc(story['headline'])}" aria-label="Share this story: {esc(story['headline'])}" aria-controls="share-status" hidden>{SHARE_ICON} Share this story</button><div id="share-status" role="status"></div><div id="share-manual" hidden><input readonly aria-label="Story link"></div></div>
<nav class="issue-links" aria-label="Complete issue"><a href="../{manifest['source']}#{anchor}">Read this in the complete October issue →</a><a href="../{manifest['pdf']}">Download the paper (PDF)</a></nav>
<section class="related"><h2>Keep wandering.</h2><div class="related-grid">{related}</div></section>
</main>

<section class="band support">
  <div class="pad">
    <div class="supgrid">
      <div>
        <p class="slug ondark">Reader Support</p>
        <h2>The News Is Free.<br>The Paper Is Not.</h2>
        <p>Advertising pays for part of this paper. Reader contributions help with the rest.</p>
      </div>
      <div>
        <a class="bigbtn" href="https://ko-fi.com/monroestreettattler#checkoutModal" target="_blank" rel="noopener">&#9749; Buy Us a Coffee</a>
        <a class="subbtn" href="../index.html#delivery">Subscribe &mdash; Never Miss an Issue</a>
        <p class="fine" style="margin-top:14px;">One time or monthly. Both options are on the next screen.</p>
      </div>
    </div>
  </div>
</section>

<footer class="foot pad">
  <div class="footnav">
    <a href="../index.html">Home</a>
    <a href="../files.html">Explore stories</a>
    <a href="../issues.html">Past issues</a>
    <a href="../dog-map.html">Dog Map</a>
    <a href="../faq.html">About &amp; FAQ</a>
    <a href="../index.html#delivery">Subscribe</a>
    <a href="mailto:MonroeStreetTattler@gmail.com">Contact</a>
  </div>
  Originally published in the October 2026 issue of The Monroe Street Tattler.<br>
  The Monroe Street Tattler &middot; Madison, Wisconsin &middot;
  <a href="mailto:MonroeStreetTattler@gmail.com">MonroeStreetTattler@gmail.com</a>
</footer>

</div>
<script src="../story-share.js" defer></script>
</body>
</html>
"""


# ---------- checking a page against the issue ----------

def verify(written, body, boxed, story):
    m = re.search(r'<article class="story-text">\n(.*)\n</article>', written, re.S)
    need(m, f"{story['key']}: article not found in output")
    part = m.group(1)
    if boxed:
        part = inner(blocks(part)[0]["raw"])
    got = [b["raw"] for b in blocks(part)]
    strip = lambda s: s.replace(ENDMARK, "").replace('"../', '"')
    need([strip(g) for g in got] == [strip(b) for b in body],
         f"{story['key']}: generated paragraphs differ from the issue")
    need(written.count(ENDMARK) == 1, f"{story['key']}: page must have exactly one end square")
    need(written.count("<h1") == 1, f"{story['key']}: page must have exactly one h1")
    need(written.count('id="share-story"') == 1, f"{story['key']}: page must have one Share button")


# ---------- sharing cards (HTML; rendered to PNG separately) ----------

def card(story, manifest):
    photo = story.get("card_photo")
    figure = (f'<img class="photo" src="{ROOT / photo}" alt="">' if photo else "")
    width = 1200 - (504 if photo else 0)
    # the photo card has a 696px text column: smaller type so nothing wraps or clips
    mast, kick, head, dek = (34, 18, 62, 26) if photo else (44, 22, 88, 32)
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&display=swap">
<style>
*{{box-sizing:border-box}}html,body{{margin:0;width:1200px;height:630px;overflow:hidden;background:#fdfcf3;color:#14110f}}
body{{display:flex}}.text{{width:{width}px;height:630px;padding:0 56px;display:flex;flex-direction:column;align-items:center;text-align:center}}
.mast{{font:900 {mast}px/1 'Times New Roman',Times,serif;text-transform:uppercase;letter-spacing:-.005em;padding:52px 0 34px;border-bottom:4px solid #14110f;align-self:stretch;margin:0}}
.kick{{font:400 {kick}px/1 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#b3241c;margin:38px 0 0}}
.mid{{flex:1;display:flex;flex-direction:column;justify-content:center;gap:26px}}
h1{{font:700 {head}px/1.04 Georgia,'Times New Roman',serif;letter-spacing:-.015em;margin:0}}
.dek{{font:italic {dek}px/1.38 Georgia,serif;margin:0}}
.site{{font:400 21px/1 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:#b3241c;margin:0 0 44px}}
.photo{{width:504px;height:630px;object-fit:cover;display:block}}
</style></head><body><div class="text"><p class="mast">The Monroe Street Tattler</p><p class="kick">{esc(story['card_kicker'])}</p>
<div class="mid"><h1>{esc(story['headline'])}</h1><p class="dek">{esc(story['deck'])}</p></div><p class="site">MonroeStreetTattler.com</p></div>{figure}</body></html>
"""


def main(argv):
    check = "--check" in argv
    cards = argv[argv.index("--cards") + 1] if "--cards" in argv else None
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    need(len(manifest["stories"]) == 4, "manifest must list exactly four stories")
    issue = (ROOT / manifest["source"]).read_text(encoding="utf-8")
    index_html = (ROOT / "index.html").read_text(encoding="utf-8")
    stale = []
    for story in manifest["stories"]:
        body, boxed = extract(issue, story, index_html)
        body = with_endmark(body, story)
        out = page(story, body, boxed, manifest)
        verify(out, body, boxed, story)
        target = ROOT / story["output"]
        if check:
            if not target.exists() or target.read_text(encoding="utf-8") != out:
                stale.append(story["output"])
        else:
            target.parent.mkdir(exist_ok=True)
            target.write_text(out, encoding="utf-8")
        if cards:
            Path(cards, Path(story["card"]).stem + ".html").write_text(card(story, manifest), encoding="utf-8")
        anchor = story["start"].split('id="')[1].split('"')[0]
        print(f"{story['output']}: {len(body)} blocks from #{anchor}")
    if stale:
        print("stale: " + ", ".join(stale))
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Fail as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(2)
