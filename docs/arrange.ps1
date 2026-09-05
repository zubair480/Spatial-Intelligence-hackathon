# Puts the two PARTY LINE Chrome windows side by side on a 1536x864 screen.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int t,bool r);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
$wins = Get-Process chrome -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like '*PARTY LINE*' } |
        Sort-Object Id
if ($wins.Count -lt 2) { Write-Output "Found $($wins.Count) PARTY LINE window(s); need 2."; exit 1 }
[void][W]::ShowWindow($wins[0].MainWindowHandle, 1)
[void][W]::ShowWindow($wins[1].MainWindowHandle, 1)
[void][W]::MoveWindow($wins[0].MainWindowHandle, 0,   0, 768, 864, $true)
[void][W]::MoveWindow($wins[1].MainWindowHandle, 768, 0, 768, 864, $true)
Write-Output "Arranged: $($wins[0].Id) left, $($wins[1].Id) right"
