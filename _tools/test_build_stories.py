#!/usr/bin/env python3
"""Focused tests for build_stories.py (standard library only).

    python3 _tools/test_build_stories.py
"""
import hashlib
import json
import os
import shutil
import struct
import sys
import tempfile
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import build_stories as bs  # noqa: E402


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def png(width, height):
    raw = b''.join(b'\x00' + b'\xff\xff\xff' * width for _ in range(height))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


ISSUE = '''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Test issue</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo">
<style>.story{margin:0}</style>
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "t"}'></script>
</head>
<body>
<div class="wrap">
  <nav class="sitebar"><a href="index.html">Home</a></nav>

  <section class="story" id="alpha">
  <div class="strip"><span>Paper</span><span class="r">Alpha</span></div>
  <h3 class="phead">Alpha headline</h3>
  <p class="sharelink"><a href="stories/t-alpha.html#share-story">Share this story</a></p>
  <p>Alpha body with a <a href="#gamma">link to gamma</a>, a <a href="#alphanote">local note</a>
  and <a href="https://example.com/">an outside link</a>.</p>
  <p id="alphanote">Note.<br>Line two.</p>
  <figure><img src="photo.jpg" srcset="photo.jpg 1x, photo.jpg 2x" alt="A photo" width="10" height="10"></figure>
  <div class="advert"><p class="adlab">Advertisement</p><a href="https://ad.example/" rel="sponsored noopener"><img src="photo.jpg" alt="Ad"></a></div>
  </section>

  <section class="story" id="beta">
  <div class="strip"><span>Paper</span><span class="r">Around</span></div>
  <h3 class="phead">Around the Neighborhood</h3>
  <div class="brief" id="gamma">
    <div class="k">Kicker</div>
    <div class="h">Gamma headline</div>
    <p class="sharelink"><a href="stories/t-gamma.html#share-story">Share this story</a></p>
    <div class="inner"><div class="deeper"><p>Gamma body <img src="photo.jpg" alt=""> continues.</p></div></div>
    <p>See <a href="page.html#top">another page</a> or <a href="mailto:x@example.com">write</a>.</p>
  </div>
  <div class="brief" id="delta">
    <div class="k">Kicker</div>
    <div class="h">Delta headline</div>
    <p class="sharelink"><a href="stories/t-delta.html#share-story">Share this story</a></p>
    <p>Delta body.</p>
  </div>
  </section>

  <div class="payup"><p class="payhead">Support</p><p>Issue-only appeal.</p>
    <div class="paybtns"><a href="index.html#delivery">Subscribe</a></div><p class="payfine">Fine print.</p></div>
  <div class="colophon"><p>Colophon <a href="/">home</a>.</p></div>
</div>
<div class="tt-footnav"><a href="index.html">Home</a></div>
</body>
</html>
'''


def unit(uid, slug, **extra):
    u = {'id': uid, 'slug': slug, 'discovery_headline': f'{uid} teaser',
         'discovery_description': f'{uid} description', 'article_headline': f'{uid.capitalize()} headline',
         'heading': {'promote': 'h3.phead'}, 'og_image': f't-{slug}-og.png',
         'og_image_alt': f'{uid} card'}
    u.update(extra)
    return u


MANIFEST = {
    'issue': 'issue.html', 'issue_name': 'Test 2026', 'date_published': '2026-01-01',
    'site': 'https://example.org/', 'stories_dir': 'stories', 'path_prefix': 't-',
    'units': [
        unit('alpha', 'alpha', exclude=['div.advert']),
        unit('gamma', 'gamma', heading={'promote': 'div.h'}, context='parent'),
        unit('delta', 'delta', heading={'promote': 'div.h'}, context='parent'),
    ],
}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='stories-test-')
        self.addCleanup(shutil.rmtree, self.root)
        self.write('issue.html', ISSUE)
        for name in ('index.html', 'page.html'):
            self.write(name, '<!DOCTYPE html><title>x</title><p id="top">x</p>')
        with open(os.path.join(self.root, 'photo.jpg'), 'wb') as f:
            f.write(b'\xff\xd8\xff\xd9')
        self.write_manifest(MANIFEST)
        os.makedirs(os.path.join(self.root, 'stories'))
        for u in MANIFEST['units']:
            with open(os.path.join(self.root, 'stories', u['og_image']), 'wb') as f:
                f.write(png(1200, 630))

    def write(self, rel, text):
        with open(os.path.join(self.root, rel), 'w', encoding='utf-8') as f:
            f.write(text)

    def write_manifest(self, m):
        self.write('manifest.json', json.dumps(m))

    def build(self):
        return bs.build(self.root, 'manifest.json')

    def html_files(self):
        return sorted(n for n in os.listdir(os.path.join(self.root, 'stories')) if n.endswith('.html'))


