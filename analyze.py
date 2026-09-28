# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "faster-whisper==1.1.1",
#   "requests==2.32.3",
#   "praat-parselmouth==0.4.5",
#   "numpy==2.1.3",
# ]
# ///
"""
Voice Awareness Dashboard: analysis pipeline.

Turns one recording (YouTube URL or local audio/video file) into a "session"
the dashboard can display, then rebuilds data/sessions.js from every session.

Usage:
  uv run analyze.py <youtube-url | path/to/file> [--title "My take"] [--id custom-id]
  uv run analyze.py --rebuild          # only regenerate data/sessions.js

Output per session:
  audio/<id>.mp3          playback copy (mono, 64 kbps)
  data/sessions/<id>.json full analysis
Curated human notes (optional) are merged from notes/<id>.json.
"""
import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AUDIO = ROOT / "audio"
SESS = ROOT / "data" / "sessions"
NOTES = ROOT / "notes"

# Targets used for on-target / off-target status. Kept in one place so the
# dashboard and the pipeline agree. Ranges are coaching targets, not norms.
TARGETS = {
    "wpm_gross":      {"label": "Overall pace", "unit": "wpm", "lo": 120, "hi": 155},
    "artic_wpm":      {"label": "Speaking pace (no pauses)", "unit": "wpm", "lo": 140, "hi": 175},
    "mid_clause_pct": {"label": "Pauses inside a phrase", "unit": "%", "hi": 10},
    "long_gaps":      {"label": "Silences > 2 s per 10 min", "unit": "", "hi": 5},
    "f0_sd_st":       {"label": "Pitch variation", "unit": "st", "lo": 3.0},
    "fillers_per_min": {"label": "Um / uh per minute", "unit": "/min", "hi": 1.0},
    "repeats":        {"label": "Doubled phrases", "unit": "", "hi": 1},
    "falling_end_pct": {"label": "Statements that land (fall)", "unit": "%", "lo": 50},
    "asr_conf":       {"label": "Word clarity (ASR confidence)", "unit": "", "lo": 0.9},
}

FILLERS = {"um", "uh", "erm", "er", "hmm", "mm", "ah"}
SOFT_HABITS = ["you know", "to make it simple", "basically", "kind of", "sort of",
               "i mean", "like", "actually", "right", "okay"]


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"command failed: {' '.join(cmd)}\n{r.stderr[-1500:]}")
    return r.stdout


def fetch(src, tmp):
    """Return (path_to_audio, title, source_label)."""
    if re.match(r"https?://", src):
        # The tv/web_safari clients avoid the 403s the default client hits here.
        # YouTube is flaky ("page needs to be reloaded"), so retry a few times.
        args = ["--extractor-args", "youtube:player_client=tv,web_safari", "--no-update"]
        for attempt in range(3):
            r = subprocess.run(["yt-dlp", "-x", "--audio-format", "wav", "--print", "after_move:title",
                                "-o", str(tmp / "src.%(ext)s"), *args, src], capture_output=True, text=True)
            if r.returncode == 0 and (tmp / "src.wav").exists():
                title = (r.stdout.strip().splitlines() or [src])[-1]
                return tmp / "src.wav", title, src
            print(f"download attempt {attempt + 1} failed, retrying ...", flush=True)
        sys.exit("yt-dlp failed:\n" + r.stderr[-1500:])
    p = Path(src).expanduser().resolve()
    if not p.exists():
        sys.exit(f"file not found: {p}")
    return p, p.stem, str(p)


