import test from "node:test";
import assert from "node:assert/strict";
import { FoundationPool } from "./foundation-host.mjs";
import { FIXTURES } from "../configuration/fixtures/index.mjs";
import { loadResearchContactEvidence } from "../contact/research-evidence.mjs";
import { createContactRegistry, FULL_CONTACT_COVERAGE } from "../contact/admission.mjs";
import { createContactOwner } from "../contact/owner.mjs";
import { loadGLB } from './asset-fixtures.mjs';
import { AUTHORED_HALO_FIXTURE, AUTHORED_CLIP_LIBRARY } from '../configuration/fixtures/authored.mjs';

test('contact identity and running track share an immutable clip snapshot across async equip',async()=>{
  const pool=new FoundationPool();
  try {
    const actor=await pool.create(),library=structuredClone(AUTHORED_CLIP_LIBRARY);
    const pending=actor.equip(AUTHORED_HALO_FIXTURE,{clipLibrary:library});
    library.clips[0].tracks[0].keys[1].rotation=[0,0,0,1];
    await pending;const originalIdentity=actor.mounts.get('halo').contact.attachmentSHA256;
    actor.step(.2,{facts:['greeting']});actor.step(.6,{facts:['greeting']});
    assert(actor.mounts.get('halo').delta.quaternion.z>.05);
    actor.reset();await actor.equip(AUTHORED_HALO_FIXTURE,{clipLibrary:library});
    assert.notEqual(actor.mounts.get('halo').contact.attachmentSHA256,originalIdentity);
    actor.step(.8,{facts:['greeting']});actor.step(1.2,{facts:['greeting']});
    assert(Math.abs(actor.mounts.get('halo').delta.quaternion.z)<1e-10);
  } finally {pool.dispose();}
});

test('contact evidence is invalidated by actual offset and secondary settings before replacement',async()=>{
  const pool=new FoundationPool();
  try {
    const actor=await pool.create();await actor.equip(FIXTURES[4]);
    const old=actor.mounts.get('halo'),{actor:identity,action}=loadResearchContactEvidence();
    actor.contactOwner.dispose();
    actor.contactOwner=createContactOwner({actor:identity,readGarments:()=>[...actor.mounts.values()].map(m=>m.contact),
      registry:createContactRegistry([null,old.contact].map(garment=>({actor:identity,action,garment,status:'supported',reason:'synthetic-identity-test-only',coverage:[...FULL_CONTACT_COVERAGE]})))});
    assert.equal(actor.beginContactAction(action,()=>({stop(){}})).allowed,true);
    const changed=structuredClone(FIXTURES[4]);changed.mounts[0].offset=[0,0,.04];
    await assert.rejects(actor.equip(changed),/Equipment contact untested/);
    assert.equal(actor.mounts.get('halo'),old);assert.equal(actor.pendingEquips,0);
    actor.endContactAction();await actor.equip(changed);
    const offsetIdentity=actor.mounts.get('halo').contact.attachmentSHA256;
    assert.notEqual(offsetIdentity,old.contact.attachmentSHA256);
    assert.equal(actor.checkContactAction(action).status,'untested');
    changed.secondaryMotion[0].maxAngleRad=.2;await actor.equip(changed);
    assert.notEqual(actor.mounts.get('halo').contact.attachmentSHA256,offsetIdentity);
  } finally {pool.dispose();}
});
test('custom fixture loads cannot borrow canonical contact provenance',async()=>{
  const pool=new FoundationPool();
  try {
    const actor=await pool.create();await actor.equip(FIXTURES[4],{load:loadGLB});
    const {action}=loadResearchContactEvidence();
    assert.throws(()=>actor.checkContactAction(action),/Unverified equipment source/);
    assert.throws(()=>actor.beginContactAction(action,()=>({stop(){}})),/Unverified equipment source/);
    await actor.equip(FIXTURES[4]);assert.equal(actor.checkContactAction(action).status,'untested');
  } finally {pool.dispose();}
});

