# I'm ADHDer activity probe for Windows 10/11 (ARCHITECTURE「活动镜像」).
#
# Prints one JSON line every two seconds and nothing else:
#   {"v":1,"front":"<process name or null>","audio":["<process name>", ...]}
# - front: the process that owns the foreground window (user32 GetForegroundWindow).
# - audio: processes whose active WASAPI session on the default render device has a
#   peak level above silence (IAudioSessionManager2 + IAudioMeterInformation), so a
#   paused player stops counting at once.
# No permission prompt is involved. It never reads window titles, track names or audio
# content, and exits when its parent stops reading stdout.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class ImAdhderActivityProbe {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImplEnumAudioEndpoints();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object result);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int NotImplGetAudioSessionControl();
    int NotImplGetSimpleAudioVolume();
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }

  // IAudioSessionControl methods first, then IAudioSessionControl2; only the needed ones are typed.
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    int NotImplGetDisplayName(); int NotImplSetDisplayName(); int NotImplGetIconPath(); int NotImplSetIconPath();
    int NotImplGetGroupingParam(); int NotImplSetGroupingParam(); int NotImplRegister(); int NotImplUnregister();
    int NotImplGetSessionIdentifier(); int NotImplGetSessionInstanceIdentifier();
    [PreserveSig] int GetProcessId(out uint processId);
  }

  [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
  }

  static string ProcessName(uint processId) {
    if (processId == 0) return null;
    try { return Process.GetProcessById((int)processId).ProcessName; } catch { return null; }
  }

  public static string Foreground() {
    IntPtr window = GetForegroundWindow();
    if (window == IntPtr.Zero) return null;
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    return ProcessName(processId);
  }

  public static string[] Audible() {
    List<string> names = new List<string>();
    try {
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice device;
      if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0) return names.ToArray();
      Guid managerId = typeof(IAudioSessionManager2).GUID;
      object managerObject;
      if (device.Activate(ref managerId, 23, IntPtr.Zero, out managerObject) != 0) return names.ToArray();
      IAudioSessionEnumerator sessions;
      if (((IAudioSessionManager2)managerObject).GetSessionEnumerator(out sessions) != 0) return names.ToArray();
      int count;
      sessions.GetCount(out count);
      for (int index = 0; index < count && names.Count < 32; index++) {
        IAudioSessionControl2 session;
        if (sessions.GetSession(index, out session) != 0 || session == null) continue;
        int state;
        if (session.GetState(out state) != 0 || state != 1) continue;
        IAudioMeterInformation meter = session as IAudioMeterInformation;
        float peak = 0;
        if (meter == null || meter.GetPeakValue(out peak) != 0 || peak < 0.001f) continue;
        uint processId;
        if (session.GetProcessId(out processId) != 0) continue;
        string name = ProcessName(processId);
        if (name != null && name.Length <= 200 && !names.Contains(name)) names.Add(name);
      }
    } catch { }
    return names.ToArray();
  }
}
'@

while ($true) {
  $line = [ordered]@{ v = 1; front = [ImAdhderActivityProbe]::Foreground(); audio = @([ImAdhderActivityProbe]::Audible()) }
  [Console]::Out.WriteLine(($line | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 2000
}
