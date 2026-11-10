"""Yönetim paneli (süper admin) 2: işler, şablonlar, şablon düzenleme, tarama geçmişi (yeni panolar) ve
mevcut Inbox / Settings ekranlarının üst menüsünün panel menüsüne çevrilmesi.
Menü, sekme, sayı kutusu, tablo panel.py'den gelir; küçük parçalar (durum, bağlantı, bölüm) row9.py ile aynı biçimdedir.
Mevcut üç ekran dosyadan dönüştürülür; dönüşüm yeniden çalıştırılabilir (ikinci çalıştırma dosyayı değiştirmez)."""
import subprocess
from panel import *

# Ölçülen içerik yükseklikleri (preview_dc.py "icerik" değeri, 20'nin katına yuvarlandı)
HEIGHT = {'A-Isler.dc.html': 1540, 'A-Sablonlar.dc.html': 1220, 'A-Sablon-Duzenle.dc.html': 1380, 'A-Tarama.dc.html': 1040}

ICON.update({
    'link': 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',  # Marka-Ikonlar'daki çizim
    'move up': 'M12 19V6M7 11l5-5 5 5',     # yeni: yukarı taşı
    'move down': 'M12 5v13M7 13l5 5 5-5',   # yeni: aşağı taşı
})


def src(name):
    return open(os.path.join(P, name), encoding='utf-8').read()


def one(pattern, s):
    m = re.search(pattern, s, re.S)
    assert m, pattern
    return m.group(1)


def sub1(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)


def once(s, old, new):
    """Tek seferlik değişiklik: yenisi zaten yazılıysa dokunmaz (betik yeniden çalıştırılabilir kalır)."""
    assert old not in new, old[:80]
    return s if new in s else sub1(s, old, new)


# ---- row9.py ile aynı küçük parçalar (panel.py'de yok)
T = TEMPLATES
MAIN = "display: flex; flex-direction: column; gap: 32px"
SR = "position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)"
ACTIONS = f'<span style="{SR}">Actions</span>'
LINK = ROW_LINK + "; margin: -12px 0"  # 44 px'lik dokunma hedefi satırı yükseltmesin
ENTITY = LINK + "; color: var(--text); text-decoration: underline; text-decoration-color: var(--edge-strong); text-underline-offset: 4px"
ACT = ("display: inline-flex; align-items: center; min-height: 44px; margin: -12px 0; padding: 0; border: 0; background: transparent; "
       "color: var(--accent-text); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer")
BACK = "display: flex; align-items: center; gap: 8px; min-height: 44px; align-self: flex-start; color: var(--text-3); text-decoration: none; font-size: 15px"
H_SUB = "margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3"
WARN_BTN = SECONDARY.replace('var(--edge-strong)', 'var(--warn-edge)').replace('color: var(--text)', 'color: var(--warn)')
assert 'var(--warn-edge)' in WARN_BTN and 'color: var(--warn)' in WARN_BTN
PERIOD = segment(['Today', '7 days', '30 days', 'All time'], '30 days', 'Period')
SMALL_BTN = SECONDARY.replace('min-height: 52px', 'min-height: 44px').replace('padding: 0 24px', 'padding: 0 16px')  # pager() düğmesiyle aynı
SELECT = "min-height: 52px; box-sizing: border-box; padding: 0 12px; border-radius: 12px; border: 1px solid var(--edge-strong); background: var(--bg); color: var(--text); font: inherit; font-size: 15px"
TABS = 'Template sections'


def top(current, sub=''):
    """Panel menüsü; ikinci düzey sekmeler varsa menüye bitişik."""
    head = header_panel(current)
    return f'<div>\n{head}\n{sub}\n</div>' if sub else head


def put(name, title, current, inner, sub=''):
    body = f'<div style="{PANEL_WRAP}">\n{top(current, sub)}\n\n<main style="{MAIN}">\n{inner.strip()}\n</main>\n</div>'
    h = HEIGHT[name]
    write(name, title, ROOT_PAGE.replace('min-height: 900px', f'min-height: {h}px'), body, h=h)


