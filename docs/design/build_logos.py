# Logo çalışması: 10 ad x 4 logo. Önizleme sayfaları ve .dc.html panoları yazar.
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, '..', 'vk-design', 'project')
PREV = os.path.join(ROOT, 'preview')
os.makedirs(PREV, exist_ok=True)

INK, BONE, LIME, SURF = '#0B0C0A', '#F2F3EC', '#C8F03C', '#151712'
PAL = {
    'dark': dict(bg=INK, fg=BONE, ac=LIME),
    'surface': dict(bg=SURF, fg=BONE, ac=LIME),
    'lime': dict(bg=LIME, fg=INK, ac=INK),
    'bone': dict(bg=BONE, fg=INK, ac=INK),
}
D, S_, L, B = PAL['dark'], PAL['surface'], PAL['lime'], PAL['bone']
BG = "'Bricolage Grotesque', system-ui, sans-serif"
UB = "'Unbounded', system-ui, sans-serif"
IS = "'Instrument Serif', Georgia, serif"
AN = "'Anton', Impact, sans-serif"
SY = "'Syne', system-ui, sans-serif"
MM = "'Martian Mono', ui-monospace, monospace"
ON = "'Onest', system-ui, sans-serif"
FONTS = ("https://fonts.googleapis.com/css2?family=Anton&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800"
         "&family=Instrument+Serif:ital@0;1&family=Martian+Mono:wght@500;700;800&family=Onest:wght@400;500;600"
         "&family=Syne:wght@700;800&family=Unbounded:wght@500;700;900&display=swap")


def svg(vb, w, h, inner):
    return (f'<svg viewBox="{vb}" fill="none" aria-hidden="true" '
            f'style="width: {w}em; height: {h}em; flex: 0 0 auto; display: block">{inner}</svg>')


def word(text, fam, wt, ls, extra=''):
    return (f'<span style="font-family: {fam}; font-weight: {wt}; letter-spacing: {ls}; line-height: 1; '
            f'white-space: nowrap{extra}">{text}</span>')


def lock(align, gap, inner):
    return f'<span style="display: inline-flex; align-items: {align}; gap: {gap}em">{inner}</span>'


def em(t):
    return f'<em style="font-style: italic">{t}</em>'


def stack(fam, lh, ls, inner, align='flex-start'):
    return (f'<span style="display: inline-flex; flex-direction: column; align-items: {align}; font-family: {fam}; '
            f'font-weight: 400; line-height: {lh}; letter-spacing: {ls}; white-space: nowrap">{inner}</span>')


# ---------- simgeler (h: yükseklik, em) ----------
def m_twin(p, h):
    return svg('0 0 42 32', round(h * 42 / 32, 3), h,
               f'<rect x="1.5" y="1.5" width="15" height="29" rx="3" stroke="{p["fg"]}" stroke-width="3"></rect>'
               f'<rect x="25.5" y="1.5" width="15" height="29" rx="3" fill="{p["ac"]}" stroke="{p["ac"]}" stroke-width="3"></rect>')


def m_k(c, h):
    return svg('0 0 28 32', round(h * 28 / 32, 3), h,
               f'<path d="M4 4v24" stroke="{c}" stroke-width="6.4" stroke-linecap="round"></path>'
               f'<path d="M23.5 4L11.5 16l12 12" stroke="{c}" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"></path>')


def kbadge(p, size, shape='square'):
    if shape == 'cut':
        base = f'<path d="M22 0H68L96 28V74a22 22 0 0 1-22 22H22A22 22 0 0 1 0 74V22A22 22 0 0 1 22 0z" fill="{p["ac"]}"></path>'
        k = (f'<path d="M33 28v40" stroke="{p["bg"]}" stroke-width="11" stroke-linecap="round"></path>'
             f'<path d="M61 30L45 48l16 20" stroke="{p["bg"]}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"></path>')
    else:
        base = f'<rect width="96" height="96" rx="22" fill="{p["ac"]}"></rect>'
        k = (f'<path d="M35 27v42" stroke="{p["bg"]}" stroke-width="11" stroke-linecap="round"></path>'
             f'<path d="M65 27L46.5 48 65 69" stroke="{p["bg"]}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"></path>')
    return svg('0 0 96 96', size, size, base + k)


