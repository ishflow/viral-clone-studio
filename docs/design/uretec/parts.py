"""Yeni Viral Clone panoları için ortak parçalar: helmet, logo, üst menüler, ikonlar, sayfa iskeleti.
Helmet ve logo mevcut bir ekrandan (A-Hesap) okunur; böylece belirteçler ve logo çizimi birebir aynı kalır."""
import json, os, re

P = os.environ.get('VK_PROJECT') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
    'artifact-files', '08326cda-fd1a-43b0-a31a-7b97f1dc97b1', 'project')
_src = open(os.path.join(P, 'A-Hesap.dc.html'), encoding='utf-8').read()
HELMET = re.search(r'<helmet>.*?</helmet>', _src, re.S).group(0)
_LOGO = re.search(r'<header[^>]*>\s*(<a href="Main\.dc\.html".*?</a>)', _src, re.S).group(1)

DISPLAY = "font-family: var(--display)"
H3 = DISPLAY + "; font-weight: 800; font-size: clamp(32px, 4vw, 52px); line-height: 1; letter-spacing: -0.03em"
H2 = DISPLAY + "; font-weight: 800; font-size: clamp(36px, 4.6vw, 64px); line-height: 0.98; letter-spacing: -0.03em"
H4 = DISPLAY + "; font-weight: 800; font-size: 32px; line-height: 1.1; letter-spacing: -0.02em"
H5 = DISPLAY + "; font-weight: 700; font-size: 24px; line-height: 1.2; letter-spacing: -0.01em"
H6 = DISPLAY + "; font-weight: 700; font-size: 20px; line-height: 1.25; letter-spacing: -0.01em"
LEAD = "font-size: 17px; line-height: 1.5; color: var(--text-2); text-wrap: pretty"
BODY2 = "font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty"
SMALL = "font-size: 13px; line-height: 1.4; color: var(--text-3)"

ROOT_PAGE = ("min-height: 900px; box-sizing: border-box; background: var(--bg); color: var(--text); "
             "font-family: var(--body); padding: 0 clamp(16px, 4vw, 60px) 72px")
WRAP = "max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 48px"
CARD = "box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line)"

BTN = "display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer"
PRIMARY_L = BTN + "; min-height: 60px; padding: 0 32px; border: 0; background: var(--accent); color: var(--on-accent); font-size: 17px"
PRIMARY = BTN + "; min-height: 52px; padding: 0 24px; border: 0; background: var(--accent); color: var(--on-accent); font-size: 15px"
SECONDARY_L = BTN + "; min-height: 60px; padding: 0 32px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); font-size: 15px"
SECONDARY = BTN + "; min-height: 52px; padding: 0 24px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); font-size: 15px"
QUIET = "display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 15px; font-weight: 500; text-decoration: none"
INPUT = "min-height: 52px; box-sizing: border-box; padding: 0 16px; border-radius: 12px; border: 1px solid var(--edge-strong); background: var(--bg); color: var(--text); font: inherit; font-size: 15px"
LABEL = "display: flex; flex-direction: column; gap: 8px; font-size: 15px; color: var(--text-2)"