def sec(hid, title, inner, right='', style=''):
    """Bölüm: küçük h2 başlık (sağında isteğe bağlı bilgi), altında içerik."""
    head = f'<h2 id="{hid}" style="margin: 0; {H6}">{title}</h2>'
    if right:
        head = ('<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px">\n'
                f'{head}\n{right}\n</div>')
    style = f'{style}; ' if style else ''
    return (f'<section aria-labelledby="{hid}" style="{style}min-width: 0; display: flex; flex-direction: column; gap: 16px">\n'
            f'{head}\n{inner.strip()}\n</section>')


_MARK = re.compile(r'(<span style="width: 8px; height: 8px;[^>]*></span>)')
_BOX = r'<span style="display: flex; justify-content: center; width: 18px">\1</span>'
_PAD = '<span style="flex: 0 0 18px"></span>'  # ikinci satır yazıyla aynı hizadan başlasın: işaret yeri kadar boşluk
_OFF = ('<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">'
        '<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--text-3)"></span>')


def st(kind, label, sub=''):
    """Tablo durumu. done / stopped / run → parts.status; off → renk taşımayan durum: içi boş halka.
    8 px'lik işaretler onay ikonuyla aynı 18 px'lik yere oturur; sütunda yazılar alt alta hizalı kalır.
    sub: durumun altındaki ikinci satır (neden, adım); yazıyla aynı hizadan başlar."""
    s = f'{_OFF}{label}</span>' if kind == 'off' else status(kind, label)
    s = _MARK.sub(_BOX, s, 1).replace('display: flex;', 'display: flex; white-space: nowrap;', 1)
    if sub:
        s = (f'<div style="display: flex; flex-direction: column; gap: 4px">{s}'
             f'<span style="display: flex; gap: 8px; white-space: nowrap; {SMALL}">{_PAD}{sub}</span></div>')
    return s


def tiles(items):
    return f'<div style="min-width: 0; {TILES}; grid-auto-rows: 1fr">\n' + '\n'.join(tile(*i) for i in items) + '\n</div>'


def search(label, placeholder):
    return ('<label style="position: relative; flex: 1 1 320px; max-width: 420px; min-width: 0; display: flex; align-items: center">\n'
            f'<span style="{SR}">{label}</span>\n'
            f'<span style="position: absolute; left: 16px; display: flex; color: var(--text-3); pointer-events: none">{icon("search")}</span>\n'
            f'<input type="search" placeholder="{placeholder}" style="{INPUT}; width: 100%; padding-left: 48px">\n</label>')


def listing(label, find, filt, tbl):
    """Liste bölümü: arama + süzgeç, tablo, sayfalama (A-Kullanicilar ile aynı düzen)."""
    bar = ''
    if find or filt:
        bar = ('<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px">\n'
               f'{find}\n{filt}\n</div>\n')
    return (f'<section aria-label="{label}" style="display: flex; flex-direction: column; gap: 16px">\n'
            f'{bar}{tbl}\n{pager()}\n</section>')


def nowrap(text):
    return f'<span style="white-space: nowrap">{text}</span>'


def mark_row(html, n, style):
    """Tablonun n. satırını (1'den) işaretler: seçili satır."""
    i = [0]

    def f(m):
        i[0] += 1
        return f'<tr style="{style}">' if i[0] == n else m.group(0)
    return re.sub(r'<tr>(?=<td)', f, html)


STEPS = re.findall(r"st\('(\d)', '([^']+)', '[^']*', '[^']*', (done|err|wait)\)", src('A-Is-Durdu.dc.html'))  # adım adları müşteri ekranından
assert len(STEPS) == 6, STEPS


def step(n):
    return f'Step {n} of {len(STEPS)} · {STEPS[n - 1][1]}'


# ---- 1. İşler
USER = f'<a href="A-Kullanici-Detay.dc.html" style="{ENTITY}">[EMAIL]</a>'
OPEN = f'<button type="button" style="{ACT}">Open</button>'
RETRY = (f'<span style="display: inline-flex; gap: 16px"><button type="button" style="{ACT}">Retry</button>'
         f'<button type="button" style="{ACT}">Refund credits</button></span>')


def job(t, quality, credits, state, act=OPEN):
    return ['[DATE]', USER, f'<span style="display: block; text-wrap: balance">{t["title"]}</span>', nowrap(t['format']), quality, 'English', credits, '[AMOUNT]', state, act]