def m_cuts(p, h):
    return svg('0 0 34 32', round(h * 34 / 32, 3), h,
               f'<path d="M9 2h9l-8 28H1z" fill="{p["fg"]}"></path><path d="M24 2h9l-8 28h-9z" fill="{p["ac"]}"></path>')


def m_arrows(c, h, sw=4):
    return svg('0 0 32 28', round(h * 32 / 28, 3), h,
               f'<path d="M3 8h24M21 2l6 6-6 6" stroke="{c}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"></path>'
               f'<path d="M29 20H5M11 14l-6 6 6 6" stroke="{c}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"></path>')


def m_cards(p, h):
    return svg('0 0 50 44', round(h * 50 / 44, 3), h,
               f'<rect x="6" y="8" width="17" height="28" rx="4" stroke="{p["fg"]}" stroke-width="3" transform="rotate(-10 14.5 22)"></rect>'
               f'<rect x="27" y="8" width="17" height="28" rx="4" fill="{p["ac"]}" transform="rotate(10 35.5 22)"></rect>')


def m_s(p, h):
    return svg('5 0 22 36', round(h * 22 / 36, 3), h,
               f'<path d="M22.06 7.5A7 7 0 1 0 16 18" stroke="{p["fg"]}" stroke-width="5" stroke-linecap="round"></path>'
               f'<path d="M16 18A7 7 0 1 1 9.94 28.5" stroke="{p["ac"]}" stroke-width="5" stroke-linecap="round"></path>')


def halves(a, b):
    return (f'<path d="M14 3A13 13 0 0 0 14 29z" fill="{a}"></path>'
            f'<path d="M18 7A13 13 0 0 1 18 33z" fill="{b}"></path>')


def m_halves(a, b, h):
    return svg('0 0 32 36', round(h * 32 / 36, 3), h, halves(a, b))


def m_frames(p, h):
    return svg('0 0 38 46', round(h * 38 / 46, 3), h,
               f'<rect x="2" y="2" width="20" height="34" rx="4.5" stroke="{p["fg"]}" stroke-width="2.6" stroke-dasharray="4.5 4"></rect>'
               f'<rect x="14" y="10" width="20" height="34" rx="4.5" fill="{p["ac"]}"></rect>')


def m_replay(p, h):
    return svg('0 0 32 32', h, h,
               f'<path d="M27.5 17A11.5 11.5 0 1 1 21 6.7" stroke="{p["ac"]}" stroke-width="3.6" stroke-linecap="round"></path>'
               f'<path d="M19.2 1.6l7.4 6.2-9 3.4z" fill="{p["ac"]}" stroke="{p["ac"]}" stroke-width="1.4" stroke-linejoin="round"></path>'
               f'<path d="M13.2 12.3v9.4l7.8-4.7z" fill="{p["fg"]}" stroke="{p["fg"]}" stroke-width="1.6" stroke-linejoin="round"></path>')


def m_clapper(a, b, h):
    return svg('0 0 36 34', round(h * 36 / 34, 3), h,
               f'<rect x="3" y="14" width="30" height="18" rx="4.5" fill="{a}"></rect>'
               f'<path d="M5 9.4L31 3.6" stroke="{a}" stroke-width="6.4" stroke-linecap="round"></path>'
               f'<path d="M11.4 5.6l1.6 4.6M18.4 4l1.6 4.6M25.4 2.5l1.6 4.6" stroke="{b}" stroke-width="2.2"></path>')


def m_equals(p, h):
    return svg('0 0 30 26', round(h * 30 / 26, 3), h,
               f'<rect x="0" y="2" width="30" height="8" rx="4" fill="{p["fg"]}"></rect>'
               f'<rect x="0" y="16" width="30" height="8" rx="4" fill="{p["ac"]}"></rect>')


def ditto(c):
    return f'<path d="M12.5 4L9.5 15M25 4l-3 11" stroke="{c}" stroke-width="6.4" stroke-linecap="round"></path>'


