import { createSurfaceMotion } from '../../shared/motion.mjs';
function createCompanionAmbience(document) {
  const motion = createSurfaceMotion(document);
  const panel = document.getElementById('panelCompanion');
  const hero = document.getElementById('companionHero');
  let running = false, inView = false, observer, visibility;
  let query;
  function sync() {
    const visible = inView && !panel.hidden && !document.hidden && !motion.reduced();
    if (visible === running) return;
    running = visible; motion.stop();
    if (visible) {
      void motion.ambient(hero.querySelector('#monsterCanvas'));
      hero.querySelectorAll('.companion-ambience span').forEach(node=>void motion.ambient(node,true));
    }
  }
  return { mount() {
    const View = document.defaultView;
    if (!hero || !panel || !View?.IntersectionObserver) return;
    visibility = new View.IntersectionObserver(entries => { inView = entries[0].isIntersecting; sync(); });
    visibility.observe(hero);
    observer = new View.MutationObserver(sync);
    observer.observe(document.body,{attributes:true,attributeFilter:['data-motion','data-stimulation']});
    observer.observe(panel,{attributes:true,attributeFilter:['hidden','class']});
    document.addEventListener('visibilitychange',sync);
    query = View.matchMedia('(prefers-reduced-motion: reduce)');
    query.addEventListener('change',sync);
  }, dispose() {
    observer?.disconnect(); visibility?.disconnect(); motion.dispose();
    document.removeEventListener('visibilitychange',sync);
    query?.removeEventListener('change',sync);
  } };
}
export { createCompanionAmbience };
