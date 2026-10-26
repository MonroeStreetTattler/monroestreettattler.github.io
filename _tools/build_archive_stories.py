#!/usr/bin/env python3
"""Build the eleven standalone August and September 2026 story pages.

The reporting lives in the issues, september-2026.html and august-2026.html.
This script copies each story out of its issue exactly as it is, wraps it in
the standalone story layout shared with the October pages, and checks that
nothing was added, dropped or reordered. Boundaries, public hooks and end
squares come from archive-stories.json.

Public surfaces (title, h1, descriptions, sharing card, share title, related
cards) use only the story's public hook. The issue's own headings stay inside
the article, where a reader meets them after arriving.

    python3 _tools/build_archive_stories.py           write the eleven pages
    python3 _tools/build_archive_stories.py --check   fail if a page is stale
    python3 _tools/build_archive_stories.py --cards DIR
                                    also write 1200x630 card HTML into DIR
                                    (rendered to PNG separately)

Standard library only. Output is deterministic: no dates, no randomness.
Reuses the October generator's parsing helpers; that file is not changed.
"""
import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # importing the October helpers must not leave __pycache__ in _tools/
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_october_stories import (  # noqa: E402
    ENDMARK, SHARE_ICON, Fail, blocks, esc, inner, need, rebase, text_of)

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = Path(__file__).resolve().parent / "archive-stories.json"
HEADER_CLASSES = {"section", "head", "bh", "deck", "kick", "k", "h"}
HEADING_CLASSES = {"head", "bh", "h"}


# ---------- reading the issue ----------

def element_end(issue, at):
    """End offset of the <div> that opens at `at`."""
    depth = 0
    for m in re.compile(r"<div\b|</div>").finditer(issue, at):
        depth += 1 if m.group(0) == "<div" else -1
        if depth == 0:
            return m.end()
    raise Fail("element never closes")


def share_link(story):
    return (f'<p class="byline"><a href="{story["output"]}#share-story" '
            f'aria-label="Share this story: {esc(story["hook"])}">Share this story &rarr;</a></p>')


def is_share_link(block, story):
    return (block["tag"] == "p" and block["attrs"].get("class") == "byline"
            and f'href="{story["output"]}#share-story"' in block["raw"])


def is_layout(block):
    return block["tag"] == "div" and block["attrs"].get("class") == "clearfix" and not text_of(block["raw"])


def classes(block):
    return set(block["attrs"].get("class", "").split())


def extract(issue, story):
    """Return the story's blocks exactly as in the issue, and the anchor they live at."""
    key = story["key"]
    if "element" in story:
        need(issue.count(story["element"]) == 1, f"{key}: element marker not unique")
        a = issue.index(story["element"])
        container = issue[a:element_end(issue, a)]
        items = blocks(inner(container))
        anchor = re.search(r'id="([^"]+)"', story["element"]).group(1)
    else:
        need(issue.count(story["start"]) == 1, f"{key}: start marker not unique")
        need(issue.count(story["next"]) == 1, f"{key}: next marker not unique")
        a, z = issue.index(story["start"]), issue.index(story["next"])
        need(a < z, f"{key}: markers out of order")
        items = blocks(issue[a:z])
        anchor = re.search(r'id="([^"]+)"', story["start"]).group(1)
    # the issue's own "Share this story" link and empty layout helpers are not story text
    links = [b for b in items if is_share_link(b, story)]
    need(len(links) <= 1, f"{key}: more than one share link in the story")
    body = [b for b in items if not is_share_link(b, story) and not is_layout(b)]
    need(body, f"{key}: no story text found")
    return body, anchor


def check_hook(issue, story, body):
    key = story["key"]
    if story["hook_source"] == "cover":
        cover = [text_of(m) for m in re.findall(r'<a class="teaser[^"]*"[^>]*>.*?</a>', issue, re.S)]
        need(story["hook"] in cover, f"{key}: hook is not a cover teaser")
    else:
        heads = [text_of(b["raw"]) for b in body if classes(b) & HEADING_CLASSES]
        need(story["hook"] in heads, f"{key}: hook is not the story's own headline")


