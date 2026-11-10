"""Boş, yükleniyor ve hata durumları: galeri (yükleniyor, sonuç yok), My videos (boş), Inbox (boş), form (hatalı alanlar).
Her pano kendi ekranının parçalarını (başlık bölümü, filtreler) o ekranın dosyasından alır; böylece ikisi birebir aynı kalır."""
from parts import *


def src(name):
    return open(os.path.join(P, name), encoding='utf-8').read()


def one(pattern, s):
    m = re.search(pattern, s, re.S)
    assert m, pattern
    return m.group(1)


def sub1(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)


main = src('Main.dc.html')
HERO = one(r'</header>\s*(<section style="display: flex; flex-wrap: wrap; align-items: flex-end.*?</section>)', main)
FILTERS = one(r'(<section aria-label="Filters".*?</section>)', main)
ADD = one(r'(<a href="A-Video-Ekle\.dc\.html" style="aspect-ratio: 9 / 16.*?</a>)', main)
GWRAP = "max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 40px"
MGRID = "display: grid; grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr)); gap: 28px 18px"
DASH = "box-sizing: border-box; border-radius: 16px; border: 1.5px dashed var(--edge-strong)"
ROOT = ROOT_PAGE

# ---- Galeri: yükleniyor
SKEL = '''<div aria-hidden="true" style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<div style="aspect-ratio: 9 / 16; border-radius: 16px; background: var(--surface)"></div>
<div style="display: flex; flex-direction: column; gap: 8px">
<span style="height: 12px; width: 80%; border-radius: 999px; background: var(--surface)"></span>
<span style="height: 12px; width: 50%; border-radius: 999px; background: var(--surface)"></span>
</div>
</div>'''
body = f'''<div style="{GWRAP}">
{header_in('gallery')}

{HERO}

{FILTERS}

<section aria-label="Templates" aria-busy="true" style="display: flex; flex-direction: column; gap: 16px">
<p role="status" style="margin: 0; display: flex; align-items: center; gap: 8px; {SMALL}">{icon('generating', 16)}Loading templates</p>
<div style="{MGRID}">
{ADD}
{chr(10).join([SKEL] * 9)}
</div>
</section>
</div>'''
write('A-Galeri-Yukleniyor.dc.html', 'Gallery: loading', ROOT, body)

# ---- Galeri: sonuç yok
hero_q = sub1(HERO, '<input type="search" placeholder=', '<input type="search" value="pet food" placeholder=')
body = f'''<div style="{GWRAP}">
{header_in('gallery')}

{hero_q}

{FILTERS}

<section aria-label="Templates" style="display: flex; flex-direction: column; gap: 32px">
<div role="status" style="{DASH}; padding: 32px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px 48px">
<div style="flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 8px">
<h2 style="margin: 0; {H5}">No templates for “pet food” yet.</h2>
<p style="margin: 0; max-width: 620px; {BODY2}">Try a broader word or another category. Or give us a video you like: in 2–5 minutes it becomes a template only you can see.</p>
</div>
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<button type="button" style="{SECONDARY}">Clear search</button>
<a href="A-Video-Ekle.dc.html" style="{SECONDARY}">Add your own video</a>
</div>
</div>
<div style="display: flex; flex-direction: column; gap: 24px">
<h2 style="margin: 0; {H5}">Other templates</h2>
<div style="{MGRID}">
{chr(10).join(video_card(t) for t in TEMPLATES[:5])}
</div>
</div>
</section>
</div>'''
write('A-Galeri-Sonuc-Yok.dc.html', 'Gallery: no results', ROOT, body)

# ---- My videos: boş
uret = src('A-Uretimlerim.dc.html')
UHEAD = one(r'</header>\s*(<section.*?</section>)', uret)
body = f'''<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 36px">
{header_in('videos', '1 free video')}

{UHEAD}

<main style="{DASH}; padding: 72px 24px; display: flex; flex-direction: column; align-items: center; gap: 24px; text-align: center">
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
<h2 style="margin: 0; {H4}">Seen it? Clone it.</h2>
<p style="margin: 0; max-width: 520px; {BODY2}">Your videos will show up here. Pick a template, upload your product, and your first video is free.</p>
</div>
<a href="Main.dc.html" style="{PRIMARY_L}">Browse the gallery</a>
</main>
</div>'''
write('A-Uretimlerim-Bos.dc.html', 'My videos: empty', ROOT, body)