def m_ditto(c, h):
    return svg('4 0 27 28', round(h * 27 / 28, 3), h, ditto(c))


def circ(p, size, inner):
    return svg('0 0 96 96', size, size, f'<circle cx="48" cy="48" r="48" fill="{p["ac"]}"></circle>{inner}')


def sw_arrows96(c):
    return (f'<path d="M28 37h36M52 25l12 12-12 12" stroke="{c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"></path>'
            f'<path d="M68 60H32M44 48L32 60l12 12" stroke="{c}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"></path>')


def ditto96(c):
    return f'<g transform="translate(3 21.5) scale(2.6)">{ditto(c)}</g>'


# ---------- 01 Viral Klon ----------
def vk1(p):
    return lock('baseline', 0.34, m_twin(p, 0.74) + word('viral klon', BG, 800, '-0.04em'))


def vk2(p):
    clone = (f'color: {p["ac"]}' if p['ac'] != p['fg'] else f'color: transparent; -webkit-text-stroke: 0.022em {p["fg"]}')
    return stack(AN, 0.95, '0.012em',
                 f'<span>VIRAL</span><span style="position: relative"><span aria-hidden="true" style="position: absolute; left: 0.07em; top: 0.07em; {clone}">KLON</span>'
                 f'<span style="position: relative">KLON</span></span>')


def vk3(p):
    t = f'<span style="font-family: {SY}; font-weight: 800; letter-spacing: -0.03em; line-height: 0.92; white-space: nowrap">viral<br>klon</span>'
    return lock('center', 0.3, kbadge(p, 1.9) + t)


def vk4(p):
    return word('Viral ' + em('Klon'), IS, 400, '-0.02em')


# ---------- 02 Cut for Cut ----------
def cc1(p):
    return lock('baseline', 0.3, m_cuts(p, 0.72) + word('cut for cut', UB, 700, '-0.03em'))


def cc2(p):
    return word(f'cut<span style="color: {p["ac"]}; margin: 0 0.03em">=</span>cut', BG, 800, '-0.04em')


def cc3(p):
    def seg(t, filled):
        look = (f'background: {p["ac"]}; color: {p["bg"]}' if filled else f'box-shadow: inset 0 0 0 0.085em {p["fg"]}')
        return f'<span style="display: inline-flex; align-items: center; height: 1.56em; padding: 0 0.44em; border-radius: 0.36em; {look}">{t}</span>'
    return (f'<span style="display: inline-flex; align-items: center; gap: 0.16em; font-family: {MM}; font-weight: 700; '
            f'letter-spacing: -0.03em; line-height: 1; white-space: nowrap">' + seg('cut', False) + seg('for', True) + seg('cut', False) + '</span>')


def cc4(p):
    return stack(AN, 0.95, '0.012em',
                 f'<span>CUT</span><span style="font-family: {IS}; font-style: italic; font-size: 0.34em; line-height: 1; letter-spacing: 0; margin: 0.02em 0 0.14em">for</span><span>CUT</span>',
                 'center')


# ---------- 03 Kloncut ----------
def kc1(p):
    return lock('baseline', 0.045, m_k(p['ac'], 0.72) + word('loncut', BG, 800, '-0.04em'))


def sliced(t, p):
    return (f'<span style="position: relative; display: inline-block; font-family: {AN}; font-weight: 400; line-height: 1.1; '
            f'letter-spacing: 0.012em; white-space: nowrap"><span style="display: block; clip-path: inset(0 0 47% 0)">{t}</span>'
            f'<span aria-hidden="true" style="position: absolute; left: 0.1em; top: 0; color: {p["ac"]}; clip-path: inset(56% -1em 0 0)">{t}</span></span>')


def kc2(p):
    return sliced('KLONCUT', p)


def kc3(p):
    return lock('center', 0.34, kbadge(p, 1.7, 'cut') + word('kloncut', UB, 700, '-0.03em'))


def kc4(p):
    return word(f'klon<span style="color: {p["ac"]}">/</span>cut', MM, 700, '-0.04em')


