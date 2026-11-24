Executed by: opencode + deepseek-v4.1-flash-free + effort low
baseline: full 517 tests pass; eslint 57 (nested-ternary 42, complexity 13, max-params 1, max-lines 1); cov main 98.25/87.19
step 1: loader.loadResources 6 params -> options object; 517 pass; 56 lint (no-nested 42, complexity 13, max-lines 1)
step 2: split renderPanel (followContext/drainRequests/listHeader/renderBody), stepColor, folderLabel, syncBothButton; 517 pass; 44 lint (nested 37, complexity 12, max-lines 1)
step 3: syncMap say/cells, row color/updateButton, split renderOverview and renderLibrary into data/hero/list/tools; 517 pass; 41 lint (nested 30, complexity 10, max-lines 1)
step 4: split renderMachines into machineCard/activity/head/lanes/actions plus module helpers; verified render tree identical to HEAD with a temporary old-vs-new tree diff; 517 pass; 30 lint (nested 20, complexity 9, max-lines 1)
step 5: split refresh into readAll/readProject/readChecks/failRead/finishRead and renderPreview into previewBody/pane/targets/document/mcp/hooks/about/lead/buttons; 517 pass; 18 lint (nested 11, complexity 6, no-shadow 1)
