"""İnceleme turu, grup R5 (iş ve videolarım): yeni panolar. Metinler docs/specs/2026-10-04-flow-contract.md §6, §3, §10.
  A-Is-Kuyrukta           sayfa (A-Is-Takibi düzeni): iş kuyrukta, adımların hepsi "waiting"
  A-Is-Durumlar           durum panosu: iş sayfasının üst şeridi (beklenenden uzun, yeniden bağlanıyor, üretim duraklatıldı)
                          + durma kartının iki hâli (içerik kuralı, ücretsiz video)
  A-Is-Durdu-Onay         pencere (A-Onay kabı): devam onayı (§6 madde 5); "mode" tweak'i: backup (varsayılan) / again
  A-Is-Kapat-Onay         pencere (aynı kap): "Stop the job here" onayı
  A-Is-Kapatildi          sayfa: kapatılan iş
  A-Uretimlerim-Durumlar  durum panosu: liste satırının hâlleri + "yüklenemedi" bloğu + hak kullanılmış boş hâl
Yeniden çalıştırılabilir: altı panoyu baştan yazar. Sonra: python3 boy.py <adlar> && python3 variants.py <adlar>
(A-Is-Durdu-Onay ve A-Is-Kapat-Onay kökü sabit yükseklikte: boy.py atlar, yükseklik aşağıda ONAY_H, KAPAT_H).
Üst menü, başlık, adım satırı A-Is-Durdu'dan; liste satırı A-Uretimlerim'den; boş hâl A-Uretimlerim-Bos'tan okunur: birebir aynı kalır."""
from parts import *


def src(name):
    return open(os.path.join(P, name + '.dc.html'), encoding='utf-8').read()


def one(pattern, s):
    m = re.search(pattern, s, re.S)
    assert m, pattern
    return m.group(1)


durdu, liste, bos = src('A-Is-Durdu'), src('A-Uretimlerim'), src('A-Uretimlerim-Bos')
HEAD = one(r'(<header.*?</header>)', durdu)
PAGE = '<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 32px">'
H1 = one(r'(<h1 style="[^"]*">Fragrance layering recipe</h1>)', durdu)
META = '<p style="margin: 0; font-size: 15px; color: var(--text-2)">4 products · Fast · 1 variant</p>'
MAIN = '<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px 48px">'
OL = one(r'(<ol aria-label="Stages"[^>]*>)', durdu)
LI = one(r'<sc-for list="\{\{ stages \}\}"[^>]*>\n(<li.*?</li>)\n</sc-for>', durdu)
STAGES = re.findall(r"st\('(\d)', '([^']*)', '([^']*)'", durdu)
assert PAGE in durdu and META in durdu and MAIN in durdu and len(STAGES) == 6

# durum panosu iskeleti (KURALLAR §11; R1 ve R3 ile aynı ölçüler)
BOARD = "max-width: 1320px; margin: 0 auto; padding-top: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 32px"
CELL = "flex: 1 1 400px; min-width: 0; max-width: 520px; display: flex; flex-direction: column; gap: 12px"
# uyarı kutusu (A-Form-Hata / A-Onay-Yetersiz ile aynı); bilgi kutusu aynı kutunun nötr kenarlı hâli
WARN_BOX = ("margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--surface); "
            "border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text)")
INFO_BOX = WARN_BOX.replace('var(--warn-edge)', 'var(--edge)')
MARK = 'flex: 0 0 auto; color: '
# satır (A-Onay ile aynı biçim); değer tek satır kalır, uzun etiket kendi içinde alt satıra iner
ROW = "display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px"
DD = "margin: 0; font-weight: 600; text-align: right; white-space: nowrap"


def cell(label, inner):
    return f'<div style="{CELL}">\n<p style="margin: 0; {SMALL}">{label}</p>\n{inner}\n</div>'


def kv(k, v, row=ROW, dt='color: var(--text-2)', dd=DD):
    return f'<div style="{row}"><dt style="{dt}">{k}</dt><dd style="{dd}">{v}</dd></div>'


def status5(kind, label):
    """parts.status ile aynı satır. Kuyruk ve kapalı için nötr işaret: içi boş daire / içi boş kare (renk tek başına taşımaz)."""
    if kind not in ('queue', 'closed'):
        return status(kind, label)
    rad = '50%' if kind == 'queue' else '2px'
    mark = f'<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: {rad}; border: 2px solid var(--text-2)"></span>'
    return f'<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">{mark}{label}</span>'


