"""İnceleme turu (2026-10-04) · Görev 2, R2 Hesap erişimi ve hesap: dokuz yeni pano (düzeltme turu 2 dahil).
Yeniden çalıştırılabilir; yalnız kendi dokuz panosunu yazar (mevcut panolar doğrudan dosyada düzeltildi).
Kullanım: python3 r2_panolar.py [ad ...]  → sonra boy.py + variants.py (yükseklik 900 ile yazılır; pencere panosu hariç).
Metinler docs/specs/2026-10-04-flow-contract.md §9, §1.4, §1.5, §8.1'den birebir. Kalıplar: alan hatası ve uyarı kutusu
A-Form-Hata, pencere A-Hesap-Sil, durum etiketleri A-Gelir (Paid / Refunded), giriş düzeni parts.auth_page()."""
import sys
from parts import *
import parts

ONLY = set(sys.argv[1:])  # ad verilirse yalnız o panolar yazılır (diğerlerinin yüksekliği sıfırlanmasın diye)


def write(name, *a, **k):
    if not ONLY or name[:-len('.dc.html')] in ONLY:
        parts.write(name, *a, **k)


LONG = 'a.very.long.address.for.testing@example-company.com'  # taşma sınavı: hiçbir görünüşte taşmamalı

# ---------------------------------------------------------------- ortak parçalar
INPUT_S = INPUT.replace('background: var(--bg)', 'background: var(--surface)')  # giriş sayfasındaki alanlar (A-Giris)
SUBMIT = ("display: flex; align-items: center; justify-content: center; min-height: 60px; border-radius: 12px; "
          "background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 17px; text-decoration: none")
OFF = "border: 0; background: var(--raised); color: var(--text-3); cursor: default"  # kapalı düğme (Marka-Bilesen-1)
H1A = f"margin: 0; {H4}"
LINK = "display: flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 500; text-decoration: none"
BACK = f'<a href="A-Giris.dc.html" style="align-self: flex-start; {QUIET}">{icon("back", 18)}Back to log in</a>'
GOOGLE = ('<button type="button" style="min-height: 52px; border-radius: 12px; border: 1px solid var(--edge-strong); background: transparent; '
          'color: var(--text); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer">Continue with Google</button>')
OR = ('<div aria-hidden="true" style="display: flex; align-items: center; gap: 16px; font-size: 13px; color: var(--text-3)">'
      '<span style="flex: 1; height: 1px; background: var(--line)"></span>or with email<span style="flex: 1; height: 1px; background: var(--line)"></span></div>')


def bad(style):
    """Hatalı alan kenarı (A-Form-Hata)."""
    assert 'border: 1px solid var(--edge-strong)' in style
    return style.replace('border: 1px solid var(--edge-strong)', 'border: 1.5px solid var(--warn)')


def field_err(text):
    """Alanın altındaki ileti (A-Form-Hata)."""
    return (f'<span style="display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 1.4; color: var(--warn)">'
            f'{icon("warning", 16, "flex: 0 0 auto")}{text}</span>')


def lead(text):
    return f'<strong style="font-weight: 600; color: var(--warn)">{text}</strong>'


def alert(html, bg='var(--surface)'):
    """Uyarı kutusu (A-Form-Hata): ilk cümle uyarı renginde, gerisi düz."""
    return (f'<p role="alert" style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; '
            f'background: {bg}; border: 1px solid var(--warn-edge); font-size: 15px; line-height: 1.5; color: var(--text)">'
            f'{icon("warning", 20, "flex: 0 0 auto; color: var(--warn)")}<span style="min-width: 0; overflow-wrap: anywhere">{html}</span></p>')


