"""Yönetim paneli (3.8 · Admin) için ortak parçalar: panel menüsü, ikinci düzey sekmeler, sayfa başlığı, sayı kutusu, tablo.
Bütün admin panoları bunları kullanır; böylece menü, tablo ve kutular tek biçimde kalır. parts.py'ye dokunmaz."""
from parts import *
from parts import _nav

PANEL_NAV = [('Overview', 'A-Admin-Genel.dc.html', 'overview'), ('Users', 'A-Kullanicilar.dc.html', 'users'),
             ('Revenue', 'A-Gelir.dc.html', 'revenue'), ('Jobs', 'A-Isler.dc.html', 'jobs'),
             ('Templates', 'A-Sablonlar.dc.html', 'templates'), ('Settings', 'A-Ayarlar.dc.html', 'settings')]
SUB_REVENUE = [('Purchases', 'A-Gelir.dc.html', 'purchases'), ('Credits', 'A-Krediler.dc.html', 'credits')]
SUB_TEMPLATES = [('All templates', 'A-Sablonlar.dc.html', 'all'), ('Inbox', 'A-Gelen.dc.html', 'inbox'),
                 ('Scan history', 'A-Tarama.dc.html', 'scans')]
ADMIN_TAG = ('<span style="font-size: 13px; font-weight: 600; color: var(--text-2); border: 1px solid var(--edge); '
             'border-radius: 8px; padding: 4px 8px">Admin</span>')


def header_panel(current=None):
    """Panelin kendi menüsü: Overview · Users · Revenue · Jobs · Templates · Settings. Müşteri menüsünden ayrıdır."""
    nav = _nav(PANEL_NAV, current).replace('aria-label="Main menu"', 'aria-label="Admin menu"')
    return (f'<header style="{HEADER}">\n'
            f'<div style="display: flex; align-items: center; gap: 12px">\n{logo("A-Admin-Genel.dc.html")}\n{ADMIN_TAG}\n</div>\n'
            f'{nav}\n'
            '<a href="Main.dc.html" style="display: flex; align-items: center; gap: 8px; min-height: 44px; color: var(--text-2); '
            f'text-decoration: none; font-size: 15px; font-weight: 500">View site{icon("external", 18)}</a>\n</header>')


TAB = ("display: flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 500; text-decoration: none; "
       "min-width: 44px; justify-content: center")  # kısa adlı sekme de 44 px dokunma eni tutar (A-Gelir ile aynı)


def subnav(items, current, label='Section'):
    """İkinci düzey sekmeler (ör. Revenue: Purchases · Credits). Seçili sekme alt çizgiyle belli olur."""
    out = []
    for text, href, key in items:
        if key == current:
            out.append(f'<a href="{href}" aria-current="page" style="{TAB}; color: var(--text); box-shadow: inset 0 -2px 0 var(--accent-text)">{text}</a>')
        else:
            out.append(f'<a href="{href}" style="{TAB}; color: var(--text-3)">{text}</a>')
    return (f'<nav aria-label="{label}" style="display: flex; flex-wrap: wrap; gap: 0 24px; border-bottom: 1px solid var(--line)">\n'
            + '\n'.join(out) + '\n</nav>')


def page_head(title, lead='', actions=''):
    """Sayfa başlığı: solda başlık + açıklama, sağda eylemler (düğme, dönem seçimi)."""
    lead = f'\n<p style="margin: 0; max-width: 720px; {BODY2}">{lead}</p>' if lead else ''
    act = f'\n<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">\n{actions}\n</div>' if actions else ''
    return ('<section style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 24px 48px">\n'
            f'<div style="flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 8px">\n<h1 style="margin: 0; {H3}">{title}</h1>{lead}\n</div>{act}\n</section>')


SEG = "display: flex; align-items: center; min-height: 44px; padding: 0 16px; border-radius: 999px; border: 0; font: inherit; font-size: 15px; font-weight: 500; cursor: pointer"


def segment(options, current, label):
    """Dönem / süzgeç seçimi: tek satır hap düğmeler, seçili olan dolu."""
    out = []
    for o in options:
        if o == current:
            out.append(f'<button type="button" aria-pressed="true" style="{SEG}; background: var(--raised); color: var(--text)">{o}</button>')
        else:
            out.append(f'<button type="button" aria-pressed="false" style="{SEG}; background: transparent; color: var(--text-3)">{o}</button>')
    return (f'<div role="group" aria-label="{label}" style="display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border-radius: 999px; '
            'border: 1px solid var(--line)">\n' + '\n'.join(out) + '\n</div>')


