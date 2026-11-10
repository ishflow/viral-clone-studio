"""R4 (2026-10-04 inceleme turu): onay penceresi, kısmi varyant ve üç durum panosu.
Yazdıkları: A-Onay, A-Onay-Yetersiz (kap aynı; satırlar sözleşme §5), A-Onay-Durumlar, A-Form-Yukleme,
A-Sonuc-Varyant-Kismi, A-Sonuc-Durumlar. Bu altı pano yalnız buradan yazılır: betik yeniden çalıştırılabilir.
Bütün metinler docs/specs/2026-10-04-flow-contract.md §5, §6 madde 8, §7.1, §10; sözleşmede olmayanlar raporda listeli.
Kullanım: VK_PROJECT=<tuval>/project python3 r4_panolar.py
Sayfa ve durum panoları 900 yükseklikle yazılır: ardından boy.py (A-Form-Yukleme A-Onay-Durumlar A-Sonuc-Varyant-Kismi A-Sonuc-Durumlar)
ve variants.py (altı pano) çalıştırılır. A-Onay ve A-Onay-Yetersiz pencere panosudur: yükseklik bu dosyada elle (660 / 620)."""
from parts import write, icon, status, header_in, ROOT_PAGE, H4, H6, SMALL, SECONDARY, TAG

B = '/_blob/'
JOB = 'Fragrance layering recipe'
SUB = f'{JOB} · Fast · 1 variant · English'
FINAL = '8 sec · 9:16 · 720p'
GENERATED = "5 images · 5 clips (20 sec of footage) · 1 music track. The clips are cut to the template's 8 seconds."
FOOT = 'You are charged when you confirm. If the video is not delivered, the credits come back.'
LONG = 'a-very-long-product-photo-name-final-v2.png'   # uzun dosya adı: hiçbir görünüşte taşmaz, satıra iner

# --- durum panosu iskeleti (KURALLAR §11) --------------------------------------------------------------------------------
BOARD = "max-width: 1320px; margin: 0 auto; padding-top: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 32px"
CELL = "flex: 1 1 400px; min-width: 0; max-width: 520px; display: flex; flex-direction: column; gap: 12px"


def cell(label, inner):
    return f'<section style="{CELL}">\n<h2 style="margin: 0; font-weight: 400; {SMALL}">{label}</h2>\n{inner.strip()}\n</section>'


def board(name, title, heading, cells):
    body = (f'<div style="{BOARD}">\n<h1 style="margin: 0; {H4}">{heading}</h1>\n'
            '<div style="display: flex; flex-wrap: wrap; gap: 32px">\n\n' + '\n\n'.join(cells) + '\n\n</div>\n</div>')
    write(name + '.dc.html', title, ROOT_PAGE, body)


# --- ortak kalıplar: uyarı kutusu (A-Form-Hata), bilgi kutusu (A-Video-Ekle), durum satırı (A-Galeri-Yukleniyor) -----------
BOX = ("margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: {bg}; "
       "border: 1px solid {edge}; font-size: 15px; line-height: 1.5; color: var(--text)")
WARN_ICON = icon('warning', 20, 'flex: 0 0 auto; color: var(--warn)')
INFO_ICON = icon('info', 20, 'flex: 0 0 auto; color: var(--text-2)')
TXT = 'min-width: 0; overflow-wrap: anywhere'


def lead(strong, rest=''):
    return f'<strong style="font-weight: 600; color: var(--warn)">{strong}</strong>{rest}'


def alert(html, bg='var(--bg)'):
    return f'<p role="alert" style="{BOX.format(bg=bg, edge="var(--warn-edge)")}">{WARN_ICON}<span style="{TXT}">{html}</span></p>'


def info(html, bg='var(--bg)'):
    return f'<p role="status" style="{BOX.format(bg=bg, edge="var(--edge)")}">{INFO_ICON}<span style="{TXT}">{html}</span></p>'


def busy(text):
    return (f'<p role="status" style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 1.4; '
            f'color: var(--text-3)">{icon("generating", 16, "flex: 0 0 auto")}{text}</p>')