def note(html, bg='var(--surface)', mark='info'):
    """Yansız bilgi kutusu: uyarı kutusuyla aynı yapı, uyarı rengi yok."""
    color = 'var(--accent-text)' if mark == 'done' else 'var(--text-2)'
    return (f'<p role="status" style="margin: 0; display: flex; align-items: flex-start; gap: 12px; padding: 12px 16px; border-radius: 12px; '
            f'background: {bg}; border: 1px solid var(--edge); font-size: 15px; line-height: 1.5; color: var(--text)">'
            f'{icon(mark, 20, "flex: 0 0 auto; color: " + color)}<span style="min-width: 0; overflow-wrap: anywhere">{html}</span></p>')


# ---------------------------------------------------------------- giriş düzenindeki sayfalar
# parts.auth_page() ilk çizimdeki iç boşluğu taşıyor; tuvaldeki beş giriş panosu sonradan merdivene çekildi (48 / 60).
# Yeni sayfalar onlarla ve yama_g1.AUTH ile birebir aynı olsun diye <main> stili güncel hâline getirilir.
_MAIN_OLD = '<main style="flex: 1 1 420px; min-width: 0; box-sizing: border-box; padding: clamp(24px, 4vw, 56px); display: flex; align-items: center; justify-content: center">'
_MAIN_NOW = '<main style="flex: 1 1 420px; min-width: 0; box-sizing: border-box; padding: clamp(24px, 4vw, 48px) clamp(16px, 4vw, 60px); display: flex; align-items: center; justify-content: center">'


def auth(inner):
    s = auth_page(inner)
    assert s.count(_MAIN_OLD) == 1
    return s.replace(_MAIN_OLD, _MAIN_NOW)


def mark(name):
    return icon(name, 32, 'color: var(--warn)')


# ---- Doğrulama bağlantısının süresi dolmuş (§9). "Zaten doğrulanmış" hâli çizilmedi: metni raporda.
write('A-Baglanti-Gecersiz.dc.html', 'Verify link expired', ROOT_AUTH, auth(f'''
<div style="display: flex; flex-direction: column; gap: 12px">
{mark('warning')}
<h1 style="{H1A}">This link has expired.</h1>
<p style="margin: 0; {BODY2}">Links work for 24 hours.</p>
</div>
<a href="A-Eposta-Dogrula.dc.html" style="{SUBMIT}">Send a new link</a>
{BACK}
'''))

# ---- Şifre sıfırlama bağlantısı geçersiz: süresi dolmuş ya da kullanılmış (§9)
write('A-Sifre-Baglanti-Gecersiz.dc.html', 'Reset link expired', ROOT_AUTH, auth(f'''
<div style="display: flex; flex-direction: column; gap: 12px">
{mark('warning')}
<h1 style="{H1A}">This reset link no longer works.</h1>
<p style="margin: 0; {BODY2}">Links work for 1 hour and only once.</p>
</div>
<a href="A-Sifre-Unuttum.dc.html" style="{SUBMIT}">Send a new link</a>
{BACK}
'''))

# ---- Oturum bitti (§9, §1.4): giriş formu; girişten sonra kaldığı sayfaya döner (örnek: doldurulmuş form)
write('A-Oturum-Bitti.dc.html', 'Session expired', ROOT_AUTH, auth(f'''
<div style="display: flex; flex-direction: column; gap: 8px">
<h1 style="{H1A}">You were logged out.</h1>
<p style="margin: 0; {BODY2}">Log in to continue where you left off.</p>
</div>
{GOOGLE}
{OR}
<form style="display: flex; flex-direction: column; gap: 16px">
<label style="{LABEL}">Email
<input type="email" autocomplete="email" placeholder="name@example.com" style="{INPUT_S}">
</label>
<label style="{LABEL}">Password
<input type="password" autocomplete="current-password" style="{INPUT_S}">
</label>
<a href="A-Form.dc.html" style="{SUBMIT}">Log in</a>
</form>
<a href="A-Sifre-Unuttum.dc.html" style="align-self: flex-start; {QUIET}">Forgot password</a>
'''))

