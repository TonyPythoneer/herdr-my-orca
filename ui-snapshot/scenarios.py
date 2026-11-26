"""Actual custom mod actions; command setup is not credited as interaction coverage."""
import json

LEFT=(0,0,.28,1)
MAIN=(.28,.04,.66,.97)
RIGHT=(.66,.04,1,.97)
DETAIL=(.18,.06,.9,.94)

def text(label, region=None, **kw):
    return {"kind":"text","label":label,"region":region,**kw}

def mouse(x,y,**kw):
    return {"kind":"mouse","xy":(x,y),**kw}

def scroll(x,y,amount=-420):
    return {"kind":"scroll","xy":(x,y),"amount":amount}

def cmd(command_name,**args):
    return {"kind":"command","name":command_name,"args":args}

def escape(**kw):
    return {"kind":"escape",**kw}

def case(title, mods, label, xy=None, *, right=False, mouse_only=False, visible=False, region=None, keyboard=False, occurrence=None, **kw):
    control = {"label":label}
    if xy is not None:
        control["xy"] = xy
    if right:
        control["right"]=True
    if mouse_only or right:
        control["mouse_only"]=True
    if visible:
        control.update({"visible":True,"region":region,"occurrence":occurrence})
    if keyboard:
        control["keyboard"]=True
    return {"title":title,"mods":mods.split(),"control":control,**kw}

# Scope is explicit: preview-only cases must not be mistaken for a live provider/agent run.
MOD_SCOPE = {
    "orca-agent-flyout":"Popup configuration preview and dismissal; no CLI launch or credentials.",
    "orca-agent-settings":"Permissions selection and persisted local fixture; provider editor only, no external provider test.",
    "orca-confirm":"Cancel a synthetic file deletion; verify the file remains.",
    "orca-float-workspace":"Open and minimize floating workspace with custom status control.",
    "orca-handoff":"Preview and dismiss with no real agent transcript; live handoff/fork requires an authenticated agent fixture.",
    "orca-landing":"Custom landing action opens workspace menu.",
    "orca-pane-header":"Custom pane context menu, not upstream pane creation.",
    "orca-right-sidebar-placeholders":"Passive custom unavailable-state panel reached by custom activity control; no backend is claimed.",
    "orca-split-menu":"Select the custom file-browser split action; verify a new focused pane.",
    "orca-status-bar":"Floating workspace button; live rate-limit refresh intentionally excluded.",
    "orca-worktree":"Open and dismiss local new-worktree dialog; no remote push or branch destruction.",
}

fixture_json=json.dumps({"version":1,"tasks":[{"id":"snapshot-edit","name":"Snapshot edited task","enabled":False,"agent":"claude","trigger":{"type":"daily","time":"09:00"},"argv":["echo","snapshot"],"cwd":None}]},indent=2)
PERM="Each agent's own settings"

