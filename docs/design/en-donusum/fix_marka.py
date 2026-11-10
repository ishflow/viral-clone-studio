#!/usr/bin/env python3
"""Marka panolarında çeviriden sonraki düzen düzeltmeleri (apply.py'den sonra bir kez çalışır).
Kullanım: python3 fix_marka.py <project-klasörü>"""
import sys

root = sys.argv[1]


def edit(name, fn):
    path = f'{root}/{name}'
    s = open(path, encoding='utf-8').read()
    t = fn(s)
    assert t != s, f'{name}: değişiklik olmadı'
    open(path, 'w', encoding='utf-8').write(t)
    print(name, 'düzeltildi')


def swap(s, old, new):
    assert s.count(old) == 1, f'{s.count(old)} kez: {old[:70]}'
    return s.replace(old, new)


COL16 = '<div style="display: flex; flex-direction: column; gap: 16px">'


def oz(s):
    # "Two lines" açıklaması tek satıra sığsın
    return swap(s, 'max-width: 620px; font-size: 17px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">One explains',
                'max-width: 860px; font-size: 17px; line-height: 1.5; color: var(--text-2); text-wrap: pretty">One explains')


def ses(s):
    # sayı ile birim satır sonunda ayrılmasın
    return swap(s, '8 sec, 7 min, 1.9M views.', '8&nbsp;sec, 7&nbsp;min, 1.9M&nbsp;views.')


def logo(s):
    # koyu sürüm kutusu kenarlığı yüzünden 2 px uzundu
    s = swap(s, 'height: 200px; border-radius: 16px; background: #0B0C0A; border: 1px solid var(--edge)',
             'height: 200px; box-sizing: border-box; border-radius: 16px; background: #0B0C0A; border: 1px solid var(--edge)')
    # en küçük boy örneği, boşluk kutusunun altındaki boş yere
    start = s.index('<span style="display: flex; align-items: baseline; gap: 8px; font-family: var(--display); font-weight: 800; font-size: 20px;')
    end = s.index('minimum size, 20 px</span>\n</span>\n', start) + len('minimum size, 20 px</span>\n</span>\n')
    block = s[start:end].replace('<span style="display: flex; align-items: baseline; gap: 8px;',
                                 '<span style="margin-top: 28px; display: flex; align-items: baseline; gap: 8px;', 1)
    s = s[:start] + s[end:]
    anchor = 'x = one frame width</span>\n'
    return swap(s, anchor, anchor + block)


def bilesen1(s):
    # kalite kutuları tam genişlik: model adı tek satıra sığar, sütunlar dengelenir
    return swap(s, '<div role="group" aria-label="Quality" style="flex: 2 1 280px;', '<div role="group" aria-label="Quality" style="flex: 1 1 100%;')


def bilesen2(s):
    # sütun dengesi: sol = video kartı + pencere, sağ = yüzey kartı + iş durumu + uyarı
    open_tag = '<section style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; align-items: start">\n\n'
    a = s.index(open_tag) + len(open_tag)
    b = s.index('\n\n</section>', a)
    col, video, surface, alert, close, col2, status, dialog, close2 = s[a:b].split('\n\n')
    for part, title in ((video, 'Video card'), (surface, 'Surface card'), (alert, 'Alert box'), (status, 'Job status'), (dialog, 'Dialog')):
        assert f'>{title}' in part.split('\n')[1], title
    return s[:a] + '\n\n'.join([col, video, dialog, close, col2, surface, status, alert, close2]) + s[b:]


def olcu(s):
    # dört bölüm, iki dengeli satır: boşluk | sayfa ve ızgara, köşe | kontrol yüksekliği
    m1 = '<section style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 64px 48px; align-items: start">'
    m3 = '<section style="display: flex; align-items: flex-start; gap: 48px; padding-top: 40px; border-top: 1px solid var(--line)">'
    i1, i3 = s.index(m1), s.index(m3)
    i4 = s.index('</section>', i3)
    head, top, bottom, tail = s[:i1], s[i1 + len(m1):i3], s[i3 + len(m3):i4], s[i4 + len('</section>'):]
    empty, spacing, corners, control, end, empty2 = top.split('\n\n')
    assert (empty, end, empty2) == ('', '</section>', '') and '>Corners</h2>' in corners and '>Control height</h2>' in control
    corners += '\n</div>'
    control = COL16 + '\n' + swap(control, 'margin: 32px 0 0; font-family', 'margin: 0; font-family')
    page = swap(bottom.strip('\n'), '<div style="flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 16px">', COL16)
    page = swap(page, '</div>\n<ul style="flex: 1 1 0; min-width: 0; margin: 45px 0 0; ', '<ul style="margin: 8px 0 0; ') + '\n</div>'
    grid = '<section style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 48px; align-items: start'
    return (head + grid + '">\n\n' + spacing + '\n\n' + page + '\n\n</section>\n\n'
            + grid + '; padding-top: 40px; border-top: 1px solid var(--line)">\n\n' + corners + '\n\n' + control + '\n\n</section>' + tail)


edit('Marka-Oz.dc.html', oz)
edit('Marka-Ses.dc.html', ses)
edit('Marka-Logo.dc.html', logo)
edit('Marka-Bilesen-1.dc.html', bilesen1)
edit('Marka-Bilesen-2.dc.html', bilesen2)
edit('Marka-Olcu.dc.html', olcu)
