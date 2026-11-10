"""İnceleme turu, grup R3: marka panoları.
A) Mevcut marka panolarındaki çelişkiler ve sözleşmeyle uyuşmayan örnek metinler yerinde düzeltilir (bulgu 10, 11, 24).
B) Marka-Bilesen-4 "Components: messages and money" baştan yazılır (yeni kalıpların marka belgesi).
Yeniden çalıştırılabilir: her düzeltme bir kez uygulanır (yenisi zaten yerindeyse dokunmaz), aranan metin yoksa betik durur.
Marka panolarının türevi yoktur (variants.py / boy.py çalıştırılmaz): yükseklik önizlemedeki `icerik` değerinden elle yazılır,
aşağıdaki HEIGHTS sözlüğü o değerleri taşır ve her çalıştırmada kök min-height ile $preview.height'a yazılır."""
from parts import *

# pano: yükseklik (önizlemedeki icerik, 20'nin katına yuvarlanmış)
HEIGHTS = {'Marka-Oz': 2240, 'Marka-Logo': 2060, 'Marka-Ses': 1680, 'Marka-Olcu': 1300, 'Marka-Renk': 1840, 'Marka-Gorsel-Kurallar': 1480,
           'Marka-Bilesen-1': 2100, 'Marka-Bilesen-2': 2680, 'Marka-Bilesen-3': 3060, 'Marka-Bilesen-4': 2160}


def src(name):
    return open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read()


def swap(s, old, new, n=1):
    assert s.count(old) == n, (old[:80], s.count(old))
    return s.replace(old, new)


def once(s, old, new, n=1):
    """old → new; yeniden çalıştırmada (new zaten yerinde) dokunmaz."""
    return s if new in s else swap(s, old, new, n)


def any_of(s, olds, new):
    """olds içindeki hâllerden hangisi yerindeyse → new (düzeltme turlarında metin bir kez daha değiştiğinde)."""
    if new in s:
        return s
    hit = [o for o in olds if o in s]
    assert len(hit) == 1, (new[:80], len(hit))
    return swap(s, hit[0], new)


def height(s, name):
    h = HEIGHTS[name]
    s, a = re.subn(r'(<div class="ay"[^>]*?(?<![-\w])min-height: )\d+px', rf'\g<1>{h}px', s, count=1)
    s, b = re.subn(r'("\$preview":\{"width":\d+,"height":)\d+\}', rf'\g<1>{h}}}', s, count=1)
    assert (a, b) == (1, 1), name
    return s


def edit(name, fn):
    path = os.path.join(P, name + '.dc.html')
    old = open(path, encoding='utf-8').read()
    new = height(fn(old), name)
    open(path, 'w', encoding='utf-8').write(new)
    print('güncellendi:' if new != old else 'aynı kaldı:', name, len(new), 'bayt')


# ---- marka panolarının ortak biçimi (bilesen.py / Marka-Bilesen-1…3 ile aynı)
ROOT = ("width: 1440px; min-height: {h}px; box-sizing: border-box; padding: 80px; background: var(--bg); color: var(--text); "
        "font-family: var(--body); display: flex; flex-direction: column; gap: 56px")
SEC = "display: flex; flex-direction: column; gap: 16px"
COL = "display: flex; flex-direction: column; gap: 48px"
TWO = "display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; align-items: start"
RULE = "padding-top: 40px; border-top: 1px solid var(--line)"
H2S = f"margin: 0; {H5}"
TXT = f"margin: 0; {BODY2}"
CAP = "font-size: 13px; color: var(--text-3)"
ITEM = "display: flex; flex-direction: column; gap: 6px"
EDGE = "box-shadow: 0 0 0 1px var(--media-edge)"
TAG_FREE = TAG.replace('color: var(--on-scrim)', 'color: var(--accent)')   # video üstünde tema yok: lime yazı --accent (Main ile aynı)
FREE = f'<span style="position: absolute; top: 44px; left: 10px; {TAG_FREE}">Free</span>'


def h2(title):
    return f'<h2 style="{H2S}">{title}</h2>'


def sec(title, inner, text=''):
    p = f'\n<p style="{TXT}">{text}</p>' if text else ''
    return f'<div style="{SEC}">\n{h2(title)}\n{inner.strip()}{p}\n</div>'


