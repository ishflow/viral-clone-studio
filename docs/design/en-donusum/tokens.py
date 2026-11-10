#!/usr/bin/env python3
"""17 ekranı marka belirteçlerine ve ölçeklerine çeker: hex -> var(--…), yazı boyu 10 basamağa,
köşe 8/12/16/24/tam, kontrol yüksekliği 44/52/60/72, ikon çizgisi 2, logo ve <helmet> belirteç bloğu.
Kullanım: python3 tokens.py <kaynak-klasör> <hedef-klasör> <Marka-Oz.dc.html (belirteç kaynağı)>"""
import glob, os, re, sys

src, dst, brand = sys.argv[1:4]
b = open(brand, encoding='utf-8').read()
TOKENS = '\n'.join(re.findall(r'^\.ay[\[{].*$', b, flags=re.M))  # .ay{…} ve .ay[data-theme="light"]{…}
assert TOKENS.count('\n') == 1, 'belirteç bloğu bulunamadı'
LOGO = ('<rect x="1.5" y="1.5" width="15" height="29" rx="3" stroke="currentColor" stroke-width="3"></rect>'
        '<rect x="25.5" y="1.5" width="15" height="29" rx="3" fill="#C8F03C" stroke-width="3" style="stroke: var(--mark-edge)"></rect>')

TEXT = {'#F2F3EC': 'text', '#E2E4D9': 'text-2', '#C9CCBF': 'text-2', '#B4B7AA': 'text-3', '#A9AC9F': 'text-3',
        '#C8F03C': 'accent-text', '#0B0C0A': 'on-accent', '#FF9A6B': 'warn', '#E0FF7A': 'accent-hover'}
BG = {'#0B0C0A': 'bg', '#050605': 'bg', '#151712': 'surface', '#1C1F17': 'raised', '#2B2F24': 'raised',
      '#23261E': 'line', '#FF9A6B': 'warn', '#F2F3EC': 'text', '#33372B': 'edge'}
EDGE = {'#23261E': 'line', '#4A4F3F': 'edge-strong', '#FF9A6B': 'warn', '#5A3A2A': 'warn-edge', '#0B0C0A': 'on-accent'}
CLAMP = {
    'clamp(120px, 22vw, 320px)': 'clamp(48px, 8.4vw, 128px)',
    'clamp(44px, 6.4vw, 96px)': 'clamp(42px, 6.4vw, 92px)',
    'clamp(44px, 5.6vw, 80px)': 'clamp(42px, 6.4vw, 92px)',
    'clamp(38px, 5.6vw, 84px)': 'clamp(42px, 6.4vw, 92px)',
    'clamp(40px, 5.4vw, 76px)': 'clamp(36px, 4.6vw, 64px)',
    'clamp(38px, 5vw, 68px)': 'clamp(36px, 4.6vw, 64px)',
    'clamp(34px, 4.6vw, 64px)': 'clamp(36px, 4.6vw, 64px)',
    'clamp(34px, 4vw, 54px)': 'clamp(32px, 4vw, 52px)',
    'clamp(34px, 4vw, 56px)': 'clamp(32px, 4vw, 52px)',
    'clamp(30px, 3.8vw, 52px)': 'clamp(32px, 4vw, 52px)',
    'clamp(30px, 4vw, 52px)': 'clamp(32px, 4vw, 52px)',
}
HEX = re.compile(r'#[0-9A-Fa-f]{6}\b')


def var(name):
    return f'var(--{name})'


def font_size(tag, v, st):
    if v in CLAMP:
        return CLAMP[v]
    muted = ('#A9AC9F' in st or '#B4B7AA' in st) and tag not in ('button', 'a', 'input', 'select', 'textarea')
    heading = tag in ('h2', 'h3', 'dt')
    table = {'12px': '13px', '14px': '13px' if muted else '15px', '16px': '17px' if tag == 'p' else '15px',
             '18px': '20px' if heading else '17px', '19px': '20px' if heading else '17px', '22px': '24px',
             '26px': '24px', '28px': '24px', '30px': '32px', '40px': '32px', '56px': '52px'}
    return table.get(v, v)


def radius(tag, v, st, attrs):
    small_image = tag == 'img' or ('width: 72px' in st and 'height: 96px' in st)
    table = {'10px': '8px' if small_image else '12px', '14px': '12px', '18px': '16px', '20px': '16px',
             '22px': '24px' if 'role="dialog"' in attrs else '16px', '28px': '24px'}
    return table.get(v, v)


def min_height(tag, v, st):
    two_line = tag == 'button' and 'flex-direction: column' in st
    table = {'46px': '52px', '48px': '52px', '54px': '52px', '56px': '52px', '58px': '60px',
             '64px': '72px' if two_line else '60px', '68px': '72px'}
    return table.get(v, v)


