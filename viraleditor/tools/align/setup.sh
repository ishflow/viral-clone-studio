#!/bin/sh
# Builds the Python environment of tools/align OFFLINE: only from the local uv cache (~/.cache/uv), never from an index.
# Needs: uv, a local Python 3.13 (uv-managed is fine), the 11 wheels of pylock.toml in the uv cache, ffmpeg on PATH,
# and the weight file ~/.cache/torch/hub/checkpoints/wav2vec2_fairseq_base_ls960_asr_ls960.pth (this script does not fetch it).
# When a wheel is missing uv stops with its name: that is the list to hand to the owner, nothing is downloaded.
set -eu
cd "$(dirname "$0")"
export UV_OFFLINE=1 UV_NO_PROGRESS=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
[ -x .venv/bin/python ] || uv venv --offline --python 3.13 .venv
uv pip sync --offline --preview-features pylock --python .venv/bin/python pylock.toml
.venv/bin/python align.py --check
