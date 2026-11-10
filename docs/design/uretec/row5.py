"""Satır 5 · Account access: şifre sıfırlama (3), e-posta doğrulama, ilk giriş karşılaması, hesabı silme onayı."""
from parts import *

INPUT_S = INPUT.replace('background: var(--bg)', 'background: var(--surface)')  # giriş sayfasındaki alanlarla aynı
SUBMIT = "display: flex; align-items: center; justify-content: center; min-height: 60px; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 17px; text-decoration: none"
H1A = f"margin: 0; {H4}"
BACK = f'<a href="A-Giris.dc.html" style="align-self: flex-start; {QUIET}">{icon("back", 18)}Back to log in</a>'
MAIL = '<strong style="color: var(--text); font-weight: 600">name@example.com</strong>'

# ---- Şifremi unuttum
write('A-Sifre-Unuttum.dc.html', 'Forgot password', ROOT_AUTH, auth_page(f'''
<div style="display: flex; flex-direction: column; gap: 8px">
<h1 style="{H1A}">Reset your password.</h1>
<p style="margin: 0; {BODY2}">Enter the email you signed up with. We will send you a link to set a new password.</p>
</div>
<form style="display: flex; flex-direction: column; gap: 16px">
<label style="{LABEL}">Email
<input type="email" autocomplete="email" placeholder="name@example.com" style="{INPUT_S}">
</label>
<a href="A-Sifre-Gonderildi.dc.html" style="{SUBMIT}">Send reset link</a>
</form>
{BACK}
'''))

# ---- Bağlantı gönderildi
write('A-Sifre-Gonderildi.dc.html', 'Reset link sent', ROOT_AUTH, auth_page(f'''
<div style="display: flex; flex-direction: column; gap: 12px">
{status('done', 'Link sent')}
<h1 style="{H1A}">Check your inbox.</h1>
<p style="margin: 0; {BODY2}">We sent a reset link to {MAIL}. It works for [LINK VALIDITY].</p>
</div>
<button type="button" style="{SECONDARY}">Send the link again</button>
<p style="margin: 0; {SMALL}">Nothing arrived? Check the spam folder, or go back and try another address.</p>
{BACK}
'''))

# ---- Yeni şifre
write('A-Sifre-Yeni.dc.html', 'Set a new password', ROOT_AUTH, auth_page(f'''
<div style="display: flex; flex-direction: column; gap: 8px">
<h1 style="{H1A}">Set a new password.</h1>
<p style="margin: 0; {BODY2}">For {MAIL}.</p>
</div>
<form style="display: flex; flex-direction: column; gap: 16px">
<label style="{LABEL}">New password
<input type="password" autocomplete="new-password" style="{INPUT_S}">
<span style="{SMALL}">At least [MIN LENGTH] characters.</span>
</label>
<label style="{LABEL}">Repeat new password
<input type="password" autocomplete="new-password" style="{INPUT_S}">
</label>
<a href="Main.dc.html" style="{SUBMIT}">Save and log in</a>
</form>
'''))

# ---- E-postanı doğrula
write('A-Eposta-Dogrula.dc.html', 'Verify your email', ROOT_AUTH, auth_page(f'''
<div style="display: flex; flex-direction: column; gap: 12px">
{status('done', 'Account created')}
<h1 style="{H1A}">Verify your email.</h1>
<p style="margin: 0; {BODY2}">We sent a link to {MAIL}. Open it to activate your account and get your free video.</p>
</div>
<button type="button" style="{SECONDARY}">Send the link again</button>
<p style="margin: 0; {SMALL}">Nothing arrived? Check the spam folder.</p>
<a href="A-Giris.dc.html" style="align-self: flex-start; {QUIET}">Use another email</a>
'''))

