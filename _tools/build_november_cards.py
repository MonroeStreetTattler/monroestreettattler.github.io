#!/usr/bin/env python3
"""Write the twelve November 2026 sharing-card pages (1200x630) as HTML.

The cards reproduce the printed cover's treatment for each story: cream paper,
ink type, red accents, the issue folio and the cover's own hook and deck. No
inside headline, result or photo that would give a story away. Render each
page to PNG with a browser at exactly 1200x630, scale 1, after fonts load
(the page sets body[data-ready] when its fit-to-width pass is done), e.g.

    python3 _tools/build_november_cards.py OUT_DIR
    chrome --headless=new --window-size=1200,630 --force-device-scale-factor=1 \
           --virtual-time-budget=6000 --screenshot=stories/2026-11-<slug>-og.png \
           OUT_DIR/2026-11-<slug>-og.html

Standard library only; nothing here is published (underscore folder). The
Trader Joe's burst (184px, 32px from the right) and the Librarians label row
("Part II" beside "Also Inside") are the publisher-approved 2026-10-24
refinements; the other ten cards are unchanged from the approved set.
"""
import os
import sys

SITE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CSS = """
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;900&family=IBM+Plex+Mono:wght@400;600&display=block');
*{box-sizing:border-box} html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:#fdfcf3;color:#14110f;font-family:Georgia,'Times New Roman',serif}
.card{position:absolute;inset:0;padding:34px 56px 30px;display:flex;flex-direction:column}
.folio{display:flex;justify-content:space-between;font-family:Archivo,Arial,sans-serif;font-weight:900;
 font-size:17px;letter-spacing:.12em;text-transform:uppercase;color:#b3241c;border-top:3px solid #14110f;
 border-bottom:3px solid #14110f;padding:8px 0}
.folio .hl{background:#14110f;color:#fdfcf3;padding:2px 10px}
.mast{font-family:'Times New Roman',Times,serif;font-weight:700;text-transform:uppercase;text-align:center;
 font-size:46px;line-height:1;margin:14px 0 0;padding-bottom:14px;border-bottom:2.5px solid #14110f}
.main{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0;padding:18px 0 8px}
.foot{text-align:center;font-family:'Times New Roman',Times,serif;font-weight:700;font-size:22px;
 border-top:2.5px solid #14110f;padding-top:10px}
.railbar{display:inline-block;align-self:flex-start;background:#14110f;color:#fdfcf3;font-family:Archivo,Arial,sans-serif;
 font-weight:900;font-size:20px;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;margin:0 0 16px}
.hd{font-family:Archivo,Arial,sans-serif;font-weight:900;text-transform:uppercase;line-height:1.0;
 letter-spacing:-.015em;margin:0;font-size:70px}
.dk{font-style:italic;font-size:32px;line-height:1.25;margin:16px 0 0}
.part{display:inline-block;background:#b3241c;color:#fff;font-size:.42em;letter-spacing:.07em;padding:.18em .45em;
 vertical-align:.32em;margin-right:.3em}
.redbox{background:#b3241c;color:#fff;padding:26px 30px}
.redbox .dk{color:#fff}
.pg{background:#14110f;color:#fdfcf3;padding:26px 32px 28px}
.pgtag{font-family:'IBM Plex Mono',monospace;font-size:24px;letter-spacing:.15em;text-transform:uppercase;margin:0 0 10px}
.pgtag span{background:#b3241c;color:#fff;font-weight:600;padding:3px 11px;margin-right:14px}
.pgword{font-family:Archivo,Arial,sans-serif;font-weight:900;text-transform:uppercase;letter-spacing:-.045em;
 line-height:.86;margin:0;font-size:150px}
.pgdek{font-style:italic;font-size:30px;color:#e4ded4;margin:16px 0 0}
.ckick{font-family:Archivo,Arial,sans-serif;font-weight:900;font-size:20px;letter-spacing:.13em;text-transform:uppercase;color:#b3241c;margin:0 0 10px}
.tj{position:relative}
.tjword{font-family:Archivo,Arial,sans-serif;font-weight:900;text-transform:uppercase;letter-spacing:-.04em;line-height:.88;margin:0;font-size:112px}
.tjsub{font-family:Archivo,Arial,sans-serif;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;line-height:1;margin:8px 0 0;font-size:54px}
.burst{position:absolute;right:0;top:-18px;width:160px;height:160px;display:grid;place-items:center;color:#fff;
 font-family:Archivo,Arial,sans-serif;font-weight:900;text-align:center;line-height:1}
.burst svg{position:absolute;inset:0;width:100%;height:100%} .burst span{position:relative}
.burst .n{display:block;font-size:60px} .burst .y{display:block;font-size:18px;letter-spacing:.14em;margin-top:3px}
.revbar{background:#b3241c;color:#fff;font-family:Archivo,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:.02em;
 text-transform:uppercase;padding:12px 16px;margin:16px 0 0;text-align:center}
.ev{display:flex;gap:30px;align-items:center;border:2.5px solid #14110f}
.shot{position:relative;width:560px;flex:none;aspect-ratio:1.8/1;overflow:hidden;border-right:2.5px solid #14110f}
.shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 58%}
.evlabel,.evitem{position:absolute;top:0;font-family:Archivo,Arial,sans-serif;font-weight:900;font-size:16px;letter-spacing:.05em;
 text-transform:uppercase;padding:6px 11px;line-height:1}
.evlabel{left:0;background:#14110f;color:#fdfcf3}.evitem{right:0;background:#b3241c;color:#fff}
.evring{position:absolute;inset:0;width:100%;height:100%}
.evtext{padding:10px 26px 10px 0}
.evhl{font-family:Archivo,Arial,sans-serif;font-weight:900;text-transform:uppercase;font-size:46px;line-height:1.03;letter-spacing:-.02em;margin:0}
.evhl .r{color:#b3241c} .evdek{font-style:italic;font-size:26px;margin:14px 0 0}
"""

