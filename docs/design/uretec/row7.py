"""İzleme ve karşılaştırma: müşterinin kendi şablonunun detayı, çok varyantlı sonuç, yan yana karşılaştırma, video oynatma penceresi."""
from parts import *

F20 = B + 'f20a7ed7a7bc172a7da483415800077f'   # ürünler yan yana
HAND1 = B + '619ee0e5a13e318118b291c1451be9b8'  # elde ürün (body oil)
HAND3 = B + 'de5244c861eb9107996b5404d64ca159'  # elde ürün (hair mist)
HAND4 = B + '586c7628c6d07d797378740fedc4c97f'  # elde ürün (parfüm)
ITAG = "padding: 6px 12px; border-radius: 999px; border: 1px solid var(--edge); font-size: 13px; color: var(--text-2)"
BACKLINK = "display: flex; align-items: center; gap: 8px; min-height: 44px; align-self: flex-start; color: var(--text-3); text-decoration: none; font-size: 15px"
PLAY = ('<button type="button" aria-label="Play the video" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 72px; height: 72px; '
        'border-radius: 50%; border: 0; background: var(--scrim); color: var(--on-scrim); display: flex; align-items: center; justify-content: center; cursor: pointer">'
        + icon('play', 26, sw=0) + '</button>')
VBTN = "width: 44px; height: 44px; border-radius: 999px; border: 0; background: transparent; color: inherit; display: flex; align-items: center; justify-content: center; cursor: pointer"


def segments(current, flexes=(13, 16, 13, 15, 23), done='var(--accent-text)', rest='var(--on-scrim)'):
    out = []
    for i, fx in enumerate(flexes):
        on = i < current
        out.append(f'<span style="flex: {fx}; height: 4px; border-radius: 2px; background: {done if on else rest}' + ('' if on else '; opacity: 0.5') + '"></span>')
    return '<div aria-hidden="true" style="display: flex; gap: 4px">' + ''.join(out) + '</div>'


SHOTS = [('0.0–1.3 sec', 'Products side by side', 'hook text, two lines in the middle'), ('1.3–2.9 sec', 'Product 1 in hand', 'product name, top left'),
         ('2.9–4.2 sec', 'Product 2 in hand', 'product name, bottom right'), ('4.2–5.7 sec', 'Product 3 in hand', 'product name, top center'),
         ('5.7–8.0 sec', 'Product 4 in hand', 'product name, bottom center')]

# ---- Şablon detayı: müşterinin kendi şablonu (örnek video yok, deneysel)
OWN = [('0.0–2.1 sec', 'Box on the desk, hands enter', 'hook text, top center'), ('2.1–4.0 sec', 'Lid comes off', 'none'),
       ('4.0–6.4 sec', 'Product lifted to the camera', 'product name, bottom center'), ('6.4–9.2 sec', 'Close-up of the label', 'one benefit, middle'),
       ('9.2–12.0 sec', 'Product placed back, final frame', 'closing line, middle')]
rows = '\n'.join(f'''<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 12px 0; border-top: 1px solid var(--line)">
<span aria-hidden="true" style="width: 44px; height: 78px; box-sizing: border-box; border-radius: 8px; border: 1.5px dashed var(--edge-strong)"></span>
<span style="flex: 0 0 96px; font-size: 15px; font-weight: 600; color: var(--accent-text)">{t}</span>
<span style="flex: 1 1 200px; font-size: 15px">{w}</span>
<span style="flex: 1 1 240px; font-size: 13px; color: var(--text-3)">On screen: {x}</span>
</div>''' for t, w, x in OWN)
body = f'''<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px">
{header_in('gallery')}

<a href="Main.dc.html" style="{BACKLINK}">{icon('back', 18)}Gallery</a>

<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 36px 64px">

<figure style="margin: 0; flex: 1 1 300px; max-width: 400px; display: flex; flex-direction: column; gap: 12px">
<div style="aspect-ratio: 9 / 16; box-sizing: border-box; border-radius: 16px; border: 1.5px dashed var(--edge-strong); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center">
<span style="font-size: 15px; color: var(--text-2)">Your reference video</span>
<span style="{SMALL}">No sample yet</span>
</div>
<figcaption style="font-size: 13px; line-height: 1.45; color: var(--text-3)">Only you can see the video you added. The sample appears here after your first video from this template.</figcaption>
</figure>

<div style="flex: 2 1 480px; min-width: 0; display: flex; flex-direction: column; gap: 28px">
<div style="display: flex; flex-direction: column; gap: 14px">
<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px">
<li style="display: flex; align-items: center; gap: 6px; {ITAG}">{icon('private', 14)}Only you</li>
<li style="padding: 6px 12px; border-radius: 999px; border: 1px dashed var(--edge-strong); font-size: 13px; color: var(--text-2)">experimental</li>
<li style="{ITAG}">No talking</li>
<li style="{ITAG}">12 sec</li>
</ul>
<h1 style="margin: 0; {H2}; text-wrap: balance">Desk unboxing in five shots</h1>
<p style="margin: 0; max-width: 620px; {LEAD}">Made from the video you added. The structure was read automatically, so look over the shot list before you generate.</p>
</div>

<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 28px">
<a href="A-Form.dc.html" style="display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 40px; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 17px; text-decoration: none">Clone it</a>
<dl style="margin: 0; display: flex; flex-wrap: wrap; gap: 10px 28px; font-size: 15px">
<div style="display: flex; flex-direction: column; gap: 2px"><dt style="color: var(--text-3)">You need</dt><dd style="margin: 0; font-weight: 600">1 product</dd></div>
<div style="display: flex; flex-direction: column; gap: 2px"><dt style="color: var(--text-3)">Shots</dt><dd style="margin: 0; font-weight: 600">5</dd></div>
<div style="display: flex; flex-direction: column; gap: 2px"><dt style="color: var(--text-3)">Added</dt><dd style="margin: 0; font-weight: 600">[DATE]</dd></div>
</dl>
</div>

<p style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--surface); border: 1px solid var(--line); {BODY2}">{icon('info', 20, 'flex: 0 0 auto; margin-top: 1px; color: var(--text-3)')}<span>We have not tested this template. The first video can differ from your reference more than a gallery template does.</span></p>

<section aria-label="Shot list" style="display: flex; flex-direction: column; gap: 4px">
<h2 style="margin: 0 0 8px; {H5}">Shot list</h2>
{rows}
</section>

<a href="#" style="align-self: flex-start; {QUIET}; color: var(--warn)">Delete this template</a>
</div>

</main>
</div>'''
write('A-Detay-Ozel.dc.html', 'Template: your own template', ROOT_PAGE, body)

