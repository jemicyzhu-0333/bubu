"""Generate an unmistakable mechanical test asset, never bubu art or an animation approval."""
import json,struct,pathlib,hashlib,math
D=pathlib.Path(__file__).resolve().parents[1]/'fixtures';D.mkdir(exist_ok=True)
def make_glb(character):
 doc={'asset':{'version':'2.0','generator':'bubu-0.1.0 mechanical fixture'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[],'meshes':[],'buffers':[],'bufferViews':[],'accessors':[],'materials':[{'name':'Mechanical_gray','pbrMetallicRoughness':{'baseColorFactor':[.42,.52,.6,1],'metallicFactor':0,'roughnessFactor':.8}},{'name':'Test_panel','pbrMetallicRoughness':{'baseColorFactor':[.06,.08,.12,1],'metallicFactor':0,'roughnessFactor':1}}]};data=bytearray()
 def accessor(values,component,kind):
  while len(data)%4:data.append(0)
  n={'SCALAR':1,'VEC3':3,'VEC4':4,'MAT4':16}[kind];flat=[v for item in values for v in (item if isinstance(item,(tuple,list)) else [item])];fmt={5126:'f',5123:'H'}[component];raw=struct.pack('<'+fmt*len(flat),*flat);vi=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':len(data),'byteLength':len(raw)});data.extend(raw);a={'bufferView':vi,'componentType':component,'count':len(flat)//n,'type':kind};
  if kind=='VEC3':a.update(min=[min(flat[i::3]) for i in range(3)],max=[max(flat[i::3]) for i in range(3)])
  ai=len(doc['accessors']);doc['accessors'].append(a);return ai
 def cubes(specs,skinned):
  ps=[];ns=[];js=[];ws=[];ix=[]
  # Clockwise around each outward-facing box side, with explicit normal.
  faces=[((1,0,0),[(1,-1,-1),(1,1,-1),(1,1,1),(1,-1,1)]),((-1,0,0),[(-1,-1,1),(-1,1,1),(-1,1,-1),(-1,-1,-1)]),((0,1,0),[(-1,1,-1),(-1,1,1),(1,1,1),(1,1,-1)]),((0,-1,0),[(-1,-1,1),(-1,-1,-1),(1,-1,-1),(1,-1,1)]),((0,0,1),[(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]),((0,0,-1),[(1,-1,-1),(-1,-1,-1),(-1,1,-1),(1,1,-1)])]
  for center,size,joint in specs:
   for normal,vs in faces:
    start=len(ps)
    for v in vs:ps.append([center[k]+v[k]*size[k]/2 for k in range(3)]);ns.append(normal);js.append([joint,0,0,0]);ws.append([1,0,0,0])
    ix.extend([start,start+1,start+2,start,start+2,start+3])
  attrs={'POSITION':accessor(ps,5126,'VEC3'),'NORMAL':accessor(ns,5126,'VEC3')}
  if skinned:attrs.update(JOINTS_0=accessor(js,5123,'VEC4'),WEIGHTS_0=accessor(ws,5126,'VEC4'))
  return {'attributes':attrs,'indices':accessor(ix,5123,'SCALAR'),'material':0}
 if character:
  doc['nodes']=[{'name':'Fixture_root','children':[1,7,8]},{'name':'Body','children':[2,3,4,5,6]},{'name':'ArmL','translation':[-.32,.7,0]},{'name':'ArmR','translation':[.32,.7,0]},{'name':'FootL','translation':[-.18,.25,0]},{'name':'FootR','translation':[.18,.25,0]},{'name':'AccessorySocket','translation':[0,1.13,0]},{'name':'FixtureSkin','mesh':0,'skin':0},{'name':'FacePanel','mesh':1,'skin':0}]
  doc['meshes'].append({'name':'Mechanical_body','primitives':[cubes([([0,.63,0],[.6,.85,.4],0),([-.48,.65,0],[.36,.16,.2],1),([.48,.65,0],[.36,.16,.2],2),([-.18,.12,.06],[.18,.24,.32],3),([.18,.12,.06],[.18,.24,.32],4)],True)]})
  ps=[[-.22,.68,.205],[.22,.68,.205],[.22,.87,.205],[-.22,.87,.205]];attrs={'POSITION':accessor(ps,5126,'VEC3'),'NORMAL':accessor([[0,0,1]]*4,5126,'VEC3'),'JOINTS_0':accessor([[0,0,0,0]]*4,5123,'VEC4'),'WEIGHTS_0':accessor([[1,0,0,0]]*4,5126,'VEC4')}
  ds=[[[0,0,0],[0,0,0],[0,.035,0],[0,.035,0]],[[0,-.02,0],[0,-.02,0],[0,.07,0],[0,.07,0]],[[.03,0,0],[-.03,0,0],[-.03,0,0],[.03,0,0]],[[.06,0,0],[-.06,0,0],[-.06,0,0],[.06,0,0]]]
  doc['meshes'].append({'name':'Mechanical_face_panel','extras':{'targetNames':['TestA_half','TestA_full','TestB_half','TestB_full']},'primitives':[{'attributes':attrs,'indices':accessor([0,1,2,0,2,3],5123,'SCALAR'),'material':1,'targets':[{'POSITION':accessor(x,5126,'VEC3')} for x in ds]}]})
  matrices=[]
  for i in range(1,6):
   pos=doc['nodes'][i].get('translation',[0,0,0]);m=[1,0,0,0,0,1,0,0,0,0,1,0,-pos[0],-pos[1],-pos[2],1];matrices.append(m)
  doc['skins']=[{'joints':[1,2,3,4,5],'skeleton':1,'inverseBindMatrices':accessor(matrices,5126,'MAT4')}]
 else:
  doc['nodes']=[{'name':'Item_root','children':[1]},{'name':'ItemMesh','mesh':0}];doc['meshes']=[{'primitives':[cubes([([0,0,0],[.22,.12,.18],0)],False)]}]
 doc['buffers']=[{'byteLength':len(data)}]
 while len(data)%4:data.append(0)
 js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);return struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(data))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(data),0x004e4942)+data