jobs = [job(T[0], 'Fast', '[CREDITS]', st('run', 'Running', step(3))),
        job(T[2], 'Best', '[CREDITS]', st('run', 'Running', step(2))),
        job(T[3], 'Best', '[CREDITS]', st('stopped', 'Stopped', '[REASON]'), RETRY),
        job(T[1], 'Fast', 'Free video', st('done', 'Done')),
        job(T[4], 'Best', '[CREDITS]', st('done', 'Done')),
        job(T[5], 'Fast', '[CREDITS]', st('stopped', 'Stopped', '[REASON]'), RETRY)]
SEL = 3  # açık (seçili) satır: aşağıdaki "Stopped job" kartı bu satırın ayrıntısı
jobs_table = mark_row(table('Jobs', ['Started', 'User', 'Template', 'Format', 'Quality', 'Language', 'Credits', 'Cost', 'Status', ACTIONS],
                            jobs, min_w=1200, num=(6, 7, 9)), SEL, 'background: var(--raised)')

MK = "flex: 0 0 36px; height: 36px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 600"


def stage(no, name, kind):
    """Adım hücresi: işaret biçimleri A-Is-Durdu'daki ile aynı (biten: daire + onay, duran: köşeli, bekleyen: kesik daire).
    Biten adımın dairesi burada dolu değil, kenarlı: ekrandaki tek lime dolgu ana düğme kalsın."""
    if kind == 'done':
        mark = f'<span style="{MK}; border-radius: 50%; color: var(--accent-text); border: 1.5px solid var(--accent-text)">{icon("done", 18, sw=2.6)}</span>'
        note, c_name, c_note, edge = 'Done', 'var(--text)', 'var(--accent-text)', 'var(--line)'
    elif kind == 'err':
        mark = f'<span style="{MK}; border-radius: 8px; color: var(--warn); border: 1.5px solid var(--warn)">{no}</span>'
        note, c_name, c_note, edge = 'Stopped here', 'var(--text)', 'var(--warn)', 'var(--warn-edge)'
    else:
        mark = f'<span style="{MK}; border-radius: 50%; color: var(--text-3); border: 1.5px dashed var(--edge-strong)">{no}</span>'
        note, c_name, c_note, edge = 'Waiting', 'var(--text-3)', 'var(--text-3)', 'var(--line)'
    return (f'<li style="display: flex; align-items: center; gap: 12px; min-width: 0; box-sizing: border-box; padding: 12px 16px; border-radius: 12px; '
            f'background: var(--bg); border: 1px solid {edge}">{mark}'
            '<span style="min-width: 0; display: flex; flex-direction: column; gap: 4px">'
            f'<span style="font-size: 15px; font-weight: 600; line-height: 1.2; color: {c_name}">{name}</span>'
            f'<span style="font-size: 13px; line-height: 1.2; color: {c_note}">{note}</span></span></li>')


def fact(dt, dd):
    return (f'<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0"><dt style="{SMALL}">{dt}</dt>'
            f'<dd style="margin: 0; font-size: 15px; line-height: 1.4; font-weight: 500; color: var(--text)">{dd}</dd></div>')


stopped_no = next(int(n) for n, _, k in STEPS if k == 'err')
saved = ', '.join(name.lower() for _, name, k in STEPS if k == 'done').capitalize()
stopped = f'''<div style="{CARD}; border-color: var(--warn-edge); display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 4px">
<h3 style="{H_SUB}">{T[3]['title']}</h3>
<p style="margin: 0; {BODY2}">[EMAIL] · {T[3]['format']} · Best · English · Started [DATE]</p>
</div>
<ol aria-label="Steps" style="margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 8px">
{chr(10).join(stage(n, name, k) for n, name, k in STEPS)}
</ol>
<dl style="margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 16px 32px">
{fact('Stopped at', step(stopped_no))}
{fact('Reason', '[REASON]')}
{fact('Saved parts', saved + ', [COUNT] of [COUNT] clips')}
{fact('Credits charged', '[CREDITS]')}
</dl>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-top: 24px; border-top: 1px solid var(--line)">
<button type="button" style="{PRIMARY}; gap: 8px">{icon('retry', 18)}Retry from the stopped step</button>
<button type="button" style="{SECONDARY}">Refund credits</button>
<a href="A-Kullanici-Detay.dc.html" style="{SECONDARY}">Open user</a>
<p style="flex: 1 1 280px; margin: 0 0 0 12px; {SMALL}">The finished parts stay saved. A retry runs only the missing part.</p>
</div>
</div>'''

