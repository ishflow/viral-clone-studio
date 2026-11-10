"""Satır 4 · Buying credits: ödeme alındı, ödeme tamamlanmadı, onay penceresi (kredi yetmiyor)."""
from parts import *

SAMPLE = '/_blob/f20a7ed7a7bc172a7da483415800077f'  # sistemin kendi çıktısı: Fragrance layering recipe


def draft(title, note):
    return f'''<section aria-labelledby="h-draft" style="flex: 1 1 420px; min-width: 0; {CARD}; display: flex; flex-direction: column; gap: 24px">
<h2 id="h-draft" style="margin: 0; {H5}">{title}</h2>
<div style="display: flex; align-items: center; gap: 16px">
<img src="{SAMPLE}" alt="Sample frame of the template" style="width: 72px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 8px; display: block; flex: 0 0 auto">
<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0">
<span style="font-size: 17px; font-weight: 600">Fragrance layering recipe</span>
<span style="{SMALL}">4 products · Fast · 1 variant</span>
<span style="{SMALL}">Estimated [CREDIT AMOUNT] credits</span>
</div>
</div>
{note}
</section>'''


def row(dt, dd, last=False):
    return (f'<div style="display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px">'
            f'<dt style="color: var(--text-2)">{dt}</dt><dd style="margin: 0; font-weight: 600">{dd}</dd></div>')


# ---- Ödeme alındı
body = f'''<div style="{WRAP}">
{header_in()}

<section style="display: flex; flex-direction: column; gap: 12px">
{status('done', 'Payment received')}
<h1 style="margin: 0; {H3}">[CREDITS] credits added.</h1>
<p style="margin: 0; max-width: 620px; {LEAD}">Your balance is now [BALANCE] credits. The invoice is saved on your Account page.</p>
</section>

<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px">

{draft('Your video is waiting', f"""<div style="display: flex; flex-wrap: wrap; gap: 12px">
<a href="A-Onay.dc.html" style="{PRIMARY_L}">Back to confirmation</a>
<a href="Main.dc.html" style="{SECONDARY_L}">Browse the gallery</a>
</div>""")}

<section aria-labelledby="h-receipt" style="flex: 1 1 420px; min-width: 0; {CARD}; display: flex; flex-direction: column; gap: 12px">
<h2 id="h-receipt" style="margin: 0 0 4px; {H5}">Receipt</h2>
<dl style="margin: 0; display: flex; flex-direction: column">
{row('Pack', 'Standard pack')}
{row('Credits', '[CREDITS]')}
{row('Paid', '[AMOUNT]')}
{row('Date', '[DATE]')}
</dl>
<a href="A-Fatura.dc.html" style="{QUIET}; align-self: flex-start">{icon('download', 18)}Download invoice (PDF)</a>
</section>

</main>
</div>'''
write('A-Odeme-Basarili.dc.html', 'Payment received', ROOT_PAGE, body)

