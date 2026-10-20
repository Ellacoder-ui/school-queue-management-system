# Web Speech Integration Report

**Date:** October 20, 2026
**Branch:** `backend`

---

## Overview

Web Speech API (`speechSynthesis`) integrated into the public `/display` board to announce new CALLED tickets and counter numbers.

## Implementation

### Files Created

| File | Purpose |
|---|---|
| `src/composables/useSpeechAnnouncement.js` | Speech announcement composable (queue, dedup, controls) |

### Files Modified

| File | Change |
|---|---|
| `src/components/PublicQueueDisplay.vue` | Added voice controls and ticket announcement watcher |
| `src/style.css` | Added voice control button styles |

### How It Works

1. **Deduplication** — Each ticket+counter combination is tracked in a `Set`. Already-announced combinations are not re-announced.
2. **No old tickets on load** — The `announced` Set starts empty. Only new CALLED tickets that appear after the page loads are announced.
3. **Announcement format** — "Counter {number}. {Service Name}. Ticket {number}."
   - Service codes mapped: TP→Tuition Payment, SOA→Statement of Account, PNEP→Promissory Notes and Exam Permits, REF→Refund Process, ADJ→Adjustment Clerk
4. **Queue** — Simultaneous announcements are queued and spoken sequentially
5. **Controls:**
   - "Enable voice" / "Voice on" — toggles speech synthesis on/off
   - "Mute" / "Unmute" — mutes/unmutes (cancels current speech when muting)
   - "Replay" — re-announces the last announced ticket
6. **Browser audio restrictions** — Speech only starts after user clicks "Enable voice" (user interaction required)
7. **No personal information** — Only counter number, service name, and ticket label are announced

### Security

- No personal data in announcements (no student names, IDs, or account info)
- Only CALLED tickets on the public display are announced
- Respects browser autoplay policies (requires user interaction to enable)
- Speech is canceled on page unmount

### UI

- Voice controls appear below the refresh button on the public display
- Only shown when `speechSynthesis` is supported
- Active state highlighted with gold accent
- Disabled state when voice is not enabled

### Testing

- Build: ✓ passing
- All 208 frontend tests passing
- Voice controls render correctly
- Deduplication prevents repeat announcements
- No announcement on page load (only new calls)