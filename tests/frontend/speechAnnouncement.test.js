import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { useSpeechAnnouncement } from '../../src/composables/useSpeechAnnouncement.js'

test('spoken ticket calls use service letters and individual digits with deduplicated live calls', async () => {
  const utterances = []
  const cancellations = []
  const previousWindow = globalThis.window
  const previousUtterance = globalThis.SpeechSynthesisUtterance
  globalThis.window = { speechSynthesis: {
    speak: utterance => utterances.push(utterance),
    cancel: () => cancellations.push(true),
  } }
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text }
  }
  try {
    let speech
    await renderToString(createSSRApp(defineComponent({
      setup() {
        speech = useSpeechAnnouncement(() => [])
        speech.enable()
        speech.announceTicket('TP-001', 1, '2026-10-21')
        speech.announceTicket('TP-001', 1, '2026-10-21')
        speech.announceTicket('SOA-20', 3, '2026-10-21')
        speech.replayLast()
        return () => h('div')
      },
    })))
    assert.equal(utterances.length, 1)
    assert.equal(utterances[0].text, 'Now serving ticket T P zero zero one at Counter One.')
    utterances[0].onend()
    assert.equal(utterances[1].text, 'Now serving ticket S O A two zero at Counter Three.')
    utterances[1].onend()
    assert.equal(utterances[2].text, 'Now serving ticket S O A two zero at Counter Three.')
    speech.disable()
    assert.deepEqual(cancellations,[true])
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
    if (previousUtterance === undefined) delete globalThis.SpeechSynthesisUtterance
    else globalThis.SpeechSynthesisUtterance = previousUtterance
  }
})
