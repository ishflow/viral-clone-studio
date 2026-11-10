"""Marka bileşen panoları: son turlarda ekranlarda kullanılan ama marka sayfasında belgelenmemiş parçalar.
Marka-Bilesen-1 / -2, Marka-Renk, Marka-Hareket, Marka-Olcu, Marka-Ses yerinde güncellenir, Marka-Bilesen-3 baştan yazılır.
Yeniden çalıştırılabilir: bölümler her çalıştırmada yenisiyle değişir (üst üste binmez), metin düzeltmeleri bir kez uygulanır.
Örnekler parts / panel sabitleriyle ya da ilgili ekranın kendi işaretlemesiyle çizilir: ortak parça ya da ekran değişince
betiği yeniden çalıştırmak örneği de günceller; aranan parça bulunamazsa betik hiçbir şey yazmadan durur.
Sonra: python3 boy.py Marka-Bilesen-1 Marka-Bilesen-2 Marka-Bilesen-3 Marka-Renk Marka-Hareket Marka-Olcu"""
from panel import *

# ---- Marka panolarının ortak biçimi (Marka-Bilesen-1 / -2 ile aynı)
ROOT = ("width: 1440px; min-height: {h}px; box-sizing: border-box; padding: 80px; background: var(--bg); color: var(--text); "
        "font-family: var(--body); display: flex; flex-direction: column; gap: 56px")
SEC = "display: flex; flex-direction: column; gap: 16px"
COL = "display: flex; flex-direction: column; gap: 48px"
TWO = "display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; align-items: start"
RULE = "padding-top: 40px; border-top: 1px solid var(--line)"   # tam genişlik bölüm ayırıcısı (Bilesen-1'deki gibi)
H2S = f"margin: 0; {H5}"
TXT = f"margin: 0; {BODY2}"
WIDE = f"margin: 0; max-width: 860px; {BODY2}"
CAP = "font-size: 13px; color: var(--text-3)"
ITEM = "display: flex; flex-direction: column; gap: 6px"          # örnek + altındaki küçük ad (panodaki mevcut biçim)
EDGE = "box-shadow: 0 0 0 1px var(--media-edge)"
# Kenarlı uyarı düğmesi: kenar yazıyla aynı renk, 1 px (son_gecis.py ile aynı karar). --warn-edge yalnız uyarı kutusunun kenarıdır.
WARN_BTN = SECONDARY.replace('var(--edge-strong)', 'var(--warn)').replace('color: var(--text)', 'color: var(--warn)')
assert 'border: 1px solid var(--warn);' in WARN_BTN and 'color: var(--warn)' in WARN_BTN
PHONE = "width: 390px; box-sizing: border-box; border-radius: 16px; box-shadow: 0 0 0 1px var(--edge); background: var(--bg)"
H3_HEIGHT = 3040  # Marka-Bilesen-3: boy.py'nin yazdığı değer


def h2(title):
    return f'<h2 style="{H2S}">{title}</h2>'


def sec(title, inner, text='', tag='div', style=SEC, text_style=TXT):
    p = f'\n<p style="{text_style}">{text}</p>' if text else ''
    return f'<{tag} style="{style}">\n{h2(title)}\n{inner.strip()}{p}\n</{tag}>'


def src(name):
    return open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read()


def cut(name, pattern):
    """Ekranın kendi işaretlemesinden bir parça."""
    m = re.search(pattern, src(name), re.S)
    assert m, (name, pattern)
    return m.group(1)


def still(html):
    """Örnekteki bağlantılar başka panoya götürmez (mevcut marka panolarında da href="#")."""
    return re.sub(r'href="[^"#]*"', 'href="#"', html)


def swap(s, old, new, n=1):
    assert s.count(old) == n, (old[:70], s.count(old))
    return s.replace(old, new)


def once(s, old, new):
    """old → new; yeniden çalıştırmada (new zaten yerinde) dokunmaz."""
    return s if new in s else swap(s, old, new)