job_tiles = [('Running now', '[COUNT]', 'Jobs in progress at this moment'), ('Done', '[COUNT]', 'Finished in this period'),
             ('Stopped', '[COUNT]', 'Stopped before they finished'), ('Average time to finish', '[DURATION]', 'From start to finished video'),
             ('Generation cost', '[AMOUNT]', 'Paid to generate the videos')]

put('A-Isler.dc.html', 'Admin: jobs', 'jobs', f'''
{page_head('Jobs', 'Every job from every user: what it cost and where it stands.', PERIOD)}

{tiles(job_tiles)}

{listing('Job list', search('Search jobs', 'Search by user or template'), segment(['All', 'Running', 'Done', 'Stopped'], 'All', 'Status'), jobs_table)}

{sec('h-stopped', 'Stopped job', stopped)}
''')


# ---- 2. Şablonlar
PRIVATE = ('<div style="display: flex; flex-direction: column; gap: 4px">'
           '<span style="display: flex; white-space: nowrap; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">'
           f'{icon("private", 18)}Private</span>'
           f'<span style="display: flex; gap: 8px; white-space: nowrap; {SMALL}">{_PAD}Only the owner sees it</span></div>')
TPL = {'published': st('done', 'Published'), 'waiting': st('off', 'Waiting to publish'), 'hidden': st('stopped', 'Hidden'), 'private': PRIVATE}
EDIT = f'<a href="A-Sablon-Duzenle.dc.html" style="{LINK}">Edit</a>'


def thumb(t):
    return ('<div style="display: flex; align-items: center; gap: 16px">'
            f'<img src="{t["img"]}" alt="" style="flex: 0 0 auto; width: 44px; height: 78px; object-fit: cover; border-radius: 8px; display: block; box-shadow: 0 0 0 1px var(--media-edge)">'
            f'<span style="min-width: 0; text-wrap: pretty">{t["title"]}</span></div>')


def views(t):
    return f'<span style="font-variant-numeric: normal">{t["views"]}</span>'  # gerçek rakam: eş genişlikli "1" boşluk bırakıyor


kinds = ['published', 'published', 'waiting', 'hidden', 'published', 'private']
tpl_rows = [[thumb(t), t['cat'], nowrap(t['format']), nowrap(t['dur']), views(t), '[COUNT]', TPL[k], '[DATE]', EDIT] for t, k in zip(T, kinds)]
templates = table('Templates', ['Template', 'Category', 'Format', 'Length', 'Reference views', 'Times generated', 'Status', 'Last edited', ACTIONS],
                  tpl_rows, min_w=1160, num=(4, 5, 8))
add_link = f'<a href="A-Gelen.dc.html" style="{SECONDARY}; gap: 8px">{icon("link", 18)}Add from a link</a>'

put('A-Sablonlar.dc.html', 'Admin: templates', 'templates', f'''
{page_head('Templates', 'Every template: the ones in the gallery, the ones waiting to publish, and the private ones made from a user’s own video.', add_link)}

{listing('Template list', search('Search templates', 'Search by title or category'),
         segment(['All', 'Published', 'Waiting', 'Hidden', 'Private'], 'All', 'Status'), templates)}
''', sub=subnav(SUB_TEMPLATES, 'all', TABS))


# ---- 3. Şablon düzenleme
E = T[1]  # Eye close-up with a day counter
assert E['dur'] == '13 sec'
SHOTS = [('0:00–0:02', 'Close-up of one bare eye', 'hook text, middle', 'None'),
         ('0:02–0:05', 'Product goes on the lash line', 'day counter, top', 'Product 1'),
         ('0:05–0:08', 'Same angle on a later day', 'day counter, top', 'None'),
         ('0:08–0:11', 'Slow look into the camera', 'day counter, top', 'None'),
         ('0:11–0:13', 'Product held next to the eye', 'product name, bottom', 'Product 1')]
