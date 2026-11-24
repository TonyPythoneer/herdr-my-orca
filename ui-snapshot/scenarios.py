"""Actual custom mod actions; command setup is not credited as interaction coverage."""
import json

LEFT=(0,0,.28,1)
MAIN=(.28,.04,.66,.97)
RIGHT=(.66,.04,1,.97)
DETAIL=(.35,.06,.66,.94)

def text(label, region=None, **kw):
    return {"kind":"text","label":label,"region":region,**kw}

def mouse(x,y,**kw):
    return {"kind":"mouse","xy":(x,y),**kw}

def cmd(command_name,**args):
    return {"kind":"command","name":command_name,"args":args}

def escape(**kw):
    return {"kind":"escape",**kw}

def case(title, mods, label, xy=None, *, right=False, mouse_only=False, visible=False, region=None, keyboard=False, **kw):
    control = {"label":label}
    if xy is not None:
        control["xy"] = xy
    if right:
        control["right"]=True
    if mouse_only or right:
        control["mouse_only"]=True
    if visible:
        control.update({"visible":True,"region":region})
    if keyboard:
        control["keyboard"]=True
    return {"title":title,"mods":mods.split(),"control":control,**kw}

# Scope is explicit: preview-only cases must not be mistaken for a live provider/agent run.
MOD_SCOPE = {
    "agent-config":"Popup configuration preview and dismissal; no CLI launch or credentials.",
    "orca-agent-manager":"Permissions selection and persisted local fixture; provider editor only, no external provider test.",
    "orca-confirm":"Cancel a synthetic file deletion; verify the file remains.",
    "orca-float":"Open and minimize floating workspace with custom status control.",
    "orca-handoff":"Preview and dismiss with no real agent transcript; live handoff/fork requires an authenticated agent fixture.",
    "orca-landing":"Custom landing action opens workspace menu.",
    "orca-pane":"Custom pane context menu, not upstream pane creation.",
    "orca-panel-gap":"Passive custom unavailable-state panel reached by custom activity control; no backend is claimed.",
    "orca-split-menu":"Select the custom file-browser split action; verify a new focused pane.",
    "orca-status":"Floating workspace button; live rate-limit refresh intentionally excluded.",
    "orca-worktree":"Open and dismiss local new-worktree dialog; no remote push or branch destruction.",
}

fixture_json=json.dumps({"version":1,"tasks":[{"id":"snapshot-edit","name":"Snapshot edited task","enabled":False,"agent":"claude","trigger":{"type":"daily","time":"09:00"},"argv":["echo","snapshot"],"cwd":None}]},indent=2)
PERM="Each agent's own settings"