# ---------- 04 Shotswap ----------
def sw1(p):
    return lock('baseline', 0.26, m_arrows(p['ac'], 0.62) + word('shotswap', BG, 800, '-0.04em'))


def sw2(p):
    return lock('center', 0.24, m_cards(p, 1.2) + word('shotswap', UB, 700, '-0.03em'))


def sw3(p):
    second = (f'color: {p["ac"]}' if p['ac'] != p['fg'] else f'color: transparent; -webkit-text-stroke: 0.024em {p["fg"]}')
    return stack(AN, 0.95, '0.012em', f'<span>SHOT</span><span style="{second}">SWAP</span>')


def sw4(p):
    return lock('center', 0.34, circ(p, 1.7, sw_arrows96(p['bg'])) + word('shotswap', SY, 800, '-0.03em'))


# ---------- 05 Selfsame ----------
def ss1(p):
    s = f'<span style="color: {p["ac"]}">s</span>'
    return word(f'{s}elf{s}ame', BG, 800, '-0.04em')


def ss2(p):
    return lock('center', 0.3, m_s(p, 1.5) + word('selfsame', UB, 700, '-0.03em'))


def ss3(p):
    return (f'<span style="display: inline-flex; flex-direction: column; font-family: {MM}; font-weight: 800; '
            f'line-height: 1.02; letter-spacing: 0.06em; white-space: nowrap"><span>SELF</span><span>SAME</span></span>')


def ss4(p):
    return word('Self' + em('same'), IS, 400, '-0.02em')


# ---------- 06 Matchcut ----------
def mc1(p):
    return word(f'match<span style="color: {p["ac"]}; margin: 0 -0.01em">/</span>cut', BG, 800, '-0.04em')


def mc2(p):
    return lock('center', 0.28, m_halves(p['fg'], p['ac'], 1.2) + word('matchcut', UB, 700, '-0.03em'))


def mcbadge(p, size):
    return svg('0 0 96 96', size, size,
               f'<rect width="96" height="96" rx="22" fill="{p["ac"]}"></rect>'
               f'<g transform="translate(22 19) scale(1.62)">{halves(p["bg"], p["bg"])}</g>')


def mc3(p):
    return lock('center', 0.34, mcbadge(p, 1.7) + word('matchcut', SY, 800, '-0.03em'))


def mc4(p):
    return word(em('Match') + 'cut', IS, 400, '-0.02em')


# ---------- 07 Standin ----------
def st1(p):
    f = (f'<span style="display: inline-block; width: 0.3em; height: 0.53em; border-radius: 0.07em; '
         f'background: {p["ac"]}; margin: 0 0.07em 0 0.08em"></span>')
    return word(f'stand{f}n', BG, 800, '-0.04em')


def st2(p):
    return lock('center', 0.26, m_frames(p, 1.3) + word('standin', UB, 700, '-0.03em'))


def st3(p):
    blk = (f'<span style="display: inline-block; width: 0.56em; height: 0.92em; margin: 0 0.05em; vertical-align: -0.14em; '
           f'border-radius: 0.06em; background: {p["ac"]}"></span>')
    return word(f'stand{blk}in', MM, 700, '-0.03em')


def st4(p):
    return word('Stand-' + em('in'), IS, 400, '-0.02em')


# ---------- 08 Remake ----------
def rm1(p):
    pill = (f'<span style="display: inline-block; padding: 0 0.13em 0.09em; margin-right: 0.07em; border-radius: 0.2em; '
            f'background: {p["ac"]}; color: {p["bg"]}">re</span>')
    return word(f'{pill}make', BG, 800, '-0.04em')


def rm2(p):
    return lock('center', 0.26, m_replay(p, 1.2) + word('remake', UB, 700, '-0.03em'))


def rm3(p):
    return word(f're<span style="color: {p["ac"]}">:</span>make', MM, 800, '-0.04em')


def rm4(p):
    return lock('center', 0.3, m_clapper(p['ac'], p['bg'], 1.4) + word('remake', SY, 800, '-0.03em'))