(D/'mechanical-character.glb').write_bytes(make_glb(True));(D/'mechanical-accessory.glb').write_bytes(make_glb(False))
profile={'format':'bubu-character-profile','version':'0.1.0','id':'mechanical.fixture','purpose':'mechanics-fixture','coordinates':{'up':'+Y','front':'+Z','unitScale':1},'joints':[{'id':id,'node':node,'capRadians':.2} for id,node in [('arm.left','ArmL'),('arm.right','ArmR'),('foot.left','FootL'),('foot.right','FootR')]],'sockets':[{'id':'head.accessory','node':'AccessorySocket'}],'expressions':{'policy':'single-path-via-neutral','meshes':['FacePanel'],'paths':[{'id':'fixture.'+p,'knots':[{'at':0,'targets':{'FacePanel':{}}},{'at':.5,'targets':{'FacePanel':{'Test'+p+'_half':1}}},{'at':1,'targets':{'FacePanel':{'Test'+p+'_full':1}}}]} for p in ['A','B']]},'capabilities':['skeletal-delta','expression-single-path','rigid-socket'],'verification':{'numeric':'fixture-tests-pending','visual':'not-art-asset','userApproval':'not-art-asset'}}
def q(z):return [0,0,math.sin(z/2),math.cos(z/2)]
motion={'format':'bubu-motion','version':'0.1.0','id':'mechanical.segments','segments':[]}
for name,angle,face,amount in [('raise',.16,'A',1),('turn',-.13,'B',1),('rest',0,'A',0)]:motion['segments'].append({'id':name,'durationSec':.4,'curve':'smoothstep','joints':{id:q(angle*(1 if 'left' in id else -1)) for id in ['arm.left','arm.right','foot.left','foot.right']},'accessories':{'testCap':q(angle)},'expression':{'path':'fixture.'+face,'intensity':amount,'fadeOutSec':.08,'fadeInSec':.12}})
for name,value in [('character-profile.json',profile),('motion.json',motion)]:(D/name).write_text(json.dumps(value,indent=2)+'\n')
assets=[]
for id,name,kind in [('body','mechanical-character.glb','glb'),('cap','mechanical-accessory.glb','glb'),('profile','character-profile.json','profile'),('motion','motion.json','motion')]:
 b=(D/name).read_bytes();assets.append({'id':id,'path':name,'kind':kind,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
manifest={'format':'bubu-suite','version':'0.1.0','id':'mechanical.foundation-demo','assets':assets,'character':{'asset':'body','profile':'profile'},'equipment':[{'id':'testCap','asset':'cap','slot':'head.accessory','fit':{'position':[0,0,0],'rotation':[0,0,0,1],'scale':1},'attachment':'rigid-socket','collision':'unverified-no-solver','support':'none'}],'motion':'motion','requiredCapabilities':['skeletal-delta','expression-single-path','rigid-socket','accessory-local-rotation','canonical-events','interrupt-c0','demand-render'],'budgets':{'totalBytes':65536,'vertices':1000,'nodes':32}}
(D/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('Generated mechanical fixture:',sum(x['bytes'] for x in assets),'bytes')
