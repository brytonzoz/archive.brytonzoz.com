"""Copy Bryton's songs from the shared Google Drive folder into the R2 bucket that brytonzoz.com
plays from (/audio/<key>). MP3s are copied without re-encoding (tags and embedded art stripped so playback starts on
the first bytes); non-MP3 sources are converted to top-quality VBR MP3 so every browser can play them.

Usage:
  python3 scripts/sync-music.py --out DIR            # download + process only
  python3 scripts/sync-music.py --out DIR --upload   # ...then upload with wrangler (needs CLOUDFLARE_API_TOKEN)
"""
import argparse
import json
import pathlib
import subprocess
import sys

import gdown
import imageio_ffmpeg

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTENT_TYPES = {".mp3": "audio/mpeg"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--upload", action="store_true")
    args = parser.parse_args()

    config = json.loads((ROOT / "music" / "sources.json").read_text())
    out = pathlib.Path(args.out)
    source_dir = out / "source"
    ready_dir = out / "ready"
    source_dir.mkdir(parents=True, exist_ok=True)

    gdown.download_folder(config["driveFolder"], output=str(source_dir), quiet=True)

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    failures = []
    for entry in config["files"]:
        src = source_dir / entry["source"]
        dest = ready_dir / entry["key"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not src.exists():
            failures.append(f"missing in Drive: {entry['source']}")
            continue
        # MP3 sources are copied bit-for-bit; anything else (e.g. AAC demos, which some browsers
        # can't decode) becomes top-quality VBR MP3 so every song plays everywhere.
        codec = ["-c", "copy"] if src.suffix.lower() == ".mp3" else ["-c:a", "libmp3lame", "-q:a", "0"]
        subprocess.run(
            [ffmpeg, "-v", "error", "-y", "-i", str(src), "-map", "0:a:0", *codec, "-map_metadata", "-1", "-write_xing", "1", str(dest)],
            check=True,
        )
        print(f"ready  {entry['key']}  ({dest.stat().st_size / 1048576:.1f} MB)")

        if args.upload:
            result = subprocess.run(
                [
                    "npx", "wrangler", "r2", "object", "put", f"{config['bucket']}/{entry['key']}",
                    "--file", str(dest),
                    "--content-type", CONTENT_TYPES[dest.suffix],
                    "--cache-control", "public, max-age=86400",
                    "--remote",
                ],
                cwd=ROOT, capture_output=True, text=True,
            )
            if result.returncode != 0:
                failures.append(f"upload failed: {entry['key']}\n{result.stdout}{result.stderr}")
            else:
                print(f"upload {entry['key']}")

    if failures:
        print("\n".join(failures), file=sys.stderr)
        sys.exit(1)
    print(f"\n{len(config['files'])} songs {'uploaded' if args.upload else 'processed'}.")


if __name__ == "__main__":
    main()
