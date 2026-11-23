import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


STAGES = {
    "pack-unopened": 192,
    "pack-hit": 193,
    "pack-anticipation": 201,
    "pack-burst": 202,
    "card-show": 204,
}
SIZE = (426, 240)
REGION = (15, 25, 412, 217)


def frame(path):
    with Image.open(path) as image:
        return image.convert("RGB").resize(SIZE).crop(REGION)


def error(reference, actual):
    channels = ImageStat.Stat(ImageChops.difference(reference, actual)).mean
    return round(sum(channels) / len(channels), 2)


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit(
            "Usage: python scripts/compare-opening.py <P1 1fps frames> <render directory> [baseline renders]"
        )
    references, current = map(Path, sys.argv[1:3])
    baseline = Path(sys.argv[3]) if len(sys.argv) == 4 else None
    results = {}
    for stage, second in STAGES.items():
        reference = frame(references / f"frame-{second:03}.jpg")
        metrics = {
            "referenceSecond": second,
            "currentRgbMeanAbsoluteError": error(reference, frame(current / f"{stage}.png")),
        }
        if baseline is not None:
            metrics["baselineRgbMeanAbsoluteError"] = error(reference, frame(baseline / f"{stage}.png"))
        results[stage] = metrics
    report = json.dumps(
        {"pixels": SIZE, "region": REGION, "metricRange": [0, 255], "stages": results}, indent=2
    ) + "\n"
    (current / "metrics.json").write_text(report, encoding="utf-8")
    print(report, end="")


if __name__ == "__main__":
    main()