# =====================================================================================================================
# A) Mevcut panolar
# =====================================================================================================================
SHORT_11 = 'The structure stays the same: shots, order, timing and on-screen text. People, setting and music are made new around your product.'
TAGLINE = 'One tagline per screen height. A long page may open with the promise and close with the call.'
STOPPED = 'The 2 credits for this video are back in your balance. The 5 finished images, 3 clips and the music are saved.'
REQ_VIDEO = 'mp4 or mov · up to 60 sec · up to 100 MB · vertical (9:16)'
CHARGE = 'You are charged when you confirm. If the video is not delivered, the credits come back.'   # sözleşme §5 madde 8
CHARGE_0 = 'You are charged once, when you confirm. If the video is not delivered, the credits come back.'   # ilk turdaki söz

# ---- Marka-Oz: vaat altına sözleşme §11 tablosu (aynı kalır / yeniden çekilir); "tek değişen ürün" cümlesi kalkar
LI = "padding: 12px 0; border-top: 1px solid var(--line); font-size: 17px; line-height: 1.5; color: var(--text-2); text-wrap: pretty"
UL = "margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column"
H3S = "margin: 0 0 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; " + H6


def promise_col(title, note, items):
    return (f'<div style="display: flex; flex-direction: column">\n<h3 style="{H3S}">{title}<span style="font-family: var(--body); font-weight: 400; '
            f'font-size: 15px; letter-spacing: 0; color: var(--text-3)">{note}</span></h3>\n<ul style="{UL}">\n'
            + '\n'.join(f'<li style="{LI}">{i}</li>' for i in items) + '\n</ul>\n</div>')


PROMISE = f'''<section style="display: flex; flex-direction: column; gap: 24px; padding-top: 40px; border-top: 1px solid var(--line)">
<div style="display: flex; flex-direction: column; gap: 8px">
{h2('What the promise covers')}
<p style="margin: 0; max-width: 860px; {LEAD}">{SHORT_11} Views and sales are never promised.</p>
</div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px">
{promise_col('Stays the same', 'the structure', ['Number of shots and their order', 'Length of each shot and the total length',
                                                'Where and when the on-screen text appears', 'Rhythm and cuts', 'The vertical 9:16 format'])}
{promise_col('Made new', 'may differ', ['People, hands, faces', 'Setting and background details',
                                        'How the product looks: the label and small print can come out slightly different',
                                        'Music: a new track in the same mood. The original audio is never used',
                                        'Voice, in a talking video'])}
</div>
</section>

'''
OZ_NEXT = '<section style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 48px; padding-top: 40px; border-top: 1px solid var(--line)">'


def oz(s):
    if 'What the promise covers' not in s:
        s = swap(s, OZ_NEXT, PROMISE + OZ_NEXT)
    # "tek değişen ürün" sözü kalkar (hemen üstteki bölüm sözleşme cümlesini taşıdığı için burada kısası)
    s = once(s, 'Shot count, order, length, rhythm, and text layout stay the same. The only thing that changes is the product.',
             'Shots, order, timing and on-screen text stay the same. People, setting and music are made new around your product.')
    s = any_of(s, ['Every job shows an estimate first. No credits are spent until you confirm.',
                   'Every job shows its price in credits first. You are charged once, when you confirm.'],
               'Every job shows its price in credits first. You are charged when you confirm.')
    s = once(s, '“5 clips, 20 sec”', '“8 sec · 9:16 · 720p”')   # onay penceresinde öne çıkan satır (sözleşme §5)
    return once(s, 'One explains what you get, the other asks you to act. They never share a view.',
                'One explains what you get, the other asks you to act. ' + TAGLINE)


# ---- Marka-Logo: Final işareti, ad / yazı, dar üst menü kuralı, teslim dosyaları, alan adı notu
FINAL = ('<span style="display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--accent-text); '
         f'font-size: 13px; font-weight: 600; color: var(--accent-text)">{icon("done", 14, sw=2.6)}Final</span>')
LOGO_H1 = '<h1 style="margin: 0; font-family: var(--display); font-weight: 800; font-size: 64px; line-height: 0.98; letter-spacing: -0.03em">Logo</h1>'
NAMES = ('<dl style="margin: 0; display: flex; flex-wrap: wrap; gap: 8px 32px; font-size: 15px; line-height: 1.5">\n'
         '<div style="display: flex; gap: 8px"><dt style="color: var(--text-3)">Name</dt><dd style="margin: 0; font-weight: 600">Viral Clone</dd></div>\n'
         '<div style="display: flex; gap: 8px"><dt style="color: var(--text-3)">Wordmark</dt><dd style="margin: 0; font-weight: 600">viral clone</dd></div>\n'
         '</dl>')