# --- onay penceresi: kap, satır biçimi ve iki düğme A-Onay'ın bugünkü hâli; satırlar sözleşme §5 ----------------------------
ROOT_DIALOG = ("width: 640px; height: {h}px; box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); "
               "font-family: var(--body); display: flex; align-items: center; justify-content: center")
DIALOG = ("width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); "
          "display: flex; flex-direction: column; gap: 24px")
ROW = "display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px"
# öne çıkan satır: uzun değer (ör. "Free video · 0 credits") dar pencerede alt satıra, sağa yaslı iner
ROW_L = ("display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; padding: 16px 0; border-top: 1px solid var(--edge); "
         "font-size: 17px")
DD = "margin: 0; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere"
BTN_ROW = "display: flex; flex-wrap: wrap-reverse; gap: 12px"
CANCEL = ('flex: 1 1 160px; display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 12px; '
          'border: 1px solid var(--edge-strong); color: var(--text); font-weight: 600; font-size: 15px; text-decoration: none')
GO = ('flex: 2 1 240px; display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 12px; '
      'background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 15px; text-decoration: none')
GO_OFF = ('flex: 2 1 240px; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 52px; box-sizing: border-box; '
          'padding: 0 16px; border-radius: 12px; border: 0; background: var(--raised); color: var(--text-3); font: inherit; font-weight: 600; '
          'font-size: 15px; cursor: default')
CANCEL_OFF = ('flex: 1 1 160px; display: flex; align-items: center; justify-content: center; min-height: 52px; box-sizing: border-box; '
              'border-radius: 12px; border: 1px solid var(--edge); background: transparent; color: var(--text-3); font: inherit; font-weight: 600; '
              'font-size: 15px; cursor: default')
DISC = ('display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 44px; box-sizing: border-box; '
        'padding: 12px 0; border: 0; border-top: 1px solid var(--edge); background: transparent; color: var(--text-2); font: inherit; '
        'font-size: 15px; text-align: left; cursor: pointer')
NOTE = 'margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3); text-wrap: pretty'
SKEL = '<span aria-hidden="true" style="display: block; width: 72px; height: 12px; border-radius: 999px; background: var(--edge)"></span>'


def row(label, value, big=False, color=''):
    """Bir özet satırı. big: öne çıkan satır (17 px, kalın etiket). value None ise iskelet (değer bekleniyor)."""
    dt = 'font-weight: 600' if big else 'color: var(--text-2)'
    st = (ROW_L if big else ROW) + ('; align-items: center' if value is None else '')
    dd = (DD.replace('margin: 0;', 'margin: 0 0 0 auto;') if big else DD) + (f'; color: {color}' if color else '')
    return f'<div style="{st}"><dt style="{dt}">{label}</dt><dd style="{dd}">{SKEL if value is None else value}</dd></div>'


def summary(credits='2', balance='[BALANCE]', after='[BALANCE AFTER]', credit_color='var(--accent-text)', balance_color='',
            loading=False, opened=False):
    """Sözleşme §5 madde 2–6: final video, kredi, bakiye, süre, açılır ayrıntı. after None ise 'After this job' satırı yok."""
    v = (lambda x: None) if loading else (lambda x: x)
    rows = [row('Final video', FINAL, big=True),
            row('Credits for this job', v(credits), big=True, color=credit_color),
            row('Balance now', v(balance), color=balance_color)]
    if after is not None:
        rows.append(row('After this job', v(after)))
    rows.append(row('Estimated time', v('about 7 min')))
    turn = '; transform: rotate(180deg)' if opened else ''
    state = 'aria-expanded="true" aria-controls="onay-ayrinti"' if opened else 'aria-expanded="false"'
    detail = (f'<button type="button" {state} style="{DISC}">What we generate'
              f'{icon("expand", 20, "flex: 0 0 auto; color: var(--text-3)" + turn)}</button>')
    if opened:
        detail += f'\n<p id="onay-ayrinti" style="margin: 0; padding: 0 0 12px; font-size: 13px; line-height: 1.5; color: var(--text-3); text-wrap: pretty">{GENERATED}</p>'
    return ('<div style="display: flex; flex-direction: column; border-bottom: 1px solid var(--edge)">\n'
            '<dl style="margin: 0; display: flex; flex-direction: column">\n' + '\n'.join(rows) + '\n</dl>\n' + detail + '\n</div>')


