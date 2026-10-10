'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// A bounded, read-only Windows enumeration checks each reparse attribute before
// descending. Node must not enumerate an unknown reparse target first and only
// reject it afterwards. No cache bytes, ACL changes, or path interpolation.
const ATTRIBUTE_PROGRAM = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $utf8 = [System.Text.UTF8Encoding]::new($false, $true)
  $reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), $utf8, $false)
  $writer = [System.IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)
  $root = ConvertFrom-Json -InputObject ($reader.ReadToEnd())
  if ($root -isnot [string] -or [string]::IsNullOrWhiteSpace($root)) { throw 'invalid' }
  $rootItem = Get-Item -LiteralPath $root -Force
  if (-not $rootItem.PSIsContainer -or (([int]$rootItem.Attributes -band 1030) -ne 0)) { throw 'invalid' }
  $entries = [System.Collections.Generic.List[object]]::new()
  $entries.Add(@{ relativePath = ''; kind = 'directory'; attributes = [int]$rootItem.Attributes })
  $queue = [System.Collections.Generic.Queue[object]]::new()
  $queue.Enqueue(@{ directory = $root; relative = ''; depth = 0 })
  $script:nameBytes = 0
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    $current = Get-Item -LiteralPath $parent.directory -Force
    if (-not $current.PSIsContainer -or (([int]$current.Attributes -band 1030) -ne 0)) { throw 'invalid' }
    Get-ChildItem -LiteralPath $parent.directory -Force | ForEach-Object {
      $item = $_; $name = $item.Name; $depth = $parent.depth + 1
      if ($entries.Count -ge 257 -or $depth -gt 4 -or [string]::IsNullOrEmpty($name) -or $name -eq '.' -or $name -eq '..' -or $name.IndexOfAny([char[]]@('/','\\',':')) -ge 0) { throw 'invalid' }
      $attributes = [int]$item.Attributes
      if (($attributes -band 1030) -ne 0) { throw 'invalid' }
      $relative = if ($parent.relative -eq '') { $name } else { $parent.relative + '/' + $name }
      $script:nameBytes += $utf8.GetByteCount($relative)
      if ($script:nameBytes -gt 32768) { throw 'invalid' }
      $kind = if ($item.PSIsContainer) { 'directory' } else { 'file' }
      $entries.Add(@{ relativePath = $relative; kind = $kind; attributes = $attributes })
      if ($item.PSIsContainer) { $queue.Enqueue(@{ directory = $item.FullName; relative = $relative; depth = $depth }) }
    }
  }
  $writer.Write((ConvertTo-Json -InputObject @{ entries = $entries.ToArray() } -Depth 4 -Compress))
  $writer.Flush()
} catch { [Console]::Error.Write('runtime-attributes-unavailable'); exit 1 }
`;

const unavailable = () => Object.assign(new Error('config-runtime-attributes-unavailable'), { code: 'config-runtime-attributes-unavailable' });
function validateRuntimeTree(report) {
  if (!report || Object.keys(report).join() !== 'entries' || !Array.isArray(report.entries)
    || !report.entries.length || report.entries.length > 257) throw unavailable();
  const seen = new Map(); let nameBytes = 0;
  for (const entry of report.entries) {
    if (!entry || Object.keys(entry).sort().join() !== 'attributes,kind,relativePath') throw unavailable();
    const { relativePath: relative, kind, attributes } = entry;
    if (typeof relative !== 'string' || /[\\:\0]/.test(relative) || relative.startsWith('/')
      || (relative && relative.split('/').some(part => !part || part === '.' || part === '..'))
      || relative.split('/').length > 4 || seen.has(relative) || !['file', 'directory'].includes(kind)
      || !Number.isInteger(attributes) || attributes < 0 || attributes > 0x7fffffff
      || (attributes & 1030) !== 0 || ((attributes & 16) !== 0) !== (kind === 'directory')) throw unavailable();
    nameBytes += Buffer.byteLength(relative);
    if (nameBytes > 32768) throw unavailable();
    if (!seen.size) { if (relative !== '' || kind !== 'directory') throw unavailable(); }
    else if (seen.get(path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative)) !== 'directory') throw unavailable();
    seen.set(relative, kind);
  }
  return Object.freeze(report.entries.map(entry => Object.freeze({ ...entry })));
}

function inspectWindowsRuntimeTree(directory, { run = spawnSync, environment = process.env } = {}) {
  if (typeof directory !== 'string' || !path.win32.isAbsolute(directory) || directory.includes('\0')) throw unavailable();
  const root = environment.SystemRoot;
  if (typeof root !== 'string' || !/^[a-zA-Z]:\\[^\\]/.test(root) || path.win32.normalize(root) !== root) throw unavailable();
  const executable = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH'));
  let result;
  try {
    result = run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ATTRIBUTE_PROGRAM], {
      input: JSON.stringify(directory), encoding: 'utf8', timeout: 15000, maxBuffer: 65536, windowsHide: true, env
    });
  } catch (_) { throw unavailable(); }
  if (result.error || result.status !== 0 || result.signal || result.stderr !== '' || typeof result.stdout !== 'string'
    || Buffer.byteLength(result.stdout) > 65536) throw unavailable();
  let report;
  try { report = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); } catch (_) { throw unavailable(); }
  return validateRuntimeTree(report);
}

module.exports = { inspectWindowsRuntimeTree, validateRuntimeTree, ATTRIBUTE_PROGRAM };
