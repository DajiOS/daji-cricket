# Daji Cricket Ground: standing rules

These rules come from the owner, Sunny Patel. They apply to every module and feature, now and in the future.

## Future-proof rule

- If a feature can be built without an external connection, build it completely.
- If it needs an outside connection, build the complete internal feature and add its connection area in Settings › Connections (`server/src/integrations.ts`). Leave the external connection unconfigured until the customer turns it on.
- An optional integration that has not been set up must never stop the rest of the suite from working or from being finished.
- Platform AI (Guppi / Ask AI, `server/src/ask/`) is part of every feature. Whatever a feature stores must be something Ask AI can find and answer about.

## Assistant name rule (locked)

- Platform AI is the core feature and its name inside the code. Never hard-code a display name (not "Guppi", not "Ask AI") into a feature: read it from `aiName` (`server/src/aiNames.ts`; `user.aiName` on the clients).
- Three levels: the core name (Platform AI), the business default (Settings › Platform AI, `aiAssistantName`, "Ask AI" unless changed), and each person's own pick (Profile › Preferences › AI assistant name). Any words, shown exactly as typed; nothing is added in front.
- A name changes only the label. It never changes permissions, security rules, what the AI can do, which business's data it reads, the question history, money limits, customer data separation or the AI provider and model.
- Reserved names: names and wake phrases of other companies' assistants (Siri, Alexa, Hey Google, OK Google, Gemini, Copilot, Cortana and the rest in `BUILTIN_RESERVED`) are refused on save with the agreed message. The software owner adds more at run time (Settings › Platform AI › Reserved names) without a release. A name reserved after it was saved keeps working for 30 days with a notice, then falls back.

## Voice action rule (locked)

- Every current and future mobile module exposes its safe actions through the one voice-action layer (`mobile/voice-actions.json`, `mobile/src/voice.ts`, `mobile/plugins/withDajiVoice.js`). Never a separate Siri workflow.
- A voice action only opens the app at a link; the screen does the work with the person's normal sign-in, permissions and business context, so voice never gets more access than tapping. It is logged as voice.
- Voice is off on a phone until that person turns it on, and the owner can switch it off for the whole business (`voiceShortcutsEnabled`). Nothing is read out loud, nothing goes into the phone's search or suggestions, and the app never listens by itself.
- Voice may prepare work (a draft task) but never approves or releases money.
- Apple's built-in phrases must use the app's own name; personal phrases (Add to Siri) use the assistant name the person picked. The app's name is never hard-coded into the voice layer.

## Pull requests

- Merging to main puts the change live. Sunny merges his own pull requests himself.
- A pull request opened for anyone else, such as the Antroli owner (who has no GitHub account), gets the `auto-merge` label. `.github/workflows/automerge.yml` merges it once every server test passes; a failed test leaves it for Sunny.

## Other standing rules

- Work on Daji only. Never touch any other project or its code.
- The booking architecture is frozen.
- Never delete money records. Hide them instead: the books keep everything (see `server/src/finevents.ts`).
- Never fake evidence. A check that did not run is reported as not run, never as passed.
- A new `registerSchema` module must be added to `server/schema.lock.json` with `node server/scripts/schema-lock.ts`. Never edit a module that has already been released.