def assemble(issue, story, body):
    """Order the article: the issue's header, any shared photo, then the reporting."""
    key = story["key"]
    # the h1 already carries the hook; don't repeat an identical heading in the article
    body = [b for b in body if not (classes(b) & HEADING_CLASSES and text_of(b["raw"]) == story["hook"])]
    lead = 0
    while lead < len(body) and (classes(body[lead]) & HEADER_CLASSES or body[lead]["tag"] in ("h3", "h4")):
        lead += 1
    raws = [b["raw"] for b in body]
    if "figure" in story:
        # the photo sits in the issue's shared photo column, not inside the brief
        figs = [m.group(0) for m in re.finditer(r"<figure>.*?</figure>", issue, re.S)
                if f'src="{story["figure"]}"' in m.group(0)]
        need(len(figs) == 1, f"{key}: shared figure found {len(figs)} times")
        raws = raws[:lead] + [figs[0]] + raws[lead:]
    return raws


def with_endmark(raws, story):
    key = story["key"]
    need(not any(ENDMARK in r for r in raws), f"{key}: issue already marks this story")
    hits = [i for i, r in enumerate(raws) if story["endmark_on"] in r]
    need(len(hits) == 1, f"{key}: endmark text found {len(hits)} times")
    i = hits[0]
    text = re.sub(r"</p>$", "", story["endmark_on"])
    at = raws[i].index(text) + len(text)
    close = raws[i].find("</p>", at)
    need(close >= 0 and "<p" not in raws[i][at:close], f"{key}: endmark text does not end a paragraph")
    need(not raws[i][at:close].strip(), f"{key}: endmark text is not the end of its paragraph")
    # one square, at the end of the complete piece; only a separate callout may follow it
    need(i == len(raws) - 1 or (story.get("callout_after") and i == len(raws) - 2),
         f"{key}: end square must be on the last block")
    raws = list(raws)
    raws[i] = raws[i][:close] + ENDMARK + raws[i][close:]
    return raws


# ---------- writing a page ----------

def page(story, raws, anchor, manifest):
    site = manifest["site"]
    issue = manifest["issues"][story["source"]]
    url = site + story["output"]
    image = site + story["output"].replace(".html", "-og.png")
    hook = story["hook"]
    alt = f"The Monroe Street Tattler. {issue['title']}. {hook}. MonroeStreetTattler.com"
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "NewsArticle",
                "headline": hook,
                "description": hook,
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
                    {"@type": "ListItem", "position": 2, "name": issue["title"], "item": site + story["source"]},
                    {"@type": "ListItem", "position": 3, "name": hook},
                ],
            },
        ],
    }
    article = "\n".join("  " + rebase(r) for r in raws)
    same = [s for s in manifest["stories"] if s["source"] == story["source"]]
    i = same.index(story)
    related = "".join(
        f'<a href="{Path(o["output"]).name}"><p>{esc(issue["title"])}</p><h3>{esc(o["hook"])}</h3></a>'
        for o in (same[(i + n) % len(same)] for n in (1, 2, 3)))
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(hook)} | The Monroe Street Tattler</title>
<meta name="description" content="{esc(hook)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Monroe Street Tattler">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{esc(hook)}">
<meta property="og:description" content="{esc(hook)}">
<meta property="og:image" content="{image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(hook)}">
<meta name="twitter:description" content="{esc(hook)}">
<meta name="twitter:image" content="{image}">
<meta name="twitter:image:alt" content="{esc(alt)}">
<link rel="icon" type="image/x-icon" href="../favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;900&family=IBM+Plex+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="../tattler.css">
<link rel="stylesheet" href="october-stories.css">
<link rel="stylesheet" href="archive-stories.css">
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
<!-- Generated from {story['source']} by _tools/build_archive_stories.py. Edit the issue, then rebuild. -->
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
<section class="story-top"><p class="kicker">{esc(issue['title'])} · The Monroe Street Tattler</p><h1>{esc(hook)}</h1></section>
<article class="story-text">
{article}
</article>
<div class="share-block"><button id="share-story" type="button" data-share-url="{url}" data-share-title="{esc(hook)}" aria-label="Share this story: {esc(hook)}" aria-controls="share-status" hidden>{SHARE_ICON} Share this story</button><div id="share-status" role="status"></div><div id="share-manual" hidden><input readonly aria-label="Story link"></div></div>
<nav class="issue-links" aria-label="Complete issue"><a href="../{story['source']}#{anchor}">Read this in the complete {esc(issue['month'])} issue →</a><a href="../{issue['pdf']}">Download the paper (PDF)</a></nav>
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
  Originally published in the {esc(issue['title'])} issue of The Monroe Street Tattler.<br>
  The Monroe Street Tattler &middot; Madison, Wisconsin &middot;
  <a href="mailto:MonroeStreetTattler@gmail.com">MonroeStreetTattler@gmail.com</a>
