"""Yönetim paneli (süper admin) 1: genel bakış, kullanıcılar, kullanıcı detayı, gelir, krediler.
Menü, sekme, sayı kutusu, tablo panel.py'den gelir; yalnız bu betiğe özgü küçük parçalar aşağıda tanımlı."""
from panel import *

T = [t['title'] for t in TEMPLATES]
DETAIL = 'A-Kullanici-Detay.dc.html'
PERIOD = segment(['Today', '7 days', '30 days', 'All time'], '30 days', 'Period')
EXPORT = f'<button type="button" style="{SECONDARY}; gap: 8px">{icon("download", 18)}Export CSV</button>'
MAIN = "display: flex; flex-direction: column; gap: 32px"
SPLIT = "display: flex; flex-wrap: wrap; gap: 32px"
HALF = "flex: 1 1 560px"
# 5 sütunluk kutu ölçüsü: 2 kutuluk yan 496 px'ten, 3 kutuluk yan 752 px'ten büyür; 1320'de kutular 248 px olur
SIDE2, SIDE3 = "flex: 2 1 496px; min-width: 0", "flex: 3 1 752px; min-width: 0"
SR = "position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)"
ACTIONS = f'<span style="{SR}">Actions</span>'
LINK = ROW_LINK + "; margin: -12px 0"  # 44 px'lik dokunma hedefi satırı yükseltmesin
ENTITY = LINK + "; color: var(--text); text-decoration: underline; text-decoration-color: var(--edge-strong); text-underline-offset: 4px"
ACT = ("display: inline-flex; align-items: center; min-height: 44px; margin: -12px 0; padding: 0; border: 0; background: transparent; "
       "color: var(--accent-text); font: inherit; font-size: 15px; font-weight: 500; cursor: pointer")
BACK = "display: flex; align-items: center; gap: 8px; min-height: 44px; align-self: flex-start; color: var(--text-3); text-decoration: none; font-size: 15px"
H_SUB = "margin: 0; font-size: 17px; font-weight: 600; line-height: 1.3"
WARN_BTN = SECONDARY.replace('var(--edge-strong)', 'var(--warn-edge)').replace('color: var(--text)', 'color: var(--warn)')
assert 'var(--warn-edge)' in WARN_BTN and 'color: var(--warn)' in WARN_BTN
HEIGHT = {'A-Admin-Genel.dc.html': 1420, 'A-Kullanicilar.dc.html': 940, 'A-Kullanici-Detay.dc.html': 1980,
          'A-Gelir.dc.html': 1420, 'A-Krediler.dc.html': 1200}


def put(name, title, current, inner, sub=''):
    """Panel sayfası: menü (+ varsa ikinci düzey sekmeler menüye bitişik), altında içerik."""
    top = header_panel(current)
    if sub:
        top = f'<div>\n{top}\n{sub}\n</div>'
    body = f'<div style="{PANEL_WRAP}">\n{top}\n\n<main style="{MAIN}">\n{inner.strip()}\n</main>\n</div>'
    h = HEIGHT[name]
    write(name, title, ROOT_PAGE.replace('min-height: 900px', f'min-height: {h}px'), body, h=h)


def sec(hid, title, inner, right='', style=''):
    """Bölüm: küçük h2 başlık (sağında isteğe bağlı süzgeç), altında içerik."""
    head = f'<h2 id="{hid}" style="margin: 0; {H6}">{title}</h2>'
    if right:
        head = ('<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px">\n'
                f'{head}\n{right}\n</div>')
    style = f'{style}; ' if style else ''
    return (f'<section aria-labelledby="{hid}" style="{style}min-width: 0; display: flex; flex-direction: column; gap: 16px">\n'
            f'{head}\n{inner.strip()}\n</section>')


def tbl(*args, **kw):
    """panel.table + son satırın alt çizgisi kalkar (kutunun kenarıyla üst üste binip 2 px görünüyordu)."""
    head, tr, last = table(*args, **kw).rpartition('<tr>')
    return head + tr + last.replace('border-bottom: 1px solid var(--line)', 'border-bottom: 0')


def grow(html):
    """Parçanın ilk öğesini bulunduğu sütunda boşluğu dolduracak şekilde uzatır."""
    return html.replace('style="', 'style="flex: 1; ', 1)


