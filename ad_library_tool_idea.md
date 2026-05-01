# Ad Library Synthesizer — Build Idea

Inspired by a friend's tool that analyzed Rosabella's Facebook ads into a "creative swipe file."

## What it does
- Scrapes a brand's Facebook Ad Library ads via Apify
- Sends ad copy to Claude API → returns angle, avatar, hook, landing page per ad
- Aggregates into a clean HTML report (no dashboard needed for v1)

## Stack
- Python script
- Apify (Facebook Ad Library actor) — already have account
- Claude API — already have key
- Output: static HTML report, opens in browser

## Time estimate
- Script + HTML report: ~2-3 hours
- Full Next.js dashboard (like friend's): 2-3 days

## Status
Parked. Not building now. Revisit if competitive ad analysis becomes useful for PixSort or Fire Pit Surplus.
