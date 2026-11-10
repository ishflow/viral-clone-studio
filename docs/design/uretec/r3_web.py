"""İnceleme turu, grup R3: yeni web panoları.
  A-Galeri-Hata          sayfa (Main düzeni): galeri yüklenemedi. "Yüklenemedi, yeniden dene" kalıbının kaynağı (KURALLAR §11).
  A-Video-Ekle-Durumlar  durum panosu: kendi videosunu ekleme kartının altı hâli (sözleşme §4, §7.2).
Yeniden çalıştırılabilir: iki panoyu baştan yazar. Sonra: python3 boy.py <adlar> && python3 variants.py <adlar>.
Başlık bölümü ve süzgeçler Main.dc.html'den, ekleme kartı A-Video-Ekle.dc.html'den okunur; böylece ikisi birebir aynı kalır."""
from parts import *


def src(name):
    return open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read()


def one(pattern, s):
    m = re.search(pattern, s, re.S)
    assert m, pattern
    return m.group(1)


def sub1(s, old, new):
    assert s.count(old) == 1, (s.count(old), old[:80])
    return s.replace(old, new)


# =====================================================================================================================
# A-Galeri-Hata: Main'in üst menüsü, başlığı ve süzgeçleri; ızgaranın yerinde "yüklenemedi" bloğu
# =====================================================================================================================
main = src('Main')
HERO = one(r'</header>\s*(<section style="display: flex; flex-wrap: wrap; align-items: flex-end.*?</section>)', main)
FILTERS = one(r'(<section aria-label="Filters".*?</section>)', main)

# Kalıp: ikon + 20 px başlık + 15 px açıklama + kenarlı "Try again". Kesik kenar yok (kesik kenar = "buraya bir şey gelir").
LOAD_FAIL = ("box-sizing: border-box; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); "
             "padding: clamp(48px, 5vw, 72px) clamp(16px, 4vw, 24px); display: flex; flex-direction: column; align-items: center; "
             "gap: 24px; text-align: center")
FAIL_ICON = ('<span aria-hidden="true" style="width: 48px; height: 48px; border-radius: 50%; background: var(--raised); color: var(--warn); '
             f'display: flex; align-items: center; justify-content: center">{icon("warning", 24)}</span>')


def load_fail(title, text, tag='h2'):
    return f'''<div role="alert" style="{LOAD_FAIL}">
{FAIL_ICON}
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
<{tag} style="margin: 0; {H6}">{title}</{tag}>
<p style="margin: 0; max-width: 520px; {BODY2}">{text}</p>
</div>
<button type="button" style="{SECONDARY}; gap: 8px">{icon('retry', 18)}Try again</button>
</div>'''


body = f'''<div style="{WRAP}">

{header_in('gallery')}

{HERO}

{FILTERS}

<section aria-label="Templates" style="display: flex; flex-direction: column">
{load_fail('Could not load the gallery.', 'Check your connection and try again. Your videos and credits are not affected.')}
</section>

</div>'''
write('A-Galeri-Hata.dc.html', 'Gallery: could not load', ROOT_PAGE, body)

# =====================================================================================================================
# A-Video-Ekle-Durumlar: ekleme kartının altı hâli
# =====================================================================================================================
ekle = src('A-Video-Ekle')
ZONE_ICON = one(r'(<span style="width: 48px; height: 48px; border-radius: 50%; background: var\(--raised\);[^>]*>.*?</svg></span>)', ekle)
REQ = 'mp4 or mov · up to 60 sec · up to 100 MB · vertical (9:16)'
assert REQ in ekle
LONG = 'a-very-long-reference-video-name-final-v2.mov'   # uzun dosya adı: taşmaz, üç noktayla kesilir ya da satıra iner

BOARD = "max-width: 1320px; margin: 0 auto; padding-top: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 32px"
CELL = "flex: 1 1 400px; min-width: 0; max-width: 520px; display: flex; flex-direction: column; gap: 12px"
# ekleme kartı (A-Video-Ekle ile aynı; iç boşluk akışkan: telefonda 24 / 16)
ZONE = ("box-sizing: border-box; padding: clamp(24px, 5vw, 32px) clamp(16px, 4vw, 24px); border: 1.5px dashed var(--edge-strong); border-radius: 16px; "
        "display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center")
# uyarı kutusu (A-Form-Hata ile aynı)
WARN_BOX = ("margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--surface); "
            "border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text)")
WARN_ICON = icon('warning', 20, 'flex: 0 0 auto; color: var(--warn)')
# pencere (A-Onay ile aynı çerçeve, satır ve düğmeler; düğme tabanları 160 / 240 yerine 120 / 200: hücrede yan yana sığar,
# telefonda A-Onay-M gibi alt alta iner)
DIALOG = ("width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); "
          "display: flex; flex-direction: column; gap: 24px")
ROW = "display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px"
DT = "color: var(--text-2)"
DD = "margin: 0; min-width: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere"
BTN_ROW = "display: flex; flex-wrap: wrap-reverse; gap: 12px"
CANCEL = ('flex: 1 1 120px; display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 12px; '
          'border: 1px solid var(--edge-strong); color: var(--text); font-weight: 600; font-size: 15px; text-decoration: none')
GO = ('flex: 2 1 200px; display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 12px; '
      'background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 15px; text-decoration: none')
DISABLED = ("min-height: 52px; padding: 0 24px; border-radius: 12px; border: 0; background: var(--raised); color: var(--text-3); "
            "font: inherit; font-size: 15px; font-weight: 600")
CHOOSE = ("min-height: 52px; padding: 0 24px; border-radius: 12px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); "
          "font: inherit; font-size: 15px; font-weight: 600; cursor: pointer")