def tail(s, first, anchor, blocks):
    """Bölümleri anchor'ın önüne (sütunun sonuna) koyar; daha önce eklenmişse ilk bölümden anchor'a kadar olanı değiştirir."""
    assert s.count(anchor) == 1, anchor[:70]
    end = s.index(anchor)
    start = s.find(f'<div style="{SEC}">\n{h2(first)}')
    return s[:end if start < 0 else start] + '\n\n'.join(blocks) + '\n\n' + s[end:]


def pads(s):
    """Düğme iç boşlukları merdivende (parts.PRIMARY / PRIMARY_L ile aynı): 52 → 0 24, 60 → 0 32."""
    return (s.replace('min-height: 52px; padding: 0 28px', 'min-height: 52px; padding: 0 24px')
             .replace('min-height: 60px; padding: 0 36px', 'min-height: 60px; padding: 0 32px'))


def edit(name, fn):
    path = os.path.join(P, name + '.dc.html')
    old = open(path, encoding='utf-8').read()
    new = fn(old)
    open(path, 'w', encoding='utf-8').write(new)
    print('güncellendi:' if new != old else 'aynı kaldı:', name, len(new), 'bayt')


def col_end(next_title):
    """Sol sütunun kapanışı: sağ sütunun ilk bölümünden hemen önce."""
    return f'</div>\n\n<div style="{COL}">\n\n<div style="{SEC}">\n{h2(next_title)}'


RIGHT_END = '</div>\n\n</section>\n\n'   # sağ sütunun ve iki sütunlu ızgaranın kapanışı


# =====================================================================================================================
# A) Marka-Bilesen-1 · controls
# =====================================================================================================================
ROW = '<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 20px 16px">'
WARN_ROW = f'''{ROW}
<div style="{ITEM}"><button type="button" style="{SECONDARY}; min-width: 240px">Keep my account</button><span style="{CAP}">safe option, wider</span></div>
<div style="{ITEM}"><button type="button" style="{WARN_BTN}; min-width: 160px">Delete account</button><span style="{CAP}">warning, bordered</span></div>
<div style="{ITEM}"><button type="button" style="{WARN_BTN}">Block user</button><span style="{CAP}">warning, bordered</span></div>
</div>
'''
BTN_TEXT = f'''<p style="{TXT}">One primary button per screen. A button says what it does and keeps its name through the whole flow. In a list, row actions are bordered buttons; lime is for the one main action of the screen.</p>
<p style="{TXT}">A bordered warning button is for a destructive or hard-to-undo action; a safe option always sits beside it and is wider.</p>
'''


def top(html, note):
    """Üst menü örneği: gerçek menü, 80 px'lik çerçevede (çerçeve menünün alt çizgisinin yerini tutar)."""
    inner = swap(still(html), '; border-bottom: 1px solid var(--line)', '')
    return (f'<div style="{ITEM}">\n<div style="padding: 0 24px; border-radius: 16px; border: 1px solid var(--edge)">\n{inner}\n</div>\n'
            f'<span style="{CAP}">{note}</span>\n</div>')


top_bar = sec('Top bar', f'''
<div style="display: flex; flex-direction: column; gap: 16px">
{top(header_in('gallery'), 'signed in')}
{top(header_out(), 'visitor')}
{top(header_panel('overview'), 'admin panel')}
</div>''', 'One layout, three states: logo on the left, menu in the middle, account on the right. Signed in, the right side is the credit '
           'balance and Account; for a visitor it is the language, Log in, and Get started; the admin panel has its own menu, the '
           'Admin tag, and View site. The login page carries the bar too. Below 900 px the bar takes its phone form: see '
           'Components: tables, panel, phone.', tag='section', text_style=WIDE)

lang_closed = re.search(r'<button type="button" aria-label="Language: English\. Change".*?</button>', header_out()).group(0)
lang_open = cut('A-Dil-Menusu', r'(<button type="button" aria-label="Language: English\. Change" aria-expanded="true".*?</button>)')
lang_menu = swap(cut('A-Dil-Menusu', r'(<div role="menu".*?</p>\n</div>)'), 'position: absolute; top: 52px; right: 0; ', '')
dropdown = sec('Dropdown menu', f'''
<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px 48px">
<div style="{ITEM}">{lang_closed}<span style="{CAP}">closed</span></div>
<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px">
{lang_open}
{lang_menu}
<span style="align-self: flex-start; {CAP}">open; the selected item carries a check</span>
</div>
</div>''', 'The list opens under its trigger and lines up with its edge. Items are 44 px high. The selected item is raised and '
           'carries a check. A short note at the bottom may say what the choice changes.')

