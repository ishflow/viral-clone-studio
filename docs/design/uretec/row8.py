"""Küçük parçalar (iletişim sayfası, çerez bildirimi, dil menüsü) ve siteden giden 5 e-posta (açık zemin)."""
from parts import *

FOOTER = re.search(r'<footer.*?</footer>', open(os.path.join(P, 'A-Fiyatlar.dc.html'), encoding='utf-8').read(), re.S).group(0)
SELECT = "min-height: 52px; box-sizing: border-box; padding: 0 12px; border-radius: 12px; border: 1px solid var(--edge-strong); background: var(--bg); color: var(--text); font: inherit; font-size: 15px"

# ---- İletişim ve destek
faq = [('When are credits spent?', 'Only when you confirm a job. You see the estimate first.'),
       ('What if a job stops halfway?', 'The finished parts are saved. Continuing costs credits only for the missing part.'),
       ('Can I get an invoice?', 'Every purchase has a PDF invoice on your Account page.'),
       ('Are you copying someone else’s video?', 'No. Only the structure is taken; footage, voice, and music are generated for your product.')]
faq_html = '\n'.join(f'<div style="display: flex; flex-direction: column; gap: 4px; padding: 16px 0; border-top: 1px solid var(--line)"><dt style="font-size: 17px; font-weight: 600; line-height: 1.3">{q}</dt><dd style="margin: 0; {BODY2}">{a}</dd></div>' for q, a in faq)
body = f'''<div style="max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column; gap: 48px">
{header_out()}

<section style="display: flex; flex-direction: column; gap: 12px">
<h1 style="margin: 0; {H2}">How can we help?</h1>
<p style="margin: 0; max-width: 620px; {LEAD}">Write to us and we answer by email, usually within [RESPONSE TIME]. If it is about a video, add its link so we can look at the same job.</p>
</section>

<main style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px 72px">

<form aria-label="Contact form" style="flex: 1 1 420px; min-width: 0; {CARD}; display: flex; flex-direction: column; gap: 16px">
<label style="{LABEL}">What is it about?
<select style="{SELECT}"><option>A video or a job</option><option>Payment and credits</option><option>My account</option><option>Something else</option></select>
</label>
<label style="{LABEL}">Your email
<input type="email" autocomplete="email" placeholder="name@example.com" style="{INPUT}">
</label>
<label style="{LABEL}">Link to the video (optional)
<input type="url" placeholder="Paste the link from My videos" style="{INPUT}">
</label>
<label style="{LABEL}">Message
<textarea rows="6" placeholder="What happened, and what did you expect?" style="box-sizing: border-box; min-height: 160px; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--edge-strong); background: var(--bg); color: var(--text); font: inherit; font-size: 15px; line-height: 1.5; resize: vertical"></textarea>
</label>
<button type="button" style="align-self: flex-start; {PRIMARY}">Send message</button>
</form>

<aside aria-labelledby="h-quick" style="flex: 1 1 380px; min-width: 0; max-width: 560px; display: flex; flex-direction: column; gap: 16px">
<h2 id="h-quick" style="margin: 0; {H5}">Quick answers</h2>
<dl style="margin: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--line)">
{faq_html}
</dl>
<p style="margin: 0; {BODY2}">Prefer email? Write to <a href="#" style="font-weight: 600; text-decoration: none">[EMAIL]</a>.</p>
</aside>

</main>

{FOOTER}
</div>'''
write('A-Iletisim.dc.html', 'Contact and support', ROOT_PAGE.replace('60px) 72px', '60px) 48px'), body)

# ---- Çerez bildirimi (sayfanın altında duran şerit)
body = f'''<div role="region" aria-label="Cookie notice" style="max-width: 1320px; margin: 0 auto; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 48px">
<div style="flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 4px">
<h1 style="margin: 0; {H6}">Cookies</h1>
<p style="margin: 0; max-width: 620px; {BODY2}">We use necessary cookies to keep you signed in. With your permission we also measure how the site is used. <a href="A-Yasal.dc.html" style="font-weight: 600; text-decoration: none">Cookie policy</a></p>
</div>
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<button type="button" style="{SECONDARY}">Only necessary</button>
<button type="button" style="{SECONDARY}">Accept all</button>
</div>
</div>'''
write('A-Cerez.dc.html', 'Cookie notice', "min-height: 180px; box-sizing: border-box; background: var(--bg); color: var(--text); font-family: var(--body); padding: 24px clamp(16px, 4vw, 60px)", body, h=180)

# ---- Dil menüsü (üst menüdeki EN düğmesi açık)
EN_BTN = '<button type="button" aria-label="Language: English. Change" style="min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--edge); background: transparent; color: var(--text-2); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer">EN</button>'
ITEM = "display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; padding: 0 12px; border-radius: 8px; border: 0; font: inherit; font-size: 15px; text-align: left; cursor: pointer; width: 100%; box-sizing: border-box"
MENU = f'''<div style="position: relative">
<button type="button" aria-label="Language: English. Change" aria-expanded="true" aria-haspopup="menu" style="min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--edge-strong); background: var(--raised); color: var(--text); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer">EN</button>
<div role="menu" aria-label="Site language" style="position: absolute; top: 52px; right: 0; width: 264px; box-sizing: border-box; padding: 8px; border-radius: 16px; background: var(--surface); border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 4px">
<button type="button" role="menuitemradio" aria-checked="true" style="{ITEM}; background: var(--raised); color: var(--text); font-weight: 600">English<span style="display: flex; color: var(--accent-text)">{icon('done', 18, sw=2.6)}</span></button>
<button type="button" role="menuitemradio" aria-checked="false" style="{ITEM}; background: transparent; color: var(--text-2)">Türkçe</button>
<p style="margin: 0; padding: 8px 12px 4px; border-top: 1px solid var(--line); {SMALL}">This changes the site language. The language of a video is chosen in the form.</p>
</div>
</div>'''
head = header_out()
assert head.count(EN_BTN) == 1
body = f'''<div style="max-width: 1320px; margin: 0 auto">
{head.replace(EN_BTN, MENU)}
</div>'''
write('A-Dil-Menusu.dc.html', 'Language menu', "min-height: 280px; box-sizing: border-box; background: var(--bg); color: var(--text); font-family: var(--body); padding: 0 clamp(16px, 4vw, 60px)", body, h=280)