def buttons(cancel=True, go='Confirm and generate', go_href='A-Is-Takibi.dc.html', go_on=True, go_icon=''):
    c = (f'<a href="A-Form.dc.html" style="{CANCEL}">Cancel</a>' if cancel
         else f'<button type="button" aria-disabled="true" style="{CANCEL_OFF}">Cancel</button>')
    g = (f'<a href="{go_href}" style="{GO}">{go}</a>' if go_on
         else f'<button type="button" aria-disabled="true" style="{GO_OFF}">{go_icon}{go}</button>')
    return f'<div style="{BTN_ROW}">\n{c}\n{g}\n</div>'


def dialog(ident, inner, tag='h1'):
    return f'''<div role="dialog" aria-labelledby="{ident}" style="{DIALOG}">
<div style="display: flex; flex-direction: column; gap: 8px">
<{tag} id="{ident}" style="margin: 0; {H4}">Confirm generation</{tag}>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">{SUB}</p>
</div>

{inner.strip()}
</div>'''


FOOT_P = f'<p style="{NOTE}">{FOOT}</p>'

# A-Onay: sekiz madde, ayrıntı açık. Kök sabit yükseklikte (pencere panosu): boy.py atlar, yükseklik elle (önizlemedeki icerik).
write('A-Onay.dc.html', 'Credit confirmation dialog', ROOT_DIALOG.format(h=660),
      dialog('onay-baslik', f'{summary(opened=True)}\n\n{buttons()}\n{FOOT_P}'), w=640, h=660)

# A-Onay-Yetersiz: aynı satırlar, 'After this job' yok (bakiye yetmiyor); ayrıntı kapalı.
YETERSIZ = alert(lead('You need 2 credits and have [BALANCE].', ' Nothing was charged. Your form is saved.'))
write('A-Onay-Yetersiz.dc.html', 'Credit confirmation dialog: not enough credits', ROOT_DIALOG.format(h=620),
      dialog('onay-baslik', f'''{summary(after=None, credit_color='', balance_color='var(--warn)')}

{YETERSIZ}

{buttons(go='Buy credits', go_href='A-Fiyatlar.dc.html')}'''), w=640, h=620)

# A-Onay-Durumlar: sözleşme §5 durum tablosu (yetersiz bakiye ayrı pano: A-Onay-Yetersiz).
SPIN = icon('generating', 18, 'flex: 0 0 auto')
OLD_NEW = '<s style="margin-right: 8px; font-weight: 400; color: var(--text-3)">2</s>5'
board('A-Onay-Durumlar', 'Credit confirmation: states', 'Credit confirmation · states', [
    cell('Getting the price', dialog('onay-d1', f'''{summary(loading=True)}

{busy('Getting the price…')}

{buttons(go_on=False)}
{FOOT_P}''', 'h3')),
    cell('Price changed', dialog('onay-d2', f'''{alert(lead('The price changed since you opened this.', ' It is now 5 credits, not 2. Check and confirm again.'))}

{summary(credits=OLD_NEW)}

{buttons()}
{FOOT_P}''', 'h3')),
    cell('Balance changed', dialog('onay-d3', f'''{alert(lead('Your balance changed in another tab.', ' Check and confirm again.'))}

{summary()}

{buttons()}
{FOOT_P}''', 'h3')),
    cell('Starting the job', dialog('onay-d4', f'''{summary()}

{buttons(cancel=False, go='Starting…', go_on=False, go_icon=SPIN)}
<p role="status" style="{NOTE}">Starting your job. You will not be charged twice.</p>''', 'h3')),
    cell('Free video', dialog('onay-d5', f'''{summary(credits='Free video · 0 credits', after='[BALANCE]')}

{info('This uses your one free video.')}

{buttons()}''', 'h3')),
    cell('Generation paused', dialog('onay-d6', f'''{summary()}

{alert(lead('Generation is paused for a short time.', ' Nothing was charged. Try again later.'))}

{buttons(go_on=False)}''', 'h3')),
])


