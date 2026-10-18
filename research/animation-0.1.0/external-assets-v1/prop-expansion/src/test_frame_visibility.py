import unittest
from types import SimpleNamespace
from frame_visibility import prepare_frame
class FrameVisibility(unittest.TestCase):
 def test_a_to_b_to_empty_preserves_borrowed_objects_and_shared_data(self):
  geometry=object();material=object();a=SimpleNamespace(hide_render=False,data=geometry,material=material);b=SimpleNamespace(hide_render=True,data=geometry,material=material);borrowed=SimpleNamespace(hide_render=False,data=geometry,material=material);owned={'a':a,'b':b}
  prepare_frame(owned);a.hide_render=False;self.assertFalse(a.hide_render);self.assertTrue(b.hide_render)
  prepare_frame(owned);b.hide_render=False;self.assertTrue(a.hide_render);self.assertFalse(b.hide_render)
  prepare_frame(owned);self.assertTrue(a.hide_render);self.assertTrue(b.hide_render);self.assertFalse(borrowed.hide_render)
  for obj in (a,b,borrowed):self.assertIs(obj.data,geometry);self.assertIs(obj.material,material)
  self.assertEqual(len(owned),2)
if __name__=='__main__':unittest.main()