def title(st):
    return f'<section style="display: flex; flex-direction: column; gap: 12px">\n{st}\n{H1}\n{META}\n</section>'


# =====================================================================================================================
# A-Is-Kuyrukta: A-Is-Takibi düzeni; adımların hepsi bekliyor, sağda kuyruk kartı
# =====================================================================================================================
WAIT = dict(rad='50%', bg='transparent', fg='var(--text-3)', bs='dashed', bd='var(--edge-strong)', title='var(--text-3)', stateColor='var(--text-3)')


def stage(no, name, note):
    s = re.sub(r'<sc-if value="\{\{ s\.isDone \}\}".*?</sc-if>', '', LI, flags=re.S)
    s = re.sub(r'<sc-if value="\{\{ s\.notDone \}\}"[^>]*>(.*?)</sc-if>', r'\1', s, flags=re.S)
    k = dict(WAIT, no=no, name=name, note=note, state='waiting')
    return re.sub(r'\{\{ s\.(\w+) \}\}', lambda m: k[m.group(1)], s)


body = f'''{PAGE}

{HEAD}

{title(status5('queue', 'In queue'))}

{MAIN}

{OL}
{chr(10).join(stage(*s) for s in STAGES)}
</ol>

<section aria-label="Queue" style="flex: 1 1 480px; min-width: 0; box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 12px">
<h2 style="margin: 0; {H4}">Position 2</h2>
<p style="margin: 0; {LEAD}">In queue. Your job starts when the one before it is done.</p>
<p style="margin: 0; {SMALL}">Nothing more to do; you can leave this page.</p>
</section>

</main>
</div>'''
write('A-Is-Kuyrukta.dc.html', 'Job progress: in queue', ROOT_PAGE, body)

# =====================================================================================================================
# A-Is-Durumlar: iş sayfasının üst şeridi (durum + başlık + ileti); ileti başlık bölümünün altında, adımların üstünde durur
# =====================================================================================================================


def strip(st, block, time=''):
    head = f'<div style="display: flex; flex-direction: column; gap: 12px">\n{st}\n<h2 style="margin: 0; {H4}">Fragrance layering recipe</h2>\n{META}\n</div>'
    if time:
        head = f'<div style="display: flex; flex-direction: column; gap: 16px">\n{head}\n{time}\n</div>'
    return f'<div style="display: flex; flex-direction: column; gap: 24px">\n{head}\n{block}\n</div>'


def notice(box, ic, color, text, role='status'):
    return f'<p role="{role}" style="{box}">{icon(ic, 20, MARK + color)}<span>{text}</span></p>'


# Süre satırı A-Is-Takibi'ndeki ile aynı (etiket + büyük değer); hücre dar olduğu için değer telefondaki boyda (24).
# Beklenenden uzun sürünce kalan süre gösterilmez: "about N min left" yerine "Taking longer than usual".
TIME_LABEL = '<span style="font-size: 13px; color: var(--text-3)">Estimated time</span>'
TIME_VALUE = 'font-family: var(--display); font-weight: 700; font-size: 32px; color: var(--text)'
takibi = src('A-Is-Takibi')
assert TIME_LABEL in takibi and TIME_VALUE in takibi
late = f'''<div style="display: flex; flex-direction: column; gap: 4px">
{TIME_LABEL}
<p style="margin: 0; font-size: 15px; color: var(--text-2)"><strong style="{TIME_VALUE.replace('32px', '24px')}">Taking longer than usual</strong></p>
</div>'''

# Durma kartı A-Is-Durdu'daki ile aynı (kenar, başlık, açıklama); başlık = sözleşme metninin ilk cümlesi.
STOP_CARD = ("box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--warn-edge); "
             "display: flex; flex-direction: column; gap: 24px")
STOP_H = "margin: 0; font-family: var(--display); font-weight: 700; font-size: 24px; letter-spacing: -0.01em"
STOP_P = "margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)"
assert STOP_CARD in durdu and STOP_H in durdu and STOP_P in durdu


def stop_card(head, text, action=''):
    return f'''<section aria-label="What happened" style="{STOP_CARD}">
<div style="display: flex; flex-direction: column; gap: 8px">
<h3 style="{STOP_H}">{head}</h3>
<p style="{STOP_P}">{text}</p>
</div>{action}
</section>'''


