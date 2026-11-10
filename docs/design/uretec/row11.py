"""Fatura (PDF): müşterinin kredi paketi aldıktan sonra indirdiği tek sayfa. Fixed page, A4 794×1123, açık zemin.
Sonda salt okunur bir kontrol var: fatura indirme bağlantıları bu panoya gidiyor mu (dosyalara dokunmaz, yalnız yazar)."""
from parts import *

# Baskı: kâğıt beyaz (--surface), kenarlardan 72 px; çizgiler 1 px ve kâğıtta kaybolmayacak kadar koyu.
ROOT = ("width: 794px; height: 1123px; box-sizing: border-box; padding: 72px; background: var(--surface); "
        "color: var(--text); font-family: var(--body); display: flex; flex-direction: column")
INK = "1px solid var(--text)"            # ana çizgi: başlık altı, tablo başlığı altı, toplam üstü
RULE = "1px solid var(--edge-strong)"    # ara çizgi
LBL = "margin: 0; font-size: 13px; line-height: 1.4; font-weight: 600; color: var(--text-3)"
NUM = "text-align: right; font-variant-numeric: tabular-nums"
TH = f"padding: 0 0 16px; border-bottom: {INK}; {LBL.replace('margin: 0; ', '')}"
TD = f"padding: 24px 0; border-bottom: {RULE}; vertical-align: baseline"
ROW = "display: flex; align-items: baseline; justify-content: space-between; gap: 16px"


def party(label, name, lines):
    """Taraf bloğu (From / Billed to): küçük etiket, koyu ad, altında satırlar."""
    rest = ''.join(f'<span style="display: block">{x}</span>' for x in lines)
    return (f'<div style="flex: 1 1 0; min-width: 0; box-sizing: border-box; padding-right: 32px; display: flex; flex-direction: column; gap: 8px">\n'
            f'<h2 style="{LBL}">{label}</h2>\n'
            f'<address style="font-style: normal; font-size: 15px; line-height: 1.5; color: var(--text-2)">'
            f'<span style="display: block; font-size: 17px; font-weight: 600; color: var(--text)">{name}</span>{rest}</address>\n</div>')


body = f'''<header style="display: flex; align-items: baseline; justify-content: space-between; gap: 32px; padding-bottom: 48px; border-bottom: {INK}">
{logo('A-Hesap.dc.html')}
<div style="display: flex; flex-direction: column; align-items: flex-end; gap: 12px">
<h1 style="margin: 0; {H4}">Invoice</h1>
<dl style="margin: 0; display: flex; flex-direction: column; gap: 4px; font-size: 15px; line-height: 1.5">
<div style="display: flex; justify-content: flex-end; gap: 8px"><dt style="color: var(--text-2)">No.</dt><dd style="margin: 0; font-weight: 600">[INVOICE NUMBER]</dd></div>
<div style="display: flex; justify-content: flex-end; gap: 8px"><dt style="color: var(--text-2)">Date</dt><dd style="margin: 0; font-weight: 600">[DATE]</dd></div>
</dl>
</div>
</header>

<main style="display: flex; flex-direction: column; padding-top: 72px">

<section aria-label="Seller and customer" style="display: flex">
{party('From', '[COMPANY NAME]', ['[ADDRESS]', 'Tax ID [TAX ID]', '[EMAIL]'])}
{party('Billed to', '[CUSTOMER NAME]', ['[BILLING ADDRESS]', '[EMAIL]'])}
</section>

<table style="margin-top: 72px; width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 15px; line-height: 1.5">
<caption style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">Items on this invoice</caption>
<thead><tr>
<th scope="col" style="width: 50%; text-align: left; {TH}">Description</th>
<th scope="col" style="width: 10%; {NUM}; {TH}">Qty</th>
<th scope="col" style="width: 20%; {NUM}; {TH}">Unit price</th>
<th scope="col" style="width: 20%; {NUM}; {TH}">Amount</th>
</tr></thead>
<tbody><tr>
<th scope="row" style="text-align: left; font-weight: 400; {TD}"><span style="display: block; font-size: 17px; font-weight: 600">Standard pack</span><span style="display: block; font-size: 13px; line-height: 1.4; color: var(--text-2)">[CREDITS] credits for Viral Clone</span></th>
<td style="{NUM}; {TD}">1</td>
<td style="{NUM}; {TD}">[PRICE]</td>
<td style="{NUM}; {TD}">[PRICE]</td>
</tr></tbody>
</table>

<section aria-label="Totals" style="margin: 24px 0 0 auto; width: 50%; display: flex; flex-direction: column; font-size: 15px; line-height: 1.5">
<dl style="margin: 0; display: flex; flex-direction: column">
<div style="{ROW}; padding: 12px 0"><dt style="color: var(--text-2)">Subtotal</dt><dd style="margin: 0; {NUM}">[SUBTOTAL]</dd></div>
<div style="{ROW}; padding: 12px 0"><dt style="color: var(--text-2)">Tax ([TAX RATE])</dt><dd style="margin: 0; {NUM}">[TAX AMOUNT]</dd></div>
<div style="{ROW}; margin-top: 12px; padding-top: 24px; border-top: {INK}"><dt style="{H6}">Total</dt><dd style="margin: 0; {NUM}; {H5}">[AMOUNT]</dd></div>
</dl>
<p style="margin: 12px 0 0; font-size: 13px; line-height: 1.4; color: var(--text-2)">Paid on [DATE] · [PAYMENT METHOD]</p>
</section>

</main>

<footer style="margin-top: auto; padding-top: 16px; border-top: {RULE}; display: flex; flex-direction: column; gap: 4px; font-size: 13px; line-height: 1.4; color: var(--text-2)">
<p style="margin: 0">Credits were added to your account when the payment was received.</p>
<p style="margin: 0; display: flex; justify-content: space-between; gap: 16px"><span>Support: [EMAIL] · viralclone.app</span><span>Page 1 of 1</span></p>
</footer>'''
write('A-Fatura.dc.html', 'Invoice (PDF)', ROOT, body, w=794, h=1123, theme='light')

# ---- Kontrol (salt okunur): fatura indirme bağlantıları A-Fatura'ya gidiyor mu?
LINK = re.compile(r'<a href="([^"]*)"[^>]*>(?:<svg.*?</svg>)?(Download invoice \(PDF\)|Download PDF)</a>')
for f in ('A-Hesap.dc.html', 'A-Odeme-Basarili.dc.html', 'E-Odeme.dc.html'):
    for n, line in enumerate(open(os.path.join(P, f), encoding='utf-8'), 1):
        for m in LINK.finditer(line):
            ok = 'tamam' if m.group(1) == 'A-Fatura.dc.html' else 'A-Fatura.dc.html olmalı'
            print(f'bağlantı: {f}:{n}  "{m.group(2)}"  href="{m.group(1)}"  ({ok})')