_MARK = re.compile(r'(<span style="width: 8px; height: 8px;[^>]*></span>)')
_BOX = r'<span style="display: flex; justify-content: center; width: 18px">\1</span>'
_OFF = ('<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-2)">'
        '<span style="width: 8px; height: 8px; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--text-3)"></span>')


def st(kind, label):
    """Tablo durumu. done / stopped / run → parts.status; off → renk taşımayan durum (Refunded, Not yet): içi boş halka.
    8 px'lik işaretler onay ikonuyla aynı 18 px'lik yere oturur; böylece sütunda yazılar alt alta hizalı kalır."""
    s = f'{_OFF}{label}</span>' if kind == 'off' else status(kind, label)
    return _MARK.sub(_BOX, s, 1).replace('display: flex;', 'display: flex; white-space: nowrap;', 1)


def verified(yes):
    """E-posta doğrulaması bir özelliktir, uyarı değil: renk taşımaz."""
    if yes:
        return f'<span style="display: flex; align-items: center; gap: 8px; white-space: nowrap">{icon("done", 18, "color: var(--text-3)", 2.6)}Verified</span>'
    return st('off', 'Not verified')


def user():
    return f'<a href="{DETAIL}" style="{ENTITY}">[EMAIL]</a>'


def invoice(has=True):
    if not has:
        return '<span style="color: var(--text-3)">No invoice</span>'
    return ('<span style="display: inline-flex; align-items: center; gap: 12px; white-space: nowrap">[INVOICE NUMBER]'
            f'<a href="A-Fatura.dc.html" style="{ENTITY}">PDF</a></span>')


def change(sign):
    if sign == '+':
        return '<span style="font-weight: 600; color: var(--accent-text)">+[CREDITS]</span>'
    if sign == '-':
        return '<span style="font-weight: 600; color: var(--text)">−[CREDITS]</span>'
    return '<span style="font-weight: 600">0</span>'


PAY = {'paid': st('done', 'Paid'), 'open': st('stopped', 'Not completed'), 'refunded': st('off', 'Refunded')}
JOB = {'done': st('done', 'Done'), 'run': st('run', 'Running'), 'stopped': st('stopped', 'Stopped'), 'none': st('off', 'Not yet')}
# Kredi hareketi: tür, işaret, not. Kullanıcı detayındaki geçmiş ile Credits sayfasındaki defter aynı satırları taşır.
MOVES = [('Purchase', '+', 'Standard pack'), ('Generation', '-', T[2]), ('Added by admin', '+', '[REASON]'),
         ('Refund', '-', 'Starter pack'), ('Generation', '-', T[0]), ('Free video', '0', T[1])]


# ---- 1. Genel bakış
def need(href, title, text, warn=False, first=False):
    """Needs attention satırı: sayı, başlık, bir cümle; bütün satır bağlantıdır. Uyarı rengi yalnız gerçek uyarıda."""
    color = 'var(--warn)' if warn else 'var(--text)'
    mark = f'<span style="display: flex; color: var(--warn)">{icon("warning", 18)}</span>' if warn else ''
    line = '' if first else '; border-top: 1px solid var(--line)'
    return (f'<li style="flex: 1; display: flex{line}">\n'
            f'<a href="{href}" style="flex: 1; display: flex; align-items: center; gap: 16px; min-height: 72px; box-sizing: border-box; '
            'padding: 12px 24px; color: var(--text); text-decoration: none">\n'
            f'<span style="min-width: 96px; {H5}; font-variant-numeric: tabular-nums; color: {color}">[COUNT]</span>\n'
            '<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px">\n'
            f'<span style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; line-height: 1.4">{title}{mark}</span>\n'
            f'<span style="{SMALL}">{text}</span>\n</span>\n'
            f'<span style="display: flex; color: var(--text-3)">{icon("forward")}</span>\n</a>\n</li>')


def tiles(items, style):
    return f'<div style="{style}; {TILES}; grid-auto-rows: 1fr">\n' + '\n'.join(tile(*i) for i in items) + '\n</div>'


customers = [('Users', '[COUNT]', 'All accounts, verified or not'), ('New sign-ups', '[COUNT]', 'Accounts created in this period'),
             ('Verified emails', '[COUNT]', 'Confirmed their email address'), ('Paying users', '[COUNT]', 'Bought at least one credit pack')]
