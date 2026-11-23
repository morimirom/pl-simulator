# Unofficial Premier League 26/27 Simulator

A fan-made Monte Carlo simulator for the 2026/27 season. Each club gets attack and defence ratings from the last two seasons plus this season's form; the rest of the season is played out thousands of times with Poisson-distributed goals, following the real fixture list.

**Live page:** https://morimirom.github.io/pl-simulator/

- Matchweek slider: actual tables with the projection made at the time for played weeks, projected standings for future weeks.
- English and Korean (한국어): switch at the top of the page, or link with `?lang=ko`. Korean-language browsers open in Korean.
- Results are added automatically by a GitHub Actions workflow (`.github/workflows/update-results.yml`), usually within an hour of full time. It reads the official Fantasy Premier League feed, cross-checks against football-data.org (repo secret `FOOTBALL_DATA_TOKEN`), and opens an issue instead of publishing if anything disagrees.
- Everything lives in `index.html`. Results and fixtures are the single `const D = {...};` line in its script.

Unofficial fan project. Not affiliated with or endorsed by the Premier League or any club. Club names are used for identification only.
