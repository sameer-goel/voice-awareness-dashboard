# Voice Awareness Dashboard

A private-by-default, browser-based voice review dashboard for listening back to recordings, inspecting pace/pitch/pauses, reviewing coaching feedback, and practising daily.

## Use the dashboard

The published site is static and loads the bundled session data and audio. For local development, serve it with the range-capable server so MP3 seeking works:

```bash
python3 serve.py 9417
open http://127.0.0.1:9417/
```

## Add a recording

Run the local analysis pipeline from this directory:

```bash
uv run analyze.py "https://youtu.be/VIDEO_ID" --title "My recording"
# or
uv run analyze.py ~/Downloads/take.webm --title "Practice take"
```

Reload the dashboard after analysis. The pipeline writes a session JSON file, a local MP3 copy, and rebuilds `data/sessions.js`.

## Features

- Shared audio player with timestamp seeking and moment loops
- Synced transcript, pause timeline, pitch, pace, volume and sentence-ending charts
- Curated feedback split into observable facts, interpretations and unknowns
- Daily exercises, practice recorder, reflection journal, streak and trends
- Widget pantry with drag/reorder, width changes, layout presets and local persistence

All dashboard state is stored in the browser's local storage. The bundled analysis and audio are static repository assets; no server-side account or database is required.