test("actual actors share original parts, dispose independently, and release the last source lease", async () => {
  const pool = new FoundationPool();
  try {
    const a = await pool.create(), b = await pool.create();
    const leftA = a.owner.root.getObjectByName("Bubu_hand-left");
    const leftB = b.owner.root.getObjectByName("Bubu_hand-left");
    assert.equal(leftA.geometry, leftB.geometry);
    assert.notEqual(a.f.h.body.skin.skeleton, b.f.h.body.skin.skeleton);
    let released = 0;
    leftA.geometry.addEventListener("dispose", () => released++);
    a.dispose();
    assert.equal(released, 0);
    b.step(0.1);
    assert.equal(pool.diagnostics().parts.references, 1);
    b.dispose();
    assert.equal(released, 1);
    assert.equal(pool.diagnostics().parts.references, 0);
    assert.equal(pool.diagnostics().budget.claimedBytes, 0);
  } finally { pool.dispose(); }
});

test("failed reset disposes the actual actor and all reservations", async () => {
  const pool = new FoundationPool();
  try {
    const actor = await pool.create();
    await actor.equip(FIXTURES[4]);
    const effects = actor.effects;
    actor.effects = { ...effects, reset() { throw new Error("reset observer"); } };
    assert.throws(() => actor.reset(), /Reset cleanup failures/);
    assert.equal(actor.disposed, true);
    assert.equal(pool.diagnostics().actors, 0);
    assert.equal(pool.diagnostics().parts.references, 0);
    assert.equal(pool.diagnostics().budget.claimedBytes, 0);
    assert.equal(actor.scene.children.length, 0);
  } finally { pool.dispose(); }
});

test("unverified tea admission preserves equipped assets and never starts a choreography", async () => {
  const pool = new FoundationPool();
  try {
    const actor = await pool.create();
    await actor.equip(FIXTURES[4]);
    const before = actor.mounts.get("halo").root.matrixWorld.clone();
    const { action, actor: identity, garment, registry } = loadResearchContactEvidence();
    assert.equal(registry.evaluate({ actor: identity, action, garments: [garment] }).status, "blocked");
    let starts = 0;
    const result = actor.beginContactAction(action, () => { starts++; return { stop() {} }; });
    assert.equal(result.status, "untested");
    assert.equal(starts, 0);
    assert.equal(actor.mounts.size, 1);
    assert.ok(actor.mounts.get("halo").root.matrixWorld.equals(before));
    actor.step(0.1);
  } finally { pool.dispose(); }
});

test("actual pointer interruption and host policies retire a synthetic contact lease once", async () => {
  const pool = new FoundationPool();
  try {
    const actor = await pool.create();
    const { actor: identity, action } = loadResearchContactEvidence();
    actor.contactOwner.dispose();
    // Synthetic positive evidence exercises ownership only; no tea geometry is played.
    actor.contactOwner = createContactOwner({
      actor: identity, readGarments: () => [],
      registry: createContactRegistry([{
        actor: identity, action, garment: null, status: "supported",
        reason: "synthetic-lifecycle-test-only", coverage: [...FULL_CONTACT_COVERAGE],
      }]),
    });
    const reasons = [];
    const begin = () => actor.beginContactAction(action, () => ({
      stop(reason) { reasons.push(reason); },
    }));
    begin();
    actor.f.emit("pointerdown", 0.05);
    assert.throws(() => actor.beginContactAction(action, () => ({})), /idle/);
    actor.step(0.05);
    assert.deepEqual(reasons, ["pointer-interruption"]);
    actor.f.emit("pointercancel", 0.1);
    actor.step(0.1);
    begin();
    actor.step(0.2, { reducedMotion: true });
    assert.deepEqual(reasons, ["pointer-interruption", "reduced-motion"]);
    assert.throws(begin, /idle/);
    actor.step(0.3);
    begin();
    actor.endContactAction();
    assert.deepEqual(reasons, ["pointer-interruption", "reduced-motion", "completed"]);
    actor.dispose();
    assert.equal(reasons.length, 3);
  } finally { pool.dispose(); }
});