# ---- İlk giriş karşılaması
free = [t for t in TEMPLATES if t['format'] == 'No talking']
FACT = "display: flex; flex-direction: column; gap: 8px"
body = f'''<div style="{WRAP}">
{header_in(None, '1 free video')}

<section style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 32px 48px">
<h1 style="margin: 0; flex: 1 1 520px; {DISPLAY}; font-weight: 800; font-size: clamp(42px, 6.4vw, 92px); line-height: 0.95; letter-spacing: -0.035em; text-wrap: balance">Your first video <span style="color: var(--accent-text)">is free.</span></h1>
<div style="flex: 1 1 340px; max-width: 440px; display: flex; flex-direction: column; gap: 24px">
<p style="margin: 0; {LEAD}">Pick any no-talking template and upload your product images. A few minutes later the same video is ready with your product. No card needed.</p>
<a href="Main.dc.html" style="align-self: flex-start; {PRIMARY_L}">Pick a template</a>
</div>
</section>

<section aria-labelledby="h-start" style="display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px">
<h2 id="h-start" style="margin: 0; {H5}">Start with one of these</h2>
<a href="Main.dc.html" style="{QUIET}">See all templates{icon('forward', 18)}</a>
</div>
<div style="{GRID}">
{chr(10).join(video_card(t) for t in free)}
</div>
</section>

<section aria-label="How the free video works" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 32px 48px; padding-top: 32px; border-top: 1px solid var(--line)">
<div style="{FACT}"><h2 style="margin: 0; {H6}">What is free</h2><p style="margin: 0; {BODY2}">One no-talking video in Fast quality, 8 to 15 seconds, with up to [PRODUCT LIMIT] products.</p></div>
<div style="{FACT}"><h2 style="margin: 0; {H6}">What comes after</h2><p style="margin: 0; {BODY2}">Every next video costs credits. You see the cost before each job; nothing is spent until you confirm.</p></div>
<div style="{FACT}"><h2 style="margin: 0; {H6}">What needs credits</h2><p style="margin: 0; {BODY2}">Talking videos, Best quality, extra variants, and turning your own video into a template.</p></div>
</section>
</div>'''
write('A-Karsilama.dc.html', 'Welcome: your first video is free', ROOT_PAGE, body)

# ---- Hesabı silme onayı
DROW = "display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px"
DEL_H = 520
body = f'''<div role="dialog" aria-labelledby="sil-baslik" style="width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 8px">
<h1 id="sil-baslik" style="margin: 0; {H4}">Delete your account?</h1>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">This cannot be undone. Here is what happens:</p>
</div>

<dl style="margin: 0; display: flex; flex-direction: column">
<div style="{DROW}"><dt style="color: var(--text-2)">Your videos and templates</dt><dd style="margin: 0; font-weight: 600">deleted</dd></div>
<div style="{DROW}"><dt style="color: var(--text-2)">Remaining credits</dt><dd style="margin: 0; font-weight: 600">[BALANCE] credits, lost</dd></div>
<div style="{DROW}; border-bottom: 1px solid var(--edge)"><dt style="color: var(--text-2)">Invoices</dt><dd style="margin: 0; font-weight: 600">[INVOICE RETENTION]</dd></div>
</dl>

<label style="{LABEL}">Type DELETE to confirm
<input type="text" autocomplete="off" style="{INPUT}">
</label>

<div style="display: flex; flex-wrap: wrap; gap: 12px">
<a href="A-Hesap.dc.html" style="flex: 2 1 240px; {SECONDARY}">Keep my account</a>
<button type="button" style="flex: 1 1 160px; {BTN}; min-height: 52px; padding: 0 24px; border: 1.5px solid var(--warn); background: transparent; color: var(--warn); font-size: 15px">Delete account</button>
</div>
</div>'''
write('A-Hesap-Sil.dc.html', 'Delete account dialog',
      f"width: 640px; height: {DEL_H}px; box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); font-family: var(--body); display: flex; align-items: center; justify-content: center",
      body, w=640, h=DEL_H)