# --- A-Form-Yukleme: ürün görseli alanının altı durumu (sözleşme §7.1) -------------------------------------------------------
REQ = 'JPG, PNG or WebP · up to 10 MB each · 1 to 8 images per product'
FIELDSET = ("margin: 0; min-width: 0; box-sizing: border-box; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); "
            "padding: 16px; display: flex; flex-wrap: wrap; gap: 12px 16px")
LEGEND = '<legend style="padding: 0 8px; font-size: 15px; color: var(--text-2)">Product 1</legend>'
AREA = 'display: flex; gap: 8px; min-width: 232px'
PHOTO = B + '619ee0e5a13e318118b291c1451be9b8'
THUMB = (f'<img src="{PHOTO}" alt="Uploaded product image" style="width: 72px; height: 96px; object-fit: cover; border-radius: 8px; display: block; '
         'box-shadow: 0 0 0 1px var(--media-edge)">')
PLUS = ('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">'
        '<path d="M12 5v14M5 12h14"></path></svg>')
ADD = ('<button type="button" aria-label="Add image" style="width: 72px; height: 96px; border-radius: 8px; border: 1.5px dashed var(--edge-strong); '
       f'background: transparent; color: var(--accent-text); display: flex; align-items: center; justify-content: center; cursor: pointer">{PLUS}</button>')
ACT = ('min-height: 44px; padding: 0 4px; border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 13px; font-weight: 600; '
       'text-align: left; white-space: nowrap; cursor: pointer')
SIDE = 'flex: 0 0 72px; display: flex; flex-direction: column; gap: 8px'
DROP = ('<button type="button" style="width: 232px; height: 96px; box-sizing: border-box; padding: 8px 16px; border-radius: 8px; '
        'border: 1.5px dashed var(--edge-strong); background: transparent; color: var(--text-2); font: inherit; font-size: 13px; line-height: 1.4; '
        'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; text-wrap: balance; '
        f'cursor: pointer"><span style="display: flex; color: var(--accent-text)">{PLUS}</span>Drop images here or choose files</button>')
TILE = 'position: relative; flex: 0 0 auto; width: 72px; height: 96px; border-radius: 8px; overflow: hidden; background: var(--raised)'
DIM = f'<img src="{PHOTO}" alt="" style="width: 100%; height: 100%; object-fit: cover; display: block; opacity: 0.4">'
FIELD_ERR = 'margin: 0; display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.4; color: var(--warn)'
ERR_ICON = icon('warning', 16, 'flex: 0 0 auto')


def actions(*names):
    return f'<div style="{SIDE}">\n' + '\n'.join(f'<button type="button" style="{ACT}">{n}</button>' for n in names) + '\n</div>'


def field_err(text, role=' role="alert"'):
    return f'<p{role} style="flex: 1 1 100%; min-width: 0; {FIELD_ERR}">{ERR_ICON}<span style="{TXT}">{text}</span></p>'


def fieldset(inner):
    return f'<fieldset style="{FIELDSET}">\n{LEGEND}\n{inner.strip()}\n</fieldset>'


UPLOADING = (f'<div style="{TILE}; box-shadow: 0 0 0 1px var(--media-edge)">\n{DIM}\n'
             '<span role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60" '
             'style="position: absolute; left: 4px; right: 4px; bottom: 4px; display: flex; padding: 4px; border-radius: 999px; background: var(--scrim)">'
             '<span style="flex: 60; height: 4px; border-radius: 999px; background: var(--accent)"></span>'
             '<span style="flex: 40; height: 4px"></span></span>\n</div>')
FAILED = (f'<div style="{TILE}; box-shadow: 0 0 0 1.5px var(--warn)">\n{DIM}\n'
          '<span aria-hidden="true" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 32px; height: 32px; '
          'border-radius: 50%; background: var(--scrim); color: var(--on-scrim); display: flex; align-items: center; justify-content: center">'
          f'{icon("warning", 20)}</span>\n</div>')
