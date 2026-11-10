"""Birkaç önizleme PNG'sini tek kontak tabakasında birleştirir: python3 sheet.py <çıktı.png> <sütun> <hücre genişliği> a.png b.png ..."""
import sys
from PIL import Image
out, cols, cw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = []
for p in sys.argv[4:]:
    im = Image.open(p).convert('RGB')
    ims.append(im.resize((cw, round(im.height * cw / im.width)), Image.LANCZOS))
rows = [ims[i:i + cols] for i in range(0, len(ims), cols)]
H = sum(max(i.height for i in r) + 8 for r in rows)
sheet = Image.new('RGB', (cols * (cw + 8), H), (60, 60, 60))
y = 0
for r in rows:
    for j, im in enumerate(r):
        sheet.paste(im, (j * (cw + 8), y))
    y += max(i.height for i in r) + 8
sheet.save(out)
print(out, sheet.size)