LOGO_LEAD = 'The right one is filled: its clone, with your product.</p>\n'
FILES = [('logo.svg', 'Mark and wordmark, vector. The source for the other files.'), ('mark.svg', 'The mark alone, vector.'),
         ('logo-dark.png', 'Mark and wordmark for dark backgrounds.'), ('logo-light.png', 'Mark and wordmark for light backgrounds.'),
         ('favicon.ico', 'The app icon for the browser tab.'), ('og-image.png', 'The image shown when a link is shared.'),
         ('email-logo.png', 'The logo for emails, on a light background.')]
NOTE = ("margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--surface); "
        "border: 1px solid var(--line); font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty")
INFO_ICON = icon('info', 20, 'flex: 0 0 auto; color: var(--text-3)')
DELIVERY = f'''<section style="display: flex; flex-direction: column; gap: 20px">
<h2 style="{H2S}">Delivery files</h2>
<ul style="margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px">
''' + '\n'.join(f'<li style="display: flex; flex-direction: column; gap: 4px"><strong style="font-size: 15px; font-weight: 600">{n}</strong>'
                f'<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">{d}</span></li>' for n, d in FILES) + f'''
</ul>
<p style="{NOTE}; max-width: 860px">{INFO_ICON}<span>Domain not registered yet; availability must be checked with the registrar.</span></p>
</section>

'''
MIN_LI = '<li><strong style="font-weight: 600; color: var(--text)">Minimum</strong> 20 px type size. Below that, use the app icon.</li>\n'


def logo_board(s):
    if '>Final</span>' not in s:
        s = swap(s, LOGO_H1, f'<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px">\n{LOGO_H1}\n{FINAL}\n</div>')
        s = swap(s, LOGO_LEAD, LOGO_LEAD + NAMES + '\n')
    s = once(s, MIN_LI, MIN_LI + '<li><strong style="font-weight: 600; color: var(--text)">Narrow header</strong> '
             'Below 360 px the header shows the mark without the wordmark.</li>\n')
    if 'Delivery files' not in s:
        s = swap(s, '</section>\n\n</div>\n</x-dc>', '</section>\n\n' + DELIVERY + '</div>\n</x-dc>')
    return s


# ---- Marka-Ses: tek söz kuralı; sol sütundaki örnekler sözleşmedeki ekran metinleriyle aynı
GLOSS = ('<div style="display: flex; flex-direction: column; gap: 4px">\n<dt style="font-size: 17px; font-weight: 600">returned, refund</dt>\n'
         '<dd style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">Credits are returned to your balance. '
         'Money is refunded to your payment method. Never one word for the other.</dd>\n</div>\n')


def ses(s):
    s = once(s, '<li>One line per view: “Same video. Your product.” or “Seen it? Clone it.” Never both.</li>', f'<li>{TAGLINE}</li>')
    s = once(s, '<li>No exclamation marks, emoji, or ellipses.</li>',
             '<li>No exclamation marks or emoji. An ellipsis only while something is running: “Uploading… 60%”.</li>')
    s = once(s, 'An unknown value goes in square brackets: [PRICE].', 'An unknown value goes in square brackets: [BALANCE].')
    s = once(s, 'Two clips could not be generated. We did not retry automatically. The 5 finished images, 3 clips, and the music are saved.',
             'Two clips could not be generated. ' + STOPPED)
    s = any_of(s, ['Press Generate and you see a credit estimate first. Nothing is spent until you confirm.', CHARGE_0], CHARGE)
    s = once(s, 'You can close this page. The job keeps running and stays in My videos.', 'You can leave this page. We email you when it is ready.')
    s = once(s, "can't build that structure yet. No credits were spent.", "can't build that structure yet. Your credit was returned.")
    if 'returned, refund' not in s:
        s = swap(s, 'Never token, point, or coin.</dd>\n</div>\n', 'Never token, point, or coin.</dd>\n</div>\n' + GLOSS)
    return s


# ---- Marka-Gorsel-Kurallar: dört yükseklik; Free etiketi kuralı ve örneği; yasak yer tutucu kalkar
G_TAG = f'<span style="position: absolute; top: 10px; right: 10px; {TAG}">8 sec</span>\n'


def gorsel(s):
    s = once(s, 'ten type steps, five corners, three heights.', 'ten type steps, five corners, four heights.')
    s = once(s, 'Leave the unknown in square brackets: [PRICE].', 'Leave the unknown in square brackets: [BALANCE].')
    s = once(s, 'Two tags on top, at most.</h2>', 'Three tags, at most.</h2>')
    s = once(s, 'Format on the left, length on the right. No gradient, logo, or watermark goes over the video.',
             'Format on the left, length on the right. Free sits under the format while your first video is unused. '
             'No gradient, logo, or watermark goes over the video.')
    return once(s, G_TAG + '</div>', G_TAG + FREE + '\n</div>')


