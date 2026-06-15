#!/usr/bin/env python3
"""UTMOSv2 naturalness scorer — Showrunner sidecar.

Usage:
    python utmos_score.py <audio-file>

Prints `{"score": <float>}` to stdout (and nothing else on success). The model
downloads on first run. Any failure exits non-zero with a message on stderr;
the Node caller then treats naturalness as unavailable (advisory, never fatal).

API verified against sarulab-speech/UTMOSv2:
    model = utmosv2.create_model(pretrained=True)
    mos = model.predict(input_path="/path/to/file.wav")  # -> float
"""
import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: utmos_score.py <audio-file>", file=sys.stderr)
        return 2
    audio_path = sys.argv[1]

    try:
        import utmosv2
    except ImportError:
        print(
            "utmosv2 not installed — see github.com/sarulab-speech/UTMOSv2",
            file=sys.stderr,
        )
        return 3

    try:
        model = utmosv2.create_model(pretrained=True)
        score = float(model.predict(input_path=audio_path))
    except Exception as exc:  # sidecar: any failure -> non-zero exit
        print(f"utmos scoring failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps({"score": score}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