# ---- Hesap engelli (§9): tek yol destek
write('A-Hesap-Engelli.dc.html', 'Account blocked', ROOT_AUTH, auth(f'''
<div style="display: flex; flex-direction: column; gap: 12px">
{mark('private')}
<h1 style="{H1A}">This account is blocked.</h1>
<p style="margin: 0; {BODY2}">If you think this is a mistake, contact support.</p>
</div>
<a href="A-Iletisim.dc.html" style="{SECONDARY}">Contact support</a>
{BACK}
'''))

# ---- Yetki yok (§9): girişli menü + A-404 düzeni
ROOT_CENTER = ("min-height: 900px; box-sizing: border-box; background: var(--bg); color: var(--text); font-family: var(--body); "
               "padding: 0 clamp(16px, 4vw, 60px) 48px; display: flex; flex-direction: column")
write('A-Yetki-Yok.dc.html', 'No access', ROOT_CENTER, f'''<div style="flex: 1; width: 100%; max-width: 1320px; margin: 0 auto; display: flex; flex-direction: column">
{header_in()}
<main style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; text-align: center; padding: 48px 0">
{icon('private', 72, 'color: var(--text-3)', sw=1.5)}
<h1 style="margin: 0; max-width: 720px; {H3}; text-wrap: balance">You do not have access to this page.</h1>
<a href="Main.dc.html" style="display: flex; align-items: center; justify-content: center; min-height: 60px; padding: 0 32px; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 17px; text-decoration: none">Back to gallery</a>
</main>
</div>''')


# ---------------------------------------------------------------- durum panoları (KURALLAR §11)
STATE_WRAP = "max-width: 1320px; margin: 0 auto; padding-top: clamp(24px, 4vw, 48px); display: flex; flex-direction: column; gap: 32px"
CELLS = "display: flex; flex-wrap: wrap; gap: 32px"
CELL = "flex: 1 1 400px; min-width: 0; max-width: 520px; display: flex; flex-direction: column; gap: 12px"
WCELL = "flex: 1 1 560px; min-width: 0; max-width: 640px; display: flex; flex-direction: column; gap: 12px"  # pencere hücresi (KURALLAR §11)
GROUP_H = "margin: 0; font-size: 20px; font-weight: 600; line-height: 1.25; color: var(--text)"


def cell(label, inner, tag='h2', style=CELL):
    return f'<section style="{style}">\n<{tag} style="margin: 0; font-weight: 400; {SMALL}">{label}</{tag}>\n{inner.strip()}\n</section>'


def board(name, title, cells):
    body = (f'<div style="{STATE_WRAP}">\n<h1 style="margin: 0; {H4}; text-wrap: balance">{title}</h1>\n<div style="{CELLS}">\n'
            + '\n\n'.join(cells) + '\n</div>\n</div>')
    write(name + '.dc.html', title, ROOT_PAGE, body)


def grouped(name, title, groups):
    """6'dan fazla hücreli durum panosu: hücreler <h2> alt başlıklarıyla gruplanır, gruplar arası 48 px (KURALLAR §11).
    Hücre etiketi <h3>, hücrenin içindeki başlıklar <h4> / <h5>."""
    parts_ = [f'<section style="display: flex; flex-direction: column; gap: 24px">\n<h2 style="{GROUP_H}">{head}</h2>\n'
              f'<div style="{CELLS}">\n' + '\n\n'.join(cells) + '\n</div>\n</section>' for head, cells in groups]
    body = (f'<div style="{STATE_WRAP.replace("gap: 32px", "gap: 48px")}">\n<h1 style="margin: 0; {H4}; text-wrap: balance">{title}</h1>\n'
            + '\n\n'.join(parts_) + '\n</div>')
    write(name + '.dc.html', title, ROOT_PAGE, body)


# ---- A-Giris-Durumlar: giriş / kayıt formu (A-Giris'in sağ sütunu, sekmeler hariç)
COLUMN = "width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: 24px"
G_TITLE = "margin: 0; font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1; letter-spacing: -0.03em"
FORM = "display: flex; flex-direction: column; gap: 16px"
FORGOT = f'<a href="A-Sifre-Unuttum.dc.html" style="align-self: flex-start; {QUIET}">Forgot password</a>'
FREE = '<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">Your first video is free: one no-talking video in Fast quality. No card needed.</p>'
TERMS = ('<p style="margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-3)">By signing up you accept the '
         '<a href="A-Yasal.dc.html" style="padding: 16px 0">terms of use</a> and the <a href="A-Yasal.dc.html" style="padding: 16px 0">privacy policy</a>.</p>')