SEG_ROW = "display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px"
period = sec('Period and filter', f'''
<div style="{SEG_ROW}">
{segment(['Today', '7 days', '30 days', 'All time'], '30 days', 'Period')}
<span style="{CAP}">period</span>
</div>
<div style="{SEG_ROW}">
{segment(['All', 'Paying', 'Free video only', 'Not verified', 'Blocked'], 'All', 'Filter')}
<span style="{CAP}">list filter</span>
</div>''', 'A row of pill buttons with one selected. The admin panel uses it to pick the period of a page or to filter a list. '
           'Each option is 44 px high; the selected one is raised.')


def bilesen1(s):
    # üst menü: bölümün tamamı (ızgaranın başına kadar) yenisiyle değişir
    a, b = s.index(f'<section style="{SEC}">\n{h2("Top bar")}'), s.index(f'<section style="{TWO}; {RULE}">')
    s = pads(s[:a] + top_bar + '\n\n' + s[b:])
    # düğme bölümü: uyarı satırı + kural metinleri (ilk çalıştırmada paragrafın yerine, sonra uyarı satırından bölüm sonuna)
    end = s.index(f'</div>\n\n<div style="{SEC}">\n{h2("Option box")}')
    k = s.find('>Keep my account</button>')
    start = s.rindex(ROW, 0, k) if k >= 0 else s.index(f'<p style="{TXT}">One primary button per screen.')
    s = s[:start] + WARN_ROW + BTN_TEXT + s[end:]
    # seçenek kutusu: müşteri ekranındaki sözle aynı (model adı yok)
    s = s.replace('720p · Seedance 2 Mini<', '720p<').replace('1080p · Seedance 2.5 Pro<', '1080p<')
    assert '>Fast</span><span style="font-size: 13px; color: var(--text-3)">720p</span>' in s
    assert '>Best</span><span style="font-size: 13px; color: var(--text-3)">1080p</span>' in s
    s = tail(s, 'Period and filter', col_end('Tags and filters'), [period])
    return tail(s, 'Dropdown menu', RIGHT_END, [dropdown])


# =====================================================================================================================
# B) Marka-Bilesen-2 · cards and states
# =====================================================================================================================
LEAD2 = 'Everything that shows or reports: video card, surface card, job status, dialog, alert'
WHITE = B + '619ee0e5a13e318118b291c1451be9b8'   # beyaz zeminli kare: light'ta kenarın neden gerektiğini gösterir

loading_line = cut('A-Galeri-Yukleniyor', r'(<p role="status".*?</p>)')
skeleton_card = cut('A-Galeri-Yukleniyor', r'(<div aria-hidden="true" style="display: flex; flex-direction: column; gap: 12px; min-width: 0">.*?</span>\n</div>\n</div>)')
skeleton_lines = cut('A-Galeri-Yukleniyor', r'(<div style="display: flex; flex-direction: column; gap: 8px">\n<span style="height: 12px;.*?</div>)')
skeleton = sec('Loading skeleton', f'''
{loading_line}
<div style="display: flex; align-items: flex-start; gap: 24px">
<div style="width: 184px; display: flex; flex-direction: column; gap: 12px">
{skeleton_card}
<span style="{CAP}">card</span>
</div>
<div style="width: 184px; display: flex; flex-direction: column; gap: 12px">
{swap(skeleton_lines, '<div style=', '<div aria-hidden="true" style=')}
<span style="{CAP}">text lines, 12 px high</span>
</div>
</div>''', 'While a list loads, each card holds its place: a block in the shape of the card and two short lines for the text. '
           'A status line above says what is loading.')