ICON = {
    'search': 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M20 20l-3.5-3.5', 'back': 'M15 6l-6 6 6 6', 'forward': 'M9 6l6 6-6 6',
    'expand': 'M6 9l6 6 6-6', 'close': 'M6 6l12 12M18 6L6 18', 'external': 'M14 5h5v5M19 5l-8 8M11 7H7a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4',
    'add': 'M12 5v14M5 12h14', 'upload': 'M12 20V9M7 13l5-5 5 5M5 4h14', 'download': 'M12 4v11M7 11l5 5 5-5M5 20h14',
    'copy': 'M11 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2zM15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3',
    'edit': 'M5 19l1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L9 18zM14.5 6.5l3 3', 'retry': 'M19 12a7 7 0 1 1-2.05-4.95M17 3.5v3.6h-3.6',
    'share': 'M3.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M14.5 6a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M14.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M8.2 10.8l6.6-3.6M8.2 13.2l6.6 3.6',
    'delete': 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5', 'play': 'M8 5.5v13l11-6.5z', 'pause': 'M9 6v12M15 6v12',
    'sound on': 'M4 10v4h3l5 4V6l-5 4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11', 'fullscreen': 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4',
    'template': 'M9.5 3h5a2.5 2.5 0 0 1 2.5 2.5v13a2.5 2.5 0 0 1 -2.5 2.5h-5a2.5 2.5 0 0 1 -2.5 -2.5v-13a2.5 2.5 0 0 1 2.5 -2.5zM10.8 9.8v4.4l3.6-2.2z',
    'done': 'M5 12.5l4.5 4.5L19 7.5', 'generating': 'M12 3.5a8.5 8.5 0 1 0 8.5 8.5', 'warning': 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 8v5M12 16.2v.1',
    'info': 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 11v5M12 7.8v.1', 'duration': 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M12 7.5V12l3 2',
    'private': 'M8 10.5h8a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1 -2.5 2.5h-8a2.5 2.5 0 0 1 -2.5 -2.5v-5a2.5 2.5 0 0 1 2.5 -2.5zM8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
    'account': 'M8.5 8.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0M5 20a7 7 0 0 1 14 0', 'credits': 'M5 7a7 3 0 1 0 14 0a7 3 0 1 0-14 0M5 7v5a7 3 0 0 0 14 0V7M5 12v5a7 3 0 0 0 14 0v-5',
    'invoice': 'M6 3.5h12v17l-3-2-3 2-3-2-3 2zM9 8.5h6M9 12.5h6', 'language': 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17',
    'key': 'M4 15a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M11 12l8.5-8.5M17 6l2.5 2.5M14.5 8.5l2 2',
    'email': 'M6 5.5h12a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1 -2.5 2.5h-12a2.5 2.5 0 0 1 -2.5 -2.5v-8a2.5 2.5 0 0 1 2.5 -2.5zM4.5 7.5l7.5 5.5 7.5-5.5',
    'inbox': 'M4 13l2.5-8h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 13h4.5a3.5 3.5 0 0 0 7 0H20',
    'menu': 'M4 7h16M4 12h16M4 17h16',
}


def icon(name, size=20, style='', sw=2):
    """İkon kütüphanesindeki (Marka-Ikonlar) çizim; rengi çevresinden alır."""
    fill = 'currentColor' if name == 'play' else 'none'
    st = f' style="{style}"' if style else ''
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="{fill}" stroke="currentColor" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{st}><path d="{ICON[name]}"></path></svg>')


def logo(href):
    return _LOGO.replace('href="Main.dc.html"', f'href="{href}"', 1)


HEADER = ("display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 32px; "
          "padding: 18px 0; border-bottom: 1px solid var(--line)")
NAV = ("display: flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 999px; color: var(--text-3); "
       "text-decoration: none; font-weight: 500; font-size: 15px")
NAV_ON = ("display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: 999px; "
          "background: var(--raised); color: var(--text); text-decoration: none; font-weight: 500; font-size: 15px")
DOT = '<span style="width: 7px; height: 7px; border-radius: 50%; background: var(--accent-text)"></span>'


def _nav(items, current):
    out = []
    for label, href, key in items:
        if key == current:
            out.append(f'<a href="{href}" aria-current="page" style="{NAV_ON}">{DOT}{label}</a>')
        else:
            out.append(f'<a href="{href}" style="{NAV}">{label}</a>')
    return '<nav aria-label="Main menu" style="display: flex; flex-wrap: wrap; gap: 4px">\n' + '\n'.join(out) + '\n</nav>'


B = '/_blob/'
TEMPLATES = [  # Main.dc.html'deki şablonlar; görsellerin hepsi sistemin kendi çıktısı
    dict(img=B + 'f20a7ed7a7bc172a7da483415800077f', title='Fragrance layering recipe', cat='Fragrance', format='No talking', dur='8 sec', views='1.9M'),
    dict(img=B + '1377349dbc87784232ac59cf9cf04986', title='Eye close-up with a day counter', cat='Lashes', format='No talking', dur='13 sec', views='19.8M'),
    dict(img=B + '874b55ddf9761a230dda46e2aa4afa85', title='"I tried it for 4 weeks" presenter story', cat='Lashes', format='Talking', dur='30 sec', views='8.9M'),
    dict(img=B + '586c7628c6d07d797378740fedc4c97f', title='Dupe comparison', cat='Fragrance', format='No talking', dur='17 sec', views='1.9M'),
    dict(img=B + 'de5244c861eb9107996b5404d64ca159', title='Shower routine: problem, result, how to use', cat='Hair', format='No talking', dur='15 sec', views='12.7M'),
    dict(img=B + '619ee0e5a13e318118b291c1451be9b8', title='"I refused to accept it" story and routine', cat='Hair', format='No talking', dur='9 sec', views='17.1M'),
]
TAG = "padding: 5px 10px; border-radius: 999px; background: var(--scrim); color: var(--on-scrim); font-size: 13px; font-weight: 500"
GRID = "display: grid; grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr)); gap: 32px 16px"


