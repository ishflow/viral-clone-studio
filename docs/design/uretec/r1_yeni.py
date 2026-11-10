"""R1 (inceleme turu 2026-10-04): satın alma ve pazarlama grubunun altı yeni panosu.
Yeniden çalıştırılabilir; yalnız kendi altı dosyasını yazar. Her sayfa en yakın mevcut panodan türetilir (aynı üst menü,
aynı düzen, aynı stil metinleri): A-Yasal-Iade ← A-Yasal · A-Hata-Servis ← A-404 · A-Odeme-Dogrulaniyor, A-Odeme-Gecikti ←
A-Odeme-Basarili · A-Iletisim-Durumlar ← A-Iletisim form kartı. Metinler docs/specs/2026-10-04-flow-contract.md §1.5, §8, §8.1, §10.
Çalıştırdıktan sonra: python3 boy.py <adlar> && python3 variants.py <adlar>."""
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


def root_of(s):
    return one(r'<div class="ay" data-theme="\{\{ theme \}\}" style="([^"]*)">', s)


def body_of(s):
    return one(r'<div class="ay"[^>]*>\n(.*)\n</div>\n</x-dc>', s)


# ---------------------------------------------------------------- A-Yasal-Iade (sayfa, A-Yasal düzeni)
yasal = src('A-Yasal.dc.html')
NAV_CUR = one(r'<a href="A-Yasal\.dc\.html" aria-current="page" style="([^"]*)">Terms of use</a>', yasal)
NAV_OFF = one(r'<a href="A-Yasal\.dc\.html" style="([^"]*)">Privacy</a>', yasal)
SECTION = one(r'<sc-for list="\{\{ sections \}\}"[^>]*>\n(.*?)\n</sc-for>', yasal)
INLINE = 'padding: 12px 0; font-weight: 600; text-decoration: none'  # satır içi bağlantı (A-Cerez, A-Iletisim ile aynı)
REFUND = [
    ('Unused packs', 'If you have not used any credit from a pack, we refund it in full within 14 days of the purchase.'),
    ('Used credits', 'Once a credit from a pack is used, the pack is not refunded. The remaining credits stay valid; credits do not expire.'),
    ('Videos that are not delivered', 'If a video is not delivered, its credits go back to your balance on their own. You see it in your account as Credits returned. This is a return of credits, not a refund of money, so there is nothing to ask for.'),
    ('A video that came out wrong', 'Tell us within 7 days: open the result and choose Report a problem. We look at it within 2 business days. If the video is wrong, we generate it again at no cost.'),
    ('How to ask for a refund', 'Open Account, go to Purchases and choose Request a refund on the pack. The credits are held until we answer. '
     'We answer within 2 business days. '
     f'You can also <a href="A-Iletisim.dc.html" style="{INLINE}">contact support</a> or write to [SUPPORT EMAIL].'),
    ('After a refund', 'The credits from the refunded pack are removed from your balance. The money is refunded to your payment method in a few days.'),
]
b = body_of(yasal)
b = sub1(b, f'<a href="A-Yasal.dc.html" aria-current="page" style="{NAV_CUR}">Terms of use</a>', f'<a href="A-Yasal.dc.html" style="{NAV_OFF}">Terms of use</a>')
b = sub1(b, f'<a href="A-Yasal-Iade.dc.html" style="{NAV_OFF}">Refunds</a>', f'<a href="A-Yasal-Iade.dc.html" aria-current="page" style="{NAV_CUR}">Refunds</a>')
b = sub1(b, '>Terms of use</h1>', '>Refund policy</h1>')
b = re.sub(r'<sc-for list="\{\{ sections \}\}".*?</sc-for>',
           lambda m: '\n'.join(SECTION.replace('{{ s.title }}', t).replace('{{ s.body }}', x) for t, x in REFUND), b, flags=re.S)
write('A-Yasal-Iade.dc.html', 'Legal page: refund policy', root_of(yasal), b)

# ---------------------------------------------------------------- A-Hata-Servis (sayfa, A-404 düzeni)
p404 = src('A-404.dc.html')
MARK = ('<span aria-hidden="true" style="width: 72px; height: 72px; border-radius: 50%; box-sizing: border-box; background: var(--surface); '
        f'border: 1px solid var(--warn-edge); color: var(--warn); display: flex; align-items: center; justify-content: center">{icon("warning", 32)}</span>')
main = f'''<main style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; text-align: center; padding: 48px 0">
{MARK}
<h1 style="margin: 0; {H3}">Something went wrong on our side.</h1>
<p style="margin: 0; max-width: 460px; font-size: 17px; line-height: 1.5; color: var(--text-2)">Nothing was charged. Try again in a few minutes.</p>
<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 12px">
<button type="button" style="{PRIMARY_L}">Try again</button>
<a href="A-Iletisim.dc.html" style="{SECONDARY_L}">Contact support</a>
</div>
</main>'''
b = re.sub(r'<main.*?</main>', lambda m: main, body_of(p404), flags=re.S)
write('A-Hata-Servis.dc.html', 'Service unavailable', root_of(p404), b)