class ExtractionTests(Fixture):
    def test_nested_brief_is_extracted_alone_with_parent_context(self):
        page = self.build()['stories/t-gamma.html']
        self.assertIn('<div class="deeper"><p>Gamma body <img src="../photo.jpg" alt=""> continues.</p></div>', page)
        self.assertIn('<span class="r">Around</span>', page)          # parent running head
        self.assertIn('<section class="story single">', page)         # parent styling, no id
        self.assertNotIn('Around the Neighborhood', page)             # container heading left out
        self.assertNotIn('Delta body', page)                          # sibling brief left out
        self.assertNotIn('class="sharelink"', page)   # the issue's own link is not copied; the Share button is added
        self.assertEqual(page.count('<h1'), 1)
        self.assertIn('<h1 class="h">Gamma headline</h1>', page)

    def test_ad_is_excluded_from_story_page_but_kept_in_issue(self):
        before = read(os.path.join(self.root, 'issue.html'))
        page = self.build()['stories/t-alpha.html']
        self.assertNotIn('advert', page.split('</head>')[1])
        self.assertNotIn('ad.example', page)
        self.assertEqual(read(os.path.join(self.root, 'issue.html')), before)
        self.assertIn('rel="sponsored noopener"', before)

    def test_story_text_matches_issue_unit(self):
        pages = self.build()
        self.assertIn('Note.<br>Line two.', pages['stories/t-alpha.html'])

    def test_issue_only_appeal_is_not_copied(self):
        page = self.build()['stories/t-alpha.html']
        self.assertNotIn('Issue-only appeal', page)
        self.assertIn('Fine print.', page)


class LinkTests(Fixture):
    def test_relative_and_fragment_links(self):
        alpha = self.build()['stories/t-alpha.html']
        self.assertIn('href="../issue.html#gamma"', alpha)            # elsewhere in the paper
        self.assertIn('href="#alphanote"', alpha)                     # stays local
        self.assertIn('href="https://example.com/"', alpha)           # outside link untouched
        self.assertIn('src="../photo.jpg"', alpha)
        self.assertIn('srcset="../photo.jpg 1x, ../photo.jpg 2x"', alpha)
        self.assertIn('href="../index.html">Home</a></nav>', alpha)
        self.assertIn('href="../favicon.ico"', alpha)
        gamma = self.build()['stories/t-gamma.html']
        self.assertIn('href="../page.html#top"', gamma)
        self.assertIn('href="mailto:x@example.com"', gamma)
        self.assertIn('href="/">home</a>', gamma)                     # root-relative untouched

    def test_missing_fragment_target_fails(self):
        self.write('issue.html', ISSUE.replace('href="#gamma"', 'href="#nowhere"'))
        with self.assertRaisesRegex(bs.BuildError, '#nowhere'):
            self.build()

    def test_missing_local_resource_fails(self):
        os.remove(os.path.join(self.root, 'page.html'))
        with self.assertRaisesRegex(bs.BuildError, 'page.html does not exist'):
            self.build()


class FailureTests(Fixture):
    def test_missing_id_fails_without_partial_output(self):
        m = json.loads(json.dumps(MANIFEST))
        m['units'].append(unit('omega', 'omega'))
        self.write_manifest(m)
        self.assertEqual(bs.main(['manifest.json', '--root', self.root]), 2)
        self.assertEqual(self.html_files(), [])

    def test_failed_rebuild_leaves_existing_pages_untouched(self):
        self.assertEqual(bs.main(['manifest.json', '--root', self.root]), 0)
        before = {n: read(os.path.join(self.root, 'stories', n))
                  for n in self.html_files()}
        self.write('issue.html', ISSUE.replace('Delta body.', 'Delta changed.')
                   .replace('id="gamma"', 'id="gone"'))
        self.assertEqual(bs.main(['manifest.json', '--root', self.root]), 2)
        after = {n: read(os.path.join(self.root, 'stories', n))
                 for n in self.html_files()}
        self.assertEqual(before, after)
        self.assertFalse([n for n in os.listdir(os.path.join(self.root, 'stories')) if n.startswith('.build-')])

    def test_duplicate_manifest_id_fails(self):
        m = json.loads(json.dumps(MANIFEST))
        m['units'].append(dict(m['units'][0], slug='again'))
        self.write_manifest(m)
        with self.assertRaisesRegex(bs.BuildError, 'duplicate manifest id'):
            self.build()

    def test_duplicate_issue_id_fails(self):
        self.write('issue.html', ISSUE.replace('id="alphanote"', 'id="delta"'))
        with self.assertRaisesRegex(bs.BuildError, 'duplicate ids'):
            self.build()

    def test_share_link_must_match_story_path(self):
        self.write('issue.html', ISSUE.replace('stories/t-delta.html', 'stories/t-wrong.html'))
        with self.assertRaisesRegex(bs.BuildError, 'share link'):
            self.build()

    def test_heading_must_match_article_headline(self):
        m = json.loads(json.dumps(MANIFEST))
        m['units'][0]['article_headline'] = 'Something else'
        self.write_manifest(m)
        with self.assertRaisesRegex(bs.BuildError, 'article_headline'):
            self.build()

    def test_wrong_sharing_image_size_fails(self):
        with open(os.path.join(self.root, 'stories', 't-alpha-og.png'), 'wb') as f:
            f.write(png(600, 315))
        with self.assertRaisesRegex(bs.BuildError, '600x315'):
            self.build()

    def test_mismatched_markup_fails(self):
        self.write('issue.html', ISSUE.replace('<p>Delta body.</p>', '<p>Delta body.</div>'))
        with self.assertRaises(bs.BuildError):
            self.build()


