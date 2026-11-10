"""R6 Yönetim (inceleme turu) mobil yamaları: yalnız 390 px'lik kopyalara uygulanır (variants.py). Kaynak panolar değişmez.
DEGISTIR: kaynağı bu turda değişen iki panonun yama listesi yenilenir (yama_g4.py'deki listenin yerine geçer).
  A-Kullanici-Detay  "Add credits" artık kenarlı düğme (yama eski lime düğmeyi arıyordu)
  A-Sablon-Duzenle   "Sample" başlığının yanına örnek durumu geldi (örnek video yaması bölümü yeniden kurar)
YAMA: yeni A-Sablon-Ornek-Eski panosu A-Sablon-Duzenle ile aynı mobil düzeni alır; ana düğmesi ("Generate a new sample") tam genişliktir.
Durum panoları (A-Admin-Onaylar, A-Admin-Islem-Durumlar, A-Admin-Grafik-Durumlar) akışkandır: yama gerekmez.
Düzeltme turu 2 (dar ekran 320 / 360 + görsel gözden geçirme):
  sayı kutuları      iki sütun yalnız kutu 170 px'e sığarsa (390'da aynı kalır); 384 px'ten dar ekranda tek sütun: değer kutudan taşmaz
  A-Gelir            kaynaktaki değer satırı artık "margin-top: auto" taşıyor (etiket üstte, değer altta): kutu yaması ona göre yenilendi
  A-Kullanici-Detay  soldaki notun iki satırlık yüksekliği (masaüstü hizası) telefonda kalkar
  A-Sablon-Duzenle   "Regenerate sample" karenin altında tam genişlik (yanındaki dar sütunda iki satıra iniyordu); "Shot 1" kırılmaz"""
import re
from yama_g4 import YAMA as G4, CARD, CARD_M, SMALL, PRIMARY, SECONDARY, STRIP, HEAD, SEG, TWO, VALUE, VALUE_M, PAGER, _grab, _missing, shots_m


def sample_m(name, wide=False):
    """Şablon düzenleme · örnek video (yama_g4.sample_m'in bu turdaki kaynağa göre hâli): telefonda küçük kare (132 px) solda,
    sağında kaynak bilgisi ve düğme; başlık satırı (başlık + örnek durumu) üstte kalır; iki açıklama cümlesi altta tek paragraf.
    wide: düğme sağ sütuna sığmıyorsa (uzun yazı, ana eylem) karenin altında tam genişlik durur."""
    m = _grab(name, r'<section aria-labelledby="h-sample" style="[^"]*">\n(<div style="[^"]*">\n<h2 id="h-sample".*?</h2>\n<span.*?</span>\n</div>)\n<figure[^>]*>\n<div[^>]*>\n'
              r'(<img[^>]*>)\n(<button type="button" aria-label="Play the sample"[^>]*>)<svg width="26" height="26"(.*?</button>)\n</div>\n'
              r'<figcaption[^>]*>(.*?)</figcaption>\n</figure>\n<dl[^>]*>\n(.*?)\n</dl>\n(<button.*?</button>)\n(<p.*?</p>)\n</section>')
    if not m or 'width: 72px; height: 72px' not in m.group(3):
        return _missing(f'{name}: örnek video bölümü')
    head, img, play, play_rest, caption, facts, again, note = m.groups()
    play = play.replace('width: 72px; height: 72px', 'width: 52px; height: 52px') + '<svg width="20" height="20"' + play_rest
    note = re.sub(r'^<p[^>]*>|</p>$', '', note)
    side = f'<dl style="margin: 0; display: flex; flex-direction: column; gap: 4px">\n{facts}\n</dl>'
    below = ''
    if wide:
        below = again + '\n'
    else:
        side += '\n' + again.replace('padding: 0 24px', 'padding: 0 16px')  # 210 px'lik sütuna sığsın
    new = f'''<section aria-labelledby="h-sample" style="flex: 1 1 100%; min-width: 0; display: flex; flex-direction: column; gap: 16px">
{head}
<div style="display: flex; align-items: stretch; gap: 16px">
<figure style="flex: 0 0 132px; margin: 0">
<div style="position: relative; border-radius: 12px; overflow: hidden; background: var(--surface); box-shadow: 0 0 0 1px var(--media-edge)">
{img}
{play}
</div>
</figure>
<div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; gap: 16px">
{side}
</div>
</div>
{below}<p style="margin: 0; {SMALL}">{caption} {note}</p>
</section>'''
    return [(m.group(0), new)]


EDIT_REST = [(f'<div style="{CARD}; display: grid; ', f'<div style="{CARD_M}; display: grid; '), STRIP,
             (f'<p style="flex: 1 1 240px; margin: 0 12px; {SMALL}">', f'<p style="margin: 0; {SMALL}">')]

ADD_OLD = f'<button type="button" style="{PRIMARY}">Add credits</button>'
assert any(old == ADD_OLD for old, _ in G4['A-Kullanici-Detay']), 'yama_g4: "Add credits" yaması beklenen biçimde değil'

# ---- düzeltme turu 2
# sayı kutuları: yama_g4 telefonda ızgarayı iki sütuna sabitliyor; 320 px'te değer ([AMOUNT], [DURATION]) kutudan taşıyordu
FIT = ('display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px',
       'display: grid; grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 12px')
TOP = lambda v: v.replace('style="', 'style="margin-top: auto; ')  # A-Gelir kaynağındaki değer satırı


def shots_r2():
    """Çekim kartı başlığı: "Shot 1" 320 px'te iki satıra kırılmaz."""
    old, new = '<span style="color: var(--text)">Shot ', '<span style="color: var(--text); white-space: nowrap">Shot '
    out = shots_m()
    assert all(old in n for o, n in out if not o.startswith('<<')), 'yama_g4.shots_m: çekim başlığı beklenen biçimde değil'
    return [(o, n.replace(old, new)) for o, n in out]


DEGISTIR = {
    'A-Kullanici-Detay': [(old.replace(PRIMARY, SECONDARY), new.replace(PRIMARY, SECONDARY)) if old == ADD_OLD else (old, new)
                          for old, new in G4['A-Kullanici-Detay']] + [FIT, ('<p id="add-hint" style="margin: 0; min-height: 2.8em; ', '<p id="add-hint" style="margin: 0; ')],
    'A-Sablon-Duzenle': sample_m('A-Sablon-Duzenle', wide=True) + shots_r2() + EDIT_REST,
    'A-Gelir': HEAD + SEG + [TWO[0], TWO[1], (TOP(VALUE), TOP(VALUE_M)), FIT] + PAGER,
}

YAMA = {
    # çekim listesi A-Sablon-Duzenle ile birebir aynıdır: aynı yama (kaynaktan okunur) burada da eşleşir
    'A-Sablon-Ornek-Eski': sample_m('A-Sablon-Ornek-Eski', wide=True) + shots_r2() + EDIT_REST,
    # yama_g4'ün kutu yamalarından sonra uygulanır (dosyalar ad sırasıyla okunur)
    'A-Admin-Genel': [FIT], 'A-Krediler': [FIT], 'A-Tarama': [FIT],
    # şablon adı telefonda en çok iki satır: tablo zaten kendi kutusunda kayıyor, sütun 190 px'e çıkar (masaüstünde 170: tablo 1320'ye sığar)
    'A-Isler': [FIT, ('min-width: 170px; text-wrap: balance', 'min-width: 190px; text-wrap: balance')],
    'A-Sablonlar': [('min-width: 170px; text-wrap: pretty', 'min-width: 190px; text-wrap: pretty')],
}