money = [('Revenue', '[AMOUNT]', 'Paid purchases in this period'), ('Credits sold', '[CREDITS]', 'Credits in paid packs'),
         ('Credits spent', '[CREDITS]', 'Used to generate videos'), ('Free videos used', '[COUNT]', 'First video, free of charge'),
         ('Generation cost', '[AMOUNT]', 'Paid to generate the videos'), ('Margin', '[AMOUNT]', 'Revenue minus generation cost')]
attention = ('<ul style="flex: 1; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-radius: 16px; '
             'border: 1px solid var(--line); background: var(--surface)">\n'
             + need('A-Isler.dc.html', 'Stopped jobs', 'Jobs that stopped before they finished.', warn=True, first=True) + '\n'
             + need('A-Gelir.dc.html', 'Payments not completed', 'Checkouts that were started but not paid.') + '\n'
             + need('A-Gelen.dc.html', 'Templates waiting to publish', 'Prepared templates that are not in the gallery yet.') + '\n</ul>')
packs5 = ['Standard pack', 'Starter pack', 'Studio pack', 'Standard pack', 'Starter pack']
latest_buy = tbl('Latest purchases', ['Date', 'User', 'Pack', 'Amount'], [['[DATE]', user(), p, '[AMOUNT]'] for p in packs5], min_w=480, num=(3,))
latest_new = tbl('Latest sign-ups', ['Date', 'User', 'Email', 'First video'],
                   [['[DATE]', user(), verified(v), JOB[j]] for v, j in
                    [(True, 'done'), (True, 'run'), (False, 'none'), (True, 'none'), (True, 'stopped')]], min_w=520)


def see_all(tbl, text, href):
    return (f'<div style="display: flex; flex-direction: column; gap: 4px">\n{tbl}\n'
            f'<a href="{href}" style="{QUIET}; align-self: flex-start">{text}{icon("forward", 18)}</a>\n</div>')


put('A-Admin-Genel.dc.html', 'Admin: overview', 'overview', f'''
{page_head('Overview', 'Customers, payments, credits, and what the videos cost to generate.', PERIOD)}

<div style="{SPLIT}">
{sec('h-customers', 'Customers', tiles(customers, 'flex: 1'), style=SIDE2)}
{sec('h-money', 'Money and credits', tiles(money, 'flex: 1'), style=SIDE3)}
</div>

<div style="{SPLIT}">
{sec('h-attention', 'Needs attention', attention, style=HALF)}
{sec('h-chart', 'Revenue and generation cost', grow(chart_slot('Revenue and generation cost per day')), style=HALF)}
</div>

<div style="{SPLIT}">
{sec('h-buy', 'Latest purchases', see_all(latest_buy, 'See all purchases', 'A-Gelir.dc.html'), style=HALF)}
{sec('h-new', 'Latest sign-ups', see_all(latest_new, 'See all users', 'A-Kullanicilar.dc.html'), style=HALF)}
</div>
''')


# ---- 2. Kullanıcılar
search = (f'<label style="position: relative; flex: 1 1 320px; max-width: 420px; min-width: 0; display: flex; align-items: center">\n'
          f'<span style="{SR}">Search users</span>\n'
          f'<span style="position: absolute; left: 16px; display: flex; color: var(--text-3); pointer-events: none">{icon("search")}</span>\n'
          f'<input type="search" placeholder="Search by email or name" style="{INPUT}; width: 100%; padding-left: 48px">\n</label>')
who = (f'<span style="display: flex; flex-direction: column; gap: 4px"><span>[EMAIL]</span>'
       f'<span style="{SMALL}; font-weight: 400">[NAME]</span></span>')
users = tbl('Users', ['User', 'Joined', 'Email', 'Balance', 'Paid in total', 'Credits spent', 'Videos', 'Last active', 'Status', ACTIONS],
              [[who, '[DATE]', verified(v), '[BALANCE]', '[AMOUNT]', '[CREDITS]', '[COUNT]', '[DATE]',
                st('run', 'Active') if a else st('stopped', 'Blocked'), f'<a href="{DETAIL}" style="{LINK}">Open</a>']
               for v, a in [(True, True), (True, True), (False, True), (True, False), (True, True), (False, True)]],
              min_w=1120, num=(3, 4, 5, 6, 9))

