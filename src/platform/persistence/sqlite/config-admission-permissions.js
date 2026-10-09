'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Fixed read-only program. Paths are JSON stdin, never PowerShell source or argv.
// No execution-policy override, ACL mutation, elevation, or fallback on rejection.
const ACL_PROGRAM = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$stage = 'streams'
try {
  $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
  $reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8, $false)
  $writer = [System.IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
  $stage = 'input'
  # Windows PowerShell 5.1 emits the JSON array as one pipeline object.
  # Direct assignment preserves that array; @(... pipeline ...) nests it.
  $paths = ConvertFrom-Json -InputObject ($reader.ReadToEnd())
  if ($paths -isnot [array] -or $paths.Count -lt 1 -or $paths.Count -gt 7) { throw 'invalid' }
  foreach ($p in $paths) { if ($p -isnot [string] -or [string]::IsNullOrWhiteSpace($p)) { throw 'invalid' } }
  $stage = 'identity'
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $entries = @()
  foreach ($p in $paths) {
    $stage = 'item'
    $item = Get-Item -LiteralPath $p -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'invalid' }
    $stage = 'acl'
    try { $acl = Get-Acl -LiteralPath $p } catch {
      $kind = $_.Exception.GetType().FullName
      $category = $_.CategoryInfo.Category.ToString()
      $errorId = ($_.FullyQualifiedErrorId -split ',')[0]
      if ($category -eq 'PermissionDenied' -or $category -eq 'SecurityError' -or $kind -eq 'System.UnauthorizedAccessException') { $stage = 'acl-access-denied' }
      elseif ($errorId -eq 'CouldNotAutoloadMatchingModule' -or $errorId -eq 'CouldNotAutoloadModule') { $stage = 'acl-module-load' }
      elseif ($kind -eq 'System.Management.Automation.CommandNotFoundException') { $stage = 'acl-command-not-found' }
      elseif ($category -eq 'ObjectNotFound') { $stage = 'acl-path-not-found' }
      elseif ($category -eq 'InvalidArgument' -or $kind -eq 'System.Management.Automation.ParameterBindingException') { $stage = 'acl-parameter' }
      else { $stage = 'acl-other' }
      throw
    }
    $stage = 'descriptor'
    $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    $stage = 'aces'
    $aces = @()
    if ($null -ne $raw.DiscretionaryAcl) {
      foreach ($ace in $raw.DiscretionaryAcl) {
        if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback) { throw 'invalid' }
        $aces += @{ sid = $ace.SecurityIdentifier.Value; type = $ace.AceQualifier.ToString(); flags = [int]$ace.AceFlags }
      }
    }
    $entries += @{ index = $entries.Count; owner = $raw.Owner.Value; nullDacl = ($null -eq $raw.DiscretionaryAcl); reparse = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0); directory = $item.PSIsContainer; aces = $aces }
  }
  $stage = 'serialize'
  $json = ConvertTo-Json -InputObject @{ sid = $sid; entries = $entries } -Depth 5 -Compress
  $writer.Write($json)
  $writer.Flush()
} catch { [Console]::Error.Write('config-admission-acl:' + $stage); exit 1 }
`;
const DIAGNOSTICS = new Set(['paths', 'system-root', 'spawn', 'timeout', 'process-exit', 'stderr', 'stdout', 'json', 'acl-access-denied', 'acl-module-load', 'acl-command-not-found', 'acl-path-not-found', 'acl-parameter', 'acl-other', 'acl-shape', 'acl-count', 'acl-owner', 'acl-dacl', 'acl-reparse', 'acl-type', 'acl-ace', 'acl-grant',
  'streams', 'input', 'identity', 'item', 'acl', 'descriptor', 'aces', 'serialize', 'membership', 'file-type', 'mode', 'file-drift', 'filesystem']);
const unavailable = diagnostic => Object.assign(new Error('config-admission-permissions-unavailable'), {
  code: 'config-admission-permissions-unavailable', diagnostic: DIAGNOSTICS.has(diagnostic) ? diagnostic : 'filesystem'
});
const sanitized = (error, fallback) => unavailable(error?.code === 'config-admission-permissions-unavailable' ? error.diagnostic : fallback);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function aclReportFailure(report, count) {
  if (!exactKeys(report, ['sid', 'entries']) || typeof report.sid !== 'string' || !/^S-1-5-\d+(?:-\d+)*$/.test(report.sid)
    || !Array.isArray(report.entries)) return 'acl-shape';
  if (report.entries.length !== count) return 'acl-count';
  const trusted = new Set([report.sid, 'S-1-5-18', 'S-1-5-32-544']);
  for (const [index, entry] of report.entries.entries()) {
    if (!exactKeys(entry, ['index', 'owner', 'nullDacl', 'reparse', 'directory', 'aces']) || entry.index !== index) return 'acl-shape';
    if (!trusted.has(entry.owner)) return 'acl-owner';
    if (entry.nullDacl !== false || !Array.isArray(entry.aces) || entry.aces.length === 0) return 'acl-dacl';
    if (entry.reparse !== false) return 'acl-reparse';
    if (entry.directory !== (index === 0)) return 'acl-type';
    for (const ace of entry.aces) {
      if (!exactKeys(ace, ['sid', 'type', 'flags']) || !Number.isInteger(ace.flags) || ace.flags < 0 || ace.flags > 31
        || !['AccessAllowed', 'AccessDenied'].includes(ace.type) || typeof ace.sid !== 'string' || !/^S-1-\d+(?:-\d+)+$/.test(ace.sid)) return 'acl-ace';
      // Deny cannot make an untrusted Allow safe. Inspect inherited and
      // inherit-only grants too, before any private bytes are copied.
      if (ace.type === 'AccessDenied') continue;
      const creatorTemplate = index === 0 && ace.sid === 'S-1-3-0' && (ace.flags & 8) !== 0 && (ace.flags & 3) !== 0;
      if (!trusted.has(ace.sid) && !creatorTemplate) return 'acl-grant';
    }
  }
  return null;
}
function validAclReport(report, count) { return aclReportFailure(report, count) === null; }

function verifyWindowsProbePermissions(directory, files = [], { run = spawnSync, environment = process.env } = {}) {
  try {
    if (!path.isAbsolute(directory) || files.length > 6 || files.some(file => path.dirname(file) !== directory)
      || new Set(files).size !== files.length) throw unavailable('paths');
    const systemRoot = environment.SystemRoot;
    if (typeof systemRoot !== 'string' || !/^[a-zA-Z]:\\[^\\]/.test(systemRoot)
      || path.win32.normalize(systemRoot) !== systemRoot || systemRoot.split('\\').some(part => part === '.' || part === '..')) throw unavailable('system-root');
    const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // PS7 only fixes module paths when launching powershell.exe directly.
    // Through Node, inherited PS7 paths can resolve incompatible system modules.
    // Child-only removal follows Microsoft's about_PSModulePath guidance.
    const childEnvironment = Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
    const result = run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ACL_PROGRAM], {
      input: JSON.stringify([directory, ...files]), encoding: 'utf8', shell: false, windowsHide: true,
      timeout: 5000, maxBuffer: 64 * 1024, env: childEnvironment
    });
    if (result.error) throw unavailable(result.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn');
    if (result.status !== 0 || result.signal) {
      const stage = /^config-admission-acl:(streams|input|identity|item|acl(?:-access-denied|-module-load|-command-not-found|-path-not-found|-parameter|-other)?|descriptor|aces|serialize)$/.exec(result.stderr || '')?.[1];
      throw unavailable(stage || 'process-exit');
    }
    if (result.stderr !== '') throw unavailable('stderr');
    if (typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 64 * 1024) throw unavailable('stdout');
    let report;
    // A single UTF-8 BOM is transport framing, never an excuse to ignore stderr.
    try { report = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); } catch (_) { throw unavailable('json'); }
    const failure = aclReportFailure(report, files.length + 1);
    if (failure) throw unavailable(failure);
  } catch (error) { throw sanitized(error, 'spawn'); }
}
function verifyProbePermissions(directory, files = [], { platform = process.platform, io = fs, verifyWindows = verifyWindowsProbePermissions } = {}) {
  try {
    const names = files.map(file => path.basename(file)).sort();
    const checkMembers = () => {
      const actual = io.readdirSync(directory).sort();
      if (actual.length !== names.length || actual.some((name, index) => name !== names[index])) throw unavailable('membership');
    };
    const paths = [directory, ...files];
    const before = paths.map(target => io.lstatSync(target, { bigint: true }));
    if (before.some((value, index) => index === 0 ? !value.isDirectory() : !value.isFile())) throw unavailable('file-type');
    checkMembers();
    if (platform === 'win32') verifyWindows(directory, files);
    else if (before.some(value => (value.mode & 0o077n) !== 0n)) throw unavailable('mode');
    paths.forEach((target, index) => {
      const after = io.lstatSync(target, { bigint: true }), prior = before[index];
      if (['dev', 'ino', 'mode', 'size', 'ctimeNs', 'mtimeNs'].some(key => after[key] !== prior[key])) throw unavailable('file-drift');
    });
    checkMembers();
  } catch (error) { throw sanitized(error, 'filesystem'); }
}
module.exports = { verifyProbePermissions, verifyWindowsProbePermissions, validAclReport, ACL_PROGRAM };
