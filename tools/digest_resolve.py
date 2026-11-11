#!/usr/bin/env python3
"""Resolve any link to text, deciding at runtime what it is.

    digest_resolve.py <url> [--max-minutes N]

Prints one JSON object: {"kind", "lane", "title", "url", "text", "segments"?, "note"?}

kind:
  youtube  captions via youtube-transcript-api, else yt-dlp subtitles, else audio + local whisper
  media    any audio/video link yt-dlp understands (direct .mp3/.mp4/..., Vimeo, X, TikTok, podcasts...)
           -> audio + local faster-whisper (CPU, free; no paid API)
  pdf      downloaded and read with pypdf
  page     everything else; the caller reads it as a web page (Exa / direct fetch)

Runs in ~/.nougen/venvs/digest (faster-whisper, yt-dlp, youtube-transcript-api, pypdf).
"""
import json
import os
import re
import sys
import tempfile
import urllib.request

MEDIA_EXT = re.compile(r"\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|mp4|m4v|mov|webm|mkv|avi)(\?|$)", re.I)
YOUTUBE = re.compile(r"(?:youtube\.com/(?:watch\?.*v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})")
UA = {"User-Agent": "Mozilla/5.0 NouScripts-digest"}

# Libraries (yt-dlp, model downloads) print progress to stdout. Keep the real stdout for the one JSON
# result and point fd 1 at stderr for everything else.
_RESULT = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)


def out(**kw):
    _RESULT.write(json.dumps(kw))
    _RESULT.flush()
    os._exit(0)


def head_type(url):
    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-0"}, method=method)
            with urllib.request.urlopen(req, timeout=15) as r:
                return (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        except Exception:
            continue
    return ""


def fmt_ts(s):
    s = int(s)
    return f"{s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d}"


def youtube_captions(vid):
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    tr = api.fetch(vid, languages=["en", "en-US", "en-GB"])
    segs = [{"t": fmt_ts(x.start), "text": x.text.replace("\n", " ")} for x in tr]
    return segs


def yt_info(url):
    import yt_dlp
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as y:
        return y.extract_info(url, download=False)


def transcribe(url, max_minutes, tmp):
    import yt_dlp
    from faster_whisper import WhisperModel
    opts = {"quiet": True, "no_warnings": True, "format": "bestaudio/best", "outtmpl": os.path.join(tmp, "a.%(ext)s"),
            "match_filter": (lambda info, *a, **k: None if not info.get("duration") or info["duration"] <= max_minutes * 60
                             else f"longer than {max_minutes} minutes")}
    with yt_dlp.YoutubeDL(opts) as y:
        info = y.extract_info(url, download=True)
    files = [f for f in os.listdir(tmp) if f.startswith("a.")]
    if not files:
        raise RuntimeError(f"no audio downloaded (over {max_minutes} min, or not media)")
    model = WhisperModel(os.environ.get("NOU_WHISPER_MODEL", "base"), device="cpu", compute_type="int8")
    segs, _ = model.transcribe(os.path.join(tmp, files[0]), vad_filter=True)
    return info, [{"t": fmt_ts(s.start), "text": s.text.strip()} for s in segs]


def main():
    if len(sys.argv) < 2:
        out(kind="error", note="usage: digest_resolve.py <url>")
    url = sys.argv[1].strip()
    max_minutes = int(sys.argv[sys.argv.index("--max-minutes") + 1]) if "--max-minutes" in sys.argv else 45

    m = YOUTUBE.search(url)
    if m:
        vid = m.group(1)
        title = url
        try:
            title = (yt_info(url) or {}).get("title") or url
        except Exception:
            pass
        try:
            segs = youtube_captions(vid)
            out(kind="youtube", lane="captions", title=title, url=url, segments=segs,
                text=" ".join(f"[{s['t']}] {s['text']}" for s in segs))
        except Exception as e:
            cap_err = str(e).splitlines()[0][:120]
        with tempfile.TemporaryDirectory() as tmp:
            try:
                info, segs = transcribe(url, max_minutes, tmp)
                out(kind="youtube", lane="whisper (no captions)", title=info.get("title") or title, url=url, segments=segs,
                    text=" ".join(f"[{s['t']}] {s['text']}" for s in segs), note=f"captions unavailable: {cap_err}")
            except Exception as e:
                out(kind="error", lane="youtube", url=url, title=title, note=f"captions: {cap_err}; audio: {str(e)[:160]}")

    ctype = head_type(url)
    if ctype == "application/pdf" or re.search(r"\.pdf(\?|$)", url, re.I):
        from pypdf import PdfReader
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, "d.pdf")
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r, open(p, "wb") as f:
                f.write(r.read())
            rd = PdfReader(p)
            text = "\n".join((pg.extract_text() or "") for pg in rd.pages)
            title = (rd.metadata.title if rd.metadata and rd.metadata.title else url)
            out(kind="pdf", lane="pypdf", title=title, url=url, text=re.sub(r"[ \t]+", " ", text).strip(), note=f"{len(rd.pages)} pages")

    is_media = MEDIA_EXT.search(url) or ctype.startswith(("audio/", "video/"))
    if not is_media and ctype.startswith("text/html"):
        # A web page might still host media yt-dlp knows (Vimeo, X, TikTok, podcast pages...). Ask it, cheaply.
        try:
            info = yt_info(url)
            is_media = bool(info and (info.get("duration") or info.get("formats")) and info.get("extractor") != "generic")
        except Exception:
            is_media = False
    if is_media:
        with tempfile.TemporaryDirectory() as tmp:
            try:
                info, segs = transcribe(url, max_minutes, tmp)
                out(kind="media", lane=f"whisper · {info.get('extractor_key') or 'direct'}", title=info.get("title") or url, url=url,
                    segments=segs, text=" ".join(f"[{s['t']}] {s['text']}" for s in segs))
            except Exception as e:
                out(kind="error", lane="media", url=url, title=url, note=str(e)[:200])

    out(kind="page", lane="web", title=url, url=url, text="", note=ctype or "unknown type")


if __name__ == "__main__":
    main()