STOPPED = status('stopped', 'Stopped')
cells = [
    cell('Taking longer than usual', strip(status('running', 'Running'), notice(INFO_BOX, 'duration', 'var(--text-2)',
         'This is taking longer than usual. Your job is still running; you do not need to start it again.'), late)),
    cell('Reconnecting', strip(status('running', 'Running'), notice(INFO_BOX, 'generating', 'var(--text-2)',
         'Reconnecting… Your job keeps running while this page reconnects.'))),
    cell('Generation paused', strip(status('running', 'Running'), notice(WARN_BOX, 'warning', 'var(--warn)',
         'Generation is paused for a short time. Your job continues when it is back. Nothing extra is charged.', 'alert'))),
    # devam seçeneği yok: tek eylem destek
    cell('Stopped · content rule', strip(STOPPED, stop_card(
        'This job was stopped because the images or text break our content rules',
        'Your 2 credits are back in your balance. This job cannot be continued.',
        f'\n<a href="A-Iletisim.dc.html" style="{SECONDARY}; align-self: flex-start">Contact support</a>'))),
    # ücretsiz videoyla başlamış iş: kredi satırları yok; seçenekler A-Is-Durdu'daki gibi (burada yalnız ileti)
    cell('Stopped · free video', strip(STOPPED, stop_card(
        'Two clips could not be generated', 'Your free video is back. The finished parts are saved.'))),
]
body = f'''<div style="{BOARD}">
<h1 style="margin: 0; {H4}">Job progress · states</h1>
<div style="display: flex; flex-wrap: wrap; gap: 32px">
{chr(10).join(cells)}
</div>
</div>'''
write('A-Is-Durumlar.dc.html', 'Job progress: states', ROOT_PAGE, body)

# =====================================================================================================================
# A-Is-Durdu-Onay: A-Onay'ın kabı (çerçeve, satır, iki düğme; yama_g2b.SHEET aynı metni arar), satırlar sözleşme §6 madde 5
# =====================================================================================================================
ONAY_H = 560
ONAY_ROOT = (f"width: 640px; height: {ONAY_H}px; box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); "
             "font-family: var(--body); display: flex; align-items: center; justify-content: center")
DIALOG = ('<div role="dialog" aria-labelledby="onay-baslik" style="width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; '
          'background: var(--surface); border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">')
BTN_NO = ("flex: 1 1 160px; display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 12px; "
          "border: 1px solid var(--edge-strong); color: var(--text); font-weight: 600; font-size: 15px; text-decoration: none")
BTN_OK = ("flex: 2 1 240px; display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 12px; "
          "background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 15px; text-decoration: none")
onay = src('A-Onay')
if DIALOG not in onay or ROW not in onay:  # kap 2026-10-04'teki A-Onay'dan alındı; R4 değiştirdiyse elle eşitle
    print('UYARI: A-Onay kabı değişmiş; A-Is-Durdu-Onay eski kapla yazıldı (DIALOG / ROW sabitlerine bak)')
BIG = ROW.replace('padding: 12px 0', 'padding: 16px 0 12px').replace('font-size: 15px', 'font-size: 17px')
LAST = ROW.replace('padding: 12px 0', 'padding: 0 0 12px').replace('border-top: 1px solid var(--edge)', 'border-bottom: 1px solid var(--edge)')
body = f'''{DIALOG}
<div style="display: flex; flex-direction: column; gap: 8px">
<h1 id="onay-baslik" style="margin: 0; {H4}">{{{{ heading }}}}</h1>
<p style="margin: 0; font-size: 15px; color: var(--text-2)">Fragrance layering recipe · Fast · 1 variant</p>
</div>

<dl style="margin: 0; display: flex; flex-direction: column">
{kv('Missing', '2 clips')}
{kv('Credits returned when it stopped', '2 credits')}
{kv('Continuing costs', '2 credits', BIG, 'font-weight: 600', DD + '; color: var(--accent-text)')}
{kv('Balance after', '[BALANCE AFTER] credits', LAST)}
</dl>

<p style="{INFO_BOX.replace('var(--surface)', 'var(--bg)')}">{icon('info', 20, MARK + 'var(--text-2)')}<span>{{{{ note }}}}</span></p>

<div style="display: flex; flex-wrap: wrap-reverse; gap: 12px">
<a href="A-Is-Durdu.dc.html" style="{BTN_NO}">Cancel</a>
<a href="A-Is-Takibi.dc.html" style="{BTN_OK}">Confirm and continue</a>
</div>
<p style="margin: 0; {SMALL}">You never pay more than the price you first confirmed.</p>
</div>'''
# mode: backup = "Continue with the backup model" (varsayılan), again = "Try again"; satırlar ve düğmeler iki hâlde aynı
AGAIN = "(this.props.mode ?? 'backup') === 'again'"
vals = (f", heading: {AGAIN} ? 'Try again' : 'Continue with the backup model'"
        f", note: {AGAIN} ? 'The same model generates the 2 missing clips again.' : 'Same price. The look may differ slightly.'")
