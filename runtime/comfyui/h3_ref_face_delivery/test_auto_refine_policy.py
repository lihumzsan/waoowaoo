"""Complete-observation protocol and single-track admission, without model doubles."""

import importlib
import unittest


def observation(detections, status="face_found", observed_frames=None):
    return {
        "status": status,
        "binding": {"geometry": [len(detections), 100, 200]},
        "detections": detections,
        "observed_frames": len(detections) if observed_frames is None else observed_frames,
    }


def face():
    return {"box": [20.0, 10.0, 40.0, 30.0], "confidence": 0.8}


def plan():
    return {
        "source": {"frame_count": 2, "height": 100, "width": 200, "fps": 24.0},
        "shots": [{"shot_id": 0, "start_frame": 0, "end_frame": 1}],
        "metrics": {"multi_face_frames": 0},
        "frames": [
            {"frame_index": 0, "shot_id": 0, "state": "detected", "paste_weight": 1.0},
            {"frame_index": 1, "shot_id": 0, "state": "reacquired", "paste_weight": 0.85},
        ],
    }


class AutoRefinePolicyTests(unittest.TestCase):
    def module(self):
        return importlib.import_module("auto_refine")

    def test_only_complete_empty_observation_authorizes_no_face(self):
        value = observation([[], []], "no_face_detected")
        self.assertEqual(self.module().classify_observation(value), "no_face")
        for changed in [
            dict(value, observed_frames=1),
            dict(value, detections=[[]]),
            dict(value, status="face_found"),
            dict(value, detections=[[], [face()]]),
        ]:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                self.module().classify_observation(changed)

    def test_unknown_is_not_empty_detection(self):
        for value in [
            observation([[], []], "unknown"),
            {"status": "unknown", "failure": "detector failed", "detections": None},
        ]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "unknown"):
                self.module().classify_observation(value)

    def test_multiface_rejected_even_when_only_one_frame_has_two_faces(self):
        with self.assertRaisesRegex(ValueError, "multi_face"):
            self.module().classify_observation(observation([[face()], [face(), face()]]))

    def test_single_face_and_occluded_frames_have_one_route(self):
        self.assertEqual(self.module().classify_observation(observation([[face()], []])), "single_track")

    def test_detector_coordinates_must_match_declared_source(self):
        for box in [[0, 0, 201, 100], [20, 10, 10, 30], [0, 0, float("nan"), 5]]:
            with self.subTest(box=box), self.assertRaises(ValueError):
                self.module().classify_observation(observation([[{"box": box, "confidence": 0.8}]]))

    def test_single_track_plan_matches_whole_source_interval(self):
        value = observation([[face()], [face()]])
        self.module().validate_single_track_plan(plan(), value)
        for key, changed in [("source", {"frame_count": 3, "height": 100, "width": 200, "fps": 24.0}),
                             ("shots", [{"shot_id": 0, "start_frame": 0, "end_frame": 0}])]:
            bad = plan()
            bad[key] = changed
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.module().validate_single_track_plan(bad, value)

    def test_scene_cuts_cannot_enter_single_track_sampler(self):
        value = plan()
        value["shots"] = [{"shot_id": 0, "start_frame": 0, "end_frame": 0},
                          {"shot_id": 1, "start_frame": 1, "end_frame": 1}]
        with self.assertRaisesRegex(ValueError, "multi_shot"):
            self.module().validate_single_track_plan(value, observation([[face()], [face()]]))

    def test_unverified_reacquisition_cannot_become_identity_evidence(self):
        value = plan()
        value["frames"][1]["state"] = "reacquired_unverified"
        with self.assertRaisesRegex(ValueError, "unverified"):
            self.module().validate_single_track_plan(value, observation([[face()], [face()]]))

    def test_long_gap_reacquisition_is_rejected_even_if_same_center_is_nearby(self):
        value = plan()
        value["source"]["frame_count"] = 7
        value["shots"][0]["end_frame"] = 6
        value["frames"] = [{"frame_index": index, "shot_id": 0,
                            "state": "detected" if index == 0 else "reacquired" if index == 6 else "lost",
                            "paste_weight": 1.0 if index in (0, 6) else 0.0} for index in range(7)]
        with self.assertRaisesRegex(ValueError, "unverified_long_gap"):
            self.module().validate_single_track_plan(value, observation([[face()], [], [], [], [], [], [face()]]))

    def test_lost_frames_cannot_receive_a_patch(self):
        value = plan()
        value["frames"][1]["state"] = "lost"
        with self.assertRaisesRegex(ValueError, "lost"):
            self.module().validate_single_track_plan(value, observation([[face()], []]))
        value["frames"][1]["paste_weight"] = 0.0
        self.module().validate_single_track_plan(value, observation([[face()], []]))

    def test_explicit_reference_slots_retain_all_ordinals(self):
        values = {"ref_image_0": object(), "ref_image_1": object(), "ref_audio_0": object()}
        result = self.module().conditioning_references(values)
        self.assertIs(result["ref_images.ref_image_0"], values["ref_image_0"])
        self.assertIs(result["ref_images.ref_image_1"], values["ref_image_1"])
        self.assertIs(result["ref_audios.ref_audio_0"], values["ref_audio_0"])
        for invalid in [{"ref_image_1": object()}, {"ref_image_0": object(), "ref_audio_1": object()},
                        {"ref_image_0": object(), "ref_image_9": object()}, {"wrong": object()}]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.module().conditioning_references(invalid)


if __name__ == "__main__":
    unittest.main()
