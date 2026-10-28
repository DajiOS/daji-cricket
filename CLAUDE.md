# Daji Cricket Ground: standing rules

These rules come from the owner, Sunny Patel. They apply to every module and feature, now and in the future.

## Future-proof rule

- If a feature can be built without an external connection, build it completely.
- If it needs an outside connection, build the complete internal feature and add its connection area in Settings › Connections (`server/src/integrations.ts`). Leave the external connection unconfigured until the customer turns it on.
- An optional integration that has not been set up must never stop the rest of the suite from working or from being finished.
- Platform AI (Guppi / Ask AI, `server/src/ask/`) is part of every feature. Whatever a feature stores must be something Ask AI can find and answer about.

## Other standing rules

- Work on Daji only. Never touch any other project or its code.
- The booking architecture is frozen.
- Never delete money records. Hide them instead: the books keep everything (see `server/src/finevents.ts`).
- Never fake evidence. A check that did not run is reported as not run, never as passed.
- A new `registerSchema` module must be added to `server/schema.lock.json` with `node server/scripts/schema-lock.ts`. Never edit a module that has already been released.