def cell(label, inner):
    return f'<section style="{CELL}">\n<h2 style="margin: 0; font-weight: 400; {SMALL}">{label}</h2>\n{inner.strip()}\n</section>'


def rows(*pairs, last=True):
    out = []
    for i, (k, v) in enumerate(pairs):
        st = ROW + ('; border-bottom: 1px solid var(--edge)' if last and i == len(pairs) - 1 else '')
        out.append(f'<div style="{st}"><dt style="{DT}">{k}</dt><dd style="{DD}">{v}</dd></div>')
    return '<dl style="margin: 0; display: flex; flex-direction: column">\n' + '\n'.join(out) + '\n</dl>'


def dialog(ident, inner):
    return f'''<div role="dialog" aria-labelledby="{ident}" style="{DIALOG}">
<div style="display: flex; flex-direction: column; gap: 8px">
<h3 id="{ident}" style="margin: 0; {H4}">Prepare this template</h3>
<p style="margin: 0; font-size: 17px; line-height: 1.5; color: var(--text)">Preparing this template costs 1 credit.</p>
</div>
{inner.strip()}
</div>'''


def zone(button, off=False):
    """Ekleme kartı. off: günlük sınır dolmuş; başlık ve ikon soluk, düğme kapalı."""
    mark = sub1(ZONE_ICON, 'stroke: var(--accent-text)', 'stroke: var(--text-3)') if off else ZONE_ICON
    tone = '; color: var(--text-3)' if off else ''
    return f'''<div style="{ZONE}">
{mark}
<span style="{H5}{tone}">Drop the file here</span>
<span style="{SMALL}">{REQ}</span>
{button}
</div>'''


FOUND = [('Length', '12 sec'), ('Shots', '5'), ('Format', 'No talking')]   # A-Detay-Ozel'deki örnek şablon

checking = cell('Checking the file', f'''
<div style="{CARD}; display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; align-items: center; gap: 12px; min-width: 0">
<span aria-hidden="true" style="flex: 0 0 auto; width: 48px; height: 48px; border-radius: 50%; background: var(--raised); color: var(--accent-text); display: flex; align-items: center; justify-content: center">{icon('template', 24)}</span>
<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px">
<span style="font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">{LONG}</span>
<span role="status" style="{SMALL}">Uploading… 60%</span>
</div>
</div>
<span role="progressbar" aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60" style="height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; display: flex"><span style="width: 60%; background: var(--accent-text); border-radius: 999px"></span></span>
<p style="margin: 0; {SMALL}">We check the type, size, length and ratio first. Nothing is charged for this check.</p>
</div>''')

confirm = cell('Confirm before preparing', dialog('hazirla-onay', f'''
{rows(*FOUND, ('Balance now', '[BALANCE]'), ('Balance after', '[BALANCE AFTER]'))}
<div style="{BTN_ROW}">
<a href="A-Video-Ekle.dc.html" style="{CANCEL}">Cancel</a>
<a href="A-Video-Ekle.dc.html" style="{GO}">Prepare template</a>
</div>
<p style="margin: 0; {SMALL}">You are charged when you confirm. If the template cannot be prepared, the credit comes back.</p>'''))

short = cell('Not enough credits', dialog('hazirla-yetersiz', f'''
{rows(*FOUND, ('Balance now', '[BALANCE]'))}
<p role="alert" style="{WARN_BOX.replace('background: var(--surface)', 'background: var(--bg)')}">{WARN_ICON}<span>You need 1 credit.</span></p>
<div style="{BTN_ROW}">
<a href="A-Video-Ekle.dc.html" style="{CANCEL}">Cancel</a>
<a href="A-Fiyatlar.dc.html" style="{GO}">Buy credits</a>
</div>'''))

rejected = cell('File cannot be used', f'''
<div style="display: flex; flex-direction: column; gap: 16px">
<p role="alert" style="{WARN_BOX}">{WARN_ICON}<span style="min-width: 0"><span style="display: block; {SMALL}; overflow-wrap: anywhere">{LONG}</span><strong style="font-weight: 600; color: var(--warn)">This video is longer than 60 seconds.</strong> Trim it and try again. Nothing was charged.</span></p>
{zone(f'<button type="button" style="{CHOOSE}">Choose a file</button>')}
<p style="margin: 0; {SMALL}; text-wrap: pretty">Each reason has its own message: file type, size, length, ratio, unreadable file, link not found, private video, removed video, unsupported site.</p>
</div>''')

failed = cell('Template could not be prepared', f'''
<article style="box-sizing: border-box; padding: 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--warn-edge); display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; justify-content: space-between; gap: 12px; align-items: baseline">
<h3 style="margin: 0; min-width: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere">[VIDEO NAME]</h3>
<span style="flex: 0 0 auto; font-size: 15px; font-weight: 600; color: var(--warn)">Not prepared</span>
</div>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">We could not prepare this template. Your credit was returned.</p>
<button type="button" style="align-self: flex-start; {SECONDARY}; gap: 8px">{icon('retry', 18)}Try again</button>
</article>''')

limit = cell('Daily limit reached', f'''
<div style="display: flex; flex-direction: column; gap: 16px">
<p role="status" style="{WARN_BOX}">{WARN_ICON}<span>You reached today's limit for your own videos. Try again tomorrow.</span></p>
{zone(f'<button type="button" aria-disabled="true" style="{DISABLED}">Choose a file</button>', off=True)}
</div>''')

body = f'''<div style="{BOARD}">
<h1 style="margin: 0; {H4}">Add your own video · states</h1>
<div style="display: flex; flex-wrap: wrap; gap: 32px">

{checking}

{rejected}

{limit}

{confirm}

{short}

{failed}

</div>
</div>'''
write('A-Video-Ekle-Durumlar.dc.html', 'Add your own video: states', ROOT_PAGE, body)