# ---- Marka-Renk: video üstündeki Free etiketi (lime yazı, aynı scrim)
def renk(s):
    return once(s, 'dark scrim, light text. Even over a pure white frame the ratio is 8.5.',
                'dark scrim, light text. Even over a pure white frame the ratio is 8.5. The Free tag keeps the scrim and takes lime text.')


# ---- Marka-Olcu: 44'lük satır eylemi
def olcu(s):
    return once(s, '>menus, filters, quiet buttons</span>', '>menus, filters, quiet buttons, row actions</span>')


# ---- Marka-Bilesen-1: biçim anahtarı 44 px; satır eylemi kuralı tek: gezinme bağlantı, işlem düğme
SW_OLD = '''<div role="group" aria-label="Format" style="display: flex; padding: 4px; border-radius: 999px; background: var(--surface); border: 1px solid var(--edge)">
<button type="button" aria-pressed="true" style="min-height: 36px; padding: 0 14px; border-radius: 999px; border: 0; background: var(--raised); color: var(--text); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer">All</button>
<button type="button" style="min-height: 36px; padding: 0 14px; border-radius: 999px; border: 0; background: transparent; color: var(--text-3); font: inherit; font-size: 15px; cursor: pointer">No talking</button>
<button type="button" style="min-height: 36px; padding: 0 14px; border-radius: 999px; border: 0; background: transparent; color: var(--text-3); font: inherit; font-size: 15px; cursor: pointer">Talking</button>
</div>
<span style="font-size: 13px; color: var(--text-3)">three-way switch; container 44 px</span>'''
SWITCH = re.search(r'(<div role="group" aria-label="Format".*?</div>)', src('Main'), re.S).group(1)   # ekrandaki anahtarın kendisi
assert 'min-height: 44px' in SWITCH and 'min-height: 36px' not in SWITCH
SW_NEW = SWITCH + '\n<span style="font-size: 13px; color: var(--text-3)">three-way switch; each option 44 px high, the pill inside 36</span>'
ROW_ACT = "display: inline-flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 500; text-decoration: none"
ROW_BTN = SECONDARY.replace('min-height: 52px', 'min-height: 44px').replace('padding: 0 24px', 'padding: 0 16px')   # A-Gelir, A-Isler ile aynı
assert 'min-height: 44px; padding: 0 16px' in ROW_BTN
ROW = '<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 20px 16px">'
ROW_ACTIONS = f'''{ROW}
<div style="{ITEM}"><a href="#" style="{ROW_ACT}; align-self: flex-start">Open</a><span style="{CAP}">row action that navigates: link</span></div>
<div style="{ITEM}"><button type="button" style="{ROW_BTN}; align-self: flex-start">Refund</button><span style="{CAP}">row action that changes something: bordered, 44 px</span></div>
</div>
'''
B1_RULE_OLD = 'In a list, row actions are bordered buttons; lime is for the one main action of the screen.</p>'
B1_RULE = ('In a list or a table, a row action that takes you somewhere (Open, View) is a link; one that changes something (Refund, Retry) '
           'is a bordered button. Lime is for the one main action of the screen.</p>')
B1_TXT = f'<p style="{TXT}">One primary button per screen.'


def bilesen1(s):
    s = once(s, SW_OLD, SW_NEW)
    s = once(s, B1_RULE_OLD, B1_RULE)
    # satır eylemi örneği: kural metninin hemen üstünde; yeniden çalıştırmada eskisinin yerine geçer
    end = s.index(B1_TXT)
    k = s.find('row action that navigates')
    s = s[:s.rindex(ROW, 0, k) if k >= 0 else end] + ROW_ACTIONS + s[end:]
    return once(s, 'The address is missing its ending. It should look like name@example.com.', 'Enter a valid email address.')


# ---- Marka-Bilesen-2: örnekler sözleşmedeki ekranlarla aynı (pencere satırları, durma metni, video şartları, çerez notu, Free etiketi)
def cut(name, pattern):
    m = re.search(pattern, src(name), re.S)
    assert m, (name, pattern)
    return m.group(1)