# ---- Sonuç: birden çok varyant
def variant(n, img, on):
    ring = '2px solid var(--accent-text)' if on else '0 solid transparent'
    return (f'<button type="button" aria-pressed="{str(on).lower()}" style="padding: 0; border: 0; background: transparent; color: var(--text); font: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px">'
            f'<img src="{img}" alt="" style="width: 72px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 8px; display: block; outline: {ring}; outline-offset: 3px">'
            f'<span style="font-size: 13px; font-weight: {600 if on else 400}; color: {"var(--text)" if on else "var(--text-3)"}">Variant {n}</span></button>')


DL = "display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px"
body = f'''<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 40px">
{header_in('videos')}

<main style="display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 40px 72px">

<div style="position: relative; flex: 1 1 280px; max-width: 390px; border-radius: 16px; overflow: hidden; background: var(--surface)">
<img src="{F20}" alt="Frame from variant 1" style="width: 100%; aspect-ratio: 9 / 16; object-fit: cover; display: block">
{PLAY}
</div>

<div style="flex: 1 1 380px; max-width: 520px; display: flex; flex-direction: column; gap: 28px">
<div style="display: flex; flex-direction: column; gap: 12px">
<h1 style="margin: 0; {DISPLAY}; font-weight: 800; font-size: clamp(42px, 6.4vw, 92px); line-height: 0.95; letter-spacing: -0.035em">3 variants are <span style="color: var(--accent-text)">ready.</span></h1>
<p style="margin: 0; font-size: 17px; color: var(--text-2)">Fragrance layering recipe · 8 sec · 720p · mp4</p>
</div>

<div role="group" aria-label="Variants" style="display: flex; flex-wrap: wrap; gap: 16px">
{variant(1, F20, True)}
{variant(2, HAND4, False)}
{variant(3, HAND1, False)}
</div>

<div style="display: flex; flex-wrap: wrap; gap: 12px">
<a href="#" style="flex: 1 1 200px; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 60px; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 17px; text-decoration: none">{icon('download', 20)}Download variant 1</a>
<a href="#" style="flex: 1 1 200px; display: flex; align-items: center; justify-content: center; min-height: 60px; border-radius: 12px; border: 1px solid var(--edge-strong); color: var(--text); font-weight: 600; font-size: 15px; text-decoration: none">Download all 3</a>
</div>

<dl style="margin: 0; display: flex; flex-direction: column">
<div style="{DL}"><dt style="flex: 0 0 110px; color: var(--text-3)">Products</dt><dd style="margin: 0; flex: 1 1 240px">Aurora Body Oil, Aurora Body Mist, Aurora Hair Mist, Solace Perfume</dd></div>
<div style="{DL}; border-bottom: 1px solid var(--line)"><dt style="flex: 0 0 110px; color: var(--text-3)">Quality</dt><dd style="margin: 0; flex: 1 1 240px">Fast · 720p</dd></div>
</dl>

<a href="A-Karsilastir.dc.html" style="align-self: flex-start; {QUIET}">Compare with the sample{icon('forward', 18)}</a>
</div>

</main>
</div>'''
write('A-Sonuc-Varyant.dc.html', 'Result: several variants', ROOT_PAGE, body)

# ---- Yan yana karşılaştırma (tam ekran; site menüsü yok)
def side(img, alt, title, note):
    return f'''<figure style="margin: 0; flex: 0 1 380px; min-width: 0; display: flex; flex-direction: column; gap: 12px">
<img src="{img}" alt="{alt}" style="width: 100%; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 16px; display: block">
<figcaption style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 15px; font-weight: 600">{title}</span><span style="{SMALL}">{note}</span></figcaption>
</figure>'''


