# Unofficial Premier League 26/27 Simulator

A fan-made Monte Carlo simulator for the 2026/27 season. Each club gets attack and defence ratings from the last two seasons plus this season's form; the rest of the season is played out thousands of times with Poisson-distributed goals, following the real fixture list.

**Live page:** https://morimirom.github.io/pl-simulator/

- Matchweek slider: actual tables with the projection made at the time for played weeks, projected standings for future weeks.
- Results are updated daily; see the update log on the page.
- Everything lives in `index.html`. Results and fixtures are the single `const D = {...};` line in its script.

Unofficial fan project. Not affiliated with or endorsed by the Premier League or any club. Club names are used for identification only.