class SharingTests(Fixture):
    def test_previews_use_the_teaser_not_the_inside_headline(self):
        page = self.build()['stories/t-alpha.html']
        head = page.split('</head>')[0]
        self.assertIn('<title>alpha teaser | Monroe Street Tattler</title>', head)
        self.assertIn('"headline": "alpha teaser"', head)
        self.assertNotIn('Alpha headline', head)                     # inside heading stays in the body
        self.assertIn('<h1 class="phead">Alpha headline</h1>', page)

    def test_one_share_button_after_the_story(self):
        page = self.build()['stories/t-alpha.html']
        self.assertEqual(page.count('id="share-story"'), 1)
        self.assertIn('data-share-url="https://example.org/stories/t-alpha.html"', page)
        self.assertIn('data-share-title="alpha teaser"', page)
        self.assertIn('aria-label="Share this story: alpha teaser"', page)
        self.assertIn('<script src="../story-share.js" defer></script>', page)
        self.assertNotIn('class="sharelink"', page)                  # the issue's link stays in the issue
        self.assertLess(page.index('Alpha body'), page.index('id="share-story"'))
        self.assertLess(page.index('id="share-story"'), page.index('class="storyreturn"'))


class CheckModeTests(Fixture):
    def test_check_reports_stale_then_clean(self):
        self.assertEqual(bs.main(['manifest.json', '--root', self.root, '--check']), 1)  # missing
        self.assertEqual(bs.main(['manifest.json', '--root', self.root]), 0)
        self.assertEqual(bs.main(['manifest.json', '--root', self.root, '--check']), 0)
        self.write('issue.html', ISSUE.replace('Delta body.', 'Delta corrected.'))
        self.assertEqual(bs.main(['manifest.json', '--root', self.root, '--check']), 1)
        self.assertEqual(bs.main(['manifest.json', '--root', self.root]), 0)
        self.assertEqual(bs.main(['manifest.json', '--root', self.root, '--check']), 0)

    def test_build_is_deterministic(self):
        self.assertEqual(self.build(), self.build())


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


@unittest.skipUnless(os.path.exists(os.path.join(SITE_ROOT, '_src', 'november-2026.json')),
                     'November manifest not present')
class NovemberTests(unittest.TestCase):
    MANIFEST = '_src/november-2026.json'

    def test_committed_pages_are_current(self):
        pages = bs.build(SITE_ROOT, self.MANIFEST)
        m = bs.load_manifest(os.path.join(SITE_ROOT, self.MANIFEST))
        self.assertEqual(bs.stale(SITE_ROOT, pages, m), [])
        self.assertEqual(len(pages), 12)

    def test_one_source_correction_reaches_its_story_page(self):
        """Edit a sentence once in a temporary copy of the issue and rebuild;
        the real repository is never touched."""
        real_issue = os.path.join(SITE_ROOT, 'november-2026.html')
        real_hash = sha(real_issue)
        tmp = tempfile.mkdtemp(prefix='stories-correction-')
        self.addCleanup(shutil.rmtree, tmp)
        shutil.copytree(SITE_ROOT, tmp, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('.git', '_workflow'))
        before = bs.build(tmp, self.MANIFEST)
        issue = os.path.join(tmp, 'november-2026.html')
        text = read(issue)
        old = 'The cheese has not.'  # mid-story sentence, unaffected by the end square
        self.assertEqual(text.count(old), 1)
        with open(issue, 'w', encoding='utf-8') as f:
            f.write(text.replace(old, 'The cheese has not. [CORRECTION TEST]'))
        after = bs.build(tmp, self.MANIFEST)
        changed = sorted(p for p in after if after[p] != before[p])
        self.assertEqual(changed, ['stories/2026-11-pizzagate.html'])
        self.assertIn('[CORRECTION TEST]', after['stories/2026-11-pizzagate.html'])
        self.assertEqual(sha(real_issue), real_hash)


if __name__ == '__main__':
    unittest.main(verbosity=2)