# ---- Inbox: boş (yönetim)
gelen = src('A-Gelen.dc.html')
GHEAD = one(r'</header>\s*(<section.*?</section>)', gelen)
CHEAD = one(r'<section aria-label="Candidates"[^>]*>\s*(<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between.*?)\s*<div style="display: flex; flex-direction: column">\s*<sc-for list="\{\{ rows \}\}"', gelen)
EMPTY = f"margin: 0; {DASH}; padding: 32px; font-size: 15px; line-height: 1.5; color: var(--text-2)"
body = f'''<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 36px">
{header_admin('inbox')}

{GHEAD}

<section aria-label="Templates waiting to publish" style="display: flex; flex-direction: column; gap: 16px">
<h2 style="margin: 0; {H5}">Templates waiting to publish</h2>
<p style="{EMPTY}">Nothing is waiting. A candidate that scores above the threshold is prepared as a template and shows up here.</p>
</section>

<section aria-label="Candidates" style="display: flex; flex-direction: column; gap: 16px">
{CHEAD}
<p style="{EMPTY}">No candidates yet. The next scan runs at 15:00. You can also paste a video link above.</p>
</section>
</div>'''
write('A-Gelen-Bos.dc.html', 'Inbox: empty', ROOT, body)

# ---- Form: hatalı alanlar (A-Form'dan türetilir)
ERR = "display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 1.4; color: var(--warn)"
f = src('A-Form.dc.html')
f = sub1(f, '<title>Generate</title>', '<title>Generate: errors</title>')
f = re.sub(r'<header.*?</header>', lambda m: header_in('gallery'), f, count=1, flags=re.S)
# tema tweak'i ve menü artık kaynakta (A-Form) var: menu_tema.py ekledi
h = json.loads(one(r"data-props='([^']*)'", f))['$preview']['height']
# görsel: yoksa çizilmez, ekleme kutusu uyarı rengine döner
img = one(r'(<img src="\{\{ p\.img \}\}"[^>]*>)', f)
f = sub1(f, img, '<sc-if value="{{ p.hasImg }}" hint-placeholder-val="{{ true }}">\n' + img + '\n</sc-if>')
f = sub1(f, 'border: 1.5px dashed var(--edge-strong); background: transparent; color: var(--accent-text); display: flex',
         'border: 1.5px dashed {{ p.addBorder }}; background: transparent; color: {{ p.addColor }}; display: flex')
# ad alanı: boşsa kenar uyarı rengi + alanın altında ne yapılacağı
name_in = one(r'(<input type="text" value="\{\{ p\.name \}\}"[^>]*>)', f)
f = sub1(f, name_in, name_in.replace('border: 1px solid var(--edge-strong)', 'border: {{ p.nameBorder }}').replace('<input ', '<input aria-invalid="{{ p.nameBad }}" ')
         + '\n<sc-if value="{{ p.nameBad }}" hint-placeholder-val="{{ false }}">\n<span style="' + ERR + '">' + icon('warning', 16) + 'Give this product a name.</span>\n</sc-if>')
f = sub1(f, '</div>\n</fieldset>', '</div>\n<sc-if value="{{ p.imgBad }}" hint-placeholder-val="{{ false }}">\n<p style="flex: 1 1 100%; margin: 0; ' + ERR + '">'
         + icon('warning', 16) + 'Add at least one image of this product.</p>\n</sc-if>\n</fieldset>')
f = sub1(f, '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 28px; padding-top: 24px; border-top: 1px solid var(--line)">',
         '<p role="alert" style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--surface); border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text)">'
         + icon('warning', 20, 'flex: 0 0 auto; margin-top: 1px; color: var(--warn)')
         + '<span><strong style="font-weight: 600; color: var(--warn)">Two things to fix before generating.</strong> Product 2 needs an image. Product 3 needs a name.</span></p>\n'
         '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 28px; padding-top: 24px; border-top: 1px solid var(--line)">')
# veri: 2. üründe görsel yok, 3. üründe ad boş
f = sub1(f, "name: 'Aurora Hair Mist'", "name: ''")
f = sub1(f, "img: B + '29d17f8e71e518c213e1c982faf29cea'", "img: ''")
f = sub1(f, "return {\nslot: b.slot,\nimg: b.img,\nname: st[nk] !== undefined ? st[nk] : b.name,",
         "var nm = st[nk] !== undefined ? st[nk] : b.name;\nvar bad = nm === '';\nvar noImg = b.img === '';\nreturn {\nslot: b.slot,\nimg: b.img,\n"
         "hasImg: !noImg,\nimgBad: noImg,\naddBorder: noImg ? 'var(--warn)' : 'var(--edge-strong)',\naddColor: noImg ? 'var(--warn)' : 'var(--accent-text)',\n"
         "nameBad: bad,\nnameBorder: bad ? '1.5px solid var(--warn)' : '1px solid var(--edge-strong)',\nname: nm,")
assert "'" not in one(r"data-props='([^']*)'", f)
open(os.path.join(P, 'A-Form-Hata.dc.html'), 'w', encoding='utf-8').write(f)
print('yazıldı: A-Form-Hata.dc.html', len(f), 'bayt')