ON_MARK = f'<span style="display: flex; color: var(--accent-text)">{icon("done", 18, sw=2.6)}</span>'
READONLY = (INPUT.replace('border: 1px solid var(--edge-strong)', 'border: 1px dashed var(--edge)')
            .replace('background: var(--bg)', 'background: transparent').replace('color: var(--text)', 'color: var(--text-2)'))
SELECTED = ' selected="selected"'


def choice(label, options, current):
    """İki seçenekli düğme grubu: seçili olan kenar + onay işaretiyle belli olur."""
    out = []
    for o in options:
        on = o == current
        out.append(f'<button type="button" aria-pressed="{str(on).lower()}" style="flex: 1 1 0; min-width: 0; min-height: 52px; box-sizing: border-box; padding: 0 16px; '
                   f'border-radius: 12px; border: 1.5px solid {"var(--accent-text)" if on else "var(--edge)"}; background: var(--bg); '
                   f'color: {"var(--text)" if on else "var(--text-2)"}; font: inherit; font-size: 15px; font-weight: {600 if on else 400}; cursor: pointer; '
                   f'display: flex; align-items: center; justify-content: space-between; gap: 8px">{o}{ON_MARK if on else ""}</button>')
    return (f'<div role="group" aria-label="{label}" style="{LABEL}; min-width: 0">\n<span>{label}</span>\n'
            '<div style="display: flex; gap: 8px">\n' + '\n'.join(out) + '\n</div>\n</div>')


def field(label, control, hint=''):
    hint = f'\n<span style="{SMALL}">{hint}</span>' if hint else ''
    return f'<label style="{LABEL}; min-width: 0">{label}\n{control}{hint}\n</label>'


cats = ''.join(f'<option{SELECTED if c == E["cat"] else ""}>{c}</option>' for c in ['Fragrance', 'Lashes', 'Hair'])
details = f'''<div style="{CARD}; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: 16px">
{field('Title', f'<input type="text" value="{E["title"]}" style="{INPUT}">')}
{field('Category', f'<select style="{SELECT}">{cats}</select>')}
{choice('Format', ['No talking', 'Talking'], E['format'])}
{choice('Visibility', ['Published', 'Hidden'], 'Published')}
{field('Length', f'<input type="text" value="{E["dur"]}" readonly="readonly" style="{READONLY}">', 'Follows the reference video. It cannot be edited.')}
{field('Products needed', f'<input type="number" min="1" value="1" style="{INPUT}">', 'How many products the form asks the user for.')}
</div>'''

ETH = "padding: 12px 8px; text-align: left; font-size: 13px; font-weight: 500; color: var(--text-3); border-bottom: 1px solid var(--line); white-space: nowrap"
ETD = "padding: 8px; font-size: 15px; line-height: 1.4; color: var(--text-2); border-bottom: 1px solid var(--line); vertical-align: middle"
EIN = INPUT.replace('padding: 0 16px', 'padding: 0 12px') + "; width: 100%"
IBTN = "flex: 0 0 auto; width: 44px; height: 44px; padding: 0; border-radius: 12px; border: 0; background: transparent; color: var(--text-2); display: flex; align-items: center; justify-content: center; cursor: pointer"


def ibtn(name, label, off=False):
    extra = ' aria-disabled="true"' if off else ''
    style = IBTN + ('; opacity: 0.35; cursor: default' if off else '')
    return f'<button type="button" aria-label="{label}"{extra} style="{style}">{icon(name, 20)}</button>'


shot_rows = []
for i, (time, what, text, prod) in enumerate(SHOTS, 1):
    opts = ''.join(f'<option{SELECTED if o == prod else ""}>{o}</option>' for o in ['Product 1', 'None'])
    shot_rows.append(
        f'<tr><th scope="row" style="{ETD}; padding-left: 16px; text-align: left; font-weight: 600; color: var(--text)">{i}</th>'
        f'<td style="{ETD}; font-weight: 600; color: var(--accent-text); white-space: nowrap">{time}</td>'
        f'<td style="{ETD}"><input type="text" aria-label="Shot {i}: what happens" value="{what}" style="{EIN}"></td>'
        f'<td style="{ETD}"><input type="text" aria-label="Shot {i}: on-screen text" value="{text}" style="{EIN}"></td>'
        f'<td style="{ETD}"><select aria-label="Shot {i}: product" style="{SELECT}; width: 100%">{opts}</select></td>'
        f'<td style="{ETD}; padding-right: 16px"><div style="display: flex; justify-content: flex-end">'
        f'{ibtn("move up", f"Move shot {i} up", i == 1)}{ibtn("move down", f"Move shot {i} down", i == len(SHOTS))}{ibtn("delete", f"Delete shot {i}")}</div></td></tr>')