def analyze(src_path, tmp):
    import numpy as np
    import parselmouth
    from faster_whisper import WhisperModel

    wav = tmp / "m.wav"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src_path), "-ac", "1", "-ar", "16000", str(wav)])

    # ---------- words (fillers kept via prompt priming) ----------
    print("transcribing ...", flush=True)
    model = WhisperModel("small.en", device="cpu", compute_type="int8")
    segs, _ = model.transcribe(str(wav), word_timestamps=True, vad_filter=False,
                               initial_prompt="Um, uh, so, like, you know, basically, right, okay.")
    W = []
    for s in segs:
        for w in s.words:
            W.append([round(w.start, 2), round(w.end, 2), w.word.strip(), round(w.probability, 2)])
    if not W:
        sys.exit("no speech detected")

    # ---------- acoustics ----------
    print("measuring pitch / loudness ...", flush=True)
    snd = parselmouth.Sound(str(wav))
    dur = snd.get_total_duration()
    pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=65, pitch_ceiling=400)
    f0 = pitch.selected_array["frequency"]; tp = pitch.xs()
    inten = snd.to_intensity(time_step=0.01); db = inten.values[0]; ti = inten.xs()
    voiced = f0[f0 > 0]
    if voiced.size < 20:
        sys.exit("too little voiced speech to analyse")
    med = float(np.median(voiced))
    semi = 12 * np.log2(voiced / med)
    # Floor-relative threshold: noise floor + 15% of the speech range. A median-based
    # threshold fails on short, pause-heavy takes where the median itself is silence.
    p10, p90 = float(np.percentile(db, 10)), float(np.percentile(db, 90))
    sil_thr = p10 + 0.15 * (p90 - p10)
    silent = db < sil_thr

    # silences >= 0.25 s
    P, st = [], None
    for i, s in enumerate(silent):
        if s and st is None:
            st = i
        if (not s or i == len(silent) - 1) and st is not None:
            L = (i - st) * 0.01
            if L >= 0.25:
                P.append((float(ti[st]), round(L, 2)))
            st = None
    speech_start, speech_end = W[0][0], W[-1][1]
    P = [p for p in P if speech_start < p[0] < speech_end]

    # classify pauses >= 0.8 s as mid-phrase vs boundary
    pauses = []
    for a, L in P:
        if L < 0.8:
            continue
        prev = [w for w in W if w[0] < a][-4:]
        nxt = [w for w in W if w[0] >= a + L - 0.3][:4]
        if not prev or not nxt:
            continue
        lw = prev[-1][2]
        boundary = bool(lw) and lw[-1] in ".,?!;:"
        pauses.append({"t": round(a, 2), "len": L, "kind": "boundary" if boundary else "mid",
                       "prev": " ".join(w[2] for w in prev), "next": " ".join(w[2] for w in nxt)})

    # phrase endings: pitch slope over last 350 ms before a pause >= 0.4 s
    endings = []
    for a, L in P:
        if L < 0.4:
            continue
        m = (tp >= a - 0.35) & (tp < a) & (f0 > 0)
        if m.sum() < 8:
            continue
        slope = float(np.polyfit(tp[m], 12 * np.log2(f0[m] / med), 1)[0] * 0.3)
        if abs(slope) > 15:          # likely octave error / creak: unreliable
            continue
        prev = [w for w in W if w[1] <= a + 0.1][-6:]
        endings.append({"t": round(a, 2), "slope": round(slope, 1),
                        "kind": "rise" if slope > 2 else "fall" if slope < -2 else "flat",
                        "text": " ".join(w[2] for w in prev)})

    # speaking time excludes silence -> articulation rate
    def speak_secs(a, b):
        m = (ti >= a) & (ti < b)
        return float((~silent[m]).sum() * 0.01)

    per_min = []
    for m0 in range(0, int(speech_end // 60) + 1):
        a, b = m0 * 60, (m0 + 1) * 60
        n = sum(1 for w in W if a <= w[0] < b)
        sp = speak_secs(max(a, speech_start), min(b, speech_end))
        span = min(b, speech_end) - max(a, speech_start)
        if span < 10:
            continue
        per_min.append({"m": m0, "wpm": round(n / span * 60), "artic": round(n / sp * 60) if sp > 1 else 0})

    windows = []
    for w0 in np.arange(0, dur, 30):
        mk = (tp >= w0) & (tp < w0 + 30) & (f0 > 0)
        mi = (ti >= w0) & (ti < w0 + 30)
        vv = f0[mk]
        if len(vv) < 20:
            continue
        s2 = 12 * np.log2(vv / med)
        windows.append({"t": int(w0), "f0med": round(float(np.median(vv)), 1),
                        "sd_st": round(float(np.std(s2)), 2),
                        "rng_st": round(float(np.percentile(s2, 95) - np.percentile(s2, 5)), 1),
                        "db90": round(float(np.percentile(db[mi], 90)), 1)})

    # ---------- language habits ----------
    low = [re.sub(r"[^a-z']", "", w[2].lower()) for w in W]
    fillers = [{"t": W[i][0], "w": low[i]} for i in range(len(W)) if low[i] in FILLERS]
    text_low = " ".join(low)
    habits = {h: len(re.findall(r"\b" + re.escape(h) + r"\b", text_low)) for h in SOFT_HABITS}
    habits = {k: v for k, v in habits.items() if v}
    repeats, i = [], 0
    while i < len(W):
        hit = False
        for n in (4, 3, 2):
            if i + 2 * n <= len(low) and low[i:i + n] == low[i + n:i + 2 * n] and all(low[i:i + n]):
                repeats.append({"t": W[i][0], "phrase": " ".join(w[2] for w in W[i:i + n])})
                i += 2 * n; hit = True; break
        if not hit:
            i += 1
    openers = Counter()
    for j in range(1, len(W)):
        if W[j][0] - W[j - 1][1] > 0.6 or W[j - 1][2][-1:] in ".?!":
            openers[low[j]] += 1

    # ---------- tracks for charts (10 Hz) ----------
    step = 10
    pitch_track = [int(round(x)) for x in f0[::step]]
    loud_track = [int(round(max(0, x))) for x in db[::step]]

    minutes = max((speech_end - speech_start) / 60, 1 / 60)
    n_end = len(endings) or 1
    metrics = {
        "duration": round(dur, 1),
        "speech_start": speech_start,
        "words": len(W),
        "wpm_gross": round(len(W) / minutes),
        "artic_wpm": round(len(W) / (max(speak_secs(speech_start, speech_end), 0.5) / 60)),
        "f0_median": round(med, 1),
        "f0_p5": round(float(np.percentile(voiced, 5)), 1),
        "f0_p95": round(float(np.percentile(voiced, 95)), 1),
        "f0_range_st": round(float(np.percentile(semi, 95) - np.percentile(semi, 5)), 1),
        "f0_sd_st": round(float(np.std(semi)), 2),
        "pauses_ge1": sum(1 for p in P if p[1] >= 1),
        "long_gaps": round(sum(1 for p in P if p[1] >= 2) / (minutes / 10), 1),
        "mid_clause_pct": round(100 * sum(p["kind"] == "mid" for p in pauses) / max(1, len(pauses))),
        "fillers_per_min": round(len(fillers) / minutes, 2),
        "repeats": len(repeats),
        "falling_end_pct": round(100 * sum(e["kind"] == "fall" for e in endings) / n_end),
        "rising_end_pct": round(100 * sum(e["kind"] == "rise" for e in endings) / n_end),
        "asr_conf": round(float(np.mean([w[3] for w in W])), 3),
        "level_p90_sd": round(float(np.std([w["db90"] for w in windows])), 2) if windows else 0,
    }
    return {
        "metrics": metrics, "perMinute": per_min, "windows": windows, "pauses": pauses,
        "endings": endings, "fillers": fillers, "habits": habits, "repeats": repeats,
        "openers": openers.most_common(8), "words": W,
        "tracks": {"hz": 10, "pitch": pitch_track, "loud": loud_track},
    }


def auto_findings(r):
    """Rule-based feedback so every new session gets observations without manual work."""
    m = r["metrics"]; fmt = lambda t: f"{int(t // 60)}:{int(t % 60):02d}"
    obs, interp = [], []
    obs.append(f"Overall pace {m['wpm_gross']} wpm; speaking pace excluding pauses {m['artic_wpm']} wpm.")
    mids = [p for p in r["pauses"] if p["kind"] == "mid"]
    obs.append(f"{m['mid_clause_pct']}% of pauses of 0.8 s or longer fall inside a phrase ({len(mids)} of {len(r['pauses'])}).")
    for p in sorted(mids, key=lambda p: -p["len"])[:3]:
        obs.append(f"{fmt(p['t'])} mid-phrase pause {p['len']} s: \"{p['prev']} ‖ {p['next']}\"")
    obs.append(f"Pitch median {m['f0_median']} Hz, variation {m['f0_sd_st']} st, span {m['f0_range_st']} st.")
    flat = min(r["windows"], key=lambda w: w["sd_st"]) if r["windows"] else None
    if flat:
        obs.append(f"Flattest stretch starts {fmt(flat['t'])} (variation {flat['sd_st']} st).")
    if r["repeats"]:
        obs.append("Doubled phrases: " + "; ".join(f"{fmt(x['t'])} \"{x['phrase']}\"" for x in r["repeats"][:5]))
    obs.append(f"Um/uh: {len(r['fillers'])} total ({m['fillers_per_min']}/min).")
    if m["mid_clause_pct"] > 20:
        interp.append("Pauses land where planning runs out, so it can sound like searching rather than landing a point.")
    if m["f0_sd_st"] < 3:
        interp.append("Narrow pitch movement can read as calm but also as low energy on key points.")
    if m["rising_end_pct"] > m["falling_end_pct"]:
        interp.append("More statements rise than fall at the end; this can sound tentative.")
    if m["wpm_gross"] < 120:
        interp.append("Low overall pace plus long gaps risks losing viewer attention.")
    unknown = ["Whether pauses come from nerves, improvising, or editing.",
               "Voice health (compressed audio is not diagnostic).",
               "How a specific audience perceives the voice."]
    return {"observable": obs, "interpretation": interp, "unknown": unknown}


def status(key, val):
    t = TARGETS[key]
    if "lo" in t and val < t["lo"]:
        return "off" if val < t["lo"] * 0.85 else "near"
    if "hi" in t and val > t["hi"]:
        return "off" if val > t["hi"] * 1.3 + 1 else "near"
    return "ok"


def rebuild():
    sessions = []
    for f in sorted(SESS.glob("*.json")):
        s = json.loads(f.read_text())
        note = NOTES / f.name
        if note.exists():
            s["notes"] = json.loads(note.read_text())
        s["status"] = {k: status(k, s["metrics"][k]) for k in TARGETS if k in s["metrics"]}
        sessions.append(s)
    sessions.sort(key=lambda s: s["date"])
    out = ROOT / "data" / "sessions.js"
    out.write_text("// generated by analyze.py, do not edit\nwindow.VOICE_DATA = "
                   + json.dumps({"targets": TARGETS, "sessions": sessions,
                                 "built": dt.datetime.now().isoformat(timespec="seconds")},
                                separators=(",", ":")) + ";\n")
    print(f"sessions.js rebuilt: {len(sessions)} session(s), {out.stat().st_size // 1024} KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", nargs="?")
    ap.add_argument("--title")
    ap.add_argument("--id")
    ap.add_argument("--source", help="label to store as the source (e.g. original URL)")
    ap.add_argument("--rebuild", action="store_true")
    a = ap.parse_args()
    for d in (AUDIO, SESS, NOTES):
        d.mkdir(parents=True, exist_ok=True)
    if a.rebuild or not a.src:
        return rebuild()
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        src_path, title, source = fetch(a.src, tmp)
        sid = a.id or dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        if not re.fullmatch(r"[\w-]{1,80}", sid):
            sys.exit("--id may only contain letters, digits, _ and -")
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src_path), "-vn", "-ac", "1",
             "-b:a", "64k", str(AUDIO / f"{sid}.mp3")])
        res = analyze(src_path, tmp)
    res.update({"id": sid, "title": a.title or title, "source": a.source or source,
                "date": dt.datetime.now().isoformat(timespec="seconds"),
                "audio": f"audio/{sid}.mp3"})
    res["auto"] = auto_findings(res)
    (SESS / f"{sid}.json").write_text(json.dumps(res))
    print(f"session saved: {sid}")
    rebuild()


if __name__ == "__main__":
    main()
