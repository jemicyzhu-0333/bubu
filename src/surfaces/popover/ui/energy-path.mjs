// Shape-preserving cubic segments: every sample remains on the curve, with no overshoot.
function energyPath(levels, width = 1000, height = 100) {
  if (!levels.length) return '';
  const y = value => height * (1 - Math.max(0, Math.min(100, Number(value) || 0)) / 100);
  let path = `M0,${y(levels[0])}`;
  for (let index = 1; index <= levels.length; index += 1) {
    const x = index * width / levels.length;
    const middle = (index - .5) * width / levels.length;
    const previous = y(levels[index - 1]);
    const next = y(levels[Math.min(index, levels.length - 1)]);
    path += ` C${middle},${previous} ${middle},${next} ${x},${next}`;
  }
  return path;
}
export { energyPath };
