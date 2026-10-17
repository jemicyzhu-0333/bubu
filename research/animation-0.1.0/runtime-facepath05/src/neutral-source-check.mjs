import {Vector4,DoubleSide,FrontSide} from 'three';
import {decodeArtAccessor} from './art-glb-preflight.mjs';
import {geometryBackingBytes} from './geometry-accounting.mjs';
import {fail} from './contracts.mjs';
const attributeNames={POSITION:'position',NORMAL:'normal',COLOR_0:'color',JOINTS_0:'skinIndex',WEIGHTS_0:'skinWeight'};
const equalArray=(a,b,label)=>{if(a.length!==b.length)fail('SOURCE_PARITY',label+' length');for(let i=0;i<a.length;i++)if(a[i]!==b[i])fail('SOURCE_PARITY',label+' scalar '+i);};
function attributeValues(attribute) {
  const result=new attribute.array.constructor(attribute.count*attribute.itemSize);
  for(let i=0;i<attribute.count;i++)for(let c=0;c<attribute.itemSize;c++)result[i*attribute.itemSize+c]=attribute.getComponent(i,c);
  return result;
}
function normalizeSkinWeights(array) {
  const normalized=array.slice(),v=new Vector4();
  for(let i=0;i<array.length;i+=4) {
    v.fromArray(array,i);const scale=1/v.manhattanLength();
    if(scale!==Infinity)v.multiplyScalar(scale);else v.set(1,0,0,0);
    v.toArray(normalized,i);
  }
  return normalized;
}
export function assertNeutralRest(scene,document) {
  const nodes=new Map();scene.traverse(o=>{if(o.name){if(nodes.has(o.name))fail('AMBIGUOUS_NODE',o.name);nodes.set(o.name,o);}});
  for(const n of document.nodes) {
    const node=nodes.get(n.name);if(!node)fail('SOURCE_PARITY','Missing source node '+n.name);
    equalArray(node.position.toArray(),n.translation??[0,0,0],n.name+' position');
    equalArray(node.quaternion.toArray(),n.rotation??[0,0,0,1],n.name+' rotation');
    equalArray(node.scale.toArray(),n.scale??[1,1,1],n.name+' scale');
    if(node.morphTargetInfluences?.some(w=>w!==0))fail('NEUTRAL_ONLY','Nonzero morph '+n.name);
    for(const child of n.children??[])if(nodes.get(document.nodes[child].name)?.parent!==node)fail('SOURCE_PARITY','Hierarchy '+n.name);
  }
  return nodes;
}
/** Runs once for a new cached source, never as a frame sampler. */
export function verifyNeutralSource(bytes,audit,gltf,decodedBudget) {
  const document=audit.document,nodes=assertNeutralRest(gltf.scene,document);
  let comparedArrays=0,comparedScalars=0,normalizedSkinScalars=0,maxWeightDelta=0;
  const compare=(index,attribute,label,weight=false)=>{
    let expected=decodeArtAccessor(bytes,document,index);
    if(weight) {
      const original=expected;expected=normalizeSkinWeights(original);
      for(let i=0;i<expected.length;i++)if(expected[i]!==original[i]){normalizedSkinScalars++;maxWeightDelta=Math.max(maxWeightDelta,Math.abs(expected[i]-original[i]));}
    }
    if(!attribute)fail('SOURCE_PARITY','Missing '+label);
    const actual=attributeValues(attribute);equalArray(expected,actual,label);comparedArrays++;comparedScalars+=expected.length;
  };
  for(const n of document.nodes)if(n.mesh!==undefined) {
    const mesh=nodes.get(n.name),definition=document.meshes[n.mesh],primitive=definition.primitives[0];
    if(!mesh.isMesh)fail('BINDING','Not a mesh '+n.name);
    for(const [semantic,index]of Object.entries(primitive.attributes))compare(index,mesh.geometry.getAttribute(attributeNames[semantic]),n.name+':'+semantic,semantic==='WEIGHTS_0');
    compare(primitive.indices,mesh.geometry.index,n.name+':index');
    for(let k=0;k<(primitive.targets?.length??0);k++)for(const [semantic,index]of Object.entries(primitive.targets[k]))compare(index,mesh.geometry.morphAttributes[attributeNames[semantic]]?.[k],n.name+':'+semantic+':'+k);
    equalArray(Object.keys(mesh.morphTargetDictionary??{}),definition.extras?.targetNames??[],n.name+' morph names');
    const m=document.materials[primitive.material],material=mesh.material,p=m.pbrMetallicRoughness??{},color=p.baseColorFactor??[1,1,1,1];
    equalArray(material.color.toArray(),color.slice(0,3),n.name+' material color');
    if(material.opacity!==color[3]||material.metalness!==(p.metallicFactor??1)||material.roughness!==(p.roughnessFactor??1)||material.side!==(m.doubleSided?DoubleSide:FrontSide))fail('SOURCE_PARITY','Material base '+n.name);
    if(material.vertexColors!==Object.hasOwn(primitive.attributes,'COLOR_0'))fail('SOURCE_PARITY','Vertex color material binding '+n.name);
    const spec=m.extensions?.KHR_materials_specular,ior=m.extensions?.KHR_materials_ior;
    if(spec&&material.specularIntensity!==(spec.specularFactor??1))fail('SOURCE_PARITY','Specular factor');
    if(spec?.specularColorFactor)equalArray(material.specularColor.toArray(),spec.specularColorFactor,'Specular color');
    if(ior&&material.ior!==ior.ior)fail('SOURCE_PARITY','IOR');
    if(n.skin!==undefined) {
      const skin=document.skins[n.skin],inverse=decodeArtAccessor(bytes,document,skin.inverseBindMatrices);
      equalArray(mesh.skeleton.bones.map(b=>b.name),skin.joints.map(i=>document.nodes[i].name),'Skin joints');
      mesh.skeleton.boneInverses.forEach((matrix,i)=>equalArray(matrix.elements,inverse.subarray(i*16,i*16+16),'Inverse bind'));
    }
  }
  const decodedArrayBytes=geometryBackingBytes(gltf.scene);
  if(decodedArrayBytes>decodedBudget)fail('LIMIT','Decoded geometry backing budget');
  return Object.freeze({comparedArrays,comparedScalars,normalizedSkinScalars,maxWeightDelta,decodedArrayBytes,morphExpandedVertices:audit.renderDeformedVertices,sourceByteLength:bytes.byteLength,webglVerified:false});
}