write('A-Is-Durdu-Onay.dc.html', 'Job stopped: confirm to continue', ONAY_ROOT, body, vals=vals,
      props={'mode': {'editor': 'enum', 'options': ['backup', 'again'], 'default': 'backup'}}, w=640, h=ONAY_H)

# =====================================================================================================================
# A-Is-Kapat-Onay: "Stop the job here" onayı; aynı kap, iki düğme (sözleşme §6)
# =====================================================================================================================
KAPAT_H = 280
body = f'''{DIALOG}
<div style="display: flex; flex-direction: column; gap: 8px">
<h1 id="onay-baslik" style="margin: 0; {H4}">Close this job?</h1>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">The saved parts are deleted. You can start it again from the template at the same price.</p>
</div>

<div style="display: flex; flex-wrap: wrap-reverse; gap: 12px">
<a href="A-Is-Durdu.dc.html" style="{BTN_NO}">Keep it</a>
<a href="A-Is-Kapatildi.dc.html" style="{BTN_OK}">Close the job</a>
</div>
</div>'''
write('A-Is-Kapat-Onay.dc.html', 'Job stopped: confirm to close', ONAY_ROOT.replace(f'height: {ONAY_H}px', f'height: {KAPAT_H}px'), body, w=640, h=KAPAT_H)

# =====================================================================================================================
# A-Is-Kapatildi: iş kapatıldı; kredi özeti ve tek ikincil düğme
# =====================================================================================================================
body = f'''{PAGE}

{HEAD}

{title(status5('closed', 'Closed'))}

{MAIN}
<section aria-label="Job closed" style="flex: 1 1 480px; min-width: 0; max-width: 640px; box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 8px">
<h2 style="margin: 0; font-family: var(--display); font-weight: 700; font-size: 24px; letter-spacing: -0.01em">Job closed</h2>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">2 credits were returned. Nothing else was charged.</p>
</div>
<dl style="margin: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--edge)">
{kv('Charged when you confirmed', '2 credits')}
{kv('Returned when it stopped', '2 credits')}
{kv('Balance now', '[BALANCE] credits')}
</dl>
<p style="margin: 0; {SMALL}">The saved parts of this video were deleted.</p>
<a href="Main.dc.html" style="{SECONDARY}; align-self: flex-start">Pick another template</a>
</section>
</main>
</div>'''
write('A-Is-Kapatildi.dc.html', 'Job stopped: closed', ROOT_PAGE, body)

# =====================================================================================================================
# A-Uretimlerim-Durumlar: liste satırı beş hâlde + liste yüklenemedi + hak kullanılmış boş hâl
# =====================================================================================================================
ART = '<article style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; padding: 16px 0; border-top: 1px solid var(--line)">'
IMG = 'flex: 0 0 72px; width: 72px; height: 128px; object-fit: cover; border-radius: 12px; display: block; box-shadow: 0 0 0 1px var(--media-edge)'
MID = '<div style="flex: 9999 1 160px; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px">'
COL1 = '<div style="flex: 9999 1 280px; min-width: 0; display: flex; flex-direction: column; gap: 4px">'
COL2 = '<div style="flex: 1 1 320px; min-width: 0; display: flex; flex-direction: column; gap: 4px">'
ROW_H2 = '<h2 style="margin: 0; font-size: 20px; font-weight: 600; line-height: 1.25; text-wrap: pretty">'
ROW_P = '<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-3)">'
ROW_BTN = ('flex: 1 1 160px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; min-height: 52px; padding: 0 24px; '
           'border-radius: 12px; font-weight: 600; font-size: 15px; text-decoration: none; border: 1px solid var(--edge-strong); background: transparent; color: var(--text)')
for piece in (ART, IMG, MID, COL1, COL2, ROW_H2, ROW_P, ROW_BTN):
    assert piece in liste, piece[:60]