TILES = "display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 16px"


def tile(label, value, sub=''):
    """Sayı kutusu: etiket, büyük değer (yer tutucu), altında açıklama."""
    sub = f'\n<span style="{SMALL}">{sub}</span>' if sub else ''
    return (f'<div style="{CARD}; display: flex; flex-direction: column; gap: 8px; min-width: 0">\n'
            f'<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">{label}</span>\n'
            f'<span style="{H4}; font-variant-numeric: tabular-nums">{value}</span>{sub}\n</div>')


TH = "padding: 12px 16px; text-align: left; font-size: 13px; font-weight: 500; color: var(--text-3); border-bottom: 1px solid var(--line); white-space: nowrap"
TD = "padding: 16px; font-size: 15px; line-height: 1.4; color: var(--text-2); border-bottom: 1px solid var(--line); vertical-align: middle"
NUM = "; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap"
# Satır eylemi ("Open", "Edit"): iç boşluk + eksi kenar boşluğu dokunma hedefini 44 × ≥ 44 yapar, satırı yükseltmez,
# yazı hücre kenarına hizalı kalır (A-Kullanicilar ile aynı). Kendi kenar boşluğu vardır: sonuna "; margin: -12px 0" ekleme.
ROW_LINK = ("display: inline-flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 500; text-decoration: none; "
            "padding: 0 12px; margin: -12px")


def table(caption, heads, rows, min_w=960, num=()):
    """Tablo: dar ekranda kendi kutusunda yana kayar. heads: sütun adları; rows: hücre HTML'leri listesi;
    num: sağa yaslanacak (sayı) sütunların sıra numaraları. İlk sütun satırın adıdır (koyu yazılır)."""
    th = ''.join(f'<th scope="col" style="{TH}{NUM if i in num else ""}">{h}</th>' for i, h in enumerate(heads))
    body = []
    for n, r in enumerate(rows):
        tds = []
        td = TD if n < len(rows) - 1 else TD.replace('; border-bottom: 1px solid var(--line)', '')  # son satır: kutu kenarı yeter
        for i, cell in enumerate(r):
            extra = NUM if i in num else ''
            if i == 0:
                extra += '; color: var(--text); font-weight: 500'
            tds.append(f'<td style="{td}{extra}">{cell}</td>')
        body.append('<tr>' + ''.join(tds) + '</tr>')
    # position: relative → gizli <caption> kutunun içinde kalır (yoksa telefonda sayfayı yana taşırıyordu)
    return ('<div style="position: relative; overflow-x: auto; border-radius: 16px; border: 1px solid var(--line); background: var(--surface)">\n'
            f'<table style="width: 100%; min-width: {min_w}px; border-collapse: collapse">\n'
            f'<caption style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">{caption}</caption>\n'
            f'<thead><tr>{th}</tr></thead>\n<tbody>\n' + '\n'.join(body) + '\n</tbody>\n</table>\n</div>')


def pager(shown='[COUNT] of [COUNT]'):
    """Tablo altı: kaç satır gösterildiği + önceki / sonraki."""
    b = SECONDARY.replace('min-height: 52px', 'min-height: 44px').replace('padding: 0 24px', 'padding: 0 16px')
    return ('<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px">\n'
            f'<span style="{SMALL}">Showing {shown}</span>\n<div style="display: flex; gap: 8px">\n'
            f'<button type="button" style="{b}; gap: 8px">{icon("back", 18)}Previous</button>\n'
            f'<button type="button" style="{b}; gap: 8px">Next{icon("forward", 18)}</button>\n</div>\n</div>')


def chart_slot(label, h=280):
    """Grafik yeri: veri uydurulmaz; kesik kenarlı kutu neyin çizileceğini söyler."""
    return (f'<div role="img" aria-label="{label}" style="box-sizing: border-box; min-height: {h}px; border-radius: 16px; '
            'border: 1.5px dashed var(--edge-strong); display: flex; align-items: center; justify-content: center; padding: 24px; '
            f'text-align: center; {BODY2}">[CHART: {label}]</div>')


PANEL_WRAP = "max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px"
