#!/usr/bin/env bash
# Records the whole desktop to docs/fallback.mp4 until you press q (or Ctrl-C).
cd "$(dirname "$0")/.."
ffmpeg -y -f gdigrab -framerate 30 -offset_x 0 -offset_y 0 -video_size 1536x864   -i desktop -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p docs/fallback.mp4
