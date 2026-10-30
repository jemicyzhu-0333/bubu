import fs from "node:fs";
import { createHash } from "node:crypto";
import { prepareD2Bindings } from "./binding-provider.mjs";
import { loadGLB, revised, correctedSatchel, sha256 } from "./asset-fixtures.mjs";
export const createD2BindingProvider = (body, anchors, admitAsset) =>
  prepareD2Bindings(body, anchors, admitAsset, {
    loadGLB, revised, correctedSatchel, sha256,
    readJSON: url => JSON.parse(fs.readFileSync(url)),
    digest: text => createHash("sha256").update(text).digest("hex"),
  });