HINT = '<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">At least 8 characters.</span>'


def login(top, button):
    return f'''<div style="{COLUMN}">
<h3 style="{G_TITLE}">Welcome back.</h3>
{GOOGLE}
{OR}
<form style="{FORM}">
{top}
<label style="{LABEL}">Email
<input type="email" autocomplete="email" value="{LONG}" style="{INPUT_S}">
</label>
<label style="{LABEL}">Password
<input type="password" autocomplete="current-password" value="password" style="{INPUT_S}">
</label>
{button}
</form>
{FORGOT}
</div>'''


def signup(email, password):
    return f'''<div style="{COLUMN}">
<h3 style="{G_TITLE}">Create your account.</h3>
{FREE}
{GOOGLE}
{OR}
<form style="{FORM}">
{email}
{password}
<a href="A-Eposta-Dogrula.dc.html" style="{SUBMIT}">Sign up</a>
</form>
{TERMS}
</div>'''


board('A-Giris-Durumlar', 'Log in and sign up · states', [
    cell('Log in: wrong email or password', login(
        alert(lead('Email or password is not correct.')),
        f'<a href="Main.dc.html" style="{SUBMIT}">Log in</a>')),
    cell('Log in: too many tries', login(
        alert(lead('Too many tries.') + ' Wait 15 minutes or reset your password.'),
        f'<button type="button" aria-disabled="true" style="min-height: 60px; border-radius: 12px; {OFF}; font: inherit; font-size: 17px; font-weight: 600">Log in</button>')),
    cell('Google sign-in: cancelled or failed', f'''<div style="{COLUMN}">
<div style="display: flex; flex-direction: column; gap: 12px">
{GOOGLE}
{note('Google sign-in was cancelled. Nothing changed.')}
</div>
<div style="display: flex; flex-direction: column; gap: 12px">
{GOOGLE}
{alert(lead('Google sign-in did not work.') + ' Try again or use your email.')}
</div>
</div>'''),
    cell('Sign up: email already has an account', signup(
        f'''<div style="display: flex; flex-direction: column">
<label style="{LABEL}">Email
<input type="email" autocomplete="email" aria-invalid="true" value="{LONG}" style="{bad(INPUT_S)}">
{field_err('This email already has an account.')}
</label>
<div style="display: flex; flex-wrap: wrap; gap: 0 24px">
<a href="A-Giris.dc.html" style="{LINK}">Log in</a>
<a href="A-Sifre-Unuttum.dc.html" style="{LINK}">Reset password</a>
</div>
</div>''',
        f'''<label style="{LABEL}">Password
<input type="password" autocomplete="new-password" value="password" style="{INPUT_S}">
{HINT}
</label>''')),
    cell('Sign up: invalid email and weak password', signup(
        f'''<label style="{LABEL}">Email
<input type="email" autocomplete="email" aria-invalid="true" value="name.example.com" style="{bad(INPUT_S)}">
{field_err('Enter a valid email address.')}
</label>''',
        f'''<label style="{LABEL}">Password
<input type="password" autocomplete="new-password" aria-invalid="true" value="pass" style="{bad(INPUT_S)}">
{field_err('Use at least 8 characters.')}
</label>''')),
    cell('Verify your email: link sent again', f'''<div style="{COLUMN}">
<div style="display: flex; flex-direction: column; gap: 12px">
<h3 style="{H1A}">Verify your email.</h3>
<p style="margin: 0; {BODY2}; overflow-wrap: anywhere">We sent a link to <strong style="color: var(--text); font-weight: 600">{LONG}</strong>. Open it to activate your account and get your free video.</p>
</div>
<button type="button" aria-disabled="true" style="min-height: 52px; padding: 0 24px; border-radius: 12px; {OFF}; font: inherit; font-size: 15px; font-weight: 600">Send again</button>
{note('Sent again. You can send another in 60 seconds.', mark='done')}
<p style="margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; font-size: 15px; color: var(--text-2)">Wrong address? <a href="A-Giris.dc.html" style="display: flex; align-items: center; min-height: 44px; font-weight: 500; text-decoration: none">Change it</a></p>
</div>'''),
])


