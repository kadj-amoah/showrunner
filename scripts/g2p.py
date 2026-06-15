import json, sys


def main() -> int:
    try:
        tokens = json.load(sys.stdin)
    except Exception:
        print("g2p: bad stdin (expected JSON array)", file=sys.stderr)
        return 2
    try:
        from phonemizer import phonemize
    except ImportError:
        print(
            "phonemizer not installed (pip install phonemizer; needs espeak-ng)",
            file=sys.stderr,
        )
        return 3
    try:
        out = {}
        for t in tokens:
            ipa = phonemize(t, language="en-us", backend="espeak", strip=True, with_stress=True)
            out[t] = ipa.strip()
    except Exception as exc:
        print(f"g2p failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
