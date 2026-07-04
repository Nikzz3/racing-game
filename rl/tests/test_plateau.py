"""Tests for detect_plateau() in train.py.

These run with only pytest installed — no gymnasium / stable-baselines3 needed.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from train import detect_plateau


class TestDetectPlateau:
    def test_false_when_history_too_short(self):
        assert detect_plateau([100.0, 200.0]) is False

    def test_false_with_strong_improvement(self):
        # 100 → 200 is 100% improvement
        assert detect_plateau([100.0, 120.0, 150.0, 175.0, 200.0]) is False

    def test_true_when_rewards_are_flat(self):
        # 0.14% variation — below 1.5% threshold
        assert detect_plateau([208.4, 208.5, 208.6, 208.6, 208.7]) is True

    def test_uses_only_last_window_entries(self):
        # Wild improvement in first 10, flat in last 5
        history = list(range(10, 110, 10)) + [208.4, 208.5, 208.5, 208.6, 208.7]
        assert detect_plateau(history) is True

    def test_custom_window_size(self):
        flat_tail = [100.0, 200.0, 300.0, 208.4, 208.5, 208.6]
        assert detect_plateau(flat_tail, window=3) is True
        assert detect_plateau(flat_tail, window=6) is False

    def test_custom_threshold(self):
        # ~5% range
        vals = [100.0, 102.0, 104.0, 103.0, 105.0]
        assert detect_plateau(vals, threshold_pct=10.0) is True
        assert detect_plateau(vals, threshold_pct=3.0) is False

    def test_handles_all_equal_values(self):
        assert detect_plateau([42.0] * 5) is True

    def test_false_when_still_improving(self):
        # Last 5 still show clear upward trend (10% range)
        assert detect_plateau([195.0, 198.0, 202.0, 206.0, 208.7]) is False