</footer>

</div>
<script src="../story-share.js" defer></script>
</body>
</html>
"""


def verify(written, raws, story):
    key = story["key"]
    m = re.search(r'<article class="story-text">\n(.*)\n</article>', written, re.S)
    need(m, f"{key}: article not found in output")
    got = [b["raw"] for b in blocks(m.group(1))]
    strip = lambda s: s.replace(ENDMARK, "").replace('"../', '"')
    need([strip(g) for g in got] == [strip(r) for r in raws], f"{key}: generated blocks differ from the issue")
    need(written.count(ENDMARK) == 1, f"{key}: page must have exactly one end square")
    need(written.count("<h1") == 1, f"{key}: page must have exactly one h1")
    need(written.count('id="share-story"') == 1, f"{key}: page must have one Share button")


# ---------- sharing cards: the public hook only ----------

def card(story, manifest):
    issue = manifest["issues"][story["source"]]
    size = 88 if len(story["hook"]) <= 42 else 76
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&display=swap">
<style>
*{{box-sizing:border-box}}html,body{{margin:0;width:1200px;height:630px;overflow:hidden;background:#fdfcf3;color:#14110f}}
body{{display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 56px}}
.mast{{font:900 44px/1 'Times New Roman',Times,serif;text-transform:uppercase;letter-spacing:-.005em;padding:52px 0 34px;border-bottom:4px solid #14110f;align-self:stretch;margin:0}}
.kick{{font:400 22px/1 'IBM Plex Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#b3241c;margin:38px 0 0}}
.mid{{flex:1;display:flex;flex-direction:column;justify-content:center}}
h1{{font:700 {size}px/1.04 Georgia,'Times New Roman',serif;letter-spacing:-.015em;margin:0;max-width:1060px;text-wrap:balance}}
.site{{font:400 21px/1 'IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;color:#b3241c;margin:0 0 44px}}
</style></head><body><p class="mast">The Monroe Street Tattler</p><p class="kick">{esc(issue['title'])}</p>
<div class="mid"><h1>{esc(story['hook'])}</h1></div><p class="site">MonroeStreetTattler.com</p></body></html>
"""


def main(argv):
    check = "--check" in argv
    cards = argv[argv.index("--cards") + 1] if "--cards" in argv else None
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    need(len(manifest["stories"]) == 11, "manifest must list exactly eleven stories")
    need(len({s["output"] for s in manifest["stories"]}) == 11, "outputs must be distinct")
    issues = {name: (ROOT / name).read_text(encoding="utf-8") for name in manifest["issues"]}
    stale = []
    for story in manifest["stories"]:
        issue = issues[story["source"]]
        body, anchor = extract(issue, story)
        check_hook(issue, story, body)
        raws = with_endmark(assemble(issue, story, body), story)
        out = page(story, raws, anchor, manifest)
        verify(out, raws, story)
        target = ROOT / story["output"]
        if check:
            if not target.exists() or target.read_text(encoding="utf-8") != out:
                stale.append(story["output"])
        else:
            target.parent.mkdir(exist_ok=True)
            target.write_text(out, encoding="utf-8")
        if cards:
            Path(cards, Path(story["output"]).stem + "-og.html").write_text(card(story, manifest), encoding="utf-8")
        print(f"{story['output']}: {len(raws)} blocks from {story['source']}#{anchor}")
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