def video_card(t, href='A-Detay.dc.html', meta=None):
    """Galeri kartı (Main.dc.html ile aynı çizim)."""
    meta = meta or f"{t['cat']} · reference {t['views']} views"
    return f'''<article style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<a href="{href}" style="position: relative; display: block; aspect-ratio: 9 / 16; border-radius: 16px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">
<img src="{t['img']}" alt="" style="width: 100%; height: 100%; object-fit: cover; display: block">
<span style="position: absolute; top: 10px; left: 10px; {TAG}">{t['format']}</span>
<span style="position: absolute; top: 10px; right: 10px; {TAG}">{t['dur']}</span>
</a>
<div style="display: flex; flex-direction: column; gap: 4px">
<h2 style="margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; color: var(--text); text-wrap: pretty">{t['title']}</h2>
<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">{meta}</p>
</div>
</article>'''


ROOT_AUTH = ("min-height: 900px; box-sizing: border-box; background: var(--bg); color: var(--text); "
             "font-family: var(--body); display: flex; flex-direction: column")
_AUTH_SIDE = re.search(r'(<section style="flex: 1 1 420px.*?</section>)', open(os.path.join(P, 'A-Giris.dc.html'), encoding='utf-8').read(), re.S).group(1)


def auth_page(inner):
    """Giriş sayfasının düzeni (A-Giris): üst menü, solda görsel panel, sağda 420 px'lik sütun."""
    head = (f'<header style="{HEADER}">\n{logo("A-Ana-Sayfa.dc.html")}\n'
            + _nav([('Gallery', 'Main.dc.html', 'gallery'), ('How it works', 'A-Ana-Sayfa.dc.html', 'how'), ('Pricing', 'A-Fiyatlar.dc.html', 'pricing')], None)
            + '\n<div style="display: flex; align-items: center; gap: 10px">\n'
            '<button type="button" aria-label="Language: English. Change" style="min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--edge); background: transparent; color: var(--text-2); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer">EN</button>\n'
            '</div>\n</header>')
    return f'''<div style="padding: 0 clamp(16px, 4vw, 60px)">
<div style="max-width: 1320px; margin: 0 auto">
{head}
</div>
</div>
<div style="flex: 1; display: flex; flex-wrap: wrap">

{_AUTH_SIDE}

<main style="flex: 1 1 420px; min-width: 0; box-sizing: border-box; padding: clamp(24px, 4vw, 56px); display: flex; align-items: center; justify-content: center">
<div style="width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 24px">
{inner.strip()}
</div>
</main>

</div>'''


def header_in(current=None, balance='[BALANCE] credits'):
    """Satıştaki girişli müşteri menüsü (A-Hesap ile aynı)."""
    nav = _nav([('Gallery', 'Main.dc.html', 'gallery'), ('My videos', 'A-Uretimlerim.dc.html', 'videos'),
                ('Pricing', 'A-Fiyatlar.dc.html', 'pricing')], current)
    if current == 'account':
        acct = f'<a href="A-Hesap.dc.html" aria-current="page" style="{NAV_ON}">{DOT}Account</a>'
    else:
        acct = ('<a href="A-Hesap.dc.html" style="display: flex; align-items: center; min-height: 44px; padding: 0 16px; '
                'border-radius: 999px; color: var(--text); text-decoration: none; font-size: 15px; font-weight: 500">Account</a>')
    return (f'<header style="{HEADER}">\n{logo("Main.dc.html")}\n{nav}\n'
            '<div style="display: flex; align-items: center; gap: 12px">\n'
            f'<span style="font-size: 13px; color: var(--text-2); border: 1px solid var(--edge); border-radius: 999px; padding: 8px 14px">{balance}</span>\n'
            f'{acct}\n</div>\n</header>')