GENERATE_OFF = ('<button type="button" aria-disabled="true" style="min-height: 60px; padding: 0 48px; border-radius: 12px; border: 0; background: var(--raised); '
             'color: var(--text-3); font: inherit; font-size: 17px; font-weight: 600; cursor: default">Generate</button>')

board('A-Form-Yukleme', 'Generate: upload states', 'Generate form · upload states', [
    cell('Empty', f'''<p style="{NOTE}">{REQ}</p>
{fieldset(f'<div style="{AREA}">{chr(10)}{DROP}{chr(10)}</div>')}'''),
    cell('Uploading', fieldset(f'''<div style="{AREA}">
{UPLOADING}
<div style="{SIDE.replace('flex: 0 0 72px', 'flex: 0 0 auto; min-width: 72px')}; justify-content: center">
<span role="status" style="font-size: 13px; line-height: 1.4; font-weight: 600; color: var(--text-2)">Uploading… 60%</span>
</div>
{ADD}
</div>''')),
    cell('Uploaded', fieldset(f'''<div style="{AREA}">
{THUMB}
{actions('Replace', 'Remove')}
{ADD}
</div>''')),
    cell('Upload failed', fieldset(f'''<div style="{AREA}">
{FAILED}
{actions('Try again', 'Remove')}
{ADD}
</div>
{field_err('Upload failed. Check your connection.')}''')),
    cell('File not accepted', fieldset(f'''<div style="{AREA}">
{THUMB}
{actions('Replace', 'Remove')}
{ADD}
</div>
<ul role="alert" style="flex: 1 1 100%; min-width: 0; margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px">
<li style="{FIELD_ERR}">{ERR_ICON}<span style="{TXT}">photo.heic is not supported. Use JPG, PNG or WebP.</span></li>
<li style="{FIELD_ERR}">{ERR_ICON}<span style="{TXT}">{LONG} is larger than 10 MB.</span></li>
<li style="{FIELD_ERR}">{ERR_ICON}<span style="{TXT}">This file could not be read.</span></li>
<li style="{FIELD_ERR}">{ERR_ICON}<span style="{TXT}">You can add up to 8 images per product.</span></li>
</ul>''')),
    cell('While images are uploading', f'''<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; padding-top: 24px; border-top: 1px solid var(--line)">
{GENERATE_OFF}
{busy('Wait for the uploads to finish.').replace('margin: 0; display: flex', 'margin: 0; flex: 1 1 200px; display: flex')}
</div>'''),
])


# --- A-Sonuc-Varyant-Kismi: iki varyant hazır, biri durdu (sözleşme §6 madde 8); düzen A-Sonuc-Varyant ----------------------
WRAP32 = '<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px">'
PLAY = ('<button type="button" aria-label="Play the video" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 72px; '
        'height: 72px; border-radius: 50%; border: 0; background: var(--scrim); color: var(--on-scrim); display: flex; align-items: center; '
        f'justify-content: center; cursor: pointer">{icon("play", 26)}</button>')
VAR_BTN = ('padding: 0; border: 0; background: transparent; color: var(--text); font: inherit; cursor: pointer; display: flex; flex-direction: column; '
           'align-items: center; gap: 8px')
VAR_IMG = 'width: 72px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 8px; display: block; box-shadow: 0 0 0 1px var(--media-edge)'
DOWNLOAD = ('flex: 1 1 200px; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 60px; box-sizing: border-box; padding: 0 16px; '
            'border: 0; border-radius: 12px; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600; font-size: 17px; cursor: pointer')
SECOND = ('flex: 1 1 200px; display: flex; align-items: center; justify-content: center; min-height: 60px; box-sizing: border-box; padding: 0 16px; '
          'border-radius: 12px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); font: inherit; font-weight: 600; '
          'font-size: 15px; cursor: pointer')