CASES = [
    case("Workspace options popup","orca-sidebar-top","Workspace options",(204,97),overlay="orca-sidebar-top"),
    case("New workspace menu","orca-sidebar-top orca-new-menu","New workspace",(260,97),overlay="orca-new-menu"),
    case("Collapse project groups","orca-sidebar-top orca-sidebar-projects","Collapse all projects",(76,97),group="expand",beforeText=["primary"],afterText=["sample-project"],absentText=["primary"],evidenceRegion=LEFT),
    case("Expand project groups","orca-sidebar-top orca-sidebar-projects","Expand all projects",(76,97),group="collapse",afterText=["primary"],evidenceRegion=LEFT),
    case("Project group disclosure","orca-sidebar-projects","sample-project",visible=True,region=LEFT,group="expand",beforeText=["primary"],afterText=["sample-project"],absentText=["primary"],evidenceRegion=LEFT),
    case("Project group expand","orca-sidebar-projects","sample-project",visible=True,region=LEFT,group="collapse",afterText=["primary"],evidenceRegion=LEFT),
    case("Project group context menu","orca-sidebar-projects orca-context-menu","sample-project",visible=True,region=LEFT,group="expand",right=True,overlay="orca-context-menu",afterText=["Open worktree","Copy Path","Delete all tabs"],closedText=["sample-project"],closedAbsent=["New worktree"]),
    case("New terminal tab menu","orca-header orca-new-menu","New tab",(446,16),overlay="orca-new-menu"),
    case("Explorer: expand src folder","orca-files","src",(720,199),visible=True,region=RIGHT,files="names",afterText=["example.js"]),
    case("Explorer: select Contents search","orca-files","Contents",visible=True,region=RIGHT,files="names",beforeText=["Find files"],afterText=["Search"],absentText=["Find files"],evidenceRegion=RIGHT),
    case("Explorer: search details","orca-files","Toggle search details",(1007,191),files="contents",afterText=["Files to include"]),
    case("Explorer: return to Names search","orca-files","Names",visible=True,region=RIGHT,files="contents",afterText=["Find files"]),
    case("Explorer: open file","orca-files","README.md",visible=True,region=RIGHT,files="names",fresh=True,afterText=["Snapshot sample","Real local git project"]),
    case("Source Control tab","orca-right-sidebar-header orca-changes","Source Control",(894,47),mouse_only=True,afterText=["Changes","Message"]),
    case("Source Control: open and explicitly close diff","orca-changes orca-diff","example.js",visible=True,region=RIGHT,panel="changes",afterText=["example.js","Unstaged"],evidenceRegion=MAIN,paneChange=True,closePane=True,follow=[
        {"kind":"press","label":"Close diff","xy":(650,82),"evidenceRegion":RIGHT,"afterText":["Changes","Message"],"absentText":["Unstaged"],"absentRegion":MAIN}
    ]),
    case("Agent history tab","orca-right-sidebar-header orca-right-sidebar-agents","Agents",(809,47),mouse_only=True,afterText=["Agent Session History"]),
    case("Agent manager footer","orca-status-footer orca-agent-settings","Agents",(17,671),mouse_only=True,afterText=["Global Agent Settings"],pageAfter="main-agents",allowTransientRuntimeErrors=["can't render at a zero size"]),
    case("Agent manager: global permissions dropdown","orca-agent-settings",PERM,visible=True,region=DETAIL,page="main-agents",popover=True,afterText=["Ask for approval","Approve for me"],closedText=[PERM],closedAbsent=["Approve for me"],allowSetupRuntimeErrors=["can't render at a zero size"],allowTransientRuntimeErrors=["can't render at a zero size"]),
    case("Agent manager: provider editor","orca-agent-settings","Add model provider",(38,625),page="main-agents",prepare=[scroll(40,560),scroll(40,560)],afterText=["Add model provider","Test and save"],allowSetupRuntimeErrors=["can't render at a zero size"]),
    case("Task management footer","orca-status-footer orca-tasks","Tasks",(43,671),mouse_only=True,afterText=["Task management"],pageAfter="main-tasks",allowSetupRuntimeErrors=["can't render at a zero size"],allowTransientRuntimeErrors=["can't render at a zero size"]),
    case("Task management: JSON editor","orca-tasks","Edit JSON",(612,271),page="main-tasks",afterText=["Close JSON","Save","Cancel"],follow=[
        text("Cancel",MAIN,scroll=True,afterText=["Edit JSON"],absentText=["Close JSON"])
    ]),
    case("Task management: back to terminals","orca-tasks","Back to terminals",(318,68),page="main-tasks",beforeText=["Task management"],afterText=["Projects"],absentText=["Task management"],pageAfter="main-terminals"),
    case("Sidebar collapse","orca-header","Collapse sidebar",(91,15),files="names",beforeText=["Projects","Find files"],afterText=["Find files"],absentText=["Projects"]),
    case("Right panel collapse","orca-right-sidebar-header orca-header","Collapse right sidebar",(1000,15),files="names",beforeText=["Find files","Names"],afterText=["Projects"],absentText=["Find files","Names"],allowTransientRuntimeErrors=["can't render at a zero size"]),
    # New native interaction cases.
    case("Landing: create workspace","orca-landing orca-new-menu","Create workspace",(545,388),mouse_only=True,page="main-landing",overlay="orca-new-menu"),
    case("Group: open New worktree dialog and cancel","orca-context-menu orca-worktree","New worktree",(146,154),group="expand",prepare=[text("sample-project",LEFT,right=True)],setupOverlay="orca-context-menu",overlay="orca-worktree",afterText=["New worktree"],follow=[mouse(150,530,noOverlay=True,absentText=["New worktree"])]),
    case("File context: delete confirmation and cancel","orca-files orca-confirm","Delete",visible=True,region=(.60,.05,1,.96),files="names",fresh=True,prepare=[text("notes.txt",RIGHT,right=True,scroll=True)],setupOverlay="orca-files",overlay="orca-confirm",afterText=["Delete?","Cancel"],follow=[text("Cancel",scroll=True,noOverlay=True,absentText=["Delete?"])],fixtureExists="notes.txt"),
    case("Panel gap: Checks unavailable state","orca-right-sidebar-header orca-right-sidebar-placeholders","Checks",(978,47),mouse_only=True,prepare=[mouse(894,47)],afterText=["Checks read Orca's hosted-review data","Herdr has no GitHub or GitLab","integration."],evidenceRegion=RIGHT),
    case("Floating workspace: show then minimize","orca-status-bar orca-float-workspace","Show Floating Workspace",(959,671),afterText=["Floating Workspace","No live agent sessions"],follow=[text("Minimize",afterText=["Projects"],absentText=["No live agent sessions","Live agent sessions"])]),
    case("Status ports: open popover, then dismiss","orca-status-ports","Ports, 0 workspace ports",(995,671),overlay="orca-status-ports",afterText=["Ports","external"],closedText=["Projects"],closedAbsent=["external"]),
    case("Pane: custom context menu","orca-pane-header orca-context-menu","Pane actions",(320,47),right=True,overlay="orca-context-menu"),
    case("Split menu: file browser action","orca-split-menu orca-files","Split Right with File Browser",visible=True,prepare=[cmd("mod.open",name="orca-split-menu")],setupOverlay="orca-split-menu",paneChange=True,afterText=["Names","Find files"],evidenceRegion=(.37,.10,.66,.97)),
    case("Agent config: dismiss local configuration preview","orca-agent-flyout","Dismiss configuration by outside click",(150,530),mouse_only=True,prepare=[cmd("mod.open",name="orca-agent-flyout")],setupOverlay="orca-agent-flyout",beforeText=["Launch terminal"],afterText=["Projects"],absentText=["Launch terminal"],noOverlay=True),
    case("Handoff: dismiss no-agent preview","orca-handoff","Dismiss by outside click",(150,530),mouse_only=True,prepare=[cmd("mod.open",name="orca-handoff")],setupOverlay="orca-handoff",beforeText=["Hand off to another agent"],absentText=["Hand off to another agent"],noOverlay=True),
    case("Permissions: select ask for approval and persist fixture","orca-agent-settings",PERM,visible=True,region=DETAIL,page="main-agents",popover=True,afterText=["Ask for approval","Approve for me"],allowSetupRuntimeErrors=["can't render at a zero size"],follow=[
        text("Ask for approval",afterText=["Ask for approval"],absentText=["Approve for me"])
    ],fileAssert={"file":"agent-manager.json","path":["permissions","default"],"equals":"ask"}),
    case("Tasks: edit JSON and save synthetic configuration","orca-tasks","Edit JSON",(963,253),visible=True,region=(.28,.04,.99,.97),page="main-tasks",afterText=["Save","Cancel"],allowSetupRuntimeErrors=["can't render at a zero size"],follow=[
        {"kind":"paste","label":"version","region":(.30,.29,.64,.76),"occurrence":"bottom","value":fixture_json},
        text("Save",(.28,.04,.99,.97),scroll=True,afterText=["Saved"])
    ],fileAssert={"file":"tasks.json","path":["tasks",0,"name"],"equals":"Snapshot edited task"}),
]