# ---------- 09 Idem ----------
def id1(p):
    sq = (f'<span style="display: inline-block; width: 0.2em; height: 0.2em; border-radius: 0.045em; '
          f'background: {p["ac"]}; margin-left: 0.07em"></span>')
    return word(f'idem{sq}', UB, 900, '-0.04em')


def id2(p):
    return lock('baseline', 0.24, m_equals(p, 0.54) + word('idem', BG, 800, '-0.04em'))


def id3(p):
    return (f'<span style="display: inline-block; border-bottom: 0.045em solid {p["fg"]}; padding: 0 0.05em">'
            + word('idem', IS, 400, '-0.01em', '; font-style: italic; display: block; line-height: 0.86') + '</span>')


def id4(p):
    mirror = (f'color: {p["ac"]}' if p['ac'] != p['fg'] else 'opacity: 0.32')
    return stack(AN, 0.98, '0.02em', f'<span>IDEM</span><span aria-hidden="true" style="transform: scaleY(-1); {mirror}">IDEM</span>', 'center')


# ---------- 10 Ditto ----------
def dt1(p):
    return word(f'di<span style="color: {p["ac"]}">tt</span>o', BG, 800, '-0.04em')


def dt2(p):
    return lock('baseline', 0.12, m_ditto(p['ac'], 0.74) + word('ditto', UB, 700, '-0.03em'))


def dt3(p):
    return lock('center', 0.34, circ(p, 1.7, ditto96(p['bg'])) + word('ditto', SY, 800, '-0.03em'))


def dt4(p):
    return word('“ditto”', IS, 400, '-0.02em', '; font-style: italic')


# ---------- uygulama simgeleri (1em kare) ----------
def hi(p):
    return p['ac'] if p['ac'] != p['fg'] else p['fg']


def t(text, fam, wt, size, extra=''):
    return f'<span style="font-family: {fam}; font-weight: {wt}; font-size: {size}em; line-height: 1; letter-spacing: -0.03em; white-space: nowrap{extra}">{text}</span>'


def clips(p):
    return svg('0 0 32 20', 0.74, 0.46,
               f'<rect x="1.2" y="1.2" width="9" height="17.6" rx="3" stroke="{p["fg"]}" stroke-width="2.4"></rect>'
               f'<rect x="12.5" y="0" width="7" height="20" rx="3" fill="{hi(p)}"></rect>'
               f'<rect x="21.8" y="1.2" width="9" height="17.6" rx="3" stroke="{p["fg"]}" stroke-width="2.4"></rect>')


def blk(w, h, r):
    return lambda p: f'<span style="display: block; width: {w}em; height: {h}em; border-radius: {r}em; background: {hi(p)}"></span>'


