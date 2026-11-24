"""Custom mod controls calibrated against real native runs 45364393855/45367963624."""
def case(title, mods, label, xy=None, *, right=False, mouse_only=False, **kw):
    control = {"label":label}
    if xy is not None:
        control["xy"] = xy
    if right:
        control["right"]=True
    if mouse_only or right:
        control["mouse_only"]=True
    return {"title":title,"mods":mods.split(),"control":control,**kw}

CASES = [
    case("Workspace options popup","orca-sidebar-top","Workspace options",(204,97),overlay="orca-sidebar-top"),
    case("New workspace menu","orca-sidebar-top orca-new-menu","New workspace",(260,97),overlay="orca-new-menu"),
    case("Collapse project groups","orca-sidebar-top orca-sidebar-projects","Collapse all projects",(76,97),group="expand"),
    case("Expand project groups","orca-sidebar-top orca-sidebar-projects","Expand all projects",(76,97),group="collapse"),
    case("Project group disclosure","orca-sidebar-projects","sample-project",(92,136),group="expand"),
    case("Project group expand","orca-sidebar-projects","sample-project",(92,136),group="collapse"),
    case("Project group context menu","orca-sidebar-projects orca-context-menu","Group context menu",(92,136),group="expand",right=True,overlay="orca-context-menu"),
    case("New terminal tab menu","orca-header orca-new-menu","New tab",(446,16),overlay="orca-new-menu"),
    case("Explorer: expand src folder","orca-files","src",(716,168),files="names"),
    case("Explorer: select Contents search","orca-files","Contents",(930,86),files="names"),
    case("Explorer: search details","orca-files","Toggle search details",(1005,160),files="contents"),
    case("Explorer: return to Names search","orca-files","Names",(765,86),files="contents"),
    case("Explorer: open file","orca-files","README.md",(751,216),files="names"),
    case("Source Control tab","orca-right-sidebar-header orca-changes","Source Control",(763,16)),
    case("Source Control: open changed file","orca-changes orca-diff","example.js",(749,178),panel="changes",popover=True),
    case("Agent history tab","orca-right-sidebar-header orca-right-sidebar-agents","Agents",(731,16),mouse_only=True),
    case("Agent manager footer","orca-status-footer orca-agent-settings","Agents",(17,671),mouse_only=True),
    case("Model providers footer","orca-status-footer orca-agent-settings","Model providers",(43,671)),
    case("Agent manager: global permissions dropdown","orca-agent-settings","Each agent's own settings: choose permission",(550,140),page="main-agents",popover=True),
    case("Agent manager: provider editor","orca-agent-settings","Add provider",(477,182),page="main-providers"),
    case("Task management footer","orca-status-footer orca-tasks","Tasks",(69,671)),
    case("Task management: JSON editor","orca-tasks","Edit JSON",(612,271),page="main-tasks"),
    case("Task management: back to terminals","orca-tasks","Back to terminals",(318,68),page="main-tasks"),
    case("Sidebar collapse","orca-header","Collapse sidebar",(91,15)),
    case("Right panel collapse","orca-right-sidebar-header orca-header","Collapse right sidebar",(1000,15)),
]
