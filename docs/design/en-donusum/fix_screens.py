#!/usr/bin/env python3
"""17 ekranda marka denetiminin yapısal düzeltmeleri (tokens.py'den sonra çalışır).
Kullanım: python3 fix_screens.py <kaynak-klasör (stage2)> <hedef-project>"""
import re, shutil, sys, glob, os

src, dst = sys.argv[1:3]
for f in glob.glob(src + '/*.dc.html'):
    shutil.copy(f, dst)


def edit(name, fn):
    path = f'{dst}/{name}.dc.html'
    s = open(path, encoding='utf-8').read()
    t = fn(s)
    assert t != s, f'{name}: değişiklik olmadı'
    open(path, 'w', encoding='utf-8').write(t)
    print(name, 'düzeltildi')


def swap(s, old, new, count=1):
    assert s.count(old) == count, f'{s.count(old)} kez (beklenen {count}): {old[:80]}'
    return s.replace(old, new)


def header(name):
    return re.search(r'<header.*?</header>', open(f'{src}/{name}.dc.html', encoding='utf-8').read(), re.S).group(0)


CHECK = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" '
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>')
SMALL_CHECK = CHECK.replace('width="18" height="18"', 'width="14" height="14"').replace('stroke-width="2.6"', 'stroke-width="3"')

# Girişsiz ziyaretçinin üst menüsü: tek biçim (ana sayfa, fiyatlar, yasal, giriş, 404)
GUEST = header('A-Ana-Sayfa').replace('href="#nasil"', 'href="A-Ana-Sayfa.dc.html"')
HOW = re.search(r'<a href="A-Ana-Sayfa\.dc\.html" style="[^"]*">How it works</a>\n', GUEST).group(0)


def stages(s):
    """İş durumu dört biçimle: dolu daire + tik, halka, kesik halka, köşeli çerçeve."""
    s = swap(s, 'height: 36px; border-radius: 50%; display: flex;', 'height: 36px; box-sizing: border-box; border-radius: {{ s.rad }}; display: flex;')
    s = swap(s, 'border: 1.5px solid {{ s.bd }}">{{ s.no }}</span>',
             'border: 1.5px {{ s.bs }} {{ s.bd }}"><sc-if value="{{ s.isDone }}" hint-placeholder-val="{{ false }}">' + CHECK
             + '</sc-if><sc-if value="{{ s.notDone }}" hint-placeholder-val="{{ true }}">{{ s.no }}</sc-if></span>')
    s = swap(s, 'var done = {', "var done = { bs: 'solid', rad: '50%', isDone: true,")
    s = swap(s, 'var wait = {', "var wait = { bs: 'dashed', rad: '50%', isDone: false,")
    s = swap(s, 'stateColor: k.stateColor };', 'stateColor: k.stateColor, bs: k.bs, rad: k.rad, isDone: k.isDone, notDone: !k.isDone };')
    return swap(s, "'5 / 5', done", "'done · 5 / 5', done")


def takibi(s):
    s = stages(s)
    s = swap(s, 'var run = {', "var run = { bs: 'solid', rad: '50%', isDone: false,")
    return swap(s, "'3 / 5', run", "'running · 3 / 5', run")


def durdu(s):
    return swap(stages(s), 'var err = {', "var err = { bs: 'solid', rad: '8px', isDone: false,")


def uretimlerim(s):
    """Hazır = lime tik (marka: durum renk + biçim + yazı)."""
    s = swap(s, '<span style="width: 8px; height: 8px; border-radius: {{ j.dot }}; background: {{ j.color }}"></span>{{ j.status }}',
             '<sc-if value="{{ j.notReady }}" hint-placeholder-val="{{ true }}"><span style="width: 8px; height: 8px; border-radius: {{ j.dot }}; background: {{ j.color }}"></span></sc-if>'
             '<sc-if value="{{ j.ready }}" hint-placeholder-val="{{ false }}">' + SMALL_CHECK + '</sc-if>{{ j.status }}')
    s = swap(s, "status: 'Ready', detail: 'mp4 · 720p', color: 'var(--text)'", "status: 'Ready', ready: true, detail: 'mp4 · 720p', color: 'var(--accent-text)'")
    s = swap(s, "status: 'Generating',", "status: 'Generating', notReady: true,")
    return swap(s, "status: 'Stopped',", "status: 'Stopped', notReady: true,")


def main(s):
    """Kart üstündeki ana düğme, bileşen panosundaki ölçüyle."""
    return swap(s, 'left: 12px; right: 12px; bottom: 12px; padding: 14px 12px; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 15px; text-align: center',
                'left: 8px; right: 8px; bottom: 8px; display: flex; align-items: center; justify-content: center; min-height: 44px; border-radius: 8px; background: var(--accent); color: var(--on-accent); font-weight: 600; font-size: 15px')


def hesap(s):
    """Ekranda tek lime ana düğme: Kaydet ikincil olur."""
    return swap(s, 'padding: 0 28px; border-radius: 12px; border: 0; background: var(--accent); color: var(--on-accent); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer">Save<',
                'padding: 0 24px; border-radius: 12px; border: 1px solid var(--edge-strong); background: transparent; color: var(--text); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer">Save<')


def guest_header(s):
    return re.sub(r'<header.*?</header>', lambda m: GUEST, s, count=1, flags=re.S)


def fiyatlar(s):
    return swap(s, '>Gallery</a>\n<a href="A-Fiyatlar.dc.html" aria-current="page"', '>Gallery</a>\n' + HOW + '<a href="A-Fiyatlar.dc.html" aria-current="page"')


def giris(s):
    """Giriş sayfası da üst menüyü taşır; sol paneldeki ayrı logo kalkar."""
    s, n = re.subn(r'<a href="A-Ana-Sayfa\.dc\.html" style="display: flex; align-items: baseline;.*?</a>\n', '', s, count=1, flags=re.S)
    assert n == 1
    root = 'font-family: var(--body); display: flex; flex-wrap: wrap">'
    s = swap(s, root, 'font-family: var(--body); display: flex; flex-direction: column">\n'
             '<div style="padding: 0 clamp(16px, 4vw, 60px)">\n<div style="max-width: 1320px; margin: 0 auto">\n' + GUEST + '\n</div>\n</div>\n'
             '<div style="flex: 1; display: flex; flex-wrap: wrap">')
    s = swap(s, '</main>\n\n</div>\n</x-dc>', '</main>\n\n</div>\n</div>\n</x-dc>')
    s, n = re.subn(r'<a href="A-Giris\.dc\.html" style="[^"]*">(?:Log in|Get started)</a>\n', '', s)  # sayfanın kendisi; ikinci lime düğme olmasın
    assert n == 2
    return swap(s, 'style="align-self: flex-start; display: flex; align-items: center; min-height: 44px">Forgot password<',
                'style="align-self: flex-start; display: flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 500; text-decoration: none">Forgot password<')


edit('A-Video-Ekle', lambda s: swap(s, 'd="M12 16V5M7 9l5-5 5 5M5 20h14"', 'd="M12 20V9M7 13l5-5 5 5M5 4h14"'))  # yükle ikonu kütüphanedeki çizimle
edit('A-Is-Takibi', takibi)
edit('A-Is-Durdu', durdu)
edit('A-Uretimlerim', uretimlerim)
edit('Main', main)
edit('A-Hesap', hesap)
edit('A-Yasal', guest_header)
edit('A-404', guest_header)
edit('A-Fiyatlar', fiyatlar)
edit('A-Giris', giris)