# çizim -> (içerik(p), tür): 'one' tek renk, 'two' iki renk, 'bleed' rozetin kendisi
ICON = {
    vk1: (lambda p: m_twin(p, 0.46), 'one'),
    vk2: (lambda p: t('VK', AN, 400, 0.62, '; letter-spacing: 0.01em'), 'one'),
    vk3: (lambda p: kbadge(p, 1), 'bleed'),
    vk4: (lambda p: t('V' + em('k'), IS, 400, 0.8), 'one'),
    cc1: (lambda p: m_cuts(p, 0.5), 'one'),
    cc2: (lambda p: m_equals(p, 0.4), 'one'),
    cc3: (clips, 'one'),
    cc4: (lambda p: t('C', AN, 400, 0.78), 'one'),
    kc1: (lambda p: m_k(hi(p), 0.54), 'one'),
    kc2: (lambda p: f'<span style="font-size: 0.8em">{sliced("K", p)}</span>', 'two'),
    kc3: (lambda p: kbadge(p, 1, 'cut'), 'bleed'),
    kc4: (lambda p: t('k/', MM, 700, 0.44), 'one'),
    sw1: (lambda p: m_arrows(hi(p), 0.46, 4.4), 'one'),
    sw2: (lambda p: m_cards(p, 0.66), 'two'),
    sw3: (lambda p: t('S', AN, 400, 0.8), 'one'),
    sw4: (lambda p: circ(p, 1, sw_arrows96(p['bg'])), 'bleed'),
    ss1: (lambda p: t('s', BG, 800, 0.9, '; margin-top: -0.14em'), 'one'),
    ss2: (lambda p: m_s(p, 0.72), 'two'),
    ss3: (lambda p: f'<span style="font-family: {MM}; font-weight: 800; font-size: 0.4em; line-height: 1.02">S<br>S</span>', 'one'),
    ss4: (lambda p: t(em('S'), IS, 400, 0.86), 'one'),
    mc1: (lambda p: t('m/', BG, 800, 0.58, '; margin-top: -0.1em'), 'one'),
    mc2: (lambda p: m_halves(p['fg'], p['ac'], 0.62), 'two'),
    mc3: (lambda p: mcbadge(p, 1), 'bleed'),
    mc4: (lambda p: t(em('M'), IS, 400, 0.82), 'one'),
    st1: (blk(0.3, 0.53, 0.07), 'one'),
    st2: (lambda p: m_frames(p, 0.68), 'two'),
    st3: (blk(0.3, 0.5, 0.04), 'one'),
    st4: (lambda p: t('S', IS, 400, 0.86), 'one'),
    rm1: (lambda p: t('re', BG, 800, 0.62, '; margin-top: -0.1em'), 'one'),
    rm2: (lambda p: m_replay(p, 0.66), 'two'),
    rm3: (lambda p: t('re:', MM, 800, 0.36), 'one'),
    rm4: (lambda p: m_clapper(hi(p), p['bg'], 0.6), 'one'),
    id1: (lambda p: t('id', UB, 900, 0.5), 'one'),
    id2: (lambda p: m_equals(p, 0.4), 'two'),
    id3: (lambda p: t(em('i'), IS, 400, 0.9), 'one'),
    id4: (lambda p: t('ID', AN, 400, 0.64, '; letter-spacing: 0.01em'), 'one'),
    dt1: (lambda p: t('tt', BG, 800, 0.8, '; margin-top: -0.06em'), 'one'),
    dt2: (lambda p: m_ditto(hi(p), 0.56), 'one'),
    dt3: (lambda p: circ(p, 1, ditto96(p['bg'])), 'bleed'),
    dt4: (lambda p: t('“”', IS, 400, 0.9, '; font-style: italic; margin-top: 0.3em'), 'one'),
}


def chip(fn, ground):
    inner, kind = ICON[fn]
    stage = PAL[ground]
    edge = ''
    if kind == 'bleed':
        p, bg = stage, 'transparent'
    elif ground in ('lime', 'bone'):
        p, bg = D, INK
    elif kind == 'two':
        p, bg, edge = D, INK, '; box-shadow: inset 0 0 0 1px #33372B'
    else:
        p, bg = L, LIME
    return (f'<span aria-hidden="true" style="position: absolute; right: 16px; top: 14px; font-size: 44px; display: flex; align-items: center; '
            f'justify-content: center; width: 1em; height: 1em; border-radius: 0.23em; background: {bg}; color: {hi(p)}; overflow: hidden{edge}">{inner(p)}</span>')