KEPT = f'<p style="{NOTE}">Kept in My videos for 12 months. You can use this video in your ads.</p>'
QUIET = 'display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 15px; font-weight: 500; text-decoration: none'
LINKS = f'''<div style="display: flex; flex-wrap: wrap; gap: 4px 24px">
<a href="A-Karsilastir.dc.html" style="{QUIET}">Compare with the sample{icon('forward', 18)}</a>
<a href="A-Sonuc-Durumlar.dc.html" style="{QUIET.replace('font-weight: 500;', 'font-weight: 500; color: var(--text-2);')}">Report a problem</a>
</div>'''
DL_ROW = 'display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px'
FACTS = f'''<dl style="margin: 0; display: flex; flex-direction: column">
<div style="{DL_ROW}"><dt style="flex: 0 0 110px; color: var(--text-3)">Products</dt><dd style="margin: 0; flex: 1 1 240px">Aurora Body Oil, Aurora Body Mist, Aurora Hair Mist, Solace Perfume</dd></div>
<div style="{DL_ROW}; border-bottom: 1px solid var(--line)"><dt style="flex: 0 0 110px; color: var(--text-3)">Quality</dt><dd style="margin: 0; flex: 1 1 240px">Fast · 720p</dd></div>
</dl>'''

write('A-Sonuc-Varyant-Kismi.dc.html', 'Result: some variants ready', ROOT_PAGE, f'''{WRAP32}
{header_in('videos')}

<main style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: center; gap: 32px 72px">

<div style="position: relative; flex: 1 1 280px; max-width: 390px; border-radius: 16px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">
<img src="{B}f20a7ed7a7bc172a7da483415800077f" alt="Frame from variant 1" style="width: 100%; aspect-ratio: 9 / 16; object-fit: cover; display: block">
{PLAY}
</div>

<div style="flex: 1 1 380px; max-width: 520px; display: flex; flex-direction: column; gap: 32px">
<div style="display: flex; flex-direction: column; gap: 12px">
<h1 style="margin: 0; font-family: var(--display); font-weight: 800; font-size: clamp(42px, 6.4vw, 92px); line-height: 0.95; letter-spacing: -0.035em">2 variants are <span style="color: var(--accent-text)">ready.</span></h1>
<p style="margin: 0; font-size: 17px; color: var(--text-2)">{JOB} · 8 sec · 720p · mp4</p>
</div>

<div role="group" aria-label="Variants" style="display: flex; flex-wrap: wrap; gap: 16px">
<button type="button" aria-pressed="true" style="{VAR_BTN}"><img src="{B}f20a7ed7a7bc172a7da483415800077f" alt="" style="{VAR_IMG}; outline: 2px solid var(--accent-text); outline-offset: 3px"><span style="font-size: 13px; font-weight: 600; color: var(--text)">Variant 1</span></button>
<button type="button" aria-pressed="false" style="{VAR_BTN}"><img src="{B}586c7628c6d07d797378740fedc4c97f" alt="" style="{VAR_IMG}; outline: 0 solid transparent; outline-offset: 3px"><span style="font-size: 13px; font-weight: 400; color: var(--text-3)">Variant 2</span></button>
<button type="button" aria-pressed="false" style="{VAR_BTN}"><span style="width: 72px; aspect-ratio: 9 / 16; box-sizing: border-box; border-radius: 8px; border: 1.5px dashed var(--warn); color: var(--warn); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-size: 13px; font-weight: 600">{icon('warning', 20)}Stopped</span><span style="font-size: 13px; font-weight: 400; color: var(--text-3)">Variant 3</span></button>
</div>

<div style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<button type="button" style="{DOWNLOAD}">{icon('download', 20)}Download variant 1</button>
<button type="button" style="{SECOND}">Download both</button>
</div>
{KEPT}
</div>

<section aria-labelledby="durdu-baslik" style="box-sizing: border-box; padding: clamp(16px, 2vw, 24px); border-radius: 16px; background: var(--surface); border: 1px solid var(--warn-edge); display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 16px">
<h2 id="durdu-baslik" style="margin: 0; {H6}">Variant 3</h2>
{status('stopped', 'Stopped')}
</div>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">This variant could not be generated. Its 2 credits are back in your balance.</p>
<a href="A-Onay.dc.html" style="min-height: 72px; box-sizing: border-box; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--edge-strong); color: var(--text); text-decoration: none; display: flex; flex-direction: column; justify-content: center; gap: 4px"><span style="font-size: 15px; font-weight: 600">Generate the missing variant again</span><span style="font-size: 13px; color: var(--text-3)">2 credits</span></a>
</section>

{FACTS}

{LINKS}
</div>

</main>
</div>''')


