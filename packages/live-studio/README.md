# Live Studio

A review room for Three.js films: the creator watches on a PC or phone and pins notes to a moment and a spot, an AI agent reads them and changes the film, and nothing in the studio can edit the film itself.

<img src="docs/studio.png" width="320" alt="The studio on a phone: the picture with a pin on the tapped ball, big play and note buttons, the timeline with words and actions, and the notes below.">

```bash
bun run demo -- 4321     # the demo film at http://localhost:4321; needs Node 22+, Bun, Python 3, ffmpeg
```

Local only and without a password: reach it from a phone through `tailscale serve` with the host name in the film's `.live_hosts` (any other name gets 403), never from the open internet.

## On your film

Every film in this monorepo shares this one studio (`"live-studio": "workspace:*"`); never copy it into a film.

```bash
bun run new-film <name>                 # at the monorepo root: copies templates/film, runs init.mjs, links the vault
cd films/<name> && bun run studio       # prints the creator's link (Tailscale) or what is missing
bun run notes [ID]                      # the creator's notes; bun run note done ID "..." when one is fixed
bun run render stills|clip              # draft stills or the draft video; options and checks in the header of render.mjs
bun run framecheck                      # faults in a rendered video
```

What a film must provide and every rule an agent follows: [docs/film-contract.md](docs/film-contract.md).

## Working on the studio

`app/` is the React page (shadcn/ui on Base UI, Tailwind, Zustand) that Vite rebuilds with the film on every save (`src/page.mjs`), `src/` is the server (restart each studio after changing it), `render/` the draft renderer, and `bun run test` the tests.

## License

MIT; built on three.js, Vite, React, shadcn/ui, Base UI, Tailwind CSS, Hono, Zustand, TanStack Hotkeys, Zod, vite-plugin-compression2 (all MIT) and Lucide (ISC).