def header_out(current=None, lang_open=False):
    """Girişsiz ziyaretçi menüsü (A-Fiyatlar ile aynı)."""
    nav = _nav([('Gallery', 'Main.dc.html', 'gallery'), ('How it works', 'A-Ana-Sayfa.dc.html', 'how'),
                ('Pricing', 'A-Fiyatlar.dc.html', 'pricing')], current)
    return (f'<header style="{HEADER}">\n{logo("A-Ana-Sayfa.dc.html")}\n{nav}\n'
            '<div style="display: flex; align-items: center; gap: 10px">\n'
            '<button type="button" aria-label="Language: English. Change" style="min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--edge); background: transparent; color: var(--text-2); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer">EN</button>\n'
            '<a href="A-Giris.dc.html" style="display: flex; align-items: center; min-height: 44px; padding: 0 12px; color: var(--text); text-decoration: none; font-size: 15px; font-weight: 500">Log in</a>\n'
            '<a href="A-Giris.dc.html" style="display: flex; align-items: center; min-height: 44px; padding: 0 20px; border-radius: 999px; background: var(--accent); color: var(--on-accent); text-decoration: none; font-size: 15px; font-weight: 600">Get started</a>\n'
            '</div>\n</header>')


def header_admin(current=None):
    """Yönetim (kendi kullanım) menüsü (A-Gelen, A-Ayarlar ile aynı)."""
    nav = _nav([('Gallery', 'Main.dc.html', 'gallery'), ('My videos', 'A-Uretimlerim.dc.html', 'videos'),
                ('Inbox', 'A-Gelen.dc.html', 'inbox')], current)
    if current == 'settings':
        st = f'<a href="A-Ayarlar.dc.html" aria-current="page" style="{NAV_ON}">{DOT}Settings</a>'
    else:
        st = ('<a href="A-Ayarlar.dc.html" style="display: flex; align-items: center; min-height: 44px; color: var(--text-3); '
              'text-decoration: none; font-size: 15px; font-weight: 500">Settings</a>')
    return (f'<header style="{HEADER}">\n{logo("Main.dc.html")}\n{nav}\n'
            '<div style="display: flex; align-items: center; gap: 12px">\n'
            '<span style="font-size: 13px; color: var(--text-3); border: 1px solid var(--edge); border-radius: 999px; padding: 8px 14px">Account: ACME / ACME2</span>\n'
            f'{st}\n</div>\n</header>')


HEADER_M = ("display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); "
            "container-type: inline-size")  # üst menü bir kaptır: içindekiler onun genişliğine (cqi) göre daralır
# 360 px'ten dar ekranda logo yalnız işarettir (Marka-Logo, "Narrow header"). Ekran 360 → üst menü 328 px (iki yanda 16 px boşluk):
# üst menü 328'den darsa yazının boyutu 0 olur (yer kaplamaz, ekran okuyucu yine okur), değilse logonun boyutunda (1em) kalır.
# Yazı kırpılmaz; dıştaki <span> satır yüksekliğini tuttuğu için işaretin yeri değişmez. İşaret 44 px'lik dokunma hedefini korur.
LOGO_M = "padding: 10px 0; min-width: 44px; white-space: nowrap; flex: 0 0 auto;"
WORD_M = "font-size: clamp(0px, (100cqi - 327.5px) * 9999, 1em); letter-spacing: -0.04em"
ROUND_M = ("width: 44px; height: 44px; flex: 0 0 auto; box-sizing: border-box; display: flex; align-items: center; justify-content: center; "
           "border-radius: 999px; border: 1px solid var(--edge); color: var(--text); text-decoration: none")
ADMIN_TAG_M = ('<span style="font-size: 13px; font-weight: 600; color: var(--text-2); border: 1px solid var(--edge); '
               'border-radius: 8px; padding: 4px 8px">Admin</span>')