# approved 2026-10-24 refinements, appended exactly as in the approved templates
TRADER_REFINEMENT = ".burst{width:184px;height:184px;right:32px;top:-24px}.burst .n{font-size:68px}.burst .y{font-size:20px}"
LIBRARIAN_REFINEMENT = (".labelrow{display:flex;align-items:center;gap:12px;margin:0 0 16px}.labelrow .railbar{margin:0}"
                        ".labelrow .part{font:900 20px Archivo,Arial,sans-serif;padding:7px 14px;margin:0;letter-spacing:.07em}")

BURST = ('<div class="burst"><svg viewBox="0 0 100 100"><polygon fill="#b3241c" points="50,0 57,10 68,4 71,16 83,14 82,27 94,29 88,40 '
         '99,46 90,54 97,64 86,69 89,81 77,81 76,93 65,88 59,99 50,91 41,99 35,88 24,93 23,81 11,81 14,69 3,64 10,54 1,46 12,40 6,29 18,27 '
         '17,14 29,16 32,4 43,10"/></svg><span><span class="n">20</span><span class="y">Years</span></span></div>')


def also_inside(head, deck, label='Also Inside'):
    return (f'<span class="railbar">{label}</span><h1 class="hd" data-fit>{head}</h1>'
            f'<p class="dk">{deck}</p>')


