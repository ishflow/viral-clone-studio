#!/usr/bin/env python3
"""Forces the KNOWN words of a script onto the sound of a clip (CTC forced alignment, wav2vec2 through torchaudio).

  align.py [request.json]     the request, as a file or on stdin:  { "media": path, "words": [str], "language": "en" }
  align.py --check            is the environment complete?         { "ready": bool, "note": str | null }

Writes ONE JSON object to stdout, logs to stderr.
  ok:      { "words": [{ "text", "start", "end", "score" }], "model", "seconds" }      exit 0
  failed:  { "error": "not-installed" | "language-unsupported" | "bad-media" | "failed", "message" }  exit 1

Rules
  1. One entry per given word, in the given order, with the given text untouched (punctuation, casing).
  2. What is aligned is a folded form: upper case, the letters A–Z and the apostrophe. Accents come off ("café" CAFE); a
     sign inside a word breaks it into parts that are aligned one after the other ("must-have" is MUST, HAVE).
     A number is spelled in English only when it is the one number of its word, 0 … 999, written as one run of one to
     three digits without a leading zero, in a word without letters; the signs around it are left out ("4." FOUR,
     "30%" THIRTY, "$20" TWENTY, "125" ONE HUNDRED TWENTY FIVE). Digits are never joined over a sign and nothing is
     guessed: every other word with a number in it is NOT aligned: two runs of digits ("1,000", "2.5", "3-5", "24/7"),
     digits next to letters ("1st", "x2", "4-week"), more than three digits, a leading zero, a number sign that is not
     0–9 ("½", "²"). Nor is a word with a letter that has no A–Z form ("ß", a Cyrillic word).
  3. A word that is not aligned (rule 2, or nothing left of it: "%", an emoji) gets its time from its neighbours. A run
     of such words shares the gap between its aligned neighbours in equal parts (from the media's start, to its end,
     when there is no neighbour). When the gap is shorter than one model frame (20 ms) per word, the run takes the
     missing time from the neighbour after it, or else the one before it, but at most half of that neighbour's length.
     Its score is 0.
  4. Every word has start < end, words never overlap, all times lie inside the decoded sound (0 … seconds).
  5. score: the mean probability the model gives the word's letters on the frames it puts them on, 0 … 1.
  6. A word starts on the frame of its first letter and ends after the frame of its last letter: the silence between two
     words belongs to neither.
  7. `media` is the path of an existing regular file on this machine. A URL, anything ffmpeg reads as a protocol
     ("concat:", "subfile,", "pipe:", "fd:" …) or as an option (a leading "-"), a folder, a named pipe: refused with
     "bad-media" before ffmpeg starts.

No network: the socket module is closed below, before any library loads; the weights are read from the local torch hub
folder and nowhere else; ffmpeg (a separate program the guard cannot see) gets the absolute path behind "file:" and a
protocol whitelist of "file" alone, so a local playlist cannot send it to a URL either. English only. Sound longer than
MAX_SECONDS is refused (one pass through the model).
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import unicodedata
import warnings


def _no_network(*_args, **_kwargs):
    raise OSError('tools/align never opens a network connection')


socket.socket.connect = _no_network
socket.socket.connect_ex = _no_network
socket.create_connection = _no_network
socket.getaddrinfo = _no_network

MODEL = 'wav2vec2-base-960h (torchaudio WAV2VEC2_ASR_BASE_960H)'
WEIGHTS = 'wav2vec2_fairseq_base_ls960_asr_ls960.pth'
RATE = 16000
MAX_SECONDS = 120
FRAME = 0.02                    # one model frame; the smallest length a word may get

ONES = 'ZERO ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE THIRTEEN FOURTEEN FIFTEEN SIXTEEN SEVENTEEN EIGHTEEN NINETEEN'.split()
TENS = '- - TWENTY THIRTY FORTY FIFTY SIXTY SEVENTY EIGHTY NINETY'.split()


class Failed(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def log(text):
    print(f'align: {text}', file=sys.stderr, flush=True)


def spell(n):
    """0 … 999 as English words."""
    if n < 20:
        return [ONES[n]]
    if n < 100:
        return [TENS[n // 10]] + ([ONES[n % 10]] if n % 10 else [])
    return [ONES[n // 100], 'HUNDRED'] + (spell(n % 100) if n % 100 else [])


def fold(word):
    """The parts of a word the model can spell (rule 2); [] when the word is not aligned (rule 3)."""
    runs = []                    # [kind, text] with kind 'L' (letters, apostrophe) or 'D' (digits); a sign closes the run
    joined = False
    for c in word.replace('‘', "'").replace('’', "'"):
        kind = unicodedata.category(c)[0]
        if c.isascii() and (c.isalpha() or c == "'"):
            kind, text = 'L', c
        elif c.isascii() and c.isdigit():
            kind, text = 'D', c
        elif kind == 'M':
            continue             # an accent written as a character of its own
        elif kind == 'L':
            text = ''.join(d for d in unicodedata.normalize('NFKD', c) if unicodedata.category(d)[0] != 'M')
            if not (text.isascii() and text.isalpha()):
                return []        # a letter with no A–Z form
        elif kind == 'N':
            return []            # a number sign that is not 0 … 9
        else:
            joined = False       # a sign: what follows is a new run, never glued to what came before
            continue
        if joined and runs[-1][0] == kind:
            runs[-1][1] += text
        else:
            runs.append([kind, text])
        joined = True
    numbers = [text for kind, text in runs if kind == 'D']
    letters = [text.strip("'").upper() for kind, text in runs if kind == 'L' and text.strip("'")]
    if not numbers:
        return letters
    if len(numbers) > 1 or letters or len(numbers[0]) > 3 or (numbers[0][0] == '0' and numbers[0] != '0'):
        return []                # not the one plain number 0 … 999 of a word without letters: do not guess
    return spell(int(numbers[0]))


def weights_path():
    import torch
    return os.path.join(torch.hub.get_dir(), 'checkpoints', WEIGHTS)


def local_file(media):
    """The absolute path of `media` when it names an existing regular file (rule 7); refuses everything else."""
    if media == '' or media.startswith('-') or media.startswith('subfile,') or re.match(r'[A-Za-z0-9+.\-]*:', media):
        raise Failed('bad-media', f'not a local file path (a URL, an ffmpeg protocol or an option): {media[:200]}')
    path = os.path.abspath(media)
    if not os.path.isfile(path):
        raise Failed('bad-media', f'not an existing regular file: {path[:300]}')
    return path


def decode_command(ffmpeg, path):
    """ffmpeg may open local files only (whatever the file says inside), and reads `path` as a file name, never as an option or a protocol."""
    return [ffmpeg, '-v', 'error', '-nostdin', '-protocol_whitelist', 'file', '-i', 'file:' + path,
            '-map', '0:a:0', '-vn', '-ac', '1', '-ar', str(RATE), '-f', 's16le', '-']


def decode(media):
    """The first sound stream of a local file as 16 kHz mono floats."""
    import torch
    ffmpeg = shutil.which('ffmpeg')
    if ffmpeg is None:
        raise Failed('not-installed', 'ffmpeg is not on PATH')
    r = subprocess.run(decode_command(ffmpeg, local_file(media)), capture_output=True, timeout=300)
    if r.returncode != 0 or len(r.stdout) < 2:
        raise Failed('failed', f'ffmpeg could not decode the sound of {media}: {r.stderr.decode("utf8", "replace").strip()[:300] or "no samples"}')
    return torch.frombuffer(bytearray(r.stdout[:len(r.stdout) // 2 * 2]), dtype=torch.int16).to(torch.float32) / 32768.0


def load_model():
    import torch
    import torchaudio
    path = weights_path()
    if not os.path.isfile(path):
        raise Failed('not-installed', f'the weight file is missing: {path}')
    labels = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H.get_labels()        # ('-', '|', 'E', 'T', …): 0 is the CTC blank, '|' the word break
    state = torch.load(path, map_location='cpu', weights_only=True)
    for key in ('aux.weight', 'aux.bias'):                                   # the file has 32 outputs: rows 1, 2, 3 are dictionary entries the speech training never used
        state[key] = torch.cat([state[key][:1], state[key][4:]])
    model = torchaudio.models.wav2vec2_base(aux_num_out=len(labels))
    model.load_state_dict(state)
    return model.eval(), labels


def emissions(model, samples):
    """Log-probabilities per model frame: [frames, labels]."""
    import torch
    with torch.inference_mode():
        out, _ = model(samples.unsqueeze(0))
        return torch.log_softmax(out, dim=-1)[0]


def force(emission, labels, parts_per_word):
    """Letter spans for the given parts. parts_per_word: one list of parts per ALIGNED word. Returns one list of (first frame, end frame, probability sum, frames) per word."""
    import torch
    import torchaudio.functional as F
    index = {c: i for i, c in enumerate(labels)}
    targets, owner = [], []
    for w, parts in enumerate(parts_per_word):
        for part in parts:
            if targets:
                targets.append(index['|'])
                owner.append(-1)
            targets += [index[c] for c in part]
            owner += [w] * len(part)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            aligned, scores = F.forced_align(emission.unsqueeze(0), torch.tensor([targets], dtype=torch.int32), blank=0)
            spans = F.merge_tokens(aligned[0], scores[0].exp())
    except (RuntimeError, ValueError) as e:
        raise Failed('failed', f'the sound ({emission.shape[0]} frames) is too short for these words ({len(targets)} letters): {str(e)[:200]}')
    if len(spans) != len(targets):
        raise Failed('failed', f'the alignment gave {len(spans)} letters for {len(targets)}')
    words = [[] for _ in parts_per_word]
    for span, w in zip(spans, owner):
        if w >= 0:
            words[w].append((span.start, span.end, span.score * (span.end - span.start), span.end - span.start))
    return words


def place(words, parts, timed, seconds):
    """All words in order: the aligned ones with their times, the others by rule 3."""
    out = [None] * len(words)
    for i, t in zip([i for i, p in enumerate(parts) if p], timed):
        out[i] = {'text': words[i], 'start': t[0], 'end': t[1], 'score': t[2]}
    i = 0
    while i < len(words):
        if out[i] is not None:
            i += 1
            continue
        j = i
        while j < len(words) and out[j] is None:
            j += 1
        before = out[i - 1] if i > 0 else None
        after = out[j] if j < len(words) else None
        a = before['end'] if before else 0.0
        b = after['start'] if after else seconds
        need = FRAME * (j - i)
        if b - a < need and after:
            b = min(a + need, (after['start'] + after['end']) / 2)
            after['start'] = b
        if b - a < need and before:
            a = max(b - need, (before['start'] + before['end']) / 2)
            before['end'] = a
        for k in range(i, j):
            out[k] = {'text': words[k], 'start': a + (b - a) * (k - i) / (j - i), 'end': a + (b - a) * (k - i + 1) / (j - i), 'score': 0.0}
        i = j
    return out


def align(media, words):
    t0 = time.time()
    samples = decode(media)
    seconds = samples.shape[0] / RATE
    if seconds > MAX_SECONDS:
        raise Failed('failed', f'{seconds:.1f} s of sound: more than the {MAX_SECONDS} s this tool takes in one pass')
    model, labels = load_model()
    t1 = time.time()
    parts = [fold(w) for w in words]
    timed = []
    if any(parts):
        emission = emissions(model, samples)
        t2 = time.time()
        per_frame = seconds / emission.shape[0]
        for spans in force(emission, labels, [p for p in parts if p]):
            frames = sum(s[3] for s in spans)
            timed.append((spans[0][0] * per_frame, spans[-1][1] * per_frame, min(1.0, max(0.0, sum(s[2] for s in spans) / frames))))
        log(f'decode+load {t1 - t0:.2f} s, model {t2 - t1:.2f} s, alignment {time.time() - t2:.2f} s, {emission.shape[0]} frames, {seconds:.2f} s of sound')
    out = place(words, parts, timed, seconds)
    seconds = round(seconds, 4)
    before = 0.0
    for w in out:
        w['start'], w['end'], w['score'] = round(w['start'], 4), round(w['end'], 4), round(w['score'], 4)
        if not (before <= w['start'] < w['end'] <= seconds):
            raise Failed('failed', f'no room for "{w["text"]}" ({w["start"]} … {w["end"]}, after {before}, sound {seconds} s)')
        before = w['end']
    return {'words': out, 'model': MODEL, 'seconds': seconds}


def check():
    try:
        import torch          # noqa: F401
        import torchaudio     # noqa: F401
    except Exception as e:    # an environment that is not there, or half there
        return {'ready': False, 'note': f'torch / torchaudio cannot be loaded: {str(e)[:200]}'}
    if not os.path.isfile(weights_path()):
        return {'ready': False, 'note': f'the weight file is missing: {weights_path()}'}
    if shutil.which('ffmpeg') is None:
        return {'ready': False, 'note': 'ffmpeg is not on PATH'}
    return {'ready': True, 'note': None}


def main(argv):
    warnings.filterwarnings('ignore')
    if argv[1:] == ['--check']:
        return check(), 0
    try:
        request = json.load(open(argv[1], encoding='utf8')) if len(argv) > 1 else json.load(sys.stdin)
        media, words, language = request['media'], request['words'], request['language']
        if not isinstance(media, str) or not isinstance(language, str) or not isinstance(words, list) or not all(isinstance(w, str) for w in words):
            raise Failed('failed', 'the request is not { media: string, words: string[], language: string }')
        if not re.match(r'^en($|[-_])', language, re.IGNORECASE):
            raise Failed('language-unsupported', f'no alignment model for "{language}": English only')
        media = local_file(media)
        try:
            import torch          # noqa: F401
            import torchaudio     # noqa: F401
        except Exception as e:
            raise Failed('not-installed', f'torch / torchaudio cannot be loaded: {str(e)[:200]}')
        return align(media, words), 0
    except Failed as e:
        return {'error': e.code, 'message': str(e)}, 1
    except Exception as e:    # one JSON object on stdout, whatever happens
        log(f'{type(e).__name__}: {e}')
        return {'error': 'failed', 'message': f'{type(e).__name__}: {str(e)[:300]}'}, 1


if __name__ == '__main__':
    answer, code = main(sys.argv)
    print(json.dumps(answer, ensure_ascii=False))
    sys.exit(code)