LEG = "display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600"
MARK = "width: 8px; height: 8px; box-sizing: border-box"
LEGEND = f'''<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px">
<span style="{LEG}; color: var(--text-2)"><span style="{MARK}; border-radius: 50%; border: 2px solid var(--text-2)"></span>In queue</span>
<span style="{LEG}; color: var(--accent-text)"><span style="{MARK}; border-radius: 50%; background: var(--accent-text)"></span>Running</span>
<span style="{LEG}; color: var(--warn)"><span style="{MARK}; border-radius: 2px; background: var(--warn)"></span>Stopped</span>
<span style="{LEG}; color: var(--text-2)"><span style="{MARK}; border-radius: 2px; border: 2px solid var(--text-2)"></span>Closed</span>
<span style="{LEG}; gap: 6px; color: var(--accent-text)">{icon('done', 14, sw=3)}Done</span>
</div>
<p style="{TXT}">A stage has four states and four shapes: filled circle with a check, ring with a bar, dashed ring, square frame. A job has five states, each with its own mark and word: In queue, Running, Stopped, Closed, Done. The state reads even without color.</p>
'''

COOKIE = re.sub(r'href="[^"#]*"', 'href="#"', cut('A-Cerez', r'(<div role="region" aria-label="Cookie notice".*?</button>\n</div>\n</div>)'))
COOKIE = swap(COOKIE, 'max-width: 1320px; margin: 0 auto; ', '').replace('<h1 ', '<h3 ').replace('</h1>', '</h3>')
COOKIE_TXT = ('One wide card: what the cookies are for, a link to the privacy page, and one answer. Only necessary cookies are used, '
              'so there is nothing to choose; the button is bordered, never lime.')
B2_CARD_END = ('{dur}</span>\n', '{dur}</span>\n' + FREE + '\n')


def bilesen2(s):
    s = once(s, '<dt style="color: var(--text-2)">Clips · 720p</dt><dd style="margin: 0; font-weight: 600">5 clips, 20 sec</dd>',
             '<dt style="color: var(--text-2)">Final video</dt><dd style="margin: 0; font-weight: 600">8 sec · 9:16 · 720p</dd>')
    s = once(s, '<dt style="font-weight: 600">Estimated credits</dt><dd style="margin: 0; font-weight: 600; color: var(--accent-text)">[CREDIT AMOUNT]</dd>',
             '<dt style="font-weight: 600">Credits for this job</dt><dd style="margin: 0; font-weight: 600; color: var(--accent-text)">2</dd>')
    s = once(s, '>Fragrance layering recipe · Fast · 1 variant</p>', '>Fragrance layering recipe · Fast · 1 variant · English</p>')
    s = once(s, '>We did not retry automatically. The 5 finished images, 3 clips, and the music are saved.</p>', '>' + STOPPED + '</p>')
    s = once(s, '<span style="font-size: 13px; color: var(--text-3)">mp4 or mov · 60 sec max</span>',
             f'<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">{REQ_VIDEO}</span>')
    for dur in ('8 sec', '13 sec'):   # iki örnek kart (duran, üzerine gelinmiş)
        s = once(s, B2_CARD_END[0].format(dur=dur), B2_CARD_END[1].format(dur=dur))
    s = once(s, 'Right, the empty frame: dashed border, always the same ratio.</p>',
             'Right, the empty frame: dashed border, always the same ratio. A no-talking template carries the Free tag under its format '
             'while the first video is unused.</p>')
    # iş durumu göstergesi: çekim listesinin altından bölümün sonuna kadar olan kısım yenisiyle değişir
    a = s.index('</ol>\n', s.index('>Job status</h2>')) + len('</ol>\n')
    b = s.index(f'</div>\n\n<div style="{SEC}">\n{h2("Alert box")}')
    s = s[:a] + LEGEND + s[b:]
    a = s.index('<div role="region" aria-label="Cookie notice"')
    b = s.index('</section>', a)
    return s[:a] + COOKIE + f'\n<p style="margin: 0; max-width: 860px; {BODY2}">{COOKIE_TXT}</p>\n' + s[b:]


# ---- Marka-Bilesen-3: satır eylemi kuralı; e-posta örneği E-Odeme'deki sözle aynı
def bilesen3(s):
    s = once(s, 'In a table the row action is a quiet link in the last column.',
             'The row action sits in the last column: a link if it takes you somewhere (Open, View), a bordered button if it changes something (Refund, Retry).')
    return s.replace('[CREDITS] credits added', '30 credits added')


# =====================================================================================================================
# B) Marka-Bilesen-4 · messages and money
# =====================================================================================================================
BOX = "margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--surface); font-size: 15px; line-height: 1.5"
WARN20 = icon('warning', 20, 'flex: 0 0 auto; color: var(--warn)')
WARN16 = icon('warning', 16, 'flex: 0 0 auto; margin-top: 1px')
DONE20 = icon('done', 20, 'flex: 0 0 auto; color: var(--accent-text)')


