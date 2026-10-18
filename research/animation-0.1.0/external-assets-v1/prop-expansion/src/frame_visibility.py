"""Only frame-renderer's owned object registry is changed; never remove shared scene resources."""
def prepare_frame(objects):
    for obj in objects.values():
        obj.hide_render = True
