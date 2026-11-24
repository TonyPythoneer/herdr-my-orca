import unittest
from capture import command_args

class CommandArgsTests(unittest.TestCase):
    def test_name_is_not_command_parameter(self):
        for command, name in [("layout.switch","orca"),("space.new","Snapshot project"),("tab.new","Second terminal"),("mod.open","orca-split-menu")]:
            self.assertEqual(command_args(command,name=name),["do",command,"--name",name])
    def test_named_arguments(self):
        self.assertEqual(command_args("layout.select",stack="main",child="main-agents"),["do","layout.select","--stack","main","--child","main-agents"])
    def test_overlay_id(self):
        self.assertEqual(command_args("overlay.close",id="frame-welcome"),["do","overlay.close","--id","frame-welcome"])
