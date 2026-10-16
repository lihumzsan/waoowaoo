from .nodes import WaoH3RefFaceDeliveryV1
from .auto_refine import WaoH3RefAutoFaceRefineV1

NODE_CLASS_MAPPINGS = {
    "WaoH3RefFaceDeliveryV1": WaoH3RefFaceDeliveryV1,
    "WaoH3RefAutoFaceRefineV1": WaoH3RefAutoFaceRefineV1,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "WaoH3RefFaceDeliveryV1": "H3 Ref Face Delivery (Experimental)",
    "WaoH3RefAutoFaceRefineV1": "H3 Ref Auto Face Refine (Experimental)",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