media = sec('Media edge', f'''
<div style="display: flex; align-items: flex-start; gap: 24px">
<div style="{ITEM}"><img src="{WHITE}" alt="" style="width: 135px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 16px; display: block; {EDGE}"><span style="{CAP}">video frame</span></div>
<div style="{ITEM}"><img src="{WHITE}" alt="" style="width: 72px; height: 96px; object-fit: cover; border-radius: 8px; display: block; {EDGE}"><span style="{CAP}">photo</span></div>
</div>''', 'Every photo and video frame carries a 1 px edge in the media edge color. In dark it is transparent; in light it is '
           'a thin line, so a white photo does not melt into the page.')

empty_style = cut('A-Uretimlerim-Bos', r'<main style="([^"]*dashed[^"]*)">')
empty = sec('Empty state', f'''
<div style="{empty_style}">
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
<h3 style="margin: 0; {H4}">Seen it? Clone it.</h3>
<p style="margin: 0; max-width: 520px; {BODY2}">Your videos will show up here.</p>
</div>
<a href="#" style="{PRIMARY_L}">Browse the gallery</a>
</div>''', 'When a list has nothing to show, a dashed panel takes its place: a title, one sentence, one action.')

# Oynatıcıdaki şerit; oynanan kısım --accent (dolgu): video üstünde tema yok, --accent-text light'ta koyu yeşile dönerdi
bar = cut('A-Oynatici', r'(<div style="position: absolute; left: 12px; right: 12px; bottom: 12px;.*?</button>\n</div>\n</div>)')
assert 'background: var(--scrim); color: var(--on-scrim)' in bar and 'background: var(--accent)' in bar and '--accent-text' not in bar
controls = sec('Video controls', f'''
<div style="position: relative; width: 408px; max-width: 100%; height: 240px; border-radius: 16px; overflow: hidden; background: var(--bg); {EDGE}">
<img src="{WHITE}" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 50% 16%; display: block">
{bar}
</div>''', 'The bar sits on the video, so it is the same in both themes: scrim behind, light text and icons on top. Play or pause '
           'and the time on the left, sound and full screen on the right. The progress line is cut into shots. Each button is 44 px.')

# Uyarı kutusu: müşteri ekranındaki söz (A-Is-Durdu): model / sağlayıcı adı ve hata kodu yok
alert = sec('Alert box', f'''
<div role="alert" style="box-sizing: border-box; padding: 20px; border-radius: 16px; background: var(--surface); border: 1px solid var(--warn-edge); display: flex; flex-direction: column; gap: 12px">
<span style="display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 600"><span style="flex: 0 0 auto; width: 10px; height: 10px; border-radius: 2px; background: var(--warn)"></span>Two clips could not be generated</span>
<p style="{TXT}">We did not retry automatically. The 5 finished images, 3 clips, and the music are saved.</p>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">
<button type="button" style="{PRIMARY}">Continue with the backup model</button>
<button type="button" style="{SECONDARY}">Try again</button>
</div>
</div>''')

cookie_card = cut('A-Cerez', r'(<div role="region" aria-label="Cookie notice".*?</button>\n</div>\n</div>)')
cookie_card = swap(cookie_card, 'max-width: 1320px; margin: 0 auto; ', '').replace('<h1 ', '<h3 ').replace('</h1>', '</h3>')
cookie = sec('Cookie bar', still(cookie_card),
             'One wide card: what the cookies are for, a link to the policy, and two answers. Both answers are bordered buttons '
             'of the same weight; neither is lime.', tag='section', style=f'{SEC}; {RULE}', text_style=WIDE)


