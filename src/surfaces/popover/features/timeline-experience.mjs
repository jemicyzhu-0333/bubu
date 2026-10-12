// Read-only presentation. Exact stored identities connect process records;
// titles, nearby times and missing identities never establish a relationship.
function identity(value) {
  return typeof value === 'string' && value.trim() && value.length <= 512 ? value : null;
}

function compare(left, right) {
  return left.at - right.at || String(left.eventId || left.id || '').localeCompare(String(right.eventId || right.id || ''));
}

function groupTimelineExperiences(entries, day) {
  if (day?.markersTruncated || !Number.isFinite(day?.dayStart) || !Number.isFinite(day?.dayEnd)) return entries;
  const routines = new Map(), inbox = new Map(), moods = new Map(), moodTargets = new Map();
  function add(map, key, entry) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  for (const entry of entries) {
    if (!Number.isFinite(entry.at) || entry.at < day.dayStart || entry.at >= day.dayEnd) continue;
    if (entry.type === 'mood' && identity(entry.id)) { add(moods, entry.id, entry); continue; }
    const marker = entry.marker;
    if (!marker || marker.change || (marker.localDayKey && marker.localDayKey !== day.dayKey)) continue;
    if (['routine.reminded', 'routine.logged', 'routine.missed'].includes(marker.kind)
        && identity(marker.routineId) && identity(marker.occurrenceId)) {
      add(routines, JSON.stringify([marker.routineId, marker.occurrenceId]), entry);
    } else if (['inbox.captured', 'inbox.resolved'].includes(marker.kind) && identity(marker.inboxId)) {
      add(inbox, marker.inboxId, entry);
      if (marker.kind === 'inbox.resolved' && marker.resolutionAction === 'feeling' && identity(marker.targetId)) {
        moodTargets.set(marker.targetId, (moodTargets.get(marker.targetId) || 0) + 1);
      }
    }
  }

  const replacements = new Map(), consumed = new Set();
  function combine(key, members, primary) {
    if (members.length < 2) return;
    const sorted = Object.freeze([...members].sort(compare));
    for (const member of sorted) consumed.add(member);
    replacements.set(primary, { ...primary, experienceId: key, experienceMembers: sorted });
  }
  for (const [key, members] of routines) {
    if (members.some(entry => entry.marker.visibility === 'private' || entry.marker.redactionState === 'redacted')) continue;
    const answers = members.filter(entry => entry.marker.kind === 'routine.logged');
    // More than one current answer is ambiguous. Do not choose a winner from
    // timestamps; the canonical revision-aware writer owns corrections.
    if (answers.length > 1 || answers.some(entry => !['done', 'skipped'].includes(entry.marker.status))) continue;
    const primary = answers[0] || [...members].sort(compare).at(-1);
    combine(`routine:${key}`, members, primary);
  }
  for (const [key, members] of inbox) {
    if (members.some(entry => entry.marker.visibility === 'private' || entry.marker.redactionState === 'redacted')) continue;
    const captures = members.filter(entry => entry.marker.kind === 'inbox.captured');
    const resolutions = members.filter(entry => entry.marker.kind === 'inbox.resolved');
    if (captures.length > 1 || resolutions.length !== 1) continue;
    const resolved = resolutions[0];
    let primary = resolved, related = members;
    if (resolved.marker.resolutionAction === 'feeling' && identity(resolved.marker.targetId)) {
      const notes = moods.get(resolved.marker.targetId) || [];
      // The mood keeps its original capture timestamp and deletion identity.
      // A missing or cross-day target is not evidence for a guessed association.
      if (notes.length === 1 && moodTargets.get(resolved.marker.targetId) === 1 && !consumed.has(notes[0])) {
        primary = notes[0]; related = [...members, primary];
      }
    }
    combine(`inbox:${key}`, related, primary);
  }
  return entries.flatMap(entry => replacements.has(entry) ? [replacements.get(entry)] : consumed.has(entry) ? [] : [entry]);
}

// A collapsed process may contain a record inside an apparent visual gap.
// Consult all displayed-day evidence before claiming that nothing was recorded.
function previousRecordedEnd(entries, before, fallback) {
  return entries.reduce((latest, entry) => entry.at < before
    ? Math.max(latest, entry.end ?? entry.at) : latest, fallback);
}

export { groupTimelineExperiences, previousRecordedEnd };
