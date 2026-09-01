# The Lost Arcanum of Dahz

A companion app for our tabletop group: a lore codex, a points-legal army
builder covering every faction, a rules reference, a game/mission helper, and a
campaign map. Runs entirely in the browser — no account, no install.

## View it
This site is published with GitHub Pages. Just open the link your group shared —
it works on phones, tablets, and computers.

## Run it locally (optional)
Any static server works, e.g.:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Staying current
Game data (units, points, magic items, rules, lores) is refreshed automatically
once a week by a GitHub Action (`.github/workflows/update-data.yml`), which runs
`tools/update-data.py` and commits any changes. You can also trigger it manually
from the repo's **Actions** tab.

## Credits & disclaimer
Game data is sourced from the community
[Old World Builder](https://github.com/nthiebes/old-world-builder) project and
rule references link to [tow.whfb.app](https://tow.whfb.app). This is an
unofficial fan tool, not affiliated with or endorsed by Games Workshop. No
copyrighted rules text is reproduced — the app links out to official references.
