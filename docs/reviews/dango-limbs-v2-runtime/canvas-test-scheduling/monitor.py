import os, sys, time, json, subprocess, pathlib, resource
out=pathlib.Path(sys.argv[1]); out.mkdir(parents=True,exist_ok=True)
cmd=sys.argv[2:]; before=time.monotonic(); seen={}; peak={'rss_kib':0}; samples=[]
def meminfo():
 d={}
 for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
  key,value=line.split(':',1)
  if key in ('MemAvailable','MemFree','MemTotal','SwapFree'): d[key]=int(value.split()[0])
 return d
def cgroup():
 d={}
 for s in ('memory.max','memory.current','memory.peak','memory.events','memory.events.local','pids.max','pids.current','pids.events'):
  p=pathlib.Path('/sys/fs/cgroup')/s
  d[str(p)]=p.read_text() if p.exists() else 'unavailable'
 return d
initial={'command':cmd,'started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'cgroup':cgroup(),'memory':meminfo()}
(out/'initial.json').write_text(json.dumps(initial,indent=2))
with (out/'tap.log').open('w') as log:
 p=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
 while p.poll() is None:
  now=time.monotonic()-before; infos={}
  for path in pathlib.Path('/proc').iterdir():
   if not path.name.isdigit():continue
   try:
    s=(path/'stat').read_text(); tail=s[s.rindex(')')+2:].split(); pid=int(path.name)
    infos[pid]={'pid':pid,'ppid':int(tail[1]),'rss_kib':int(tail[21])*os.sysconf('SC_PAGE_SIZE')//1024,'threads':int(tail[17]),'state':tail[0]}
   except (OSError,ValueError,IndexError):pass
  ids={p.pid}; changed=True
  while changed:
   added={pid for pid,i in infos.items() if i['ppid'] in ids}-ids;changed=bool(added);ids.update(added)
  own=[]
  for pid in ids:
   if pid not in infos:continue
   info=infos[pid]
   if pid not in seen:
    try: cmdline=pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace')
    except OSError:cmdline='unavailable'
    seen[pid]={'cmd':cmdline,'first_s':round(now,3),'peak_rss_kib':0,'peak_threads':0}
   old=seen[pid];old['last_s']=round(now,3);old['peak_rss_kib']=max(old['peak_rss_kib'],info['rss_kib']);old['peak_threads']=max(old['peak_threads'],info['threads'])
   own.append(info)
  rss=sum(i['rss_kib'] for i in own)
  sample={'t':round(now,3),'rss_kib':rss,'processes':len(own),'threads':sum(i['threads'] for i in own),'memory':meminfo(),'top':sorted(own,key=lambda x:x['rss_kib'],reverse=True)[:5]}
  samples.append(sample)
  if rss>peak['rss_kib']:peak=sample
  time.sleep(.1)
 rc=p.wait()
summary={'command':cmd,'exit':rc,'duration_s':time.monotonic()-before,'peak':peak,'min_available_kib':min(s['memory']['MemAvailable'] for s in samples),'cgroup_after':cgroup(),'processes':sorted(seen.values(),key=lambda x:x['peak_rss_kib'],reverse=True),'rusage_children':list(resource.getrusage(resource.RUSAGE_CHILDREN))}
(out/'summary.json').write_text(json.dumps(summary,indent=2))
(out/'samples.json').write_text(json.dumps(samples))
print(json.dumps({k:v for k,v in summary.items() if k!='processes'},indent=2));print('Top processes:');print(json.dumps(summary['processes'][:12],indent=2));sys.exit(rc)