# ---- E-postalar (açık zemin; koyu e-postayı posta uygulamaları kendince çevirir)
EROOT = "width: 640px; min-height: 600px; box-sizing: border-box; padding: 32px; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; flex-direction: column; gap: 16px"
EBTN = PRIMARY + "; align-self: flex-start"


def email(name, title, subject, inner):
    body = f'''<p style="margin: 0; {SMALL}">From: Viral Clone · Subject: {subject}</p>
<div style="box-sizing: border-box; padding: 32px; border-radius: 16px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 24px">
{logo('A-Ana-Sayfa.dc.html')}
{inner.strip()}
</div>
<p style="margin: 0; padding: 0 32px; {SMALL}">You get this email because you have a Viral Clone account. Questions? <a href="A-Iletisim.dc.html" style="font-weight: 600; text-decoration: none">Contact support</a>.<br>© [COMPANY NAME] · [ADDRESS]</p>'''
    write(name, title, EROOT, body, w=640, h=600, theme='light')


def etext(h1, p, st=''):
    return f'''<div style="display: flex; flex-direction: column; gap: 12px">
{st}
<h1 style="margin: 0; {H4}">{h1}</h1>
<p style="margin: 0; {LEAD}">{p}</p>
</div>'''


def erow(dt, dd):
    return f'<div style="display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line); font-size: 15px"><dt style="color: var(--text-2)">{dt}</dt><dd style="margin: 0; font-weight: 600">{dd}</dd></div>'


email('E-Dogrulama.dc.html', 'Email: verify your address', 'Verify your email', f'''
{etext('Verify your email.', 'Confirm this address to activate your account and get your free video.')}
<a href="A-Karsilama.dc.html" style="{EBTN}">Verify email</a>
<p style="margin: 0; {SMALL}">The link works for [LINK VALIDITY]. If you did not sign up, you can ignore this email.</p>
''')

email('E-Sifre.dc.html', 'Email: reset password', 'Set a new password', f'''
{etext('Set a new password.', 'We got a request to reset the password for name@example.com.')}
<a href="A-Sifre-Yeni.dc.html" style="{EBTN}">Set new password</a>
<p style="margin: 0; {SMALL}">The link works for [LINK VALIDITY]. If you did not ask for this, ignore this email; your password stays the same.</p>
''')

email('E-Hazir.dc.html', 'Email: your video is ready', 'Your video is ready', f'''
{etext('Your video is ready.', 'It took about 7 minutes. You can watch it, download it, or generate another variant.', status('done', 'Ready'))}
<div style="display: flex; align-items: center; gap: 16px; padding: 16px; border-radius: 12px; background: var(--bg)">
<img src="{B}f20a7ed7a7bc172a7da483415800077f" alt="Frame from your video" style="width: 72px; aspect-ratio: 9 / 16; object-fit: cover; border-radius: 8px; display: block; flex: 0 0 auto">
<div style="display: flex; flex-direction: column; gap: 4px; min-width: 0"><span style="font-size: 17px; font-weight: 600">Fragrance layering recipe</span><span style="{SMALL}">8 sec · 720p · mp4</span></div>
</div>
<a href="A-Sonuc.dc.html" style="{EBTN}">Watch and download</a>
<p style="margin: 0; {SMALL}">The video stays in My videos.</p>
''')

email('E-Durdu.dc.html', 'Email: job stopped', 'Your video stopped halfway', f'''
{etext('Your video stopped halfway.', 'One step failed, so we stopped. Nothing was retried and no extra credits were spent.', status('stopped', 'Stopped'))}
<dl style="margin: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--line)">
{erow('Template', 'Fragrance layering recipe')}
{erow('Saved so far', '5 images, 3 of 5 clips, music')}
{erow('Missing', '2 clips')}
</dl>
<a href="A-Is-Durdu.dc.html" style="{EBTN}">See your options</a>
<p style="margin: 0; {SMALL}">Continuing needs your confirmation and costs credits only for the missing part.</p>
''')

email('E-Odeme.dc.html', 'Email: payment received', 'Payment received: [CREDITS] credits added', f'''
{etext('[CREDITS] credits added.', 'Thank you. Your balance is now [BALANCE] credits.', status('done', 'Payment received'))}
<dl style="margin: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--line)">
{erow('Pack', 'Standard pack')}
{erow('Paid', '[AMOUNT]')}
{erow('Date', '[DATE]')}
{erow('Invoice number', '[INVOICE NUMBER]')}
</dl>
<a href="A-Fatura.dc.html" style="{EBTN}; gap: 8px">{icon('download', 18)}Download invoice (PDF)</a>
<p style="margin: 0; {SMALL}">All invoices are on your Account page.</p>
''')