shots = f'''<div style="border-radius: 16px; border: 1px solid var(--line); background: var(--surface)">
<div style="overflow-x: auto">
<table style="width: 100%; min-width: 820px; border-collapse: collapse; table-layout: fixed">
<caption style="{SR}">Shot list</caption>
<thead><tr><th scope="col" style="{ETH}; width: 28px; padding-left: 16px">#</th><th scope="col" style="{ETH}; width: 88px">Time</th><th scope="col" style="{ETH}">What happens</th><th scope="col" style="{ETH}; width: 232px">On-screen text</th><th scope="col" style="{ETH}; width: 132px">Product</th><th scope="col" style="{ETH}; width: 132px; padding-right: 16px">{ACTIONS}</th></tr></thead>
<tbody>
{chr(10).join(shot_rows)}
</tbody>
</table>
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 16px">
<button type="button" style="{SMALL_BTN}; gap: 8px">{icon('add', 18)}Add shot</button>
<span style="{SMALL}">Every new video follows these shots in this order. The times add up to the template length.</span>
</div>
</div>'''

sample = f'''<figure style="margin: 0; display: flex; flex-direction: column; gap: 8px">
<div style="position: relative; border-radius: 16px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">
<img src="{E['img']}" alt="Frame from the sample video of this template" style="width: 100%; aspect-ratio: 9 / 16; object-fit: cover; display: block">
<button type="button" aria-label="Play the sample" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 72px; height: 72px; border-radius: 50%; border: 0; background: var(--scrim); color: var(--on-scrim); display: flex; align-items: center; justify-content: center; cursor: pointer">{icon('play', 26, sw=0)}</button>
</div>
<figcaption style="{SMALL}">Sample video, generated by this system.</figcaption>
</figure>
<dl style="margin: 0; display: flex; flex-direction: column; gap: 4px; padding: 16px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line)">
<dt style="{SMALL}">Reference</dt>
<dd style="margin: 0; font-size: 15px; line-height: 1.4; font-weight: 500; color: var(--text)">TikTok Creative Center Top Ads</dd>
<dd style="margin: 0; font-size: 15px; line-height: 1.4; color: var(--text-2)">{E['views']} views</dd>
</dl>
<button type="button" style="{SECONDARY}; gap: 8px">{icon('retry', 18)}Regenerate sample</button>
<p style="margin: 0; {SMALL}">A new sample is generated after credit confirmation.</p>'''

put('A-Sablon-Duzenle.dc.html', 'Admin: edit template', 'templates', f'''
<section aria-label="Template" style="display: flex; flex-direction: column; gap: 8px">
<a href="A-Sablonlar.dc.html" style="{BACK}">{icon('back', 18)}Templates</a>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px">
<h1 style="margin: 0; min-width: 0; overflow-wrap: anywhere; {H3}">{E['title']}</h1>
{status('done', 'Published')}
</div>
<p style="margin: 0; {BODY2}">{E['cat']} · {E['format']} · {E['dur']} · Last edited [DATE]</p>
</section>

<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px">
{sec('h-sample', 'Sample', sample, style='flex: 1 1 260px; max-width: 300px')}
<div style="flex: 3 1 640px; min-width: 0; display: flex; flex-direction: column; gap: 32px">
{sec('h-details', 'Details', details)}
{sec('h-shots', 'Shot list', shots, right=f'<span style="{SMALL}">{len(SHOTS)} shots · {E["dur"]}</span>')}
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-top: 24px; border-top: 1px solid var(--line)">
<button type="button" style="{PRIMARY}">Save changes</button>
<button type="button" style="{SECONDARY}">Discard changes</button>
<p style="flex: 1 1 240px; margin: 0 12px; {SMALL}">Changes apply only to videos generated from now on.</p>
<button type="button" style="{WARN_BTN}">Hide template</button>
</div>
</div>
</div>
''')