put('A-Kullanicilar.dc.html', 'Admin: users', 'users', f'''
{page_head('Users', 'Everyone who signed up. Open a user to see purchases, jobs, and credit history.', EXPORT)}

<section aria-label="User list" style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px">
{search}
{segment(['All', 'Paying', 'Free video only', 'Not verified', 'Blocked'], 'All', 'Filter')}
</div>
{users}
{pager()}
</section>
''')


# ---- 3. Kullanıcı detayı
buys = tbl('Purchases', ['Date', 'Pack', 'Credits', 'Amount', 'Invoice', 'Status'],
             [['[DATE]', p, '[CREDITS]', '[AMOUNT]', invoice(s != 'open'), PAY[s]] for p, s in
              [('Standard pack', 'paid'), ('Studio pack', 'open'), ('Starter pack', 'refunded'), ('Standard pack', 'paid'), ('Starter pack', 'paid')]],
             num=(2, 3))
jobs = tbl('Jobs', ['Started', 'Template', 'Format', 'Quality', 'Language', 'Credits', 'Status', ACTIONS],
             [['[DATE]', t, f, q, 'English', c, JOB[s], f'<a href="A-Isler.dc.html" style="{LINK}">Open</a>'] for t, f, q, c, s in
              [(T[2], 'Talking', 'Best', '[CREDITS]', 'run'), (T[3], 'No talking', 'Best', '[CREDITS]', 'stopped'),
               (T[0], 'No talking', 'Fast', '[CREDITS]', 'done'), (T[4], 'No talking', 'Best', '[CREDITS]', 'done'),
               (T[1], 'No talking', 'Fast', 'Free video', 'done')]],
             num=(5, 7))
history = tbl('Credit history', ['Date', 'Type', 'Change', 'Note', 'Balance after'],
                [['[DATE]', kind, change(sign), note, '[BALANCE]'] for kind, sign, note in MOVES], num=(2, 4))
facts = [('Balance', '[BALANCE]', 'Credits the user can spend now'), ('Paid in total', '[AMOUNT]', 'All paid purchases'),
         ('Credits bought', '[CREDITS]', 'From credit packs'), ('Credits spent', '[CREDITS]', 'Used to generate videos'),
         ('Videos generated', '[COUNT]', 'Finished videos')]
actions = f'''<div style="{CARD}; display: flex; flex-wrap: wrap; gap: 24px 48px">
<form aria-labelledby="h-add" style="flex: 3 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 16px">
<h3 id="h-add" style="{H_SUB}">Add credits</h3>
<div style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px">
<label style="{LABEL}; flex: 0 1 160px; min-width: 0">Credits to add
<input type="number" min="1" step="1" inputmode="numeric" placeholder="0" style="{INPUT}; width: 100%">
</label>
<label style="{LABEL}; flex: 1 1 280px; min-width: 0">Reason
<input type="text" required="required" aria-describedby="add-hint" placeholder="Why you are adding credits" style="{INPUT}; width: 100%">
</label>
<button type="button" style="{PRIMARY}">Add credits</button>
</div>
<p id="add-hint" style="margin: 0; {SMALL}">A reason is required. It is shown in the credit history.</p>
</form>
<div role="group" aria-labelledby="h-access" style="flex: 2 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 16px">
<h3 id="h-access" style="{H_SUB}">Access</h3>
<div style="margin-top: auto; display: flex; flex-wrap: wrap; gap: 12px">
<button type="button" style="{SECONDARY}">Send password reset email</button>
<button type="button" style="{WARN_BTN}">Block user</button>
</div>
<p style="margin: 0; {SMALL}">A blocked user cannot log in. Their credits are not deleted.</p>
</div>
</div>'''

put('A-Kullanici-Detay.dc.html', 'Admin: user detail', 'users', f'''
<section aria-label="User" style="display: flex; flex-direction: column; gap: 8px">
<a href="A-Kullanicilar.dc.html" style="{BACK}">{icon('back', 18)}Users</a>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px">
<h1 style="margin: 0; min-width: 0; overflow-wrap: anywhere; {H3}">[EMAIL]</h1>
{status('run', 'Active')}
</div>
<p style="margin: 0; {BODY2}">Joined [DATE] · Email verified · Last active [DATE]</p>
</section>

{tiles(facts, 'min-width: 0')}

{sec('h-actions', 'Actions', actions)}

{sec('h-buys', 'Purchases', buys)}

{sec('h-jobs', 'Jobs', jobs)}

{sec('h-history', 'Credit history', history)}
''')


