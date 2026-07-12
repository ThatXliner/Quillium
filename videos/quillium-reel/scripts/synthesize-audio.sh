#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
output="$project_dir/assets/audio/quillium-bed.wav"

mkdir -p "$(dirname "$output")"

ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "sine=frequency=110:sample_rate=48000:duration=27" \
    -f lavfi -i "sine=frequency=164.81:sample_rate=48000:duration=27" \
    -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=27" \
    -f lavfi -i "anoisesrc=color=pink:sample_rate=48000:duration=27" \
    -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=0.18" \
    -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=0.24" \
    -f lavfi -i "sine=frequency=523.25:sample_rate=48000:duration=0.22" \
    -f lavfi -i "sine=frequency=880:sample_rate=48000:duration=0.32" \
    -filter_complex "\
        [0:a]volume='0.030*(0.45+0.55*sin(PI*t/27))':eval=frame,lowpass=f=240[a0]; \
        [1:a]volume='0.018*(0.35+0.65*sin(PI*t/27))':eval=frame,lowpass=f=360[a1]; \
        [2:a]volume='0.010*(0.25+0.75*sin(PI*t/27))':eval=frame,lowpass=f=480[a2]; \
        [3:a]lowpass=f=900,highpass=f=80,volume=0.006[a3]; \
        [4:a]afade=t=out:st=0:d=0.18,volume=0.055,adelay=5200|5200[a4]; \
        [5:a]afade=t=out:st=0:d=0.24,volume=0.045,adelay=11200|11200[a5]; \
        [6:a]afade=t=out:st=0:d=0.22,volume=0.050,adelay=16800|16800[a6]; \
        [7:a]afade=t=out:st=0:d=0.32,volume=0.048,adelay=20800|20800[a7]; \
        [a0][a1][a2][a3][a4][a5][a6][a7]amix=inputs=8:duration=longest:normalize=0, \
        afade=t=in:st=0:d=1.2,afade=t=out:st=26:d=1, \
        aecho=0.8:0.35:55:0.10,alimiter=limit=0.7, \
        loudnorm=I=-23:LRA=7:TP=-2,aresample=48000,apad=pad_len=4800, \
        atrim=end_sample=1296000,asetpts=N/SR/TB, \
        aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[out]" \
    -map "[out]" -c:a pcm_s16le "$output"

printf '%s\n' "$output"
