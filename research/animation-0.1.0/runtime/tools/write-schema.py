"""Emit the IDE wire-shape schema. Runtime semantic checks remain in src/contracts.mjs."""
import json,pathlib
D=pathlib.Path(__file__).resolve().parents[1]/'spec'
S={'type':'string','minLength':1,'maxLength':160}
def enum(*a):return {'enum':list(a)}
def num(a,b,integer=False):return {'type':'integer' if integer else 'number','minimum':a,'maximum':b}
def arr(x,n):return {'type':'array','items':x,'maxItems':n}
def vec(n,lo=-1e6,hi=1e6):return {'type':'array','items':num(lo,hi),'minItems':n,'maxItems':n}
def obj(p,optional=()):return {'type':'object','properties':p,'required':[x for x in p if x not in optional],'additionalProperties':False}
def dictionary(value,n=64):return {'type':'object','additionalProperties':value,'maxProperties':n}
def head(format,props,optional=()):return obj({'format':{'const':format},'version':{'const':'0.1.0'},**props},optional)
caps=enum('skeletal-delta','expression-single-path','rigid-socket','accessory-local-rotation','canonical-events','interrupt-c0','demand-render','authored-quaternion-clips')
asset=obj({'id':S,'path':{'type':'string','minLength':1,'maxLength':128,'pattern':'^[A-Za-z0-9][A-Za-z0-9_.-]*(/[A-Za-z0-9][A-Za-z0-9_.-]*)*$'},'kind':enum('glb','profile','motion','clips'),'bytes':num(1,8388608,True),'sha256':{'type':'string','pattern':'^[0-9a-f]{64}$'}})
item=obj({'id':S,'asset':S,'slot':S,'fit':obj({'position':vec(3),'rotation':vec(4,-1,1),'scale':num(.01,10)}),'attachment':enum('rigid-socket'),'collision':enum('unverified-no-solver'),'support':enum('none')})
manifest=head('bubu-suite',{'id':S,'assets':arr(asset,16),'character':obj({'asset':S,'profile':S}),'equipment':arr(item,8),'motion':S,'clips':S,'requiredCapabilities':{**arr(caps,8),'uniqueItems':True},'budgets':obj({'totalBytes':num(1,33554432),'vertices':num(1,100000),'nodes':num(1,128)})},['clips'])
knots=arr(obj({'at':num(0,1),'targets':dictionary(dictionary(num(0,1),16),16)}),17)
profile=head('bubu-character-profile',{'id':S,'purpose':enum('mechanics-fixture'),'coordinates':obj({'up':enum('+Y'),'front':enum('+Z'),'unitScale':{'const':1}}),'joints':arr(obj({'id':S,'node':S,'capRadians':num(0,.5)}),64),'sockets':arr(obj({'id':S,'node':S}),16),'expressions':obj({'policy':enum('single-path-via-neutral'),'meshes':{**arr(S,16),'uniqueItems':True},'paths':arr(obj({'id':S,'knots':knots}),8)}),'capabilities':{**arr(caps,8),'uniqueItems':True},'verification':obj({'numeric':enum('fixture-tests-pending','fixture-tests-passed'),'visual':enum('not-art-asset'),'userApproval':enum('not-art-asset')})})
segment=obj({'id':S,'durationSec':num(.02,10),'curve':enum('smoothstep'),'joints':dictionary(vec(4,-1,1)),'accessories':dictionary(vec(4,-1,1),8),'expression':obj({'path':S,'intensity':num(0,1),'fadeOutSec':num(.02,1),'fadeInSec':num(.02,1)})},['expression'])
motion=head('bubu-motion',{'id':S,'segments':arr(segment,64)})
track=obj({'target':S,'interpolation':enum('STEP','LINEAR'),'keys':{**arr(obj({'at':num(0,1),'rotation':vec(4,-1.000001,1.000001)}),128),'minItems':2}})
clips=head('bubu-clips',{'id':S,'clips':{**arr(obj({'id':S,'durationSec':num(.02,10),'endBehavior':enum('hold'),'tracks':{**arr(track,72),'minItems':1}}),16),'minItems':1}})
schema={'$schema':'https://json-schema.org/draft/2020-12/schema','title':'bubu runtime 0.1.0 strict wire shapes','description':'IDE/document validation. Runtime also checks byte/complexity budgets, integrity, references, normalized quaternion/caps, complete face roster, unique nodes, GLB content and instance budgets. No extensions or compatibility aliases.','oneOf':[{'$ref':'#/$defs/'+x} for x in ['manifest','profile','motion','clips']],'$defs':{'manifest':manifest,'profile':profile,'motion':motion,'clips':clips}}
def fmt(x,l=0):
 s=json.dumps(x,ensure_ascii=False,separators=(', ', ': '))
 if len(s)+l*2<150:return s
 if isinstance(x,dict):return '{\n'+',\n'.join('  '*(l+1)+json.dumps(k)+': '+fmt(v,l+1) for k,v in x.items())+'\n'+'  '*l+'}'
 if isinstance(x,list):return '[\n'+',\n'.join('  '*(l+1)+fmt(v,l+1) for v in x)+'\n'+'  '*l+']'
 return s
(D/'wire.schema.json').write_text(fmt(schema)+'\n')
