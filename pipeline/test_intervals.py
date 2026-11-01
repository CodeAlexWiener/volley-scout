import unittest

from pipeline.intervals import Rally, fuse_score_changes, merge_rallies, pad_rallies, windows


class IntervalTests(unittest.TestCase):
    def test_merge_overlapping_windows(self) -> None:
        merged = merge_rallies(
            [Rally(10, 18), Rally(16, 22), Rally(40, 48)],
        )
        self.assertEqual(merged, [Rally(10, 22), Rally(40, 48)])

    def test_score_change_snaps_the_end(self) -> None:
        fused = fuse_score_changes([Rally(10, 20)], [21.5], 60)
        self.assertEqual(fused, [Rally(10, 21.5)])

    def test_snap_does_not_swallow_the_next_rally(self) -> None:
        fused = fuse_score_changes([Rally(10, 20), Rally(22, 30)], [23], 60)
        self.assertEqual(fused, [Rally(10, 23), Rally(23, 30)])

    def test_score_change_inside_a_rally_splits_it(self) -> None:
        fused = fuse_score_changes([Rally(0, 30)], [14], 60)
        self.assertEqual(fused, [Rally(0, 14), Rally(14, 30)])

    def test_score_change_in_a_gap_inserts_a_rally(self) -> None:
        fused = fuse_score_changes([Rally(0, 8), Rally(40, 50)], [25], 60)
        self.assertTrue(any(abs(rally.end - 25) < 0.01 for rally in fused))

    def test_pad_meets_in_the_middle(self) -> None:
        padded = pad_rallies([Rally(10, 12), Rally(13, 15)], 60, pad=1)
        self.assertEqual(len(padded), 2)
        self.assertLessEqual(padded[0].end, padded[1].start + 0.001)
        self.assertAlmostEqual(padded[0].start, 9)
        self.assertAlmostEqual(padded[1].end, 16)

    def test_windows_cover_the_file(self) -> None:
        spans = windows(200, length=120, overlap=30)
        self.assertEqual(spans[0], (0, 120))
        self.assertEqual(spans[-1][1], 200)
        self.assertGreater(spans[0][1], spans[1][0])


if __name__ == "__main__":
    unittest.main()
