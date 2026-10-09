// Bounded, sequential browser fixture. The parent suite resizes only its iframe;
// it never changes a native application window or talks to an activity probe.
const cases = [
  { name: 'focus/music/AI', mode: 'focused' },
  { name: 'context phrase', mode: 'focused', phase: 'phrase' },
  { name: 'rest', mode: 'resting' },
  { name: 'long title', mode: 'focused', long: 'true' },
  { name: 'calm', mode: 'focused', calm: 'true' },
  ...['external-speech', 'menu', 'drag', 'peek', 'resume', 'repeat', 'exit'].map(scenario => ({ name: scenario, scenario, mode: 'focused' })),
  ...['top', 'bottom', 'left', 'right'].map(edge => ({ name: `dock ${edge}`, edge, scenario: 'dock', mode: 'focused' })),
  { name: 'narrow', mode: 'focused', width: 180 },
  { name: 'short', mode: 'focused', height: 200 }
];
const iframe = document.getElementById('preview'), output = document.getElementById('results');
function load(input) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { removeEventListener('message', receive); reject(new Error('Fixture did not report within 30 seconds')); }, 30_000);
    function receive(event) {
      if (event.source !== iframe.contentWindow || event.origin !== location.origin || event.data?.type !== 'footer-layout-result') return;
      clearTimeout(timeout); removeEventListener('message', receive); resolve(event.data.proof);
    }
    addEventListener('message', receive);
    iframe.style.width = `${input.width || 220}px`; iframe.style.height = `${input.height || 220}px`;
    iframe.src = `../../src/renderer/context-review.html?${new URLSearchParams({ signals: 'music,ai', ...input })}`;
  });
}
document.getElementById('run').addEventListener('click', async event => {
  event.currentTarget.disabled = true;
  const results = [];
  try {
    for (const skin of ['pink', 'usagi']) for (const dpr of [1, 2]) for (const entry of cases) {
      output.textContent = `Checking ${skin} / canvas ${dpr}× / ${entry.name}`;
      const proof = await load({ ...entry, skin, dpr });
      results.push({ skin, canvasDpr: dpr, case: entry.name, ...proof.footerLayout });
    }
    output.textContent = JSON.stringify({ passed: results.every(result => result.passed), results }, null, 2);
  } catch (error) { output.textContent = JSON.stringify({ error: String(error), results }, null, 2); }
  finally { document.getElementById('run').disabled = false; }
});