# ---- 4. Tarama geçmişi (saatler ve eşik mevcut ekranlardan okunur: A-Ayarlar'daki üç saat ve eşik, A-Gelen'deki "next at")
ayar, gelen0 = src('A-Ayarlar.dc.html'), src('A-Gelen.dc.html')
TIMES = re.findall(r"this\.fld\('t\d', '(\d\d:\d\d)'\)", ayar)
NEXT = one(r'next at (\d\d:\d\d)', gelen0)
LIMIT = one(r"this\.fld\('esik', '(\d+)'", ayar)
assert len(TIMES) == 3 and NEXT in TIMES and f'Threshold {LIMIT}' in gelen0, (TIMES, NEXT, LIMIT)
at = TIMES.index(NEXT)
TOPADS, SHORTS = 'TikTok Creative Center Top Ads', 'YouTube Shorts'
CAND = f'<a href="A-Gelen.dc.html" style="{LINK}">Open candidates</a>'


def scan(time, source, state):
    return [f'[DATE] · {time}', source, '[COUNT]', '[COUNT]', '[COUNT]', state, CAND]


# son tarama (sıradakinden bir önceki saat): Top Ads sürüyor, Shorts durdu (A-Gelen'deki uyarıyla aynı durum)
scans = [scan(TIMES[at - 1], TOPADS, st('run', 'Running')), scan(TIMES[at - 1], SHORTS, st('stopped', 'Stopped', '[REASON]')),
         scan(TIMES[at - 2], TOPADS, st('done', 'Done')), scan(TIMES[at - 2], SHORTS, st('done', 'Done')),
         scan(TIMES[at - 3], TOPADS, st('done', 'Done')), scan(TIMES[at - 3], SHORTS, st('done', 'Done'))]
scan_table = table('Scans', ['Started', 'Source', 'Videos checked', 'Above the threshold', 'Prepared', 'Status', ACTIONS],
                   scans, min_w=960, num=(2, 3, 4, 6))
scan_tiles = [('Scans', '[COUNT]', 'Runs in this period'), ('Videos checked', '[COUNT]', 'Scored by the scans'),
              ('Above the threshold', '[COUNT]', f'Scored above {LIMIT}'), ('Templates prepared', '[COUNT]', 'Sent to the Inbox'),
              ('Published', '[COUNT]', 'Live in the gallery')]
run_now = f'<button type="button" style="{SECONDARY}">Run a scan now</button>'

put('A-Tarama.dc.html', 'Admin: scan history', 'templates', f'''
<div style="display: flex; flex-direction: column; gap: 16px">
{page_head('Scan history', 'What each scan checked and how much of it became templates.', PERIOD + chr(10) + run_now)}
<p style="margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; {BODY2}">
<span style="display: flex; color: var(--text-3)">{icon('duration', 18)}</span>
<span>Scans run {len(TIMES)} times a day: {', '.join(TIMES)} · next at {NEXT}</span>
<a href="A-Ayarlar.dc.html" style="{QUIET}">Change times</a>
</p>
</div>

{tiles(scan_tiles)}

{listing('Scan list', '', '', scan_table)}
''', sub=subnav(SUB_TEMPLATES, 'scans', TABS))


# ---- Mevcut ekranlar: üst menü → panel menüsü, tema tweak'i
THEME_PROP = '"theme":{"editor":"enum","options":["dark","light"],"default":"dark"}'
THEME_VAL = "theme: this.props.theme ?? 'dark'"
INBOX_TABS = subnav(SUB_TEMPLATES, 'inbox', TABS)
OLD_OR_NEW_MENU = r'(?:<div>\s*)?<header.*?</header>(?:\s*<nav aria-label="' + TABS + r'".*?</nav>\s*</div>)?'