def bilesen2(s):
    s = pads(once(s, LEAD2 + '.</p>', LEAD2 + ', loading and empty states, video controls, cookie bar.</p>'))
    s = s.replace('Clips · Seedance 2 Mini 720p<', 'Clips · 720p<')
    assert '>Clips · 720p</dt>' in s
    # görsel kenarı: mevcut video kartları ve ürün fotoğrafı
    s = once(s, 'overflow: hidden; background: var(--surface)">', f'overflow: hidden; background: var(--surface); {EDGE}">')
    s = once(s, 'background: var(--surface); outline: 2px solid', f'background: var(--surface); {EDGE}; outline: 2px solid')
    s = once(s, 'object-fit: cover; border-radius: 8px; display: block">', f'object-fit: cover; border-radius: 8px; display: block; {EDGE}">')
    s = tail(s, 'Loading skeleton', col_end('Surface card and drop zone'), [skeleton, media])
    s = tail(s, 'Alert box', RIGHT_END, [alert, empty, controls])
    start, end = s.index(RIGHT_END) + len(RIGHT_END), s.index('</div>\n</x-dc>')   # ızgaradan sonra, kökün kapanışından önce
    return s[:start] + cookie + '\n\n' + s[end:]


# =====================================================================================================================
# D) Marka-Renk · --media-edge satırı
# =====================================================================================================================
SCRIM = "t('scrim', '--scrim', scrim, '76% dark', 'on video')"


def renk(s):
    s = once(s, SCRIM + '\n],', SCRIM + ",\nt('media edge', '--media-edge', 'transparent', 'transparent', 'photos, video')\n],")
    s = once(s, SCRIM + '\n]\n};', SCRIM + ",\nt('media edge', '--media-edge', 'rgba(11, 12, 10, 0.12)', '12% dark', 'photos, video')\n]\n};")
    return pads(s.replace('hint-placeholder-count="16"', 'hint-placeholder-count="17"'))


def ses(s):
    """Ses panosu: "When a job stops" örneği ekrandaki sözle aynı (hata kodu yok)."""
    s = s.replace('>The service returned a 500. We did not retry', '>Two clips could not be generated. We did not retry')
    assert '>Two clips could not be generated. We did not retry automatically. The 5 finished images, 3 clips, and the music are saved.<' in s
    return s


# =====================================================================================================================
# C) Marka-Bilesen-3 · tables, panel, phone
# =====================================================================================================================
# -- panel menüsü + ikinci düzey sekmeler (A-Gelir'deki gibi menüye bitişik)
panel_menu = sec('Panel menu and tabs', f'''
<div style="padding: 0 24px 24px; border-radius: 16px; border: 1px solid var(--edge)">
{still(header_panel('revenue'))}
{still(subnav(SUB_REVENUE, 'purchases', 'Revenue sections'))}
</div>''', 'The admin panel has its own menu: the Admin tag next to the logo, six sections, and View site on the right. '
           'A section with more than one page gets a row of tabs attached under the menu; the selected tab is underlined.',
                 tag='section', text_style=WIDE)

# -- sayı kutusu, grafik yeri (A-Admin-Genel'deki kutular)
customers = [('Users', '[COUNT]', 'All accounts, verified or not'), ('New sign-ups', '[COUNT]', 'Accounts created in this period'),
             ('Revenue', '[AMOUNT]', 'Paid purchases in this period'), ('Credits sold', '[CREDITS]', 'Credits in paid packs')]
tiles = sec('Number tile', f'<div style="{TILES}; grid-auto-rows: 1fr">\n' + '\n'.join(tile(*c) for c in customers) + '\n</div>',
            'A label, the value, and one line that says what is counted. Values use tabular figures, so they line up from tile to tile.')
chart = sec('Chart slot', chart_slot('Revenue per day'),
            'Where a chart will go, a dashed box names what it will show. No chart is drawn without data: no made-up lines, '
            'no sample numbers.')

# -- tablo (A-Kullanicilar'ın sütunları; durum hücreleri row9.py'deki st / verified ile aynı)
SR = "position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)"
ACTIONS = f'<span style="{SR}">Actions</span>'
_MARK = re.compile(r'(<span style="width: 8px; height: 8px;[^>]*></span>)')
_BOX = r'<span style="display: flex; justify-content: center; width: 18px">\1</span>'
_OFF = ('<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">'
        '<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--text-3)"></span>')


def st(kind, label):
    s = f'{_OFF}{label}</span>' if kind == 'off' else status(kind, label)
    return _MARK.sub(_BOX, s, 1).replace('display: flex;', 'display: flex; white-space: nowrap;', 1)