# ad, dosya kökü, anlam, .com durumu, [(çizim, zemin, sahne px, şerit px)]
BOARDS = [
    ('Viral Klon', '01-Viral-Klon', 'Çalışma adımız. Ne yaptığını söyler; K harfi adı ayırt eder.', ('viralklon.com', True),
     [(vk1, 'dark', 62, 22), (vk2, 'surface', 96, 19), (vk3, 'lime', 54, 15), (vk4, 'bone', 104, 30)]),
    ('Cut for Cut', '02-Cut-for-Cut', '“Kesme kesme aynısı.” Sinemadaki “shot for shot” deyiminin kurgu hali.', ('cutforcut.com', True),
     [(cc1, 'dark', 44, 18), (cc2, 'surface', 92, 26), (cc3, 'bone', 42, 15), (cc4, 'lime', 92, 15)]),
    ('Kloncut', '03-Kloncut', 'Klon ile cut tek sözcükte. K harfi “başa sar” simgesi olarak çizilir.', ('kloncut.com', True),
     [(kc1, 'dark', 92, 26), (kc2, 'surface', 100, 26), (kc3, 'lime', 50, 18), (kc4, 'bone', 58, 20)]),
    ('Shotswap', '04-Shotswap', '“Çekimde değiş tokuş”: videodaki ürün gider, seninki gelir.', ('shotswap.com', False),
     [(sw1, 'dark', 70, 24), (sw2, 'surface', 46, 18), (sw3, 'lime', 100, 19), (sw4, 'bone', 44, 17)]),
    ('Selfsame', '05-Selfsame', 'İngilizcede “tıpatıp aynısı” demek. Az kullanılan, akılda kalan bir sözcük.', ('selfsame.com', False),
     [(ss1, 'dark', 86, 26), (ss2, 'surface', 46, 18), (ss3, 'lime', 78, 16), (ss4, 'bone', 104, 30)]),
    ('Matchcut', '06-Matchcut', 'Sinema terimi: iki çekimi biçim eşleşmesiyle bağlayan kesme.', ('matchcut.com', False),
     [(mc1, 'dark', 82, 26), (mc2, 'surface', 46, 18), (mc3, 'lime', 42, 17), (mc4, 'bone', 104, 30)]),
    ('Standin', '07-Standin', 'Sette oyuncunun yerine geçen kişi. Burada senin ürünün, videodaki ürünün yerine geçer.', ('standin.com', False),
     [(st1, 'dark', 92, 26), (st2, 'surface', 48, 18), (st4, 'lime', 110, 30), (st3, 'bone', 56, 20)]),
    ('Remake', '08-Remake', '“Yeniden çekim.” En düz, en hemen anlaşılan ad.', ('remake.com', False),
     [(rm1, 'dark', 88, 26), (rm2, 'surface', 50, 18), (rm4, 'lime', 48, 18), (rm3, 'bone', 60, 20)]),
    ('Idem', '09-Idem', 'Latince “aynısı”. Dört harf; her dilde aynı okunur.', ('idem.com', False),
     [(id4, 'dark', 100, 17), (id2, 'surface', 96, 26), (id1, 'lime', 88, 22), (id3, 'bone', 128, 30)]),
    ('Ditto', '10-Ditto', 'İngilizcede “aynısından” demek. Tırnak gibi duran işareti tek başına logo olur.', ('ditto.com', False),
     [(dt1, 'dark', 104, 26), (dt2, 'surface', 60, 20), (dt3, 'lime', 54, 18), (dt4, 'bone', 116, 30)]),
]

NAV = ('<span aria-hidden="true" style="display: flex; align-items: center; gap: 10px">'
       '<span style="width: 34px; height: 6px; border-radius: 3px; background: #33372B"></span>'
       '<span style="width: 46px; height: 6px; border-radius: 3px; background: #33372B"></span>'
       '<span style="width: 28px; height: 6px; border-radius: 3px; background: #33372B"></span>'
       '<span style="width: 52px; height: 24px; border-radius: 12px; background: #C8F03C"></span></span>')


def tile(i, fn, ground, s_stage, s_strip):
    p = PAL[ground]
    edge = '#23261E' if ground in ('dark', 'surface') else p['bg']
    return (
        f'<figure style="margin: 0; border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; border: 1px solid #23261E">\n'
        f'<div style="position: relative; height: 264px; background: {p["bg"]}; color: {p["fg"]}; display: flex; align-items: center; justify-content: center; font-size: {s_stage}px">'
        f'<span style="position: absolute; left: 18px; top: 14px; font-family: {ON}; font-size: 13px; font-weight: 500; opacity: 0.7">{i}</span>'
        f'{chip(fn, ground)}{fn(p)}</div>\n'
        f'<div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 60px; padding: 0 20px; background: {INK}; border-top: 1px solid {edge}; color: {BONE}; font-size: {s_strip}px">'
        f'{fn(D)}{NAV}</div>\n'
        f'</figure>')