# ---- A-Hesap-Durumlar: profil kartı, bakiye, satın almalar, faturalar (A-Hesap'taki kartlarla aynı çizim).
# 13 hücre: <h2> grupları Profile / Balance / Purchases / Invoices. İade satırları sözleşme §8.1'in yedi durumu (birebir metin).
CARD_COL = CARD + "; display: flex; flex-direction: column"
H_CARD = "margin: 0; font-family: var(--display); font-weight: 700; font-size: 24px"
SELECT = "min-height: 52px; box-sizing: border-box; padding: 0 12px; border-radius: 12px; border: 1px solid var(--edge-strong); background: var(--bg); color: var(--text); font: inherit; font-size: 15px"
SAVE = '<button type="button" style="align-self: flex-start; min-height: 52px; padding: 0 24px; border-radius: 12px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer">Save</button>'
PASSWORD = f"""<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 16px; padding-top: 8px; border-top: 1px solid var(--line)">
<h5 style="margin: 0; font-size: 15px; font-weight: 600">Password</h5>
<a href="A-Sifre-Gonderildi.dc.html" style="display: flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 600; text-decoration: none">Change password</a>
</div>"""


def profile(email, after_email='', before_save='', save=SAVE):
    return f"""<div style="{CARD_COL}; gap: 16px">
<h4 style="{H_CARD}">Profile</h4>
<label style="{LABEL}">Name
<input type="text" autocomplete="name" placeholder="Your name" style="{INPUT}">
</label>
<label style="{LABEL}">Email
<input type="email" autocomplete="email" value="{email}" style="{INPUT}">
</label>
{after_email}<label style="{LABEL}">Language
<select style="{SELECT}"><option>English</option><option>Türkçe</option></select>
<span style="font-size: 13px; line-height: 1.4; color: var(--text-3)">Video language is chosen on each job.</span>
</label>
<label style="{LABEL}">Appearance
<select style="{SELECT}"><option>System</option><option>Dark</option><option>Light</option></select>
</label>
{before_save}{save}
{PASSWORD}
</div>"""


# Bakiye kartı (A-Hesap'taki yuvanın ölçüsü: gösterge sayısı aynı clamp). Tutulan kredi bakiyeye dahil değil (§8.1 Kilit).
BALANCE_HELD = f"""<div style="{CARD_COL}; gap: 24px">
<h4 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--text-2)">Your credit balance</h4>
<div style="display: flex; flex-direction: column; gap: 12px">
<p style="margin: 0; font-family: var(--display); font-weight: 800; font-size: clamp(48px, 15vw, 80px); line-height: 0.9; letter-spacing: -0.04em; overflow-wrap: anywhere">[BALANCE]</p>
<p style="margin: 0; {BODY2}">10 more credits are held for a refund request.</p>
</div>
<a href="A-Fiyatlar.dc.html" style="align-self: flex-start; box-sizing: border-box; display: flex; align-items: center; justify-content: center; min-height: 52px; padding: 0 24px; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 15px; text-decoration: none">Buy credits</a>
</div>"""

ROW = "display: flex; flex-direction: column; gap: 4px; padding: 12px 0 0; border-top: 1px solid var(--line)"
ROW_TOP = "display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 16px"
# Durum etiketi: parts.status() ile aynı sözcük, renk ve işaret (yönetimde A-Gelir aynı çizimi kullanır); işaret 18 px'lik
# kutuda ortalanır ki onay işaretiyle aynı hizada dursun.
STATE = "display: flex; white-space: nowrap; align-items: center; gap: 8px; font-size: 15px; font-weight: 600"


