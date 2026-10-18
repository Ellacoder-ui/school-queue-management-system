# Vue 3 + Vite

Local queue frontend: run `python scripts/local_frontend.py --dev` using the existing
local Supabase stack. The product lives at `/`, the anonymous monitor at `/display`,
and existing-account password testing at `/dev/login` in development builds only.

Google Sign-In frontend preparation is implemented, but the local provider is not
configured or enabled. Follow [the reviewed setup preparation](supabase/LOCAL_GOOGLE_OAUTH_SETUP.md)
only after separate configuration approval. Never put provider secrets in VITE_ variables.

Checks: `npm run test:frontend` and `python scripts/local_frontend.py --build`.

This template should help get you started developing with Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about IDE Support for Vue in the [Vue Docs Scaling up Guide](https://vuejs.org/guide/scaling-up/tooling.html#ide-support).