def verified(yes):
    if yes:
        return f'<span style="display: flex; align-items: center; gap: 8px; white-space: nowrap">{icon("done", 18, "color: var(--text-3)", 2.6)}Verified</span>'
    return st('off', 'Not verified')


who = f'<span style="display: flex; flex-direction: column; gap: 4px"><span>[EMAIL]</span><span style="{SMALL}; font-weight: 400">[NAME]</span></span>'
users = table('Users', ['User', 'Joined', 'Email', 'Balance', 'Paid in total', 'Videos', 'Status', ACTIONS],
              [[who, '[DATE]', verified(v), '[BALANCE]', '[AMOUNT]', '[COUNT]',
                st('run', 'Active') if a else st('stopped', 'Blocked'), f'<a href="#" style="{ROW_LINK}">Open</a>']
               for v, a in [(True, True), (False, True), (True, False)]], min_w=960, num=(3, 4, 5, 7))

JOB_HEADS, JOB_NUM = ['Started', 'User', 'Template', 'Credits', 'Status'], (3,)


def state_table(caption, rows, busy=False):
    """panel.table'ın kutusu ve başlık satırı; gövdeyi durum (boş / yükleniyor) doldurur."""
    t = swap(table(caption, JOB_HEADS, [], min_w=520, num=JOB_NUM), '<tbody>\n\n</tbody>', f'<tbody>\n{rows}\n</tbody>')
    return swap(t, '<table style=', '<table aria-busy="true" style=') if busy else t


empty_rows = (f'<tr><td colspan="{len(JOB_HEADS)}" style="padding: 32px 24px; text-align: center">'
              '<div style="display: flex; flex-direction: column; align-items: center; gap: 16px">'
              f'<p style="{TXT}">No jobs match this filter.</p>'
              f'<button type="button" style="{SECONDARY}">Clear filter</button></div></td></tr>')
LINE = "display: inline-block; vertical-align: middle; height: 12px; border-radius: 999px; background: var(--raised)"
TD_LAST = swap(TD, '; border-bottom: 1px solid var(--line)', '')
WIDTHS = [64, 96, 144, 48, 64]   # şeritler 616 px'lik kutuya sığar (yana kayma yok)
loading_rows = '\n'.join(
    '<tr aria-hidden="true">' + ''.join(
        f'<td style="{TD if r < 2 else TD_LAST}{NUM if i in JOB_NUM else ""}"><span style="{LINE}; width: {w}px"></span></td>'
        for i, w in enumerate(WIDTHS)) + '</tr>' for r in range(3))
states = f'''<div style="{TWO}">
<div style="{ITEM}">
{state_table('Jobs: no rows', empty_rows)}
<span style="{CAP}">empty: the header row stays; one sentence and one action in a single cell</span>
</div>
<div style="{ITEM}">
{state_table('Jobs: loading', loading_rows, busy=True)}
<span style="{CAP}">loading: the header row and three skeleton rows</span>
</div>
</div>'''
tables = sec('Table', f'''
{users}
{pager()}
<p style="{WIDE}">The first column names the row and is darker. Number columns are right-aligned in tabular figures. A status is a shape and a word, never color alone. In a table the row action is a quiet link in the last column. On a narrow screen the table scrolls sideways inside its own box; the page does not. Under the table: how many rows are shown, then Previous and Next.</p>
{states}''', 'Every admin list (Jobs, Templates, Scan history, Users) uses this pattern when it is empty or loading.',
             tag='section', text_style=WIDE)

# -- telefon üst menüsü: üç hâl + açık menü (A-Menu-M'nin içeriği)
PHONE_ROW = "display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px"


def phone_bar(kind, note):
    return (f'<div style="{PHONE_ROW}">\n<div style="{PHONE}; padding: 0 16px 24px">\n{still(header_m(kind))}\n</div>\n'
            f'<span style="{CAP}">{note}</span>\n</div>')


