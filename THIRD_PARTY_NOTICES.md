# Third-party notices

ULI's own source code is released under the MIT License (see `LICENSE`).
The Windows installer bundles the following third-party software. Each component
keeps its own license; ULI runs FFmpeg and FFprobe as separate programs
(command-line processes) and does not link against them.

## FFmpeg (ffmpeg.exe)

- Version: 6.1.1 "essentials" static build by gyan.dev, via the
  [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) npm package
- License: **GNU General Public License v3.0** (built with `--enable-gpl --enable-version3`)
- License text in the installed app: `resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe.LICENSE`
- Build information: `resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe.README`
- Corresponding source code: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93
  (build scripts and configuration: https://www.gyan.dev/ffmpeg/builds/)
- FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

## FFprobe (ffprobe.exe)

- Version: 4.0.2, via the [`ffprobe-static`](https://github.com/joshwnj/ffprobe-static) npm package
- License: **GNU General Public License v3.0**
- Source code: https://github.com/FFmpeg/FFmpeg/tree/n4.0.2

## whisper.cpp (speech recognition for Auto Captions)

- Version: b5454, Windows x64 build from https://github.com/ggml-org/whisper.cpp/releases
  (`whisper-cli.exe`, `whisper.dll`, `ggml*.dll`, installed under `resources/whisper`)
- License: **MIT** — Copyright (c) 2023-2026 The ggml authors
- ULI runs it as a separate program; audio never leaves the computer.

## Whisper speech models (downloaded on first use, not bundled)

- `ggml-small-q5_1.bin` / `ggml-large-v3-turbo-q5_0.bin` from https://huggingface.co/ggerganov/whisper.cpp
- Original models: OpenAI Whisper, **MIT License** — Copyright (c) 2022 OpenAI
- Downloaded to `%APPDATA%\ULI\models` only when the user starts Auto Captions; verified with SHA-256.

## Electron

- Version: 38, https://www.electronjs.org/
- License: MIT. Electron includes Chromium and other components; their licenses are
  installed next to the application as `LICENSE.electron.txt` and `LICENSES.chromium.html`.

## npm packages

- `ffmpeg-static` — GPL-3.0-or-later (package code and the bundled binary)
- `ffprobe-static` — MIT (package code); the bundled binary is GPL-3.0

## Fonts and voices

ULI does not bundle any fonts or text-to-speech voices. It lists the fonts and
Windows speech voices already installed on the user's computer.
