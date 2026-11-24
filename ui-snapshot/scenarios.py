"""Custom mod controls calibrated from native run 45364393855."""
def case(title, mods, label, xy=None, **kw):
    control = {"label":label}
    if xy is not None:
        control["xy"] = xy
    return {"title":title,"mods":mods.split(), "control":control, **kw}

CASES = [
    case("Workspace options popup","orca-nav","Workspace options",(204,97),overlay="orca-nav"),
    case("New workspace menu","orca-nav orca-new-menu","New workspace",(260,97),overlay="orca-new-menu"),
    case("Collapse project groups","orca-nav orca-spaces","Collapse all projects"),
    case("Expand project groups","orca-nav orca-spaces","Expand all projects"),
    case("Project group disclosure","orca-spaces","Collapse group"),
    case("Project group menu","orca-spaces orca-menu","Group menu",overlay="orca-menu"),
    case("New terminal tab menu","orca-tabs orca-new-menu","New tab",(446,16),overlay="orca-new-menu"),
    case("Explorer: expand src folder","orca-files","src",(716,168)),
    case("Explorer: select Contents search","orca-files","Contents",(930,86)),
    case("Explorer: search details","orca-files","Toggle search details",wait=1.2),
    case("Explorer: open file","orca-files","README.md",(751,216)),
    case("Source Control tab","orca-panel-head orca-changes","Source Control",(763,16)),
    case("Source Control: open changed file","orca-changes orca-diff","example.js",panel="changes"),
    case("Agent history tab","orca-panel-head orca-agents","Agents",(731,16)),
    case("Agent manager footer","orca-chrome orca-agent-manager","Agents",(20,647)),
    case("Model providers footer","orca-chrome orca-agent-manager","Model providers",(48,647)),
    case("Agent manager: global permissions dropdown","orca-agent-manager","Each agent's own settings",page="main-agents"),
    case("Agent manager: provider editor","orca-agent-manager","Add provider",page="main-providers"),
    case("Task management footer","orca-chrome orca-tasks","Tasks",(76,647)),
    case("Task management: JSON editor","orca-tasks","Edit JSON",page="main-tasks"),
    case("Task management: back to terminals","orca-tasks","Back to terminals",page="main-tasks"),
    case("Unified sidebar collapse","orca-chrome orca-tabs","Collapse sidebar",layout="orca-unified"),
    case("Unified right panel collapse","orca-panel-head orca-tabs","Collapse right sidebar",layout="orca-unified"),
]
