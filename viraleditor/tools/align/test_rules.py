"""The pure rules of align.py (fold, spell, place, the media check, the ffmpeg command), with plain asserts.
Run: python test_rules.py (any Python 3; no model, no ffmpeg, no network)."""
import os
import tempfile

import align

fold = align.fold
# letters: accents come off, signs break a word into parts, apostrophes stay inside
assert fold("It's") == ["IT'S"] and fold('ACME.') == ['ACME'] and fold('honestly?') == ['HONESTLY']
assert fold('you’ve') == ["YOU'VE"] and fold("'quoted'") == ['QUOTED'] and fold("''") == [] and fold("rock'n'roll") == ["ROCK'N'ROLL"]
assert fold('must-have') == ['MUST', 'HAVE'] and fold('café') == ['CAFE'] and fold('naïve') == ['NAIVE']
assert fold('cafe' + chr(0x301)) == ['CAFE'] and fold('ﬁne') == ['FINE']       # an accent as its own character; a ligature opens
# a letter with no A-Z form: the word is not aligned (never the word with the letter left out)
assert fold('straße') == [] and fold('сыворотка') == []
# one number 0 … 999 and no letter: spelled; the signs around it are left out
assert fold('4') == ['FOUR'] and fold('0.') == ['ZERO'] and fold('4.') == ['FOUR'] and fold('30%') == ['THIRTY'] and fold('(30)') == ['THIRTY']
assert fold('125') == ['ONE', 'HUNDRED', 'TWENTY', 'FIVE'] and fold('999') == ['NINE', 'HUNDRED', 'NINETY', 'NINE']
assert fold('100%') == ['ONE', 'HUNDRED'] and fold('$20') == ['TWENTY'] and fold('№1') == ['ONE'] and fold('#1') == ['ONE']
# everything else with a number in it is NOT aligned: digits are never joined over a sign, and nothing is guessed
assert fold('½') == [] and fold('1½') == [] and fold('²') == [] and fold('m²') == []          # a fraction or raised digit
assert fold('3–5') == [] and fold('3-5') == [] and fold('24/7') == [] and fold('1/2') == [] and fold('10:30') == []   # two numbers in one word
assert fold('1,000') == [] and fold('2,500') == [] and fold('10,000') == [] and fold('2.5') == []                  # a separator or a decimal point
assert fold('2026') == [] and fold('007') == []                                                                     # above 999, a leading zero
assert fold('x2') == [] and fold('1st') == [] and fold('4-week') == [] and fold('B12') == []                        # a number and letters in one word
assert fold('%') == [] and fold('\U0001F642') == [] and fold('→') == [] and fold('') == []
assert align.spell(0) == ['ZERO'] and align.spell(13) == ['THIRTEEN'] and align.spell(20) == ['TWENTY'] and align.spell(21) == ['TWENTY', 'ONE'] and align.spell(100) == ['ONE', 'HUNDRED']


def place(words, timed, seconds):
    out = align.place(words, [fold(w) for w in words], timed, seconds)
    before = 0.0
    for w, text in zip(out, words):
        assert w['text'] == text
        assert before <= w['start'] < w['end'] <= seconds + 1e-9, (words, out)
        before = w['end']
    return [(round(w['start'], 4), round(w['end'], 4), w['score']) for w in out]


# every word aligned: nothing moves
assert place(['a', 'b'], [(0.1, 0.2, 0.9), (0.5, 0.6, 0.8)], 1.0) == [(0.1, 0.2, 0.9), (0.5, 0.6, 0.8)]
# a run in the middle shares the gap in equal parts, score 0
assert place(['a', '%', '2026', 'b'], [(0.1, 0.2, 0.9), (0.5, 0.6, 0.8)], 1.0) == [(0.1, 0.2, 0.9), (0.2, 0.35, 0.0), (0.35, 0.5, 0.0), (0.5, 0.6, 0.8)]
# at the start and at the end: from 0, up to the end of the sound
assert place(['%', 'a', '%'], [(0.4, 0.6, 0.9)], 1.0) == [(0.0, 0.4, 0.0), (0.4, 0.6, 0.9), (0.6, 1.0, 0.0)]
# no room before the first word: one frame from the neighbour after it, at most half of it
assert place(['%', 'go'], [(0.0, 0.1, 0.9)], 1.0) == [(0.0, 0.02, 0.0), (0.02, 0.1, 0.9)]
assert place(['%', 'go'], [(0.0, 0.02, 0.9)], 1.0) == [(0.0, 0.01, 0.0), (0.01, 0.02, 0.9)]
# no room after the last word: from the neighbour before it
assert place(['go', '%'], [(0.9, 1.0, 0.9)], 1.0) == [(0.9, 0.98, 0.9), (0.98, 1.0, 0.0)]
# two words in a gap of one frame: the neighbour after gives the rest
assert place(['a', '%', '%', 'b'], [(0.5, 1.0, 0.9), (1.02, 1.5, 0.8)], 2.0) == [(0.5, 1.0, 0.9), (1.0, 1.02, 0.0), (1.02, 1.04, 0.0), (1.04, 1.5, 0.8)]
# nothing the model can spell: equal parts of the whole sound
assert place(['%', '2026'], [], 1.0) == [(0.0, 0.5, 0.0), (0.5, 1.0, 0.0)]


# the media must be an existing regular local file: what ffmpeg could read as a protocol or an option never reaches it
def refused(media):
    try:
        align.local_file(media)
    except align.Failed as e:
        return e.code == 'bad-media'
    return False


for media in ['http://127.0.0.1:9/x.mp4', 'https://example.invalid/a.mp4', 'rtmp://example.invalid/live', 'file:///tmp/a.mp4', 'concat:/a.mp4|/b.mp4',
              'subfile,,start,0,end,100,,:/a.mp4', 'pipe:0', 'fd:0', 'data:audio/wav;base64,AAAA', ':a.mp4', '-', '-version', '']:
    assert refused(media), media
here = os.path.abspath(__file__)
folder = tempfile.mkdtemp(prefix='ve-align-rules-')
assert refused(os.path.join(folder, 'missing.mp4')) and refused(folder)
os.mkfifo(os.path.join(folder, 'pipe.mp4'))
assert refused(os.path.join(folder, 'pipe.mp4'))
assert align.local_file(here) == here
assert align.local_file(os.path.relpath(here)) == here
# ffmpeg gets the absolute path behind "file:" (never an option, never another protocol) and may open local files only, whatever the file says inside
command = align.decode_command('/usr/local/bin/ffmpeg', '/clips/a b:c.mp4')
assert command[0] == '/usr/local/bin/ffmpeg'
assert command[command.index('-protocol_whitelist') + 1] == 'file' and command.index('-protocol_whitelist') < command.index('-i')
assert command[command.index('-i') + 1] == 'file:/clips/a b:c.mp4' and '/clips/a b:c.mp4' not in command
print('rules ok')
