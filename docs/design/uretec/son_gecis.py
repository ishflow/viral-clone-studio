"""Panolar arası son tutarlılık geçişi (yeniden çalıştırılabilir): ortak alt bilgi, soru ızgarası, uyarı düğmesi kenarı,
sonuç ekranında karşılaştırma bağlantısı. Ortak parça kararları burada tek yerde durur.
Kullanım: python3 son_gecis.py   (sonra: boy.py + variants.py)"""
import os, re
from parts import P

LINK = 'display: flex; align-items: center; min-height: 44px; color: var(--text-2); text-decoration: none'
FOOTER = ('<footer style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 32px; '
          'padding-top: 24px; border-top: 1px solid var(--line); font-size: 13px; color: var(--text-3)">\n'
          '<span>© [COMPANY NAME]</span>\n<nav aria-label="Footer menu" style="display: flex; flex-wrap: wrap; gap: 4px 24px">\n'
          + '\n'.join(f'<a href="{h}" style="{LINK}">{t}</a>' for t, h in [
              ('Gallery', 'Main.dc.html'), ('Pricing', 'A-Fiyatlar.dc.html'), ('Terms of use', 'A-Yasal.dc.html'),
              ('Privacy', 'A-Yasal.dc.html'), ('Refunds', 'A-Yasal.dc.html'), ('Contact', 'A-Iletisim.dc.html')])
          + '\n</nav>\n</footer>')


def edit(name, fn):
    path = os.path.join(P, name + '.dc.html')
    s = open(path, encoding='utf-8').read()
    t = fn(s)
    if t != s:
        open(path, 'w', encoding='utf-8').write(t)
        print('değişti:', name)


# 1. Ziyaretçi sayfalarında tek alt bilgi: Gallery · Pricing · Terms of use · Privacy · Refunds · Contact
for n in ('A-Ana-Sayfa', 'A-Fiyatlar', 'A-Iletisim'):
    edit(n, lambda s: re.sub(r'<footer.*?</footer>', lambda m: FOOTER, s, count=1, flags=re.S))


def yasal(s):  # yasal sayfada alt bilgi yoktu: sarmalayıcının sonuna eklenir
    if '<footer' in s:
        return re.sub(r'<footer.*?</footer>', lambda m: FOOTER, s, count=1, flags=re.S)
    i = s.rindex('</main>') + len('</main>')
    return s[:i] + '\n\n' + FOOTER + s[i:]


edit('A-Yasal', yasal)

# 2. Dört soruluk ızgara 2 × 2 (üç sütunda bir soru yalnız kalıyordu)
for n in ('A-Ana-Sayfa', 'A-Fiyatlar'):
    edit(n, lambda s: s.replace('minmax(min(380px, 100%), 1fr)', 'minmax(min(480px, 100%), 1fr)'))

# 3. Kenarlı uyarı düğmesi: kenar yazıyla aynı renk, 1 px (kontrol kenarı en az 3:1 görünmeli)
for n in (('A-Hesap-Sil',) if os.environ.get('SKIP_ADMIN') else ('A-Hesap-Sil', 'A-Kullanici-Detay', 'A-Sablon-Duzenle')):
    edit(n, lambda s: re.sub(r'border: 1(?:\.5)?px solid var\(--warn(?:-edge)?\)(; [^"]*?color: var\(--warn\))',
                             r'border: 1px solid var(--warn)\1', s))

# 4. Tek varyantlı sonuçta da örnekle karşılaştırma bağlantısı (çok varyantlıda vardı)
def sonuc(s):
    if 'A-Karsilastir.dc.html' in s:
        return s
    v = open(os.path.join(P, 'A-Sonuc-Varyant.dc.html'), encoding='utf-8').read()
    link = re.search(r'<a href="A-Karsilastir\.dc\.html".*?</a>', v, re.S).group(0)
    anchor = re.search(r'</dl>', s)
    assert anchor, 'A-Sonuc: bilgi listesi bulunamadı'
    return s[:anchor.end()] + '\n' + link + s[anchor.end():]


edit('A-Sonuc', sonuc)

# 5. Videolarım listesinde satır eylemleri kenarlı düğme: listede tek bir ana eylem yok, birden çok hazır video
#    birden çok lime düğme demekti (lime kuralı)
edit('A-Uretimlerim', lambda s: s.replace(
    'text-decoration: none; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent)">Open</a>',
    'text-decoration: none; border: 1px solid var(--edge-strong); background: transparent; color: var(--text)">Open</a>'))