CASES = [
    case("Workspace options popup","orca-nav","Workspace options",(204,97),overlay="orca-nav"),
    case("New workspace menu","orca-nav orca-new-menu","New workspace",(260,97),overlay="orca-new-menu"),
    case("Collapse project groups","orca-nav orca-spaces","Collapse all projects",(76,97),group="expand",absentText=["primary"]),
    case("Expand project groups","orca-nav orca-spaces","Expand all projects",(76,97),group="collapse",afterText=["primary"]),
    case("Project group disclosure","orca-spaces","sample-project",(92,136),group="expand",absentText=["primary"]),
    case("Project group expand","orca-spaces","sample-project",(92,136),group="collapse",afterText=["primary"]),
    case("Project group context menu","orca-spaces orca-menu","Group context menu",(92,136),group="expand",right=True,overlay="orca-menu",afterText=["New worktree","Open worktree"],closedAbsent=["New worktree"]),
    case("New terminal tab menu","orca-tabs orca-new-menu","New tab",(446,16),overlay="orca-new-menu"),
    case("Explorer: expand src folder","orca-files","src",(716,168),files="names",afterText=["example.js"]),
    case("Explorer: select Contents search","orca-files","Contents",(930,86),files="names",absentText=["Find files"]),
    case("Explorer: search details","orca-files","Toggle search details",(1005,160),files="contents",afterText=["Files to include"]),
    case("Explorer: return to Names search","orca-files","Names",(765,86),files="contents",afterText=["Find files"]),
    case("Explorer: open file","orca-files","README.md",(751,216),files="names",afterText=["Snapshot sample","Real local git project"]),
    case("Source Control tab","orca-panel-head orca-changes","Source Control",(763,16),afterText=["Stage All","Changes"]),
    case("Source Control: open and explicitly close diff","orca-changes orca-diff","example.js",(749,178),panel="changes",afterText=["Unstaged","orca-diff"],paneChange=True,closePane=True,follow=[
        mouse(650,82,afterText=["Stage All"],absentText=["orca-diff","Unstaged"]) ]),
    case("Agent history tab","orca-panel-head orca-agents","Agents",(731,16),mouse_only=True,afterText=["Agent Session History"]),
    case("Agent manager footer","orca-chrome orca-agent-manager","Agents",(20,645),mouse_only=True,afterText=["Global Agent Settings"]),
    case("Model providers footer","orca-chrome orca-agent-manager","Model providers",(48,645),afterText=["Model providers"]),
    case("Agent manager: global permissions dropdown","orca-agent-manager",PERM,visible=True,region=DETAIL,page="main-agents",popover=True,afterText=["Ask for approval","Approve for me"],closedAbsent=["Approve for me"]),
    case("Agent manager: provider editor","orca-agent-manager","Add provider",(477,182),page="main-providers",afterText=["API key"]),
    case("Task management footer","orca-chrome orca-tasks","Tasks",(76,645),afterText=["Task management"]),
    case("Task management: JSON editor","orca-tasks","Edit JSON",(612,271),page="main-tasks",afterText=["Close JSON","Save","Cancel"],follow=[
        text("Cancel",MAIN,scroll=True,afterText=["Edit JSON"],absentText=["Close JSON"]) ]),
    case("Task management: back to terminals","orca-tasks","Back to terminals",(318,68),page="main-tasks",absentText=["Task management"]),
    case("Unified sidebar collapse","orca-chrome orca-tabs","Collapse sidebar",(91,15),layout="orca-unified",absentText=["Projects"]),
    case("Unified right panel collapse","orca-panel-head orca-tabs","Collapse right sidebar",(1000,15),layout="orca-unified",absentText=["Find files","Names"]),
    # New native interaction cases.
    case("Landing: create workspace","orca-landing orca-new-menu","Create workspace",visible=True,region=MAIN,page="main-landing",overlay="orca-new-menu"),
    case("Group: open New worktree dialog and cancel","orca-menu orca-worktree","New worktree",visible=True,region=LEFT,group="expand",prepare=[mouse(92,136,right=True)],setupOverlay="orca-menu",overlay="orca-worktree",afterText=["New worktree"],follow=[escape(noOverlay=True,absentText=["New worktree"])]),
    case("File context: delete confirmation and cancel","orca-files orca-confirm","Delete",visible=True,region=(.60,.05,1,.96),files="names",prepare=[text("notes.txt",RIGHT,right=True)],setupOverlay="orca-files",overlay="orca-confirm",afterText=["Delete?","Cancel"],follow=[text("Cancel",scroll=True,noOverlay=True,absentText=["Delete?"])],fixtureExists="notes.txt"),
    case("Panel gap: Checks unavailable state","orca-panel-head orca-panel-gap","Checks",(795,16),mouse_only=True,afterText=["Checks","hosted-review"]),
    case("Floating workspace: show then minimize","orca-status orca-float","Show Floating Workspace",(1005,671),afterText=["Floating Workspace"],follow=[mouse(1005,671,absentText=["Floating Workspace"])]),
    case("Pane: custom context menu","orca-pane orca-menu","Pane actions",(320,47),right=True,prepare=[cmd("pane.split",direction="right")],overlay="orca-menu"),
    case("Split menu: file browser action","orca-split-menu orca-files","Split Right with File Browser",visible=True,prepare=[cmd("mod.open",name="orca-split-menu")],setupOverlay="orca-split-menu",paneChange=True),
    case("Agent config: dismiss local configuration preview","agent-config","Escape",keyboard=True,prepare=[cmd("mod.open",name="agent-config")],setupOverlay="agent-config",afterText=["Projects"],noOverlay=True),
    case("Handoff: dismiss no-agent preview","orca-handoff","Escape",keyboard=True,prepare=[cmd("mod.open",name="orca-handoff")],setupOverlay="orca-handoff",beforeText=["Hand off to another agent"],absentText=["Hand off to another agent"],noOverlay=True),
    case("Permissions: select ask for approval and persist fixture","orca-agent-manager",PERM,visible=True,region=DETAIL,page="main-agents",popover=True,afterText=["Ask for approval"],follow=[
        text("Ask for approval",afterText=["Ask for approval"],absentText=["Approve for me"]) ],
        fileAssert={"file":"agent-manager.json","path":["permissions","default"],"equals":"ask"}),
    case("Tasks: edit JSON and save synthetic configuration","orca-tasks","Edit JSON",visible=True,region=MAIN,page="main-tasks",afterText=["Save","Cancel"],follow=[
        {"kind":"paste","label":"version","region":(.30,.29,.64,.76),"value":fixture_json},
        text("Save",MAIN,scroll=True,afterText=["Saved"]) ],
        fileAssert={"file":"tasks.json","path":["tasks",0,"name"],"equals":"Snapshot edited task"}),
    case("Tasks: compact native viewport editor and cancel","orca-tasks","Edit JSON",visible=True,region=(.25,.05,.7,.95),page="main-tasks",viewport=(960,640),afterText=["Close JSON","Save","Cancel"],follow=[
        text("Cancel",(.25,.05,.7,.95),scroll=True,afterText=["Edit JSON"],absentText=["Close JSON"]) ]),
    case("Permissions: compact native viewport menu","orca-agent-manager","Ask for approval",visible=True,region=(.3,.05,.7,.85),page="main-agents",viewport=(960,640),popover=True,afterText=["Approve for me"],closedAbsent=["Approve for me"]),
]