def _mark(inner):
    return f'<span style="display: flex; justify-content: center; width: 18px">{inner}</span>'


_DOT = '<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--accent-text)"></span>'
PAID = f'<span style="{STATE}; color: var(--accent-text)">{icon("done", 18, sw=2.6)}Paid</span>'
REQUESTED = f'<span style="{STATE}; color: var(--accent-text)">{_mark(_DOT)}Refund requested</span>'
SENT = f'<span style="{STATE}; color: var(--accent-text)">{_mark(_DOT)}Refund sent</span>'
REFUNDED = (f'<span style="{STATE}; color: var(--text-2)">'
            + _mark('<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--text-3)"></span>')
            + 'Refunded</span>')
FAILED = (f'<span style="{STATE}; color: var(--warn)">'
          + _mark('<span style="width: 8px; height: 8px; border-radius: 2px; background: var(--warn)"></span>') + 'Refund failed</span>')
ROW_LINK = "display: flex; align-items: center; min-height: 44px; font-size: 15px"
INVOICE = f'<a href="A-Fatura.dc.html" style="{ROW_LINK}; font-weight: 600; text-decoration: none">Download invoice</a>'
ASK = f'<a href="A-Hesap-Iade-Onay.dc.html" style="{ROW_LINK.replace("min-height: 44px;", "min-height: 44px; color: var(--text);")}; font-weight: 500; text-decoration: none">Request a refund</a>'
CANCEL = (f'<button type="button" style="{ROW_LINK}; padding: 0; border: 0; background: transparent; color: var(--text); font: inherit; '
          'font-size: 15px; font-weight: 500; cursor: pointer">Cancel request</button>')
SUPPORT = f'<a href="A-Iletisim.dc.html" style="{ROW_LINK}; font-weight: 600; text-decoration: none">Contact support</a>'


def purchase(pack, state, text='', links=(INVOICE,), box='', after=''):
    """Satın alma satırı (A-Hesap): paket + durum, tarih ve tutar, durum cümlesi, eylemler. box: satır içi uyarı kutusu."""
    text = f'\n<p style="margin: 0; font-size: 13px; line-height: 1.4; color: var(--text-2); text-wrap: pretty">{text}</p>' if text else ''
    box = f'\n<div style="padding-top: 8px">\n{box}\n</div>' if box else ''
    after = f'\n<div style="padding-bottom: 4px">\n{after}\n</div>' if after else ''
    return f"""<div style="{ROW}">
<div style="{ROW_TOP}">
<span style="font-size: 15px; font-weight: 600">{pack}</span>
{state}
</div>
<span style="font-size: 13px; color: var(--text-3)">[DATE] · [AMOUNT]</span>{text}{box}
<div style="display: flex; flex-wrap: wrap; gap: 0 24px">
{chr(10).join(links)}
</div>{after}
</div>"""


def purchases(rows, notice=''):
    notice = f'<div style="padding-bottom: 8px">\n{notice}\n</div>\n' if notice else ''
    return f"""<div style="{CARD_COL}; gap: 8px">
<h4 style="margin: 0 0 8px; font-family: var(--display); font-weight: 700; font-size: 24px">Purchases</h4>
{notice}{rows}
</div>"""


def c3(label, inner):
    return cell(label, inner, tag='h3')


