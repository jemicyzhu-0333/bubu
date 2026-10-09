# One-shot reminder safety lookup (ARCHITECTURE「日常与能量」).
# Emits one versioned process identity. No titles, paths, audio, loop or storage.
# Execution and language policy are left unchanged; failure is unknown to the host.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class BubuReminderForeground {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  public static string Read() {
    IntPtr window = GetForegroundWindow();
    if (window == IntPtr.Zero) return null;
    uint processId;
    if (GetWindowThreadProcessId(window, out processId) == 0 || processId == 0) return null;
    try {
      using (Process process = Process.GetProcessById((int)processId)) {
        string name = process.ProcessName;
        // Discard a switch during the lookup instead of attributing the old app.
        uint currentId;
        if (GetForegroundWindow() != window || GetWindowThreadProcessId(window, out currentId) == 0
            || currentId != processId) return null;
        return name;
      }
    } catch { return null; }
  }
}
'@
$name = [BubuReminderForeground]::Read()
if ($null -eq $name -or $name.Length -gt 200 -or $name -notmatch '^[A-Za-z0-9][A-Za-z0-9._ -]*$' -or $name -ne $name.Trim()) {
  $name = ''
}
[Console]::Out.WriteLine(('foreground-v1:' + $name))