phone = sec('Phone top bar', f'''
<div style="display: flex; flex-direction: column; gap: 16px">
{phone_bar('in', 'signed in: the credit balance')}
{phone_bar('out', 'visitor: Get started')}
{phone_bar('admin', 'admin panel: the Admin tag')}
</div>''', 'Below 900 px the top bar takes this form: the logo, the one thing needed most at that moment (the credit balance, '
           'or Get started), and the menu button. The menu opens full screen; its items are 60 px high.')

menu_root = cut('A-Menu-M', r'<div class="ay" data-theme="\{\{ theme \}\}" style="([^"]*)">')
assert 'min-height: 844px' in menu_root and 'padding: 0 16px 24px' in menu_root
menu_inner = cut('A-Menu-M', r'<div class="ay"[^>]*>\n(.*?)\n</div>\n</x-dc>')
assert 'min-height: 60px' in menu_inner
phone_open = sec('Phone menu, open', f'''
<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px 24px">
<div style="{PHONE.replace('; background: var(--bg)', '')}; {menu_root}">
{still(menu_inner)}
</div>
<p style="flex: 1 1 144px; min-width: 0; {TXT}">The menu covers the whole screen. Each item is 60 px high; the current page carries the dot. Under the list: the credit balance and its one action. Language and Log out stay at the bottom.</p>
</div>''')

# -- e-posta kalıbı (E-Odeme'den kısaltılmış örnek, gerçek ölçüde: pano 640, kart 576; e-posta her temada açık zeminlidir)
mail_root = cut('E-Odeme', r'<div class="ay"[^>]*style="([^"]*)">')
assert mail_root.startswith('width: 640px; ') and 'padding: clamp(16px, 8vw - 16px, 32px)' in mail_root   # geniş ekranda 32 → kart 576
mail = cut('E-Odeme', r'<div class="ay"[^>]*>\n(.*?)\n</div>\n</x-dc>')
mail, n1 = re.subn(r'<dl .*?</dl>\n', '', mail, flags=re.S)
mail, n2 = re.subn(r'<p [^>]*>All invoices are on your Account page\.</p>\n', '', mail)
assert (n1, n2) == (1, 1)
mail = still(mail.replace('<h1 ', '<h3 ').replace('</h1>', '</h3>'))
email = sec('Email', f'''
<div data-theme="light" style="width: 640px; max-width: 100%; box-sizing: border-box; padding: 32px; border-radius: 16px; background: var(--bg); color: var(--text); display: flex; flex-direction: column; gap: 16px; box-shadow: 0 0 0 1px var(--edge)">
{mail}
</div>''', 'An email is 640 px wide with a 576 px card, and always light, whatever the theme of the site. The logo on top, one '
           'message, one primary button, and a footer that says why the email came.')

invoice = (f'<div style="{SEC}">\n{h2("Invoice and print")}\n<p style="{TXT}">The invoice is a PDF on A4, on a light background. '
           'Lines are at least 1 px, so they print. Lime appears only in the logo.</p>\n</div>')

body = f'''
<header style="display: flex; flex-direction: column; gap: 16px">
<h1 style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 64px; line-height: 0.98; letter-spacing: -0.03em">Components: tables, panel, phone</h1>
<p style="margin: 0; max-width: 860px; {LEAD}">Everything the admin panel, the phone, and email add: panel menu, number tile, chart slot, table, phone top bar, email.</p>
</header>

{panel_menu}

<section style="{TWO}">

{tiles}

{chart}

</section>

{tables}

<section style="{TWO.replace('repeat(2, minmax(0, 1fr))', '640px minmax(0, 1fr)')}; {RULE}">

<div style="{COL}">

{phone}

{email}

</div>

<div style="{COL}">

{phone_open}

{invoice}

</div>

</section>
'''

if __name__ == '__main__':
    edit('Marka-Bilesen-1', bilesen1)
    edit('Marka-Bilesen-2', bilesen2)
    edit('Marka-Renk', renk)
    edit('Marka-Hareket', pads)
    edit('Marka-Olcu', pads)
    edit('Marka-Ses', ses)
    write('Marka-Bilesen-3.dc.html', 'Viral Clone — components: tables, panel, phone', ROOT.format(h=H3_HEIGHT), body, h=H3_HEIGHT)