grouped('A-Hesap-Durumlar', 'Account · states', [
    ('Profile', [
        c3('Saved', profile(LONG, save=(
            '<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px">\n'
            + SAVE.replace('align-self: flex-start; ', '') + f'\n<span role="status">{status("done", "Saved.")}</span>\n</div>'))),
        c3('Could not save', profile(LONG, before_save=alert(
            lead('Could not save.') + ' Your changes are still here. Try again.', 'var(--bg)') + '\n')),
        c3('Email change waiting', profile('[EMAIL]', after_email=note(
            f'We sent a link to {LONG}. Your email changes after you open it. Until then you log in with the old one.', 'var(--bg)') + '\n')),
        c3('Password: account opened with Google', f"""<div style="{CARD_COL}; gap: 8px">
<h4 style="margin: 0; font-size: 15px; font-weight: 600">Password</h4>
<p style="margin: 0; {BODY2}">You sign in with Google. There is no password to change.</p>
</div>"""),
    ]),
    ('Balance', [
        c3('Credits held for a refund request', BALANCE_HELD),
    ]),
    ('Purchases', [
        c3('Refundable and not refundable', purchases('\n'.join([
            purchase('Starter pack', PAID, links=(INVOICE, ASK)),
            purchase('Standard pack', PAID, 'Not refundable: credits from this pack were used.'),
            purchase('Starter pack', PAID, 'Not refundable: more than 14 days ago.'),
        ]))),
        c3('Refund requested', purchases(
            purchase('Starter pack', REQUESTED, 'We answer within 2 business days. The 10 credits are held until then.', links=(INVOICE, CANCEL)))),
        c3('Request cancelled', purchases(
            purchase('Starter pack', PAID, links=(INVOICE, ASK)),
            notice=note('Request cancelled. Your 10 credits are available again.', 'var(--bg)', mark='done'))),
        c3('Refund sent', purchases(
            purchase('Starter pack', SENT, '10 credits were removed. The money is on its way to your payment method; this takes a few days.'))),
        c3('Refunded', purchases(
            purchase('Starter pack', REFUNDED, 'Refunded on [DATE]. $19 went back to your payment method.'))),
        c3('Refund failed', purchases(
            purchase('Starter pack', FAILED, links=(SUPPORT, INVOICE), box=alert(
                lead('The refund did not go through.') + ' Your 10 credits are back in your balance. Contact support and we sort it out.', 'var(--bg)')))),
    ]),
    ('Invoices', [
        c3('No invoices yet', purchases(
            f'<p style="margin: 0; padding: 12px 0 0; border-top: 1px solid var(--line); {BODY2}">No invoices yet.</p>')),
        c3('Download failed', purchases(
            purchase('Standard pack', PAID, after=alert(lead('Could not download the invoice.') + ' Try again.', 'var(--bg)')))),
    ]),
])


# ---- A-Hesap-Sil-Durumlar: silme penceresi (A-Hesap-Sil ile aynı çizim)
DIALOG = ("width: 100%; box-sizing: border-box; padding: 24px; border-radius: 24px; background: var(--surface); "
          "border: 1px solid var(--edge); display: flex; flex-direction: column; gap: 24px")
D_ROW = "display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; padding: 12px 0; border-top: 1px solid var(--edge); font-size: 15px"
D_DD = "margin: 0 0 0 auto; font-weight: 600; text-align: right; overflow-wrap: anywhere"
D_HEAD = f'<h3 style="margin: 0; {H4}">Delete your account?</h3>'
WHAT = f'''<div style="display: flex; flex-direction: column; gap: 12px">
<dl style="margin: 0; display: flex; flex-direction: column">
<div style="{D_ROW}"><dt style="color: var(--text-2)">Your videos, images and templates</dt><dd style="{D_DD}">deleted</dd></div>
<div style="{D_ROW}; border-bottom: 1px solid var(--edge)"><dt style="color: var(--text-2)">Remaining credits</dt><dd style="{D_DD}">[BALANCE] credits, lost</dd></div>
</dl>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">Invoices are kept for as long as tax law requires.</p>
</div>'''
KEEP = "flex: 2 1 240px; " + SECONDARY
DEL = "flex: 1 1 160px; " + BTN + "; min-height: 52px; padding: 0 24px; font-size: 15px"
KEEP_ON = f'<a href="A-Hesap.dc.html" style="{KEEP}">Keep my account</a>'
DEL_ON = f'<button type="button" style="{DEL}; border: 1px solid var(--warn); background: transparent; color: var(--warn)">Delete account</button>'
DEL_OFF = f'<button type="button" aria-disabled="true" style="{DEL}; {OFF}">Delete account</button>'
DIALOG_CELL = DIALOG.replace('width: 100%;', 'width: 100%; max-width: 592px;')  # A-Hesap-Sil: 640 px pano - 2 × 24 px
OFF_2 = "border: 1px solid var(--edge); background: transparent; color: var(--text-3); cursor: default"  # kapalı ikincil düğme (A-Onay-Durumlar)