def shown(inner, note):
    return f'<div style="{ITEM}">\n{inner}\n<span style="{CAP}">{note}</span>\n</div>'


messages = sec('Inline message', f'''
<div style="display: flex; flex-direction: column; gap: 16px">
{shown(f'<p style="{BOX}; border: 1px solid var(--line); color: var(--text-2)">{INFO_ICON}<span>Preparing a template costs 1 credit. You confirm before anything is charged.</span></p>', 'info: something to know before you act')}
{shown(f'<p role="alert" style="{BOX}; border: 1px solid var(--warn-edge); color: var(--text)">{WARN20}<span><strong style="font-weight: 600; color: var(--warn)">This video is longer than 60 seconds.</strong> Trim it and try again. Nothing was charged.</span></p>', 'warning: something stopped or changed; the first sentence says what')}
{shown(f'<p role="status" style="{BOX}; border: 1px solid var(--line); color: var(--text)">{DONE20}<span>Sent again. You can send another in 60 seconds.</span></p>', 'success: something finished')}
{shown(status('done', 'Saved.'), 'a one-word result next to its button: a status line, no box')}
</div>''', 'A message sits where the thing happened, not at the top of the page. All three share one box; the icon and the edge tell them apart, '
           'so the kind reads without color. One or two sentences: what happened, then what to do. A warning that follows a payment or a '
           'credit step ends with what was charged.')

ERR = "display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 1.4; color: var(--warn)"
FIELD = "display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--text-3)"
INPUT_BAD = ("min-height: 52px; box-sizing: border-box; padding: 0 16px; border-radius: 12px; border: 1.5px solid var(--warn); background: var(--surface); "
             "color: var(--text); font: inherit; font-size: 15px")
field = sec('Field error', f'''
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px">
<label style="{FIELD}">Email
<input type="email" value="name@example" aria-invalid="true" style="{INPUT_BAD}">
<span style="{ERR}">{icon('warning', 16)}Enter a valid email address.</span>
</label>
<label style="{FIELD}">Password
<input type="password" value="12345" aria-invalid="true" style="{INPUT_BAD}">
<span style="{ERR}">{icon('warning', 16)}Use at least 8 characters.</span>
</label>
</div>''', 'The field keeps what was typed. Its edge takes the warning color and one line under it says what to do. The line carries '
           'an icon, so it reads without color. Other fields are not touched.')

LOAD_FAIL = ("box-sizing: border-box; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); "
             "padding: clamp(48px, 5vw, 72px) clamp(16px, 4vw, 24px); display: flex; flex-direction: column; align-items: center; "
             "gap: 24px; text-align: center")   # A-Galeri-Hata ile aynı
FAIL_ICON = ('<span aria-hidden="true" style="width: 48px; height: 48px; border-radius: 50%; background: var(--raised); color: var(--warn); '
             f'display: flex; align-items: center; justify-content: center">{icon("warning", 24)}</span>')
TRY = f'<button type="button" style="{SECONDARY}; gap: 8px">{icon("retry", 18)}Try again</button>'
load_fail = sec('Could not load', f'''
<div role="alert" style="{LOAD_FAIL}">
{FAIL_ICON}
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
<h3 style="margin: 0; {H6}">Could not load the gallery.</h3>
<p style="margin: 0; max-width: 520px; {BODY2}">Check your connection and try again. Your videos and credits are not affected.</p>
</div>
{TRY}
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px">
{TRY}
<a href="#" style="{QUIET}">Contact support</a>
<span style="{CAP}">after a second failure</span>
</div>''', 'When a list or a part of a page cannot load, this block takes its place: an icon, a 20 px title that names what did not load, '
           'one 15 px sentence, and a bordered Try again. The button is never lime. After a second failure, Contact support appears beside it.')

# Küçük resim hâlleri: A-Form-Yukleme'deki çizimle aynı (72 × 96, köşe 8)
IMG = B + '619ee0e5a13e318118b291c1451be9b8'
THUMB = "position: relative; flex: 0 0 auto; width: 72px; height: 96px; border-radius: 8px; overflow: hidden; background: var(--raised)"
DIM = f'<img src="{IMG}" alt="" style="width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0.4">'
ACT = ("min-height: 44px; padding: 0 4px; border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 13px; font-weight: 600; "
       "text-align: left; white-space: nowrap; cursor: pointer")