def header_m(kind, balance='[BALANCE] credits'):
    """Telefon genişliğinde üst menü: logo + o an en gerekli tek şey + menü düğmesi. Menü açılınca tam ekran olur
    (A-Menu-M, A-Menu-Ziyaretci-M, A-Menu-Admin-M). kind: 'in' girişli müşteri, 'out' ziyaretçi, 'auth' giriş sayfaları, 'admin' panel."""
    home = {'in': 'Main.dc.html', 'out': 'A-Ana-Sayfa.dc.html', 'auth': 'A-Ana-Sayfa.dc.html', 'admin': 'A-Admin-Genel.dc.html'}[kind]
    menu = {'in': 'A-Menu.dc.html', 'out': 'A-Menu-Ziyaretci.dc.html', 'auth': 'A-Menu-Ziyaretci.dc.html', 'admin': 'A-Menu-Admin.dc.html'}[kind]
    # dokunma hedefi 44; logo tek satır kalır ve daralmaz: yer yetmezse bakiye kısalır, logo kırılmaz
    left = (logo(home).replace('style="display: flex; align-items: baseline;', f'style="display: flex; align-items: baseline; {LOGO_M}', 1)
            .replace('<span>viral clone</span>', f'<span><span style="{WORD_M}">viral clone</span></span>', 1))
    assert LOGO_M in left and WORD_M in left
    if kind == 'admin':
        left = f'<div style="display: flex; align-items: center; gap: 8px">\n{left}\n{ADMIN_TAG_M}\n</div>'
    mid = ''
    if kind == 'in':
        # bakiye sığmazsa sözcük sınırından kırılır ve yalnız ilk satır görünür: "[BALANCE] credits" → "[BALANCE]" (yarım sözcük kalmaz)
        mid = ('<a href="A-Hesap.dc.html" style="display: block; min-width: 0; line-height: 42px; height: 44px; box-sizing: border-box; padding: 0 12px; '
               'border-radius: 999px; border: 1px solid var(--edge); color: var(--text-2); text-decoration: none; font-size: 13px; '
               f'text-align: center; overflow: hidden; text-overflow: ellipsis">{balance}</a>\n')
    elif kind == 'out':
        mid = ('<a href="A-Giris.dc.html" style="display: flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 999px; '
               'background: var(--accent); color: var(--on-accent); text-decoration: none; font-size: 15px; font-weight: 600; '
               'white-space: nowrap">Get started</a>\n')
    return (f'<header style="{HEADER_M}">\n{left}\n<div style="display: flex; align-items: center; gap: 8px; min-width: 0">\n{mid}'
            f'<a href="{menu}" aria-label="Open menu" style="{ROUND_M}">{icon("menu")}</a>\n</div>\n</header>')


def status(kind, label):
    """Durum satırı: renk + biçim + yazı birlikte."""
    if kind == 'done':
        mark = icon('done', 18, sw=2.6)
        color = 'var(--accent-text)'
    elif kind == 'stopped':
        mark = '<span style="width: 8px; height: 8px; border-radius: 2px; background: var(--warn)"></span>'
        color = 'var(--warn)'
    else:
        mark = '<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--accent-text)"></span>'
        color = 'var(--accent-text)'
    return f'<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: {color}">{mark}{label}</span>'


def write(name, title, root_style, body, vals='', props=None, w=1440, h=900, theme='dark'):
    """Panoyu project klasörüne yazar. vals: renderVals'a eklenecek JS alanları (", a: 1" biçiminde)."""
    p = {"theme": {"editor": "enum", "options": ["dark", "light"], "default": theme}}
    p.update(props or {})
    p["$preview"] = {"width": w, "height": h}
    doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + title + '</title>\n'
           '<script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n' + HELMET + '\n'
           '<div class="ay" data-theme="{{ theme }}" style="' + root_style + '">\n' + body.strip() + '\n</div>\n</x-dc>\n'
           "<script type=\"text/x-dc\" data-dc-script data-props='" + json.dumps(p, separators=(',', ':')) + "'>\n"
           "class Component extends DCLogic {\nrenderVals() {\nreturn { theme: this.props.theme ?? '" + theme + "'" + vals + " };\n}\n}\n"
           '</script>\n</body>\n</html>\n')
    assert "'" not in json.dumps(p), name
    open(os.path.join(P, name), 'w', encoding='utf-8').write(doc)
    print('yazıldı:', name, len(doc), 'bayt')
