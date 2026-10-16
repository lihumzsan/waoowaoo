"""Run real T8 math + the production frame compositor against pixel oracles.

Reads only the four actual upstream mathematical functions; no fake torch,
Comfy node, service, plan validator, resize implementation, or app is installed.
Default sources are the audited installed commit; local source paths are optional.
This proves tensor math, not Comfy registry loading or GPU/model execution.
"""

from __future__ import annotations

import argparse
import ast
import importlib
from pathlib import Path
import sys
from types import ModuleType
import unittest
from urllib.request import urlopen

import numpy as np
import torch
import torch.nn.functional as torch_functional


T8_COMMIT = "b6be56527a016f2b9a999432bb30acfa68307e7c"
T8_RAW_ROOT = f"https://raw.githubusercontent.com/T8mars/comfyui-minimax-h3-audio-T8/{T8_COMMIT}/h3_t8"


def read_source(path: str | None, filename: str) -> str:
    if path:
        return Path(path).read_text(encoding="utf-8")
    with urlopen(f"{T8_RAW_ROOT}/{filename}", timeout=30) as response:
        return response.read().decode("utf-8")


def actual_t8_math(parity_source: str, advanced_source: str) -> ModuleType:
    module = ModuleType("audited_t8_math")
    module.__dict__.update(torch=torch, torch_functional=torch_functional)
    selections = ((parity_source, {"_gaussian_blur_mask", "_parity_canvas_mask", "_source_space_colour_match"}),
                  (advanced_source, {"_warp_crop_to_source"}))
    for source, names in selections:
        functions = [node for node in ast.parse(source).body
                     if isinstance(node, ast.FunctionDef) and node.name in names]
        if {node.name for node in functions} != names:
            raise RuntimeError("Required real T8 mathematical function is missing")
        tree = ast.Module(body=[ast.ImportFrom(module="__future__",
                                              names=[ast.alias(name="annotations")], level=0), *functions],
                          type_ignores=[])
        exec(compile(ast.fix_missing_locations(tree), "<actual-pinned-t8-math>", "exec"), module.__dict__)
    return module


class TensorMathOracles(unittest.TestCase):
    parity: ModuleType
    delivery: ModuleType
    geometry: ModuleType

    def test_composed_warp_samples_refined_pixels_at_hand_derived_centers(self):
        geometry = self.geometry.center_crop_geometry(200, 100, 64, 64)
        crop = torch.empty((4, 4, 3), dtype=torch.float32)
        crop[..., 0] = torch.arange(4).view(1, -1) / 3
        crop[..., 1] = torch.arange(4).view(-1, 1) / 3
        crop[..., 2] = 0.5
        crop_before = crop.clone()
        source_base = torch.full((64, 64, 3), 0.25, dtype=torch.float32)
        output = source_base.clone()
        record = {"source_crop_box_xyxy": [75.0, 25.0, 125.0, 75.0],
                  "crop_face_box_xyxy": [0.0, 0.0, 4.0, 4.0]}
        changed = self.delivery.blend_delivery_frame(
            output, crop, record, geometry, 4, 1, "face_only", 0, 0.0, 0.0, 1.0, 1.0, self.parity)
        self.assertTrue(changed)
        # Target 31.5 maps to crop pixel 1.4375; the ramp is pixel-index / 3.
        torch.testing.assert_close(output[31, 31], torch.tensor([23 / 48, 23 / 48, 0.5]), atol=1e-6, rtol=0)
        torch.testing.assert_close(output[32, 32], torch.tensor([25 / 48, 25 / 48, 0.5]), atol=1e-6, rtol=0)
        self.assertTrue(torch.equal(source_base, torch.full_like(source_base, 0.25)))
        self.assertTrue(torch.equal(crop, crop_before))
        self.assertTrue(torch.equal(output[:8], source_base[:8]))

    def test_real_t8_color_helper_matches_weighted_original_moments(self):
        refined = torch.tensor([[[0.1, 0.1, 0.1], [0.3, 0.3, 0.3]],
                                [[0.5, 0.5, 0.5], [0.7, 0.7, 0.7]]])
        original = refined * 0.5 + 0.2
        actual = self.parity._source_space_colour_match(refined, original, torch.ones((2, 2)), 1.0)
        torch.testing.assert_close(actual, original, atol=1e-6, rtol=0)

    def test_outside_real_t8_mask_retains_signed_zero_and_values_exactly(self):
        geometry = self.geometry.center_crop_geometry(64, 64, 64, 64)
        base = torch.full((64, 64, 3), 0.25)
        base[:8, :, 0] = -0.0
        output = base.clone()
        record = {"source_crop_box_xyxy": [16.0, 16.0, 48.0, 48.0],
                  "crop_face_box_xyxy": [8.0, 8.0, 24.0, 24.0]}
        self.delivery.blend_delivery_frame(output, torch.ones((32, 32, 3)), record,
                                           geometry, 32, 1, "face_only", 0, 0.0,
                                           0.0, 1.0, 1.0, self.parity)
        np.testing.assert_array_equal(output[:8].numpy().view(np.uint32), base[:8].numpy().view(np.uint32))
        torch.testing.assert_close(output[32, 32], torch.ones(3), atol=1e-6, rtol=0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--parity-source")
    parser.add_argument("--advanced-source")
    arguments = parser.parse_args()
    package_root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(package_root))
    TensorMathOracles.delivery = importlib.import_module("h3_ref_face_delivery.nodes")
    TensorMathOracles.geometry = importlib.import_module("h3_ref_face_delivery.geometry")
    TensorMathOracles.parity = actual_t8_math(read_source(arguments.parity_source, "face_refine_parity_advanced.py"),
                                            read_source(arguments.advanced_source, "face_refine_advanced.py"))
    unittest.main(argv=[sys.argv[0]], verbosity=2)