# ---------------------------------------------------------------- A-Odeme-Dogrulaniyor, A-Odeme-Gecikti (sayfa, A-Odeme-Basarili düzeni)
ok = src('A-Odeme-Basarili.dc.html')
HEAD = one(r'(<header.*?</header>)', ok)
DRAFT = one(r'(<div style="display: flex; align-items: center; gap: 16px">\n<img.*?</div>\n</div>)', ok)
ROW = one(r'(<div style="display: flex; flex-wrap: wrap; justify-content: space-between[^>]*><dt[^>]*>)Pack</dt>', ok)
DD = one(r'<dt style="color: var\(--text-2\)">Pack</dt>(<dd[^>]*>)', ok)
COL = "flex: 1 1 420px; min-width: 0; " + CARD + "; display: flex; flex-direction: column"
TOP = "display: flex; flex-direction: column; gap: 12px"
PWRAP = "max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 48px"


def rows(pairs):
    return ('<dl style="margin: 0; display: flex; flex-direction: column">\n'
            + '\n'.join(f'{ROW}{k}</dt>{DD}{v}</dd></div>' for k, v in pairs) + '\n</dl>')


def pay_page(name, title, top, left, right):
    body = f'''<div style="{PWRAP}">
{HEAD}

{top}

<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px">

{left}

{right}

</main>
</div>'''
    write(name, title, root_of(ok), body)


ORDER = [('Pack', 'Standard pack'), ('Credits', '30'), ('Price', '$54')]
pay_page('A-Odeme-Dogrulaniyor.dc.html', 'Payment: confirming',
         f'''<section role="status" style="{TOP}">
{status('running', 'Confirming')}
<h1 style="margin: 0; {H3}">Confirming your payment…</h1>
<p style="margin: 0; max-width: 620px; {LEAD}">This usually takes a few seconds. Do not pay again.</p>
</section>''',
         f'''<section aria-labelledby="h-draft" style="{COL}; gap: 24px">
<h2 id="h-draft" style="margin: 0; {H5}">Your video is waiting</h2>
{DRAFT}
<p style="margin: 0; {BODY2}">Your form is saved.</p>
</section>''',
         f'''<section aria-labelledby="h-order" style="{COL}; gap: 12px">
<h2 id="h-order" style="margin: 0 0 4px; {H5}">Your order</h2>
{rows(ORDER + [('Status', 'Confirming…')])}
</section>''')

pay_page('A-Odeme-Gecikti.dc.html', 'Payment: taking longer',
         f'''<section style="{TOP}">
{status('running', 'Still confirming')}
<h1 style="margin: 0; {H3}">We are still waiting for the payment provider.</h1>
<p style="margin: 0; max-width: 620px; {LEAD}">If the payment went through, your credits appear on their own and we email you. You do not need to pay again.</p>
</section>''',
         f'''<section aria-labelledby="h-order" style="{COL}; gap: 24px">
<h2 id="h-order" style="margin: 0; {H5}">Your order</h2>
{rows(ORDER + [('Status', 'Waiting for the payment provider'), ('Reference', '[REFERENCE]')])}
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<a href="A-Odeme-Dogrulaniyor.dc.html" style="{PRIMARY_L}">Check again</a>
<a href="A-Iletisim.dc.html" style="{SECONDARY_L}">Contact support</a>
</div>
</section>''',
         f'''<section aria-labelledby="h-draft" style="{COL}; gap: 24px">
<h2 id="h-draft" style="margin: 0; {H5}">Your video is waiting</h2>
{DRAFT}
<p style="margin: 0; {BODY2}">Your form is saved.</p>
<a href="A-Form.dc.html" style="align-self: flex-start; {SECONDARY}">Back to your video</a>
</section>''')

# ---------------------------------------------------------------- Durum panoları (KURALLAR §11)
SWRAP = "max-width: 1320px; margin: 0 auto; padding-top: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 32px"
CELL = "flex: 1 1 400px; min-width: 0; max-width: 520px; display: flex; flex-direction: column; gap: 12px"
BOX = CARD + "; display: flex; flex-direction: column"
ALERT = ("margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--bg); "
         "border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text-2)")  # A-Onay-Yetersiz ile aynı
WARN_ICON = icon('warning', 20, 'flex: 0 0 auto; color: var(--warn)')


def cell(label, inner):
    return f'<div style="{CELL}">\n<p style="margin: 0; {SMALL}">{label}</p>\n{inner.strip()}\n</div>'


def state_board(name, title, h1, cells):
    body = f'''<div style="{SWRAP}">
<h1 style="margin: 0; {H4}">{h1}</h1>
<div style="display: flex; flex-wrap: wrap; gap: 32px">
{chr(10).join(cells)}
</div>
</div>'''
    write(name, title, ROOT_PAGE, body)