def check(s, before, name):
    """Kök stili ve $preview değişmedi; data-props geçerli JSON; renderVals node'da çalışıyor ve temayı veriyor."""
    root = lambda t: re.search(r'<div class="ay"[^>]*? style="([^"]*)"', t).group(1)
    props = lambda t: json.loads(one(r"data-props='([^']*)'", t))
    assert root(s) == root(before), 'kök stili değişti'
    p = props(s)
    assert list(p)[0] == 'theme' and p['$preview'] == props(before)['$preview'], 'props'
    assert s.count('data-theme="{{ theme }}"') == 1 and s.count(THEME_PROP) == 1 and s.count(THEME_VAL) == 1, name
    script = one(r'<script type="text/x-dc"[^>]*>(.*?)</script>', s)
    js = ('class DCLogic{constructor(p){this.props=p;this.state={}}}\n' + script +
          "\nconsole.log(['dark','light'].map(function(t){return new Component({theme:t}).renderVals().theme})"
          ".concat(new Component({}).renderVals().theme).join())")
    out = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    assert out.stdout.strip() == 'dark,light,dark', (name, out.stdout, out.stderr[-400:])


def convert(name, current, tabs='', edits=(), every=()):
    """<header> → panel menüsü (+ varsa ikinci düzey sekmeler), kökte data-theme, data-props ve renderVals'ta theme.
    edits: tek eşleşmeli değişiklikler; every: bütün eşleşmelere uygulanan değişiklikler (yenisi eskisini içermez)."""
    before = src(name)
    s, n = re.subn(OLD_OR_NEW_MENU, lambda m: top(current, tabs), before, count=1, flags=re.S)
    assert n == 1, name
    s = once(s, '<div class="ay" style="', '<div class="ay" data-theme="{{ theme }}" style="')
    s = once(s, "data-props='{\"$preview\"", "data-props='{" + THEME_PROP + ",\"$preview\"")
    for old, new in edits:
        s = once(s, old, new)
    for old, new in every:
        assert old not in new and (old in s or new in s), old
        s = s.replace(old, new)
    check(s, before, name)
    if s != before:
        open(os.path.join(P, name), 'w', encoding='utf-8').write(s)
    print('dönüştürüldü:' if s != before else 'zaten dönüşmüş, dokunulmadı:', name, len(s), 'bayt')


convert('A-Gelen.dc.html', 'templates', INBOX_TABS, [("return {\npending: [", "return {\n" + THEME_VAL + ",\npending: [")])
# A-Ayarlar: üst menüdeki "Account: {{ accLabel }}" etiketi menüyle birlikte gitti; yalnız onu besleyen accLabel alanı da kalkar
convert('A-Ayarlar.dc.html', 'settings', '',
        [("return {\naccLabel: acc === 'musteri' ? 'ACME / ACME2' : 'my own key',\naccounts: accounts,",
          "return {\n" + THEME_VAL + ",\naccounts: accounts,")],
        # saat alanındaki simge tarayıcınındır: light'ta koyu zemine göre çizilip kayboluyordu; dark'ta görünüş aynı kalır
        every=[('color-scheme: dark', 'color-scheme: {{ theme }}')])

# ---- Inbox: boş (row6.py'deki pano; menü panel menüsü oldu, başlık bölümleri A-Gelen'den okunur)
gelen = src('A-Gelen.dc.html')
GHEAD = one(r'(<section style="display: flex; flex-wrap: wrap; align-items: flex-end.*?</section>)', gelen)
CHEAD = one(r'<section aria-label="Candidates"[^>]*>\s*(<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between.*?)\s*<div style="display: flex; flex-direction: column">\s*<sc-for list="\{\{ rows \}\}"', gelen)
DASH = "box-sizing: border-box; border-radius: 16px; border: 1.5px dashed var(--edge-strong)"
EMPTY = f"margin: 0; {DASH}; padding: 32px; font-size: 15px; line-height: 1.5; color: var(--text-2)"
body = f'''<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 36px">
{top('templates', INBOX_TABS)}

{GHEAD}

<section aria-label="Templates waiting to publish" style="display: flex; flex-direction: column; gap: 16px">
<h2 style="margin: 0; {H5}">Templates waiting to publish</h2>
<p style="{EMPTY}">Nothing is waiting. A candidate that scores above the threshold is prepared as a template and shows up here.</p>
</section>

<section aria-label="Candidates" style="display: flex; flex-direction: column; gap: 16px">
{CHEAD}
<p style="{EMPTY}">No candidates yet. The next scan runs at {NEXT}. You can also paste a video link above.</p>
</section>
</div>'''
write('A-Gelen-Bos.dc.html', 'Inbox: empty', ROOT_PAGE, body)
