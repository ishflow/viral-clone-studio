"""Telefon menüsünün açık hâli (yalnız mobilde var olan üç pano): girişli müşteri, ziyaretçi, yönetim.
Kapalı hâli parts.header_m(); üst menüdeki menü düğmesi bu panolara gider. Light kopyaları variants.py üretir (-ML)."""
from parts import *
from parts import HEADER_M, ROUND_M, ADMIN_TAG_M

ROOT_M = ("min-height: 844px; box-sizing: border-box; background: var(--bg); color: var(--text); font-family: var(--body); "
          "padding: 0 16px 24px; display: flex; flex-direction: column; gap: 24px")
ITEM = ("display: flex; align-items: center; gap: 12px; min-height: 60px; border-bottom: 1px solid var(--line); font-family: var(--display); "
        "font-weight: 700; font-size: 24px; line-height: 1.2; letter-spacing: -0.01em; text-decoration: none")
WIDE = "; width: 100%"
LANG = ('<button type="button" aria-label="Language: English. Change" style="display: flex; align-items: center; gap: 12px; width: 100%; '
        'min-height: 52px; box-sizing: border-box; padding: 0 16px; border-radius: 12px; border: 1px solid var(--edge-strong); '
        'background: transparent; color: var(--text); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer">'
        + icon('language') + '<span style="flex: 1; text-align: left">English</span>' + icon('expand') + '</button>')


def top(home, back, tag=''):
    left = logo(home)
    if tag:
        left = f'<div style="display: flex; align-items: center; gap: 8px">\n{left}\n{tag}\n</div>'
    return (f'<header style="{HEADER_M}">\n{left}\n'
            f'<a href="{back}" aria-label="Close menu" style="{ROUND_M}">{icon("close")}</a>\n</header>')


def nav(items, current, label):
    out = []
    for text, href in items:
        if text == current:
            out.append(f'<a href="{href}" aria-current="page" style="{ITEM}; color: var(--text)">{DOT}{text}</a>')
        else:
            out.append(f'<a href="{href}" style="{ITEM}; color: var(--text-2)">{text}</a>')
    return f'<nav aria-label="{label}" style="display: flex; flex-direction: column">\n' + '\n'.join(out) + '\n</nav>'


# ---- Girişli müşteri
body = f'''{top('Main.dc.html', 'Main.dc.html')}

{nav([('Gallery', 'Main.dc.html'), ('My videos', 'A-Uretimlerim.dc.html'), ('Pricing', 'A-Fiyatlar.dc.html'), ('Account', 'A-Hesap.dc.html')], 'Gallery', 'Main menu')}

<section aria-label="Credits" style="{CARD}; display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-direction: column; gap: 4px">
<span style="{SMALL}">Your credit balance</span>
<span style="{H5}">[BALANCE] credits</span>
</div>
<a href="A-Fiyatlar.dc.html" style="{PRIMARY}{WIDE}">Buy credits</a>
</section>

<div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px">
{LANG}
<a href="A-Giris.dc.html" style="{QUIET}; color: var(--text-2)">Log out</a>
</div>'''
write('A-Menu-M.dc.html', 'Menu: signed in', ROOT_M, body, w=390, h=844)

# ---- Ziyaretçi
body = f'''{top('A-Ana-Sayfa.dc.html', 'A-Ana-Sayfa.dc.html')}

{nav([('Gallery', 'Main.dc.html'), ('How it works', 'A-Ana-Sayfa.dc.html'), ('Pricing', 'A-Fiyatlar.dc.html')], None, 'Main menu')}

<section aria-label="Get started" style="display: flex; flex-direction: column; gap: 12px">
<p style="margin: 0; {BODY2}">Your first video is free.</p>
<a href="A-Giris.dc.html" style="{PRIMARY_L}{WIDE}">Get started</a>
<a href="A-Giris.dc.html" style="{SECONDARY_L}{WIDE}">Log in</a>
</section>

<div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px">
{LANG}
</div>'''
write('A-Menu-Ziyaretci-M.dc.html', 'Menu: visitor', ROOT_M, body, w=390, h=844)

# ---- Yönetim
body = f'''{top('A-Admin-Genel.dc.html', 'A-Admin-Genel.dc.html', ADMIN_TAG_M)}

{nav([('Overview', 'A-Admin-Genel.dc.html'), ('Users', 'A-Kullanicilar.dc.html'), ('Revenue', 'A-Gelir.dc.html'), ('Jobs', 'A-Isler.dc.html'),
      ('Templates', 'A-Sablonlar.dc.html'), ('Settings', 'A-Ayarlar.dc.html')], 'Overview', 'Admin menu')}

<div style="margin-top: auto; display: flex; flex-direction: column; gap: 8px">
<a href="Main.dc.html" style="{SECONDARY}{WIDE}; gap: 8px">View site{icon('external', 18)}</a>
</div>'''
write('A-Menu-Admin-M.dc.html', 'Menu: admin', ROOT_M, body, w=390, h=844)