# ---- A-Odeme-Durumlar: ödeme sonucu kartı (iptal, oturum süresi doldu, reddedildi)
def pay_card(label, head, text, action, href):
    return f'''<section style="{BOX}; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 12px">
{status('stopped', label)}
<h2 style="margin: 0; {H5}">{head}</h2>
<p style="margin: 0; {BODY2}">{text}</p>
</div>
<a href="{href}" style="{PRIMARY}">{action}</a>
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 16px; padding-top: 12px; border-top: 1px solid var(--line)">
<span style="font-size: 15px; line-height: 1.5; color: var(--text-2)">Your form is saved.</span>
<a href="A-Form.dc.html" style="{QUIET}">Back to your video</a>
</div>
</section>'''


state_board('A-Odeme-Durumlar.dc.html', 'Payment: cancelled and expired', 'Payment · cancelled and expired', [
    cell('Cancelled', pay_card('Cancelled', 'You left the checkout.', 'Nothing was charged.', 'Back to pricing', 'A-Fiyatlar.dc.html')),
    cell('Checkout expired', pay_card('Expired', 'This checkout expired.', 'Nothing was charged. Start again from pricing.', 'Back to pricing', 'A-Fiyatlar.dc.html')),
    cell('Declined (for comparison)', pay_card('Declined', 'The payment was declined.', 'Nothing was charged.', 'Try another payment method', 'A-Fiyatlar.dc.html')),
])

# ---- A-Iletisim-Durumlar: form kartı (gönderiliyor, gönderildi, gönderilemedi, aynı ileti, girişli kullanıcı)
ilet = src('A-Iletisim.dc.html')
FORM = one(r'(<form aria-label="Contact form".*?</form>)', ilet)
FORM = sub1(FORM, 'style="flex: 1 1 420px; min-width: 0; box-sizing: border-box;', 'style="box-sizing: border-box;')  # hücrede sütun: esnek taban kalkar
SEND = one(r'(<button type="button" style="align-self: flex-start;[^>]*>Send message</button>)', FORM)
LINK = one(r'(<label[^>]*>Link to the video \(optional\)\n<input[^>]*>\n</label>)', FORM)
MAIL = one(r'(<label[^>]*>Your email\n<input[^>]*>\n</label>)', FORM)
MSG = 'The product looks different in the video.'
filled = sub1(FORM, 'placeholder="name@example.com"', 'value="[EMAIL]" placeholder="name@example.com"')
filled = sub1(filled, '></textarea>', f'>{MSG}</textarea>')
OFF = ('<button type="button" aria-disabled="true" style="align-self: flex-start; display: flex; align-items: center; justify-content: center; gap: 8px; '
       'box-sizing: border-box; border-radius: 12px; font: inherit; font-weight: 600; cursor: default; min-height: 52px; padding: 0 24px; border: 0; '
       f'background: var(--raised); color: var(--text-3); font-size: 15px">{icon("generating", 18)}Sending…</button>')  # kapalı düğme: Marka-Bilesen-1
sending = sub1(filled, SEND, OFF).replace('<form aria-label="Contact form"', '<form aria-label="Contact form" aria-busy="true"')
failed = sub1(filled, SEND, f'<p role="alert" style="{ALERT}">{WARN_ICON}<span>Could not send. Your message is still here. Try again.</span></p>\n'
              + SEND.replace('>Send message</button>', '>Try again</button>'))


NOTE_BOX = sub1(one(r'<form aria-label="Contact form" style="([^"]*)"', FORM), 'gap: 16px', 'gap: 12px')  # form kartının yerini alır: aynı kart


def note(mark, head, text):
    return f'''<section role="status" style="{NOTE_BOX}">
{mark}
<h2 style="margin: 0; {H5}">{head}</h2>
<p style="margin: 0; {BODY2}">{text}</p>
</section>'''


INFO = ('<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">'
        f'{icon("info", 18)}Already sent</span>')
JOB = ('<label style="display: flex; flex-direction: column; gap: 8px; font-size: 15px; color: var(--text-2)">About job\n'
       + one(r'(<select style="[^"]*">)', FORM) + '<option>Fragrance layering recipe · [DATE]</option><option>Not about a job</option></select>\n'
       '<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">The job ID is added for you.</span>\n</label>')
signed = sub1(sub1(FORM, MAIL + '\n', ''), LINK, JOB)
signed = sub1(signed, SEND, f'<p style="margin: 0; {SMALL}">We answer by email to [EMAIL].</p>\n' + SEND)

state_board('A-Iletisim-Durumlar.dc.html', 'Contact and support: states', 'Contact and support · states', [
    cell('Sending', sending),
    cell('Sent', note(status('done', 'Sent'), 'Message sent.', 'Reference [REFERENCE]. We answer within 2 business days.')),
    cell('Could not send', failed),
    cell('Same message sent twice', note(INFO, 'You already sent this message.', 'Reference [REFERENCE].')),
    cell('Signed in · about job', signed),
])
