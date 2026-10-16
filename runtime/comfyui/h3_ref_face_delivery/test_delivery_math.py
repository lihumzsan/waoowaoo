"""Independent affine/pixel oracles; no ComfyUI, model, CUDA, or torch doubles.

These catch using full-frame ratios instead of KJ's integer center crop,
off-by-half sampling, and altering pixels outside the actual alpha support.
"""

import importlib
import unittest

import numpy as np


class DeliveryMathTests(unittest.TestCase):
    def module(self, name):
        try:
            return importlib.import_module(name)
        except ModuleNotFoundError:
            self.fail(f"Missing production delivery mathematics: {name}")

    def test_center_crop_projects_source_edges_with_integer_offset(self):
        geometry = self.module("geometry").center_crop_geometry(448, 736, 1088, 1920)
        self.assertEqual(geometry.source_crop_xywh, (15, 0, 417, 736))
        self.assertEqual(geometry.project_box((15, 0, 432, 736)), (0, 0, 1088, 1920))
        self.assertAlmostEqual(geometry.project_box((0, 0, 448, 736))[0], -39.13669064748201)

    def test_divisibility_is_applied_before_crop_aspect(self):
        geometry = self.module("geometry").center_crop_geometry(101, 100, 100, 100)
        self.assertEqual((geometry.output_width, geometry.output_height), (96, 96))
        self.assertEqual(geometry.source_crop_xywh, (0, 0, 100, 100))
        self.assertEqual(geometry.project_box((0, 0, 100, 100)), (0, 0, 96, 96))

    def test_pixel_center_mapping_preserves_composed_affine(self):
        geometry = self.module("geometry").center_crop_geometry(200, 100, 64, 64)
        self.assertEqual(geometry.source_crop_xywh, (50, 0, 100, 100))
        self.assertEqual(geometry.source_center(0, 0), (50.78125, 0.78125))
        self.assertEqual(geometry.source_center(63, 63), (149.21875, 99.21875))
        self.assertEqual(geometry.project_box((75, 25, 125, 75)), (16, 16, 48, 48))

    def test_zero_sized_rounded_target_fails(self):
        with self.assertRaises(ValueError):
            self.module("geometry").center_crop_geometry(448, 736, 31, 1920)

    def test_alpha_composition_leaves_every_zero_support_bit_unchanged(self):
        module = self.module("pixels")
        base = np.array([[[-0.0, 0.125, 1.25], [0.2, 0.4, 0.6]],
                         [[0.4, 0.5, 0.6], [0.7, 0.8, 0.9]]], dtype=np.float32)
        before = base.copy()
        patch = np.ones_like(base)
        alpha = np.array([[0.0, 0.5], [1.0, 0.0]], dtype=np.float32)
        module.composite_rgb_in_place(base, patch, alpha)
        np.testing.assert_array_equal(base[alpha == 0].view(np.uint32),
                                      before[alpha == 0].view(np.uint32))
        np.testing.assert_allclose(base[0, 1], [0.6, 0.7, 0.8], atol=1e-7)
        np.testing.assert_array_equal(base[1, 0], [1, 1, 1])

    def test_nonfinite_patch_cannot_partially_mutate_output(self):
        base = np.full((2, 2, 3), 0.25, dtype=np.float32)
        before = base.copy()
        patch = np.ones_like(base)
        patch[1, 1, 0] = np.nan
        with self.assertRaises(ValueError):
            self.module("pixels").composite_rgb_in_place(base, patch, np.ones((2, 2), dtype=np.float32))
        np.testing.assert_array_equal(base, before)


if __name__ == "__main__":
    unittest.main()
