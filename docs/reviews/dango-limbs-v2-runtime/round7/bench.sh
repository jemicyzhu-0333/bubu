. /workspace/bubu-review/env.sh
A=paper-return,moonwalk,magic-trick,sip-tea,dance,workout,catch-star,wave,paper-plane,carry-energy,hiccup,type-keyboard
for r in 1 2 3; do for t in bubu-b7 bubu bubu-r7on; do for s in usagi pink; do
  echo "$t r$r $s $(node --expose-gc /workspace/$t/tools/pet-motion-craft/bench-frame.mjs --app-root=/workspace/$t --actions=$A --frames=300 --skins=$s | tail -1)"
done; done; done
