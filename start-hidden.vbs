Set fso = CreateObject("Scripting.FileSystemObject")
Set WShell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverJs = fso.BuildPath(scriptDir, "server.js")
WShell.Run "node """ & serverJs & """", 0, False