PRODUCT = '4 products: Aurora Body Oil, Body Mist, Hair Mist, Solace Perfume'
assert PRODUCT in liste
SHOT = B + '619ee0e5a13e318118b291c1451be9b8'


def dot(color, rad='50%'):
    return f'<span style="width: 8px; height: 8px; border-radius: {rad}; background: {color}"></span>'


def ring(rad):
    return f'<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: {rad}; border: 2px solid var(--text-2)"></span>'


def row(mark, color, label, detail, btn, href, img_extra=''):
    return f'''{ART}
<img src="{SHOT}" alt="" style="{IMG}{img_extra}">
{MID}
{COL1}
{ROW_H2}Fragrance layering recipe</h2>
{ROW_P}{PRODUCT}</p>
{ROW_P}Fast · 1 variant</p>
</div>
{COL2}
<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: {color}">{mark}{label}</span>
<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">{detail}</span>
</div>
</div>
<a href="{href}" style="{ROW_BTN}">{btn}</a>
</article>'''


# "yüklenemedi" bloğu: A-Galeri-Hata (R3) ile aynı yapı ve ölçüler
LOAD_FAIL = ("box-sizing: border-box; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); "
             "padding: clamp(48px, 5vw, 72px) clamp(16px, 4vw, 24px); display: flex; flex-direction: column; align-items: center; "
             "gap: 24px; text-align: center")
fail = f'''<div role="alert" style="{LOAD_FAIL}">
<span aria-hidden="true" style="width: 48px; height: 48px; border-radius: 50%; background: var(--raised); color: var(--warn); display: flex; align-items: center; justify-content: center">{icon('warning', 24)}</span>
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
<h2 style="margin: 0; {H6}">Could not load your videos.</h2>
<p style="margin: 0; max-width: 520px; {BODY2}">Check your connection and try again. Your videos and credits are not affected.</p>
</div>
<button type="button" style="{SECONDARY}; gap: 8px">{icon('retry', 18)}Try again</button>
</div>'''

# boş hâl: A-Uretimlerim-Bos'un kutusu; ücretsiz hak kullanılmış, "free" sözü yok
EMPTY = one(r'<main (style="box-sizing: border-box; border-radius: 16px; border: 1\.5px dashed[^"]*")>', bos)
EMPTY_H2 = one(r'(<h2 style="[^"]*">)Seen it\? Clone it\.</h2>', bos)
EMPTY_P = one(r'(<p style="[^"]*">)Your videos will show up here\.', bos)
EMPTY_BTN = one(r'<a href="Main\.dc\.html" (style="[^"]*")>Browse the gallery</a>', bos)
empty = f'''<div {EMPTY}>
<div style="display: flex; flex-direction: column; align-items: center; gap: 8px">
{EMPTY_H2}No videos yet.</h2>
{EMPTY_P}Your videos will show up here.</p>
</div>
<a href="Main.dc.html" {EMPTY_BTN}>Pick a template</a>
</div>'''

T2, LIME, WARN = 'var(--text-2)', 'var(--accent-text)', 'var(--warn)'
cells = [
    cell('In queue', row(ring('50%'), T2, 'In queue', 'Position 2', 'Open', 'A-Is-Kuyrukta.dc.html')),
    cell('Running', row(dot(LIME), LIME, 'Running', 'Clips 3 / 5 · about 3 min left', 'Watch', 'A-Is-Takibi.dc.html')),
    cell('Stopped, credits returned', row(dot(WARN, '2px'), WARN, 'Stopped', 'Credits returned · 3 of 5 clips saved', 'See options', 'A-Is-Durdu.dc.html')),
    cell('Closed', row(ring('2px'), T2, 'Closed', '2 credits were returned. Nothing else was charged.', 'Open', 'A-Is-Kapatildi.dc.html')),
    cell('No longer stored', row(icon('duration', 14, sw=3), T2, 'No longer stored', 'Videos are kept for 12 months.', 'Generate it again',
                                 'A-Form.dc.html', '; opacity: 0.6')),
    cell('List could not load', fail),
    cell('Empty, free video already used', empty),
]
body = f'''<div style="{BOARD}">
<h1 style="margin: 0; {H4}">My videos · states</h1>
<div style="display: flex; flex-wrap: wrap; gap: 32px">
{chr(10).join(cells)}
</div>
</div>'''
write('A-Uretimlerim-Durumlar.dc.html', 'My videos: states', ROOT_PAGE, body)
