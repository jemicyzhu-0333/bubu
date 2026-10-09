'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Fixed read-only program. Paths are JSON stdin, never PowerShell source or argv.
// No execution-policy override, ACL mutation, elevation, or fallback on rejection.
const ACL_PROGRAM = `
$ErrorActionPreference = 'Stop'
try {
  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $paths = @([Console]::In.ReadToEnd() | ConvertFrom-Json)
  if ($paths.Count -lt 1 -or $paths.Count -gt 7) { throw 'invalid' }
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $entries = @()
  foreach ($p in $paths) {
    $item = Get-Item -LiteralPath $p -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'invalid' }
    $acl = Get-Acl -LiteralPath $p
    $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    $aces = @()
    if ($null -ne $raw.DiscretionaryAcl) {
      foreach ($ace in $raw.DiscretionaryAcl) {
        if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback) { throw 'invalid' }
        $aces += @{ sid = $ace.SecurityIdentifier.Value; type = $ace.AceQualifier.ToString(); flags = [int]$ace.AceFlags }
      }
    }
    $entries += @{ index = $entries.Count; owner = $raw.Owner.Value; nullDacl = ($null -eq $raw.DiscretionaryAcl); reparse = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0); directory = $item.PSIsContainer; aces = $aces }
  }
  @{ sid = $sid; entries = $entries } | ConvertTo-Json -Depth 5 -Compress
} catch { [Console]::Error.Write('config-admission-permissions-unavailable'); exit 1 }
`;
const unavailable = () => Object.assign(new Error('config-admission-permissions-unavailable'), { code: 'config-admission-permissions-unavailable' });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function validAclReport(report, count) {
  if (!exactKeys(report, ['sid', 'entries']) || typeof report.sid !== 'string' || !/^S-1-5-\d+(?:-\d+)*$/.test(report.sid)
    || !Array.isArray(report.entries) || report.entries.length !== count) return false;
  const trusted = new Set([report.sid, 'S-1-5-18', 'S-1-5-32-544']);
  return report.entries.every((entry, index) => {
    if (!exactKeys(entry, ['index', 'owner', 'nullDacl', 'reparse', 'directory', 'aces']) || entry.index !== index || !trusted.has(entry.owner) || entry.nullDacl !== false || entry.reparse !== false
      || entry.directory !== (index === 0) || !Array.isArray(entry.aces) || entry.aces.length === 0) return false;
    return entry.aces.every(ace => {
      if (!exactKeys(ace, ['sid', 'type', 'flags']) || !Number.isInteger(ace.flags) || ace.flags < 0 || ace.flags > 31
        || !['AccessAllowed', 'AccessDenied'].includes(ace.type) || typeof ace.sid !== 'string' || !/^S-1-\d+(?:-\d+)+$/.test(ace.sid)) return false;
      // Deny cannot make an untrusted Allow safe. Inspect inherited and
      // inherit-only grants too, before any private bytes are copied.
      if (ace.type === 'AccessDenied') return true;
      return trusted.has(ace.sid) || (index === 0 && ace.sid === 'S-1-3-0'
        && (ace.flags & 8) !== 0 && (ace.flags & 3) !== 0); // Inheritable CREATOR OWNER template only.
    });
  });
}
function verifyWindowsProbePermissions(directory, files = [], { run = spawnSync, environment = process.env } = {}) {
  try {
    if (!path.isAbsolute(directory) || files.length > 6 || files.some(file => path.dirname(file) !== directory)
      || new Set(files).size !== files.length) throw unavailable();
    const systemRoot = environment.SystemRoot;
    if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\[^\\]/.test(systemRoot)
      || path.win32.normalize(systemRoot) !== systemRoot || systemRoot.split('\\').some(part => part === '.' || part === '..')) throw unavailable();
    const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ACL_PROGRAM], {
      input: JSON.stringify([directory, ...files]), encoding: 'utf8', shell: false, windowsHide: true,
      timeout: 5000, maxBuffer: 64 * 1024
    });
    if (result.error || result.status !== 0 || result.signal || result.stderr !== ''
      || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 64 * 1024
      || !validAclReport(JSON.parse(result.stdout), files.length + 1)) throw unavailable();
  } catch (_) { throw unavailable(); }
}
function verifyProbePermissions(directory, files = [], { platform = process.platform, io = fs, verifyWindows = verifyWindowsProbePermissions } = {}) {
  try {
    const names = files.map(file => path.basename(file)).sort();
    const checkMembers = () => {
      const actual = io.readdirSync(directory).sort();
      if (actual.length !== names.length || actual.some((name, index) => name !== names[index])) throw unavailable();
    };
    const paths = [directory, ...files];
    const before = paths.map(target => io.lstatSync(target, { bigint: true }));
    if (before.some((value, index) => index === 0 ? !value.isDirectory() : !value.isFile())) throw unavailable();
    checkMembers();
    if (platform === 'win32') verifyWindows(directory, files);
    else if (before.some(value => (value.mode & 0o077n) !== 0n)) throw unavailable();
    paths.forEach((target, index) => {
      const after = io.lstatSync(target, { bigint: true }), prior = before[index];
      if (['dev', 'ino', 'mode', 'size', 'ctimeNs', 'mtimeNs'].some(key => after[key] !== prior[key])) throw unavailable();
    });
    checkMembers();
  } catch (_) { throw unavailable(); }
}
module.exports = { verifyProbePermissions, verifyWindowsProbePermissions, validAclReport, ACL_PROGRAM };