# ---- 4. Gelir
sales = [('Revenue', '[AMOUNT]', 'Paid purchases in this period'), ('Purchases', '[COUNT]', 'Paid credit pack purchases'),
         ('Average purchase', '[AMOUNT]', 'Revenue divided by purchases'), ('Paying users', '[COUNT]', 'Bought at least one credit pack'),
         ('Payments not completed', '[COUNT]', 'Checkout started, not paid'), ('Refunds', '[AMOUNT]', 'Money returned to customers')]
by_pack = tbl('Revenue by credit pack', ['Pack', 'Price', 'Credits', 'Sold', 'Revenue', 'Share of revenue'],
                [[p, '[PRICE]', '[CREDITS]', '[COUNT]', '[AMOUNT]', '[PERCENT]'] for p in ('Starter pack', 'Standard pack', 'Studio pack')],
                min_w=720, num=(1, 2, 3, 4, 5))
refund = f'<button type="button" style="{ACT}">Refund</button>'
purchases = tbl('Purchases', ['Date', 'User', 'Pack', 'Credits', 'Amount', 'Tax', 'Invoice', 'Status', ACTIONS],
                  [['[DATE]', user(), p, '[CREDITS]', '[AMOUNT]', '[AMOUNT]', invoice(s != 'open'), PAY[s], refund if s == 'paid' else '']
                   for p, s in [('Standard pack', 'paid'), ('Starter pack', 'open'), ('Studio pack', 'paid'), ('Standard pack', 'refunded'),
                                ('Starter pack', 'paid'), ('Standard pack', 'open')]],
                  min_w=1120, num=(3, 4, 5, 8))
chart = chart_slot('Revenue per day').replace('style="', f'style="{SIDE2}; ', 1)

put('A-Gelir.dc.html', 'Admin: revenue', 'revenue', f'''
{page_head('Revenue', 'Credit pack purchases, invoices, and refunds.', PERIOD + chr(10) + EXPORT)}

<div style="{SPLIT}">
{tiles(sales, SIDE3)}
{chart}
</div>

{sec('h-packs', 'By credit pack', by_pack)}

{sec('h-purchases', 'Purchases', purchases + chr(10) + pager())}
''', sub=subnav(SUB_REVENUE, 'purchases', 'Revenue sections'))


# ---- 5. Krediler
credits = [('Credits sold', '[CREDITS]', 'Credits in paid packs'), ('Credits spent', '[CREDITS]', 'Used to generate videos'),
           ('Unspent balance', '[CREDITS]', 'Credits customers still hold'), ('Free videos given', '[COUNT]', 'One per verified email'),
           ('Added by admin', '[CREDITS]', 'Given by hand, with a reason'), ('Refunded', '[CREDITS]', 'Removed by purchase refunds')]


def spending(title, names):
    """Küçük döküm tablosu: başlığı ilk sütun başlığıdır."""
    return tbl(title, [title, 'Jobs', 'Credits', 'Generation cost'], [[n, '[COUNT]', '[CREDITS]', '[AMOUNT]'] for n in names],
                 min_w=440, num=(1, 2, 3))


ledger = tbl('Credit ledger', ['Date', 'User', 'Type', 'Change', 'Note', 'Balance after'],
               [['[DATE]', user(), kind, change(sign), note, '[BALANCE]'] for kind, sign, note in MOVES], num=(3, 5))

put('A-Krediler.dc.html', 'Admin: credits', 'revenue', f'''
{page_head('Credits', 'Every credit that was sold, given, or spent.', PERIOD)}

<div style="{SPLIT}">
{tiles(credits, SIDE3)}
<div style="{SIDE2}; display: flex; flex-direction: column; justify-content: space-between; gap: 16px">
{spending('Spending by quality', ['Fast', 'Best'])}
{spending('Spending by format', ['No talking', 'Talking'])}
</div>
</div>

{sec('h-ledger', 'Credit ledger', ledger + chr(10) + pager(),
     right=segment(['All', 'Purchases', 'Generations', 'Free videos', 'Added by admin', 'Refunds'], 'All', 'Type'))}
''', sub=subnav(SUB_REVENUE, 'credits', 'Revenue sections'))