# --- A-Sonuc-Durumlar: indirme, oynatma, saklama ve sorun bildirme (sözleşme §10) -------------------------------------------
FRAME = 'width: 100%; max-width: 270px; border-radius: 16px'   # video karesi: telefondaki ölçüsü (A-Sonuc-M)
NEW_VARIANT = (f'<a href="A-Form.dc.html" style="flex: 1 1 200px; display: flex; align-items: center; justify-content: center; min-height: 60px; '
               'border-radius: 12px; border: 1px solid var(--edge-strong); color: var(--text); font-weight: 600; font-size: 15px; text-decoration: none">'
               'Generate a new variant</a>')
RADIO = 'appearance: none; -webkit-appearance: none; flex: 0 0 auto; width: 20px; height: 20px; box-sizing: border-box; margin: 0; border-radius: 50%; background: transparent'
OPTION = ('display: flex; align-items: center; gap: 12px; min-height: 52px; box-sizing: border-box; padding: 0 16px; border-radius: 12px; '
          'background: var(--bg); font-size: 15px; cursor: pointer')


def option(text, on=False):
    edge = '1.5px solid var(--accent-text)' if on else '1px solid var(--edge-strong)'
    dot = '6px solid var(--accent-text)' if on else '1.5px solid var(--edge-strong)'
    return (f'<label style="{OPTION}; border: {edge}"><input type="radio" name="sorun"{" checked" if on else ""} '
            f'style="{RADIO}; border: {dot}">{text}</label>')


REPORT = f'''<div role="dialog" aria-labelledby="sorun-baslik" style="{DIALOG}">
<div style="display: flex; flex-direction: column; gap: 8px">
<h3 id="sorun-baslik" style="margin: 0; {H4}">Report a problem</h3>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">{JOB} · 8 sec · 720p</p>
</div>
<div role="radiogroup" aria-labelledby="sorun-baslik" style="display: flex; flex-direction: column; gap: 8px">
{option('The product looks different', True)}
{option('Text is wrong or cut off')}
{option('The video does not play')}
{option('Something else')}
</div>
<label style="display: flex; flex-direction: column; gap: 8px; font-size: 15px; color: var(--text-2)">Add a note (optional)
<textarea rows="3" placeholder="What happened, and what did you expect?" style="box-sizing: border-box; min-height: 96px; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--edge-strong); background: var(--bg); color: var(--text); font: inherit; font-size: 15px; line-height: 1.5; resize: vertical"></textarea>
</label>
<div style="{BTN_ROW}">
<a href="A-Sonuc.dc.html" style="{CANCEL}">Cancel</a>
<button type="button" style="{GO}; border: 0; font: inherit; font-weight: 600; font-size: 15px; cursor: pointer">Send report</button>
</div>
<p style="{NOTE}">The job ID is added automatically. You can report a problem within 7 days.</p>
</div>'''

# varyant başına durum (sözleşme §6 durum tablosu, son satır): etiket karonun üstünde, galeri kartındaki scrim etiketi (parts.TAG)
V_TILE = 'position: relative; aspect-ratio: 9 / 16; box-sizing: border-box; border-radius: 12px; overflow: hidden'
V_IMG = 'width: 100%; height: 100%; object-fit: cover; display: block'
V_SPIN = ('<span aria-hidden="true" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 32px; height: 32px; '
          'border-radius: 50%; background: var(--scrim); color: var(--on-scrim); display: flex; align-items: center; justify-content: center">'
          f'{icon("generating", 20)}</span>')


def variant(n, state, tile, inner=''):
    return (f'<li style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 8px">\n<div style="{V_TILE}; {tile}">\n'
            + (inner + '\n' if inner else '') + f'<span style="position: absolute; top: 8px; left: 8px; {TAG}">{state}</span>\n</div>\n'
            f'<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">Variant {n}</span>\n</li>')