CARDS = {
    'trader-joes-at-20': (
        '<p class="ckick">A Special Anniversary Investigation</p><div class="tj">' + BURST +
        '<h1 class="tjword">Trader Joe&rsquo;s</h1><h2 class="tjsub">What Are They Hiding?</h2></div>'
        '<p class="revbar">Two Decades on Monroe Street. The Tattler Investigates.</p>', TRADER_REFINEMENT),
    'frozen-pizza-taste-test': (also_inside('Trader Joe&rsquo;s Frozen Pizzas Put on Trial',
                                            'Neighborhood jury delivers its verdict.'), ''),
    'jakes-flower-beds': (also_inside('The Man Who Knows Where Everything Is Buried',
                                      'What does he know, and why is he talking now?'), ''),
    'pizzagate': ('<div class="pg"><p class="pgtag"><span>Exclusive</span> Monroe Street</p>'
                  '<h1 class="pgword">Pizzagate</h1><p class="pgdek">New revelations raise troubling questions.</p></div>', ''),
    'librarians-part-two': (
        '<div class="labelrow"><span class="railbar">Also Inside</span><span class="part">Part II</span></div>'
        '<h1 class="hd" data-fit>Second Librarian Breaks Silence</h1>'
        '<p class="dk">What they reveal may change how you see the library forever.</p>', LIBRARIAN_REFINEMENT),
    'crane-crossing-mystery': (also_inside('Human Accomplice Emerges in Crane Crossing Mystery',
                                           'This remains a developing story.'), ''),
    'little-free-library-dumpster': (
        '<div class="ev"><div class="shot"><img src="{root}/lfl-evidence.jpg" alt="">'
        '<span class="evlabel">Photographic Evidence</span><span class="evitem">The Item in Question</span>'
        '<svg class="evring" viewBox="0 0 100 100" preserveAspectRatio="none"><ellipse cx="35" cy="70" rx="19" ry="21" '
        'fill="none" stroke="#c8201b" stroke-width="1.5"/></svg></div>'
        '<div class="evtext"><h1 class="evhl">Has the Little Free Library Movement <span class="r">Gone Too Far?</span></h1>'
        '<p class="evdek">An anonymous tipster came forward.</p></div></div>', ''),
    'gregory-street-bees': (also_inside('Who Really Runs Gregory Street?',
                                        'Homemade signs suggest a shift in power.'), ''),
    'young-signmakers': (also_inside('Child Labor Makes Comeback', 'Authorities have yet to intervene.'), ''),
    'monkey-escape-case-closed': (also_inside('Monroe Street Emerges From Month of Monkey Chaos!',
                                              'The aftermath. The fallout.'), ''),
    'dear-barb-thanksgiving': (also_inside('&ldquo;Take it to the grave.&rdquo;',
                                           'Barb rules on an eleven-year Thanksgiving deception.', label='Dear Barb'), ''),
    'christmas-cards-taste-of-india': (
        '<span class="railbar">Also Inside</span><div class="redbox"><h1 class="hd" data-fit>Local Restaurant Faces '
        'Holiday Onslaught!</h1><p class="dk">A coordinated effort is now underway.</p></div>', ''),
}

FIT = """<script>
document.fonts.ready.then(()=>{
  const m=document.querySelector('.main');
  for(const el of document.querySelectorAll('[data-fit]')){
    let s=parseFloat(getComputedStyle(el).fontSize);
    while((m.scrollHeight>m.clientHeight+1||el.scrollWidth>el.clientWidth+1)&&s>20){s-=2;el.style.fontSize=s+'px';}
  }
  document.body.dataset.ready='1';
});
</script>"""


def page(body, extra):
    return ('<!doctype html><html><head><meta charset="utf-8"><style>' + CSS + extra + '</style></head><body>\n'
            '<div class="card"><div class="folio"><span>Extra! &middot; Vol. 3, No. 9 &middot; November 2026</span></div>\n'
            '<p class="mast">The Monroe Street Tattler</p>\n'
            '<div class="main">' + body.replace('{root}', 'file://' + SITE_ROOT) + '</div>\n'
            '<div class="foot">MonroeStreetTattler.com</div></div>' + FIT + '</body></html>\n')


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    out = argv[1]
    os.makedirs(out, exist_ok=True)
    for slug, (body, extra) in CARDS.items():
        with open(os.path.join(out, f'2026-11-{slug}-og.html'), 'w', encoding='utf-8') as f:
            f.write(page(body, extra))
        print(f'wrote 2026-11-{slug}-og.html')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
