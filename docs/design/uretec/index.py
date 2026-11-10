"""canvas.json'a yeni satır ekler: bölüm başlığı (not) + panolar. Yükseklik ve genişlik pano dosyasındaki $preview'dan okunur.
Kullanım: add_row(not_id, başlık, y, [(dosya, pano adı, sayfa_mı), ...]); yayından hemen önce, dizin yeniden okunduktan sonra çalıştır."""
import json, os, re
from parts import P

PATH = os.path.join(P, 'canvas.json')


def load():
    return json.load(open(PATH, encoding='utf-8'))


def save(c):
    json.dump(c, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


def add_row(c, note_id, text, y, boards, x0=0):
    """y: bölüm başlığının y'si; panolar y + 300'de başlar. Satırın alt kenarını döndürür."""
    c['notes'][note_id] = {"kind": "title1", "maxW": 8000, "page": "a", "text": text, "w": 240, "x": x0, "y": y}
    x, bottom = x0, 0
    for name, title, is_page in boards:
        s = open(os.path.join(P, name), encoding='utf-8').read()
        pv = json.loads(re.search(r"data-props='([^']*)'", s).group(1))['$preview']
        e = {"h": pv['height'], "title": title, "w": pv['width'], "x": x, "y": y + 300}
        if is_page:
            e["expand"] = "fill"
        c['boards'][name] = e
        if name not in c['order']:
            c['order'].append(name)
        x += pv['width'] + 80
        bottom = max(bottom, y + 300 + pv['height'])
    print(f'{text}: {len(boards)} pano, y={y + 300}, alt kenar={bottom}, sonraki başlık y={bottom + 120}')
    return bottom
