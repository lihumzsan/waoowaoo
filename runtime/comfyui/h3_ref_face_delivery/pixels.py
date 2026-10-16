"""One delivery-frame compositor; zero-alpha pixels retain their original bits."""

import numpy as np
from numpy.typing import NDArray


def composite_rgb_in_place(base: NDArray[np.float32], patch: NDArray[np.float32],
                           alpha: NDArray[np.float32]) -> None:
    if base.ndim != 3 or base.shape[-1] != 3 or patch.shape != base.shape or alpha.shape != base.shape[:2]:
        raise ValueError("RGB base/patch and alpha dimensions must agree")
    if any(array.dtype != np.float32 for array in (base, patch, alpha)):
        raise ValueError("Composition requires FP32 arrays")
    if not all(np.isfinite(array).all() for array in (base, patch, alpha)):
        raise ValueError("Composition rejects NaN and Inf")
    if np.any(alpha < 0) or np.any(alpha > 1):
        raise ValueError("Composition alpha must be in [0, 1]")
    support = alpha > 0
    weights = alpha[support, None]
    blended = base[support] * (1.0 - weights) + patch[support] * weights
    base[support] = np.clip(blended, 0.0, 1.0)