def body(name, meaning, logos):
    tiles = '\n'.join(tile(i + 1, *l) for i, l in enumerate(logos))
    return (
        f'<div style="width: 1200px; min-height: 860px; box-sizing: border-box; padding: 48px 56px 56px; background: {INK}; color: {BONE}; font-family: {ON}; display: flex; flex-direction: column; gap: 28px">\n'
        f'<header style="display: flex; align-items: baseline; justify-content: space-between; gap: 32px">\n'
        f'<h1 style="margin: 0; font-size: 28px; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em">{name}</h1>\n'
        f'<p style="margin: 0; max-width: 640px; text-align: right; font-size: 15px; line-height: 1.5; color: #C9CCBF">{meaning}</p>\n'
        f'</header>\n'
        f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px">\n{tiles}\n</div>\n'
        f'</div>')


def overview():
    cells = []
    for n, (name, stem, meaning, (dom, free), logos) in enumerate(BOARDS):
        fn, ground, s_stage, _ = logos[0]
        st = (f'<span style="color: #C8F03C">{dom} boş görünüyor</span>' if free else f'<span style="color: #A9AC9F">{dom} dolu</span>')
        cells.append(
            f'<figure style="margin: 0; display: flex; flex-direction: column; gap: 12px">\n'
            f'<div style="height: 220px; border-radius: 16px; border: 1px solid #23261E; background: {INK}; color: {BONE}; display: flex; align-items: center; justify-content: center; font-size: {round(s_stage * 0.72)}px">{fn(D)}</div>\n'
            f'<figcaption style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; font-size: 13px; line-height: 1.4"><strong style="font-size: 15px; font-weight: 600">{n + 1:02d} · {name}</strong>{st}</figcaption>\n'
            f'</figure>')
    return (
        f'<div style="width: 2480px; min-height: 760px; box-sizing: border-box; padding: 56px 64px 64px; background: {INK}; color: {BONE}; font-family: {ON}; display: flex; flex-direction: column; gap: 36px">\n'
        f'<header style="display: flex; align-items: flex-end; justify-content: space-between; gap: 48px">\n'
        f'<h1 style="margin: 0; font-family: {BG}; font-weight: 800; font-size: 64px; line-height: 0.98; letter-spacing: -0.03em">On ad, kırk logo</h1>\n'
        f'<p style="margin: 0; max-width: 760px; font-size: 17px; line-height: 1.5; color: #C9CCBF">Her adın dört ayrı logosu kendi panosunda. Burada her addan birinci seçenek duruyor. Alan adı durumu 4 Ekim 2026 tarihli DNS sorgusuna göre; marka tescili kontrol edilmedi.</p>\n'
        f'</header>\n'
        f'<div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 32px 24px">\n' + '\n'.join(cells) + '\n</div>\n'
        f'</div>')


def dc(title, b, w, h):
    return ('<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n<title>' + title + '</title>\n'
            '<script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n'
            '<link href="' + FONTS + '" rel="stylesheet">\n<style>\nbody{margin:0}\n</style>\n</helmet>\n' + b +
            '\n</x-dc>\n<script type="text/x-dc" data-dc-script data-props=\'{"$preview":{"width":' + str(w) + ',"height":' + str(h) + '}}\'>\n'
            'class Component extends DCLogic {\nrenderVals() {\nreturn {};\n}\n}\n</script>\n</body>\n</html>\n')


def prev(stem, b):
    with open(os.path.join(PREV, f'{stem}.html'), 'w', encoding='utf-8') as f:
        f.write(f'<!doctype html><html><head><meta charset="utf-8"><link href="{FONTS}" rel="stylesheet">'
                f'<style>body{{margin:0}}</style></head><body>{b}</body></html>')


for name, stem, meaning, dom, logos in BOARDS:
    b = body(name, meaning, logos)
    with open(os.path.join(OUT, f'Logo-{stem}.dc.html'), 'w', encoding='utf-8') as f:
        f.write(dc(f'Logo çalışması — {name}', b, 1200, 860))
    prev(stem, b)
ov = overview()
with open(os.path.join(OUT, 'Logo-00-Genel-Bakis.dc.html'), 'w', encoding='utf-8') as f:
    f.write(dc('Logo çalışması — genel bakış', ov, 2480, 760))
prev('00-Genel-Bakis', ov)
print('ok', len(BOARDS) + 1)