# ---- Ödeme tamamlanmadı
OPT = "min-height: 72px; box-sizing: border-box; padding: 12px 16px; border-radius: 12px; font: inherit; text-align: left; text-decoration: none; cursor: pointer; display: flex; flex-direction: column; justify-content: center; gap: 2px"
body = f'''<div style="{WRAP}">
{header_in()}

<section style="display: flex; flex-direction: column; gap: 12px">
{status('stopped', 'Not completed')}
<h1 style="margin: 0; {H3}">Payment not completed.</h1>
<p style="margin: 0; max-width: 620px; {LEAD}">The payment was cancelled or declined, so nothing was charged. Your balance is still [BALANCE] credits.</p>
</section>

<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px">

<section aria-labelledby="h-next" style="flex: 1 1 420px; min-width: 0; box-sizing: border-box; padding: 24px; border-radius: 16px; background: var(--surface); border: 1px solid var(--warn-edge); display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 8px">
<h2 id="h-next" style="margin: 0; {H5}">What you can do</h2>
<p style="margin: 0; {BODY2}">Message from the payment provider: [REASON]. Trying again opens the same secure payment page.</p>
</div>
<div style="display: flex; flex-direction: column; gap: 12px">
<a href="A-Fiyatlar.dc.html" style="{OPT}; border: 0; background: var(--accent); color: var(--on-accent)"><span style="font-size: 15px; font-weight: 600">Try again</span><span style="font-size: 13px">Standard pack · [PRICE]</span></a>
<a href="A-Fiyatlar.dc.html" style="{OPT}; border: 1px solid var(--edge-strong); background: transparent; color: var(--text)"><span style="font-size: 15px; font-weight: 600">Choose another pack</span><span style="font-size: 13px; color: var(--text-3)">Back to pricing</span></a>
<a href="A-Iletisim.dc.html" style="{QUIET}; align-self: flex-start">Contact support</a>
</div>
</section>

{draft('Nothing is lost', f'<p style="margin: 0; {BODY2}">Your form is saved. You can confirm this video as soon as you have enough credits.</p>')}

</main>
</div>'''
write('A-Odeme-Basarisiz.dc.html', 'Payment not completed', ROOT_PAGE, body)

# ---- Onay penceresi: kredi yetmiyor
DROW = "display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px"


def drow(dt, dd, dd_style='font-weight: 600'):
    return f'<div style="{DROW}"><dt style="color: var(--text-2)">{dt}</dt><dd style="margin: 0; {dd_style}">{dd}</dd></div>'


DIALOG_H = 680
body = f'''<div role="dialog" aria-labelledby="onay-baslik" style="width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 8px">
<h1 id="onay-baslik" style="margin: 0; {H4}">Confirm generation</h1>
<p style="margin: 0; font-size: 15px; color: var(--text-2)">Fragrance layering recipe · Fast · 1 variant</p>
</div>

<dl style="margin: 0; display: flex; flex-direction: column">
{drow('Images · Nano Banana Pro', '5')}
{drow('Clips · Seedance 2 Mini 720p', '5 clips, 20 sec')}
{drow('Music · Lyria', '1')}
{drow('Estimated time', 'about 7 min')}
<div style="display: flex; justify-content: space-between; gap: 16px; padding: 16px 0 12px; border-top: 1px solid var(--edge); font-size: 17px"><dt style="font-weight: 600">Estimated credits</dt><dd style="margin: 0; font-weight: 600">[CREDIT AMOUNT]</dd></div>
<div style="display: flex; justify-content: space-between; gap: 16px; padding: 0 0 12px; font-size: 15px"><dt style="color: var(--text-2)">Your balance</dt><dd style="margin: 0; font-weight: 600">[BALANCE]</dd></div>
<div style="display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); border-bottom: 1px solid var(--edge); font-size: 15px"><dt style="font-weight: 600; color: var(--warn)">Missing</dt><dd style="margin: 0; font-weight: 600; color: var(--warn)">[CREDIT DIFFERENCE]</dd></div>
</dl>

<p role="alert" style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; background: var(--bg); border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text-2)">{icon('warning', 20, 'flex: 0 0 auto; margin-top: 1px; color: var(--warn)')}<span>Not enough credits for this video. Nothing is spent. Your form stays saved while you buy.</span></p>

<div style="display: flex; flex-wrap: wrap; gap: 12px">
<a href="A-Form.dc.html" style="flex: 1 1 160px; {SECONDARY}">Cancel</a>
<a href="A-Fiyatlar.dc.html" style="flex: 2 1 240px; {PRIMARY}">Buy credits</a>
</div>
</div>'''
write('A-Onay-Yetersiz.dc.html', 'Credit confirmation dialog: not enough credits',
      f"width: 640px; height: {DIALOG_H}px; box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: center; justify-content: center",
      body, w=640, h=DIALOG_H)
