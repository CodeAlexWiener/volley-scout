import subprocess
import tempfile
import unittest
from pathlib import Path

from pipeline.cuts import cut_clip
from pipeline.intervals import Rally


class CutTests(unittest.TestCase):
    def test_cut_maps_back_to_the_source_range(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            work = Path(raw)
            source = work / "match.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=160x120:d=2",
                    "-c:v",
                    "libx264",
                    "-t",
                    "2",
                    str(source),
                ],
                check=True,
                capture_output=True,
            )
            rally = Rally(0.4, 1.2)
            dest = work / "clips" / "rally_001.mp4"
            cut_clip(source, rally, dest)
            self.assertTrue(dest.exists())
            self.assertGreater(dest.stat().st_size, 500)
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "csv=p=0",
                    str(dest),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            duration = float(probe.stdout.strip())
            self.assertAlmostEqual(duration, rally.duration, delta=0.35)


if __name__ == "__main__":
    unittest.main()