VARIANTS = '<ul aria-label="Variants" style="margin: 0; padding: 0; list-style: none; display: flex; gap: 16px">\n' + '\n'.join([
    variant(1, 'Done', 'background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)',
            f'<img src="{B}f20a7ed7a7bc172a7da483415800077f" alt="Frame from variant 1" style="{V_IMG}">'),
    variant(2, 'Generating', 'background: var(--raised); box-shadow: 0 0 0 1px var(--media-edge)',
            f'<img src="{B}586c7628c6d07d797378740fedc4c97f" alt="" style="{V_IMG}; opacity: 0.4">\n{V_SPIN}'),
    variant(3, 'Waiting', 'background: var(--surface); border: 1.5px dashed var(--edge-strong)'),
]) + '\n</ul>'

board('A-Sonuc-Durumlar', 'Result: states', 'Result · states', [
    cell('Variant states', VARIANTS),
    cell('Preparing the download', f'''<div style="display: flex; flex-wrap: wrap; gap: 12px">
<button type="button" aria-busy="true" aria-disabled="true" style="{DOWNLOAD.replace('background: var(--accent); color: var(--on-accent)', 'background: var(--raised); color: var(--text-3)').replace('cursor: pointer', 'white-space: nowrap; cursor: default')}">{icon('generating', 20)}Preparing your file…</button>
{NEW_VARIANT}
</div>'''),
    cell('Download did not start', f'''<div style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<button type="button" style="{DOWNLOAD}">{icon('download', 20)}Download</button>
{NEW_VARIANT}
</div>
<div role="alert" style="{BOX.format(bg='var(--surface)', edge='var(--warn-edge)')}">{WARN_ICON}
<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px">
<span style="{TXT}">{lead('The download did not start.', ' Try again.')}</span>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px">
<button type="button" style="display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer">{icon('retry', 18)}Try again</button>
<a href="A-Iletisim.dc.html" style="{QUIET}">Contact support</a>
</div>
</div>
</div>
</div>'''),
    cell('Video cannot be played', f'''<div style="position: relative; {FRAME}; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">
<img src="{B}f20a7ed7a7bc172a7da483415800077f" alt="Frame from the generated video" style="width: 100%; aspect-ratio: 9 / 16; object-fit: cover; display: block">
<div role="alert" style="position: absolute; left: 0; top: 0; right: 0; bottom: 0; box-sizing: border-box; padding: 16px; background: var(--scrim); color: var(--on-scrim); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center">
{icon('warning', 24)}
<p style="margin: 0; font-size: 15px; line-height: 1.5; text-wrap: balance">This video cannot be played here. Download it instead.</p>
<button type="button" style="display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 52px; box-sizing: border-box; padding: 0 24px; border-radius: 12px; border: 1px solid var(--on-scrim); background: transparent; color: var(--on-scrim); font: inherit; font-weight: 600; font-size: 15px; cursor: pointer">{icon('download', 18)}Download</button>
</div>
</div>'''),
    cell('Video no longer stored', f'''<div style="{FRAME}; aspect-ratio: 9 / 16; box-sizing: border-box; padding: 16px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; text-align: center">
<span aria-hidden="true" style="width: 48px; height: 48px; border-radius: 50%; background: var(--raised); color: var(--text-3); display: flex; align-items: center; justify-content: center">{icon('duration', 24)}</span>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2); text-wrap: balance">This video is no longer stored. Videos are kept for 12 months.</p>
<a href="A-Form.dc.html" style="{SECONDARY}">Generate it again</a>
</div>'''),
    cell('Report a problem', REPORT),
    cell('Problem reported', f'''<div role="dialog" aria-label="Problem reported" style="{DIALOG}">
{status('done', 'Reported')}
<p style="margin: 0; font-size: 17px; line-height: 1.5; color: var(--text); text-wrap: pretty">Thanks. We look at it within 2 business days. If the video is wrong, we generate it again at no cost.</p>
<a href="A-Sonuc.dc.html" style="{SECONDARY}">Close</a>
</div>'''),
])
