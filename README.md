# Mistport Dive（雾港深巡）

A browser roguelite inspired by room-dungeon crawlers. Pure frontend — no build step, no backend, no dependencies. Open `index.html` and play.

**Play online:** https://eduzkf.github.io/mistport-dive/

## Features

- Room-based dungeon crawling with procedurally generated floors and endless descent mode
- Teardrop projectile combat (aim with mouse) with 100 data-driven items changing damage, range, HP, fire pattern, etc.
- Item pedestal pick-1-of-3 builds, shop economy with randomized stock, boss fights, NPC dialogue with state awareness, and an in-game codex
- Progress saved to `localStorage` (per browser)

## Content Pipeline

Game content (items / NPC lines / global balance) lives in YAML as the single source of truth, validated by 6 rules (line-level error reporting), then deterministically expanded (seeded PRNG) into `data.generated.js` which the game consumes at runtime — zero hardcoded content in game code. A headless vm-sandbox regression suite (8 scenarios / 28 assertions) runs the full game logic without a browser.

## Tech

- HTML5 Canvas + vanilla JavaScript (~zero deps)
- Node.js pipeline: YAML validation → deterministic generation → vm-sandbox headless regression
- `localStorage` save (`mistport_v1`)

## Controls

| Action | Key |
|---|---|
| Move | WASD |
| Shoot | Left mouse (aim direction) |
| Interact / confirm | E / Space |
| Debug panel | F1 |
