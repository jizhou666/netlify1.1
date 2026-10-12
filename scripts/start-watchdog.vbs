' 芳村仓库存：隐藏启动「常驻看守」（不会弹黑窗口）。
' 双击它就等于手动启动看守；把它复制到「启动」文件夹即可随登录自动运行。
Option Explicit
Dim fso, shell, here, root, nodeExe
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
root = fso.GetParentFolderName(here)
nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"
shell.Run """" & nodeExe & """ """ & root & "\scripts\serve-inventory.mjs""", 0, False
