#!/usr/bin/env python3
"""Write the December 2026 sharing-card pages (1200x630) as HTML.

Same method as build_november_cards.py: each card reproduces the printed
cover's treatment (cream paper, ink type, red accents, the season-finale folio)
with the cover's own hook and deck, and nothing that gives a story away. The
missing-child public notice photo is never used on a card (it is marked not for
social media); only the game card shows art, the game's own title artwork.
Render each page to PNG with a browser at exactly 1200x630, scale 1, after the
page sets body[data-ready]:

    python3 _tools/build_december_cards.py OUT_DIR
    chrome --headless=new --window-size=1200,630 --force-device-scale-factor=1 \
           --virtual-time-budget=6000 --screenshot=stories/2026-12-<slug>-og.png \
           OUT_DIR/2026-12-<slug>-og.html

The issue card renders the same way from OUT_DIR/december-2026-og.html to
december-2026-og.png. Standard library only; nothing here is published.
"""
import os
import sys

SITE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CSS = """
*{box-sizing:border-box} html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:#fdfcf3;color:#14110f;font-family:Georgia,'Times New Roman',serif}
.card{position:absolute;inset:0;padding:30px 56px 26px;display:flex;flex-direction:column}
.folio{display:flex;justify-content:space-between;align-items:center;font-family:Arial,Helvetica,sans-serif;font-weight:700;
 font-size:17px;letter-spacing:.12em;text-transform:uppercase;border-top:4px solid #14110f;border-bottom:1.5px solid #14110f;padding:7px 0}
.folio .mo{color:#b3241c} .folio .hl{background:#14110f;color:#fdfcf3;padding:3px 12px;letter-spacing:.16em}
.mast{font-family:'Times New Roman',Times,serif;font-weight:700;text-transform:uppercase;text-align:center;
 font-size:50px;line-height:1;margin:12px 0 0;padding-bottom:12px;border-bottom:4px solid #14110f}
.main{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0;padding:16px 0 8px}
.foot{text-align:center;font-family:'Times New Roman',Times,serif;font-weight:700;font-size:22px;
 border-top:3px solid #14110f;padding-top:9px}
.railbar{display:inline-block;align-self:flex-start;background:#b3241c;color:#fff;font-family:Arial,Helvetica,sans-serif;
 font-weight:700;font-size:20px;letter-spacing:.2em;text-transform:uppercase;padding:6px 16px;margin:0 0 16px}
.hd{font-family:Arial,Helvetica,sans-serif;font-weight:700;text-transform:uppercase;line-height:1.02;
 letter-spacing:-.01em;margin:0;font-size:68px}
.dk{font-style:italic;font-size:32px;line-height:1.25;margin:16px 0 0}
.crisis{background:#b3241c;color:#fff;padding:24px 32px 22px}
.crisis .hd{font-size:118px;line-height:.9;letter-spacing:-.025em}
.crisis .dk{color:#fff;border-top:1.5px solid rgba(255,255,255,.6);padding-top:12px;margin-top:16px}
.game{display:flex;align-items:stretch;background:#14110f;color:#fdfcf3;border:2.5px solid #14110f}
.game img{display:block;width:560px;height:auto;align-self:center}
.game .t{padding:20px 26px;display:flex;flex-direction:column;justify-content:center}
.game .tag{align-self:flex-start;background:#b3241c;color:#fff;font:700 16px Arial,sans-serif;letter-spacing:.16em;
 text-transform:uppercase;padding:4px 10px;margin:0 0 12px}
.game .hd{font-size:40px;color:#fdfcf3} .game .dk{font-size:22px;color:#e9e3d8}
.edition{font-family:Arial,Helvetica,sans-serif;font-weight:700;color:#b3241c;font-size:26px;letter-spacing:.22em;
 text-transform:uppercase;text-align:center;margin:0 0 18px}
"""

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


def also_inside(head, deck=None, label='Also Inside'):
    return (f'<span class="railbar">{label}</span><h1 class="hd" data-fit>{head}</h1>'
            + (f'<p class="dk">{deck}</p>' if deck else ''))


CRISIS = ('<div class="crisis"><h1 class="hd" data-fit>Christmas in Crisis!</h1>'
          '<p class="dk">Is this the end of Christmas on Monroe Street?</p></div>')

CARDS = {
    'santas-on-monroe-street-game': (
        '<div class="game"><img src="{root}/assets/december-2026/santas-on-monroe-street-cover-art.png" alt="">'
        '<div class="t"><span class="tag">Blockbuster Game</span>'
        '<h1 class="hd" data-fit>Grand Theft Auto VI Faces Unexpected Low-Budget Rival</h1>'
        '<p class="dk">The Tattler enters the video game industry with significantly fewer resources.</p></div></div>'),
    'santa-census': also_inside('Local Population Explodes; Officials Scramble',
                                'Emergency census launched. Residents urged to cooperate.'),
    'badgerbots': also_inside('Neighborhood Teens Caught!!&hellip; In the Act of Engineering!',
                              'Do you know what your teenager is building?'),
    'christmas-in-crisis': CRISIS,
    'missing-child-found': also_inside('Missing Child Found. Parents Not Looking.',
                                       'Disturbing discovery in Glenwood Children&rsquo;s Park raises more questions than answers.'),
    'madison-saunas': also_inside('Manosphere Makes Neighborhood Debut', 'Or is this simply healthy living?',
                                  label='Page 7'),
    'keyes-window-peeper': also_inside('Keyes Window Peeper Given Official Title'),
    'jack-o-lanterns': also_inside('Capital Punishment Appears Back on the Table'),
    'dear-barb': also_inside('Dear Barb', 'Season&rsquo;s greetings. Mind your manners.', label='Reader Mail'),
    'hair-salon-traffic-logic': also_inside('Neighborhood Business Defies Traffic Logic'),
    'terrace-leaf-pile': also_inside('Ignorance Is Bliss'),
    'missed-connection': also_inside('Missed Connections'),
    'west-philadelphia-santa': also_inside('Santa Takes Up Post in West Philadelphia', label='Reader Potpourri'),
}

ISSUE_CARD = ('<p class="edition">A Special Season Finale Edition</p>' + CRISIS)


def page(body):
    return ('<!doctype html><html><head><meta charset="utf-8"><style>' + CSS + '</style></head><body>\n'
            '<div class="card"><div class="folio"><span>Extra! &middot; Vol. 3, No. 10 &middot; '
            '<span class="mo">December 2026</span></span><span class="hl">The Season Finale</span></div>\n'
            '<p class="mast">The Monroe Street Tattler</p>\n'
            '<div class="main">' + body.replace('{root}', 'file://' + SITE_ROOT) + '</div>\n'
            '<div class="foot">MonroeStreetTattler.com</div></div>' + FIT + '</body></html>\n')


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    out = argv[1]
    os.makedirs(out, exist_ok=True)
    pages = {f'2026-12-{slug}-og.html': page(body) for slug, body in CARDS.items()}
    pages['december-2026-og.html'] = page(ISSUE_CARD)
    for name, text in pages.items():
        with open(os.path.join(out, name), 'w', encoding='utf-8') as f:
            f.write(text)
        print('wrote', name)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
