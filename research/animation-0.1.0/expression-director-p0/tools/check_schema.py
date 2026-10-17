"""Optional third-party JSON shape check; runtime validator has extra semantic checks."""
import json
from pathlib import Path
from importlib.metadata import version
from jsonschema import Draft202012Validator
root=Path(__file__).resolve().parent.parent
schema=json.loads((root/'spec/policy.schema.json').read_text())
Draft202012Validator.check_schema(schema)
v=Draft202012Validator(schema)
sample={'format':'bubu-expression-policy-p0','version':'0.1.0-p0','sourceSha256':schema['properties']['sourceSha256']['const'],'profileSha256':schema['properties']['profileSha256']['const'],'candidates':[{'key':'test_a','faceId':'R0','amount':1,'enterSec':.25,'exitSec':.25,'holdSec':.5,'gapSec':.25}]}
v.validate(sample)
invalid=[]
for key,val in [('weight',1),('holdSec',0),('faceId','unknown')]:
 x=json.loads(json.dumps(sample));x['candidates'][0][key]=val
 assert list(v.iter_errors(x)), key
 invalid.append(key)
report={'validator':'jsonschema','version':version('jsonschema'),'schemaSyntax':'PASS','validMechanicalFixture':'PASS','invalidFieldsRejected':invalid,'scope':'JSON shape only; unique candidate keys and programmatic accessor/coercion/finiteness checks are additionally enforced by runtime validator.'}
(root/'evidence/schema-check.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