def fix_style(tag, st, attrs):
    scrim = 'rgba(11, 12, 10, 0.7' in st
    lime_bg = 'background: #C8F03C' in st
    field = tag in ('input', 'select', 'textarea', 'label')
    solid_button = tag in ('a', 'button') and 'font-weight: 600' in st
    circle = 'border-radius: 50%' in st
    out = []
    for d in [x.strip() for x in st.split(';') if x.strip()]:
        prop, _, val = d.partition(':')
        prop, val = prop.strip(), val.strip()
        if prop == 'font-family':
            val = var('display') if 'Bricolage' in val else var('body')
        elif prop == 'color':
            if val == '#F2F3EC' and scrim:
                val = var('on-scrim')
            elif val in TEXT:
                val = var(TEXT[val])
        elif prop in ('background', 'background-color'):
            if val == '#C8F03C':
                val = var('accent') if 'color: #0B0C0A' in st else var('accent-text')
            elif val.startswith('rgba(11, 12, 10, 0.7'):
                val = var('scrim')
            elif val == 'rgba(242, 243, 236, 0.5)':
                val = var('on-scrim') + '; opacity: 0.5'
            elif val in BG:
                val = var(BG[val])
        elif prop.startswith('border') and prop != 'border-radius' or prop == 'outline':
            def edge(m):
                h = m.group(0)
                if h == '#C8F03C':
                    return var('accent') if lime_bg else var('accent-text')
                if h in ('#33372B', '#2B2F24'):
                    return var('edge-strong') if field or (solid_button and h == '#33372B') else var('edge')
                return var(EDGE[h]) if h in EDGE else h
            val = HEX.sub(edge, val)
        elif prop == 'font-size':
            val = font_size(tag, val, st)
        elif prop == 'border-radius':
            val = radius(tag, val, st, attrs)
        elif prop == 'min-height':
            val = min_height(tag, val, st)
        elif prop in ('width', 'height'):
            if val in ('52px', '56px') and circle:
                val = '48px'
            elif val == '76px' and circle:
                val = '72px'
            elif val == '68px' and prop == 'width':
                val = '72px'
        elif prop == 'box-shadow':
            continue  # marka: gölge yok
        out.append(f'{prop}: {val}')
    return '; '.join(out)


def fix_tag(m):
    tag, attrs = m.group(1), m.group(2)
    attrs = re.sub(r'style="([^"]*)"', lambda s: 'style="' + fix_style(tag, s.group(1), attrs) + '"', attrs)
    if tag == 'svg':
        attrs = attrs.replace('stroke-width="2.2"', 'stroke-width="2"')
        attrs = re.sub(r'stroke="(#[0-9A-Fa-f]{6})"', lambda s: f'style="stroke: {var(TEXT[s.group(1)])}"', attrs)
        attrs = attrs.replace('width="28" height="28"', 'width="26" height="26"')
    return f'<{tag}{attrs}>'


def fix_js(js):
    out = []
    for line in js.split('\n'):
        lime_obj = "bg: '#C8F03C'" in line
        if 'var hot' in line:  # lime paket kartı: üstündeki her şey koyu, düğme yazısı açık
            line = line.replace("btnFg: '#F2F3EC'", "btnFg: 'var(--on-scrim)'")
        line = re.sub(r"\b(bg|btnBg): '#C8F03C'", r"\1: 'var(--accent)'", line)
        line = re.sub(r"\b(fg|btnFg|sub|btnBg|btnBd): '#0B0C0A'", r"\1: 'var(--on-accent)'", line)
        line = re.sub(r"\b(bd|btnBd): '#C8F03C'", lambda m: f"{m.group(1)}: 'var(--accent)'" if lime_obj or m.group(1) == 'btnBd' else m.group(0), line)
        line = re.sub(r"\bbtnBd: '#33372B'", "btnBd: 'var(--edge-strong)'", line)
        line = re.sub(r"\bbd: '#33372B'", "bd: 'var(--edge-strong)'", line)  # bekleyen adımın halkası
        line = re.sub(r"\bbg: '(#[0-9A-F]{6})'", lambda m: f"bg: '{var(BG[m.group(1)])}'" if m.group(1) in BG else m.group(0), line)
        line = re.sub(r"\bbd: '#23261E'", "bd: 'var(--line)'", line)
        line = line.replace("'#33372B'", "'var(--edge)'").replace("'#4A4F3F'", "'var(--edge-strong)'").replace("'#2B2F24'", "'var(--raised)'")
        line = HEX.sub(lambda m: var(TEXT[m.group(0)]) if m.group(0) in TEXT else m.group(0), line)
        out.append(line)
    return '\n'.join(out)


os.makedirs(dst, exist_ok=True)
for path in sorted(glob.glob(src + '/*.dc.html')):
    name = os.path.basename(path)
    s = open(path, encoding='utf-8').read()
    head, sep, js = s.partition('<script type="text/x-dc"')
    pre, hsep, body = head.partition('</helmet>')
    assert hsep, name
    pre = pre.replace('a{color:#C8F03C}a:hover{color:#E0FF7A}', TOKENS + '\na{color:var(--accent-text)}a:hover{color:var(--text)}')
    assert TOKENS in pre, name
    body = re.sub(r'(<svg viewBox="0 0 42 32"[^>]*>).*?(</svg>)', lambda m: m.group(1) + LOGO + m.group(2), body)
    body = re.sub(r'<(\w+)((?:\s[^<>]*)?)>', fix_tag, body)
    body = re.sub(r'<div style="', '<div class="ay" style="', body, count=1)
    s = pre + hsep + body + sep + fix_js(js)
    open(os.path.join(dst, name), 'w', encoding='utf-8').write(s)
    left = sorted(set(HEX.findall(s.replace(TOKENS, '').replace(LOGO, ''))))
    rg = sorted(set(re.findall(r'rgba\([^)]*\)', s.replace(TOKENS, ''))))
    print(f'{name}: ' + ('temiz' if not (left or rg) else f'kalan {left} {rg}'))
