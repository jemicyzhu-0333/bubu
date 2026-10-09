(() => {
  'use strict';
  const control = document.querySelector('#motion-toggle');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let manualReduced = false;
  let media;
  function setupMotion() {
    if (media) media.revert();
    const reduced = manualReduced || preference.matches;
    document.documentElement.dataset.reducedMotion = String(reduced);
    control.setAttribute('aria-pressed', String(reduced));
    control.textContent = preference.matches ? 'Reduced motion (system)' : reduced ? 'Motion reduced' : 'Reduce motion';
    if (!window.gsap || !window.ScrollTrigger || reduced) return;
    gsap.registerPlugin(ScrollTrigger);
    media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.timeline({defaults:{duration:.75,ease:'power2.out'}})
        .from('.intro', {y:20,autoAlpha:0,stagger:.09})
        .from('.hero-art', {y:24,autoAlpha:0}, .15)
        .from('.poster-front', {y:30,rotation:0,autoAlpha:0}, .35)
        .from('.poster-back', {y:35,rotation:0,autoAlpha:0}, .45)
        .from('.pet-sticker', {y:25,rotation:-2,autoAlpha:0}, .65);
      gsap.from('.campaign-card', {y:45,autoAlpha:0,rotation:0,stagger:.13,duration:1,ease:'power2.out',scrollTrigger:{trigger:'.campaign-cards',start:'top 85%',once:true}});
      gsap.utils.toArray('.reveal').forEach(el => {
        gsap.from(el, {y:24,autoAlpha:0,duration:.7,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 92%',once:true}});
      });
      return () => {};
    });
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
  control.addEventListener('click', () => { manualReduced = !manualReduced; setupMotion(); });
  preference.addEventListener('change', setupMotion);
  window.addEventListener('load', () => { if (window.ScrollTrigger) ScrollTrigger.refresh(); });
  setupMotion();
})();