body = f'''<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px">
<header style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 32px; padding: 18px 0; border-bottom: 1px solid var(--line)">
<a href="A-Sonuc.dc.html" style="{BACKLINK}">{icon('back', 18)}Back to result</a>
<h1 style="margin: 0; {H5}">Fragrance layering recipe</h1>
<a href="#" style="{PRIMARY}; gap: 8px">{icon('download', 18)}Download</a>
</header>

<main style="display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 32px">
{side(HAND3, 'Frame from the sample video: product in hand', 'Sample in the gallery', 'The video you picked')}
{side(HAND1, 'Frame from your video: your product in hand', 'Your video', 'Same shot, your product')}
</main>

<div role="group" aria-label="Playback, both videos together" style="align-self: center; width: 100%; max-width: 792px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line)">
{segments(2, rest='var(--text-3)')}
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px">
<button type="button" aria-label="Pause" style="{VBTN}; color: var(--text)">{icon('pause', 22)}</button>
<span style="font-size: 15px; font-weight: 600">0:02 / 0:08</span>
<span style="flex: 1 1 200px; font-size: 15px; color: var(--text-2)">Shot 2 of 5 · Product 1 in hand</span>
<button type="button" aria-label="Sound on" style="{VBTN}; color: var(--text)">{icon('sound on', 22)}</button>
</div>
</div>
</div>'''
write('A-Karsilastir.dc.html', 'Compare side by side', ROOT_PAGE.replace('padding: 0 clamp(16px, 4vw, 60px) 72px', 'padding: 0 clamp(16px, 4vw, 60px) 48px'), body)

# ---- Video oynatma penceresi (galeriden açılır)
shot_rows = []
for i, (t, w, x) in enumerate(SHOTS):
    on = i == 1
    shot_rows.append(f'<li style="display: flex; align-items: center; gap: 16px; min-height: 44px; padding: 0 12px; border-radius: 8px; background: {"var(--raised)" if on else "transparent"}">'
                     f'<span style="flex: 0 0 96px; font-size: 13px; font-weight: 600; color: {"var(--accent-text)" if on else "var(--text-3)"}">{t}</span>'
                     f'<span style="font-size: 15px; color: {"var(--text)" if on else "var(--text-2)"}">{w}</span></li>')
PH = 824
body = f'''<div role="dialog" aria-labelledby="oy-baslik" style="width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); display: flex; gap: 32px">

<div style="position: relative; flex: 0 0 auto; width: 408px; border-radius: 16px; overflow: hidden; background: var(--bg)">
<img src="{HAND1}" alt="Sample video, shot 2: product in hand" style="width: 100%; aspect-ratio: 9 / 16; object-fit: cover; display: block">
<div style="position: absolute; left: 12px; right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 4px; padding: 12px 8px 4px; border-radius: 12px; background: var(--scrim); color: var(--on-scrim)">
<div style="padding: 0 8px">{segments(2)}</div>
<div style="display: flex; align-items: center; gap: 4px">
<button type="button" aria-label="Pause" style="{VBTN}">{icon('pause', 22)}</button>
<span style="font-size: 13px; font-weight: 500">0:02 / 0:08</span>
<span style="flex: 1"></span>
<button type="button" aria-label="Sound on" style="{VBTN}">{icon('sound on', 22)}</button>
<button type="button" aria-label="Full screen" style="{VBTN}">{icon('fullscreen', 22)}</button>
</div>
</div>
</div>

<div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px">
<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px">
<li style="{ITAG}">Fragrance</li>
<li style="{ITAG}">No talking</li>
<li style="{ITAG}">8 sec</li>
</ul>
<h1 id="oy-baslik" style="margin: 0; {H4}; text-wrap: balance">Fragrance layering recipe</h1>
<p style="margin: 0; {SMALL}">Sample video, generated by this system · reference 1.9M views</p>
</div>
<button type="button" aria-label="Close" style="flex: 0 0 auto; width: 44px; height: 44px; border-radius: 999px; border: 1px solid var(--edge); background: transparent; color: var(--text); display: flex; align-items: center; justify-content: center; cursor: pointer">{icon('close', 20)}</button>
</div>

<section aria-label="Shot list" style="display: flex; flex-direction: column; gap: 8px">
<h2 style="margin: 0; {H6}">Shot list</h2>
<ol style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px">
{chr(10).join(shot_rows)}
</ol>
</section>

<div style="margin-top: auto; display: flex; flex-wrap: wrap; gap: 12px">
<a href="A-Form.dc.html" style="flex: 2 1 200px; {PRIMARY_L}">Clone it</a>
<a href="A-Detay.dc.html" style="flex: 1 1 160px; {SECONDARY_L}">Open template</a>
</div>
</div>

</div>'''
write('A-Oynatici.dc.html', 'Video player window',
      f"width: 1000px; height: {PH}px; box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: center; justify-content: center",
      body, w=1000, h=PH)
