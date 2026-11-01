import unittest

from pipeline.scoreboard import Token, score_timeline


def _digits(frames: list[tuple[float, int, int]]) -> list[Token]:
    tokens: list[Token] = []
    for moment, left, right in frames:
        tokens.append(Token(moment, str(left), 0.10, 0.08))
        tokens.append(Token(moment, str(right), 0.18, 0.08))
    return tokens


class ScoreboardTests(unittest.TestCase):
    def test_debounce_and_point_change(self) -> None:
        frames = []
        for second in range(0, 6):
            frames.append((float(second), 0, 0))
        for second in range(6, 10):
            frames.append((float(second), 1, 0))
        _samples, changes, status = score_timeline(_digits(frames), 0, 0)
        self.assertTrue(status.startswith("ok"))
        self.assertEqual(changes, [6.0])

    def test_ignores_a_one_frame_flicker(self) -> None:
        frames = [(float(second), 3, 2) for second in range(8)]
        frames[3] = (3.0, 9, 9)
        _samples, changes, status = score_timeline(_digits(frames), 3, 2)
        self.assertTrue(status.startswith("ok"))
        self.assertEqual(changes, [])

    def test_no_stable_pair_fails(self) -> None:
        tokens = [Token(float(index), "4", 0.5, 0.5) for index in range(6)]
        _samples, changes, status = score_timeline(tokens, 0, 0)
        self.assertTrue(status.startswith("failed"))
        self.assertEqual(changes, [])

    def test_swapped_sides_follow_the_starting_score(self) -> None:
        frames = [(float(second), 4, 1) for second in range(4)]
        frames += [(float(second), 4, 2) for second in range(4, 8)]
        samples, changes, status = score_timeline(_digits(frames), 1, 4)
        self.assertEqual(status, "ok")
        self.assertEqual(samples[0].us, 1)
        self.assertEqual(samples[0].them, 4)
        self.assertEqual(changes, [4.0])
        self.assertEqual(samples[-1].us, 2)
        self.assertEqual(samples[-1].them, 4)


if __name__ == "__main__":
    unittest.main()