ACTS = '<div style="flex: 0 0 72px; display: flex; flex-direction: column; gap: 8px">\n{}\n</div>'
PAIR = "display: flex; align-items: flex-start; gap: 8px"


def acts(*names):
    return ACTS.format('\n'.join(f'<button type="button" style="{ACT}">{n}</button>' for n in names))


t_empty = (f'<button type="button" style="width: 232px; height: 96px; box-sizing: border-box; padding: 8px 16px; border-radius: 8px; border: 1.5px dashed var(--edge-strong); '
           'background: transparent; color: var(--text-2); font: inherit; font-size: 13px; line-height: 1.4; display: flex; flex-direction: column; align-items: center; '
           f'justify-content: center; gap: 4px; text-align: center; text-wrap: balance; cursor: pointer"><span style="display: flex; color: var(--accent-text)">{icon("add", 20)}</span>'
           'Drop images here or choose files</button>')
t_more = (f'<button type="button" aria-label="Add image" style="width: 72px; height: 96px; border-radius: 8px; border: 1.5px dashed var(--edge-strong); '
           f'background: transparent; color: var(--accent-text); display: flex; align-items: center; justify-content: center; cursor: pointer">{icon("add", 20)}</button>')
t_busy = f'''<div style="{PAIR}">
<div style="{THUMB}; {EDGE}">
{DIM}
<span role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60" style="position: absolute; left: 4px; right: 4px; bottom: 4px; display: flex; padding: 4px; border-radius: 999px; background: var(--scrim)"><span style="flex: 60; height: 4px; border-radius: 999px; background: var(--accent)"></span><span style="flex: 40; height: 4px"></span></span>
</div>
<div style="flex: 0 0 auto; min-width: 72px; align-self: stretch; display: flex; flex-direction: column; gap: 8px; justify-content: center">
<span role="status" style="font-size: 13px; line-height: 1.4; font-weight: 600; color: var(--text-2)">Uploading… 60%</span>
</div>
</div>'''
t_done = f'''<div style="{PAIR}">
<img src="{IMG}" alt="Uploaded product image" style="width: 72px; height: 96px; object-fit: cover; border-radius: 8px; display: block; {EDGE}">
{acts('Replace', 'Remove')}
</div>'''
t_fail = f'''<div style="{PAIR}">
<div style="{THUMB}; box-shadow: 0 0 0 1.5px var(--warn)">
{DIM}
<span aria-hidden="true" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 32px; height: 32px; border-radius: 50%; background: var(--scrim); color: var(--on-scrim); display: flex; align-items: center; justify-content: center">{icon('warning', 20)}</span>
</div>
{acts('Try again', 'Remove')}
</div>'''
LINE = "margin: 0; display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.4; color: var(--warn)"
uploads = sec('Upload thumbnail', f'''
<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px">
{shown(t_empty, 'empty')}
{shown(t_more, 'add another')}
{shown(t_busy, 'uploading')}
{shown(t_done, 'uploaded')}
{shown(t_fail, 'upload failed')}
</div>
<div style="{ITEM}">
<p role="alert" style="{LINE}">{WARN16}<span style="min-width: 0; overflow-wrap: anywhere">Upload failed. Check your connection.</span></p>
<p role="alert" style="{LINE}">{WARN16}<span style="min-width: 0; overflow-wrap: anywhere">a-very-long-product-photo-name-final-v2.png is larger than 10 MB.</span></p>
<span style="{CAP}">one line per file, under the thumbnails: the file name and what to do</span>
</div>''', 'A thumbnail is 72 by 96 with an 8 px corner. While it uploads, the image is dimmed and a bar on a scrim shows the progress; '
           'the percent is written beside it. A failed upload takes a warning ring and icon. An error touches only its own file: the other '
           'images and fields stay. The main button stays off until every upload is done.')

# Kredi özeti satırları: A-Onay'daki satırlarla aynı
ROW17 = "display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; padding: 16px 0; border-top: 1px solid var(--edge); font-size: 17px"
DD17 = "margin: 0 0 0 auto; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere"
ROW15 = "display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px"
DD = "margin: 0; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere"
credits = sec('Credit rows', f'''
<div style="box-sizing: border-box; max-width: 520px; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 16px">
<dl style="margin: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--edge)">
<div style="{ROW17}; border-top: 0; padding-top: 0"><dt style="font-weight: 600">Credits for this job</dt><dd style="{DD17}; color: var(--accent-text)">2</dd></div>
<div style="{ROW15}"><dt style="color: var(--text-2)">Balance now</dt><dd style="{DD}">[BALANCE]</dd></div>
<div style="{ROW15}"><dt style="color: var(--text-2)">After this job</dt><dd style="{DD}">[BALANCE AFTER]</dd></div>
</dl>
<p style="margin: 0; {SMALL}; text-wrap: pretty">{CHARGE}</p>
</div>''', 'Wherever credits are about to be charged, three rows in this order: the price, the balance now, the balance after. The price row is '
           'one step larger and its number takes the accent text color. The price is fixed: the number shown is the number charged. '
           'Only time is an estimate (“about 7 min”). A note under the rows says when the charge happens and what comes back.')