def confirm(readonly=''):
    return f'''<label style="{LABEL}">Type DELETE to confirm
<input type="text" autocomplete="off" value="DELETE"{readonly} style="{INPUT}">
</label>'''


def dialog(inner):
    return f'<div style="{DIALOG_CELL}">\n{inner.strip()}\n</div>'


def wcell(label, inner):
    return cell(label, inner, style=WCELL)


board('A-Hesap-Sil-Durumlar', 'Delete account · states', [
    wcell('A job is running', dialog(f'''
{D_HEAD}
{alert(lead('You have a job running.') + ' Wait until it finishes, then delete your account.', 'var(--bg)')}
<div style="display: flex; flex-wrap: wrap; gap: 12px">
{KEEP_ON}
{DEL_OFF}
</div>''')),
    wcell('Deleting', dialog(f'''
<div style="display: flex; flex-direction: column; gap: 8px">
{D_HEAD}
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">This cannot be undone. Here is what happens:</p>
</div>
{WHAT}
{confirm(' readonly')}
<div style="display: flex; flex-wrap: wrap; gap: 12px">
<button type="button" aria-disabled="true" style="{KEEP.replace('border: 1px solid var(--edge-strong); background: transparent; color: var(--text)', OFF_2)}">Keep my account</button>
<button type="button" aria-disabled="true" style="{DEL}; gap: 8px; {OFF}">{icon('generating', 18)}Deleting…</button>
</div>''')),
    wcell('Could not delete', dialog(f'''
<div style="display: flex; flex-direction: column; gap: 8px">
{D_HEAD}
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">This cannot be undone. Here is what happens:</p>
</div>
{WHAT}
{confirm()}
{alert(lead('Could not delete your account.') + ' Nothing was removed. Try again.', 'var(--bg)')}
<div style="display: flex; flex-wrap: wrap; gap: 12px">
{KEEP_ON}
{DEL_ON}
</div>''')),
])


# ---- A-Hesap-Iade-Onay: iade isteği onayı (§8.1). Pencere panosu: kap A-Hesap-Sil ile aynı (mobil yaması da onunki),
# düğme düzeni A-Onay. Kök sabit yükseklikte: boy.py atlar, yükseklik önizlemenin "icerik" değerinden elle.
ROOT_DIALOG = ("width: 640px; height: {h}px; box-sizing: border-box; padding: 24px; background: var(--bg); color: var(--text); "
               "font-family: var(--body); display: flex; align-items: center; justify-content: center")
REFUND_H = 280
write('A-Hesap-Iade-Onay.dc.html', 'Account · confirm refund request', ROOT_DIALOG.format(h=REFUND_H), f'''<div role="dialog" aria-labelledby="iade-baslik" style="{DIALOG}">
<div style="display: flex; flex-direction: column; gap: 8px">
<h1 id="iade-baslik" style="margin: 0; {H4}; text-wrap: balance">Request a refund for Starter · 10 credits · $19?</h1>
<p style="margin: 0; font-size: 15px; line-height: 1.5; color: var(--text-2)">The 10 credits are held until we answer.</p>
</div>
<div style="display: flex; flex-wrap: wrap-reverse; gap: 12px">
<a href="A-Hesap.dc.html" style="flex: 1 1 160px; {SECONDARY}">Keep the credits</a>
<a href="A-Hesap.dc.html" style="flex: 2 1 240px; {PRIMARY}">Request refund</a>
</div>
</div>''', w=640, h=REFUND_H)
