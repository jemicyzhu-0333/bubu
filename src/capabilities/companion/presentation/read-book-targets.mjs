// Independent front read-book source candidate. No production imports or writes.
const smooth = n => { const t = Math.max(0, Math.min(1, n)); return t*t*(3-2*t); };
const mix = (a,b,t) => a.map((v,i) => v+(b[i]-v)*t);
export const SOURCE_GRIPS = Object.freeze({left:[15.625,52],right:[50.25,52]});
export const PAGE_SOURCE_CONTACT = Object.freeze([1.45,-1.95]);
// Same transform order as the original paintDetail(page): translate * rotate * scale.
function pageContact(detail, local = PAGE_SOURCE_CONTACT) {
  const amount = detail.amount, sin = Math.sin(amount*Math.PI);
  const sx = .5+sin*.5, theta = -amount*.24, c = Math.cos(theta), s = Math.sin(theta);
  return [detail.at[0]-sin*4+c*sx*local[0]-s*local[1],
    detail.at[1]+4+s*sx*local[0]+c*local[1]];
}
function sampleReadBookTargets(contact, progress) {
  const book=contact.tools.find(t=>t.key==='book-front'), page=contact.details.find(d=>d.type==='page');
  if(!book||!page) return null;
  const delta=[book.x-9,book.y-46], left=SOURCE_GRIPS.left.map((v,i)=>v+delta[i]);
  const rightHold=SOURCE_GRIPS.right.map((v,i)=>v+delta[i]);
  // Reach before the original page appears; hold its real pixel edge for the
  // entire original visible-page interval; return only after its disappearance.
  const approach=smooth((progress-.14)/.08)*(1-smooth((progress-.72)/.10));
  const pageTarget=pageContact(page), right=mix(rightHold,pageTarget,approach);
  return {left,right,rightHold,pageTarget,approach,pageVisible:page.amount>.01,
    rightRole:approach===1?'page-edge':approach===0?'book-edge':'reach-or-return'};
}

export { pageContact, sampleReadBookTargets };