WORD = f"box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 12px; min-width: 0"
QUOTE = "margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 15px; line-height: 1.5; color: var(--text)"


def word(name, what, quotes):
    return (f'<div style="{WORD}">\n<h3 style="margin: 0; {H6}">{name}</h3>\n<p style="{TXT}">{what}</p>\n<ul style="{QUOTE}">\n'
            + '\n'.join(f'<li>“{q}”</li>' for q in quotes) + '\n</ul>\n</div>')


words = sec('Returned and refund', f'''
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch">
{word('returned', 'Credits go back to your balance. It happens on its own.', ['Credits returned', 'Your credit was returned.', 'The 2 credits for this video are back in your balance.'])}
{word('refund', 'Money goes back to your payment method, through the payment provider.', ['Request a refund', 'Refunded', 'The money is refunded to your payment method in a few days.'])}
</div>''', 'Two words for two different things, never one for the other. A stopped job or a template that could not be prepared returns '
           'credits. A pack that was not used is refunded.')

LINE15 = "display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600"
HELP = "font-size: 13px; line-height: 1.4; color: var(--text-3)"
INPUT_OK = INPUT_BAD.replace('border: 1.5px solid var(--warn)', 'border: 1px solid var(--edge-strong)')
assert INPUT_OK != INPUT_BAD
talking = f'''<section style="{SEC}; {RULE}">
{h2('Talking template')}
<div style="{TWO}">
<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px 48px">
{shown(f'<span style="{LINE15}; color: var(--accent-text)">{icon("done", 18, sw=2.6)}Free with your first video</span>', 'template page, no-talking template')}
{shown(f'<span style="{LINE15}; color: var(--text-2)">{icon("credits", 18)}Needs credits · 4 credits</span>', 'template page, talking template')}
</div>
<div style="{ITEM}">
<label style="{FIELD}">Short description
<input type="text" value="body oil" style="{INPUT_OK}">
<span style="{HELP}">What the presenter says is written from your product description. Only claims you typed are used.</span>
</label>
<span style="{CAP}">generate form, talking template: a note under the description field</span>
</div>
</div>
<p style="margin: 0; max-width: 860px; {BODY2}">A talking template is not covered by the free video. Where a no-talking template says Free with your first video, its page says what it costs: the same line, with the credits icon and no accent color. In the form, a note under the product description says where the presenter's words come from. The sample pages on the canvas show a no-talking template, so these two lines are recorded here.</p>
</section>'''

HEAD_STYLE = "margin: 0; font-family: var(--display); font-weight: 800; font-size: 64px; line-height: 0.98; letter-spacing: -0.03em"
body4 = f'''
<header style="display: flex; flex-direction: column; gap: 16px">
<h1 style="{HEAD_STYLE}">Components: messages and money</h1>
<p style="margin: 0; max-width: 860px; {LEAD}">Everything that says what happened and what it costs: inline messages, field errors, the could-not-load block, upload states, credit rows, and the two words for giving something back.</p>
</header>

<section style="{TWO}; {RULE}">

<div style="{COL}">

{messages}

{field}

{load_fail}

</div>

<div style="{COL}">

{uploads}

{credits}

{words}

</div>

</section>

{talking}
'''

if __name__ == '__main__':
    edit('Marka-Oz', oz)
    edit('Marka-Logo', logo_board)
    edit('Marka-Ses', ses)
    edit('Marka-Gorsel-Kurallar', gorsel)
    edit('Marka-Renk', renk)
    edit('Marka-Olcu', olcu)
    edit('Marka-Bilesen-1', bilesen1)
    edit('Marka-Bilesen-2', bilesen2)
    edit('Marka-Bilesen-3', bilesen3)
    h = HEIGHTS['Marka-Bilesen-4']
    write('Marka-Bilesen-4.dc.html', 'Viral Clone — components: messages and money', ROOT.format(h=h), body4, h=h)
