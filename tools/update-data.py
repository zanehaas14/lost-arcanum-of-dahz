#!/usr/bin/env python3
"""
The Lost Arcanum of Dahz — data updater.

Pulls the official Warhammer: The Old World army datasets from the public
Old World Builder repository and rebuilds this app's data files. This replaces
fragile HTML scraping: OWB publishes clean JSON, so a rules/points change
upstream is picked up simply by re-running this script.

  python3 tools/update-data.py              # update everything
  python3 tools/update-data.py bretonnia    # update one faction (by id)

Rebuilds:
  data/factions/<id>.json   per-faction units + upgrade options
  data/factions-index.json  the army dropdown
  data/magic-items.json     magic items grouped by faction/category
  data/rules-index.json     special-rule name -> book/page + rulebook link

Your homebrew is never touched: entries in data/homebrew/<faction-id>.json are
merged back on top of the refreshed official data every run.

Sources (unofficial, community; not affiliated with Games Workshop):
  units/items: https://github.com/nthiebes/old-world-builder
  rule text links: https://tow.whfb.app
"""

import json
import os
import re
import sys
import urllib.request

RAW_BASE = ("https://raw.githubusercontent.com/nthiebes/old-world-builder"
            "/main/public/games/the-old-world")
MAGIC_URL = f"{RAW_BASE}/magic-items.json"
RULES_URL = ("https://raw.githubusercontent.com/nthiebes/old-world-builder"
             "/main/src/components/rules-index/rules-index-export.json")
LORES_URL = ("https://raw.githubusercontent.com/nthiebes/old-world-builder"
             "/main/src/assets/lores-of-magic-with-spells.json")
TOW_BASE = "https://tow.whfb.app"  # online rulebook to link rule/spell text

SMALL_WORDS = {"of", "the", "and", "to", "a", "an", "in", "on"}


def titlecase(s):
    words = s.split()
    return " ".join(w if (w in SMALL_WORDS and i) else w.capitalize()
                    for i, w in enumerate(words))


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

FACTIONS = {
    "beastmen-brayherds": "Beastmen Brayherds",
    "chaos-dwarfs": "Chaos Dwarfs",
    "daemons-of-chaos": "Daemons of Chaos",
    "dark-elves": "Dark Elves",
    "dwarfen-mountain-holds": "Dwarfen Mountain Holds",
    "empire-of-man": "Empire of Man",
    "grand-cathay": "Grand Cathay",
    "high-elf-realms": "High Elf Realms",
    "kingdom-of-bretonnia": "Kingdom of Bretonnia",
    "lizardmen": "Lizardmen",
    "ogre-kingdoms": "Ogre Kingdoms",
    "orc-and-goblin-tribes": "Orc & Goblin Tribes",
    "renegade-crowns": "Renegade Crowns",
    "skaven": "Skaven",
    "tomb-kings-of-khemri": "Tomb Kings of Khemri",
    "vampire-counts": "Vampire Counts",
    "warriors-of-chaos": "Warriors of Chaos",
    "wood-elf-realms": "Wood Elf Realms",
}
CATEGORY_MAP = {"characters": "Characters", "core": "Core",
                "special": "Special", "rare": "Rare"}

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(HERE, "data")
FACTIONS_DIR = os.path.join(DATA, "factions")
HOMEBREW_DIR = os.path.join(DATA, "homebrew")


def fetch(url):
    with urllib.request.urlopen(url, timeout=45) as r:
        return json.loads(r.read().decode("utf-8"))


def opts(arr):
    """Normalize an OWB option array (equipment/armor/options/mounts/command)."""
    out = []
    for o in arr or []:
        name = o.get("name_en")
        if not name:
            continue
        out.append({
            "name": name,
            "points": o.get("points", 0),
            "perModel": bool(o.get("perModel")),
            "default": bool(o.get("equippedDefault") or o.get("active")),
        })
    return out


def allowances(items):
    """Magic-item allowances on a unit (e.g. 'Magic Items', 'Forest Spites')."""
    out = []
    for it in items or []:
        if "types" in it or "maxPoints" in it:
            out.append({
                "label": it.get("name_en", "Magic Items"),
                "types": it.get("types", []),
                "maxPoints": it.get("maxPoints"),
            })
    return out


def split_rules(sr):
    if not sr:
        return []
    txt = sr.get("name_en", "") if isinstance(sr, dict) else str(sr)
    return [s.strip() for s in txt.split(",") if s.strip()]


WIZARD_LV = re.compile(r"Level\s+(\d+)\s+Wizard", re.I)


def wizard_from_options(item):
    """Copy OWB `lores`; infer wizardLevel from nested/flat Level N Wizard.
    Flatten nested Level N Wizard into the unit options list."""
    lores = [k for k in (item.get("lores") or []) if k]
    level = None
    extra = []
    for o in item.get("options") or []:
        name = o.get("name_en") or ""
        m = WIZARD_LV.search(name)
        if m and (o.get("active") or o.get("equippedDefault")):
            level = int(m.group(1))
        nested = o.get("options") or []
        for n in nested:
            nname = n.get("name_en") or ""
            if not nname:
                continue
            extra.append({
                "name": nname,
                "points": n.get("points", 0),
                "perModel": bool(n.get("perModel")),
                "default": bool(n.get("equippedDefault") or n.get("active")),
            })
            nm = WIZARD_LV.search(nname)
            if nm and (n.get("active") or n.get("equippedDefault")) and level is None:
                level = int(nm.group(1))
    if item.get("spellCount") is not None and level is None:
        try:
            level = int(item["spellCount"])
        except (TypeError, ValueError):
            pass
    return lores, level, extra


def transform_unit(item, category):
    name = item.get("name_en") or item.get("id") or "Unknown"
    pts = item.get("points", 0)
    minimum = item.get("minimum", 0) or 0
    multi = category != "Characters" and minimum and minimum > 1
    options = opts(item.get("options"))
    lores, wlevel, extra_wiz = wizard_from_options(item)
    if extra_wiz:
        options = [o for o in options if o["name"].lower() != "wizard"] + extra_wiz
    out = {
        "id": item.get("id", name.lower().replace(" ", "-")),
        "name": name,
        "category": category,
        "points": pts * minimum if multi else pts,
        "perModel": pts if multi else None,
        "minSize": minimum if multi else 1,
        "type": "official",
        "notes": "",
        "mounts": opts(item.get("mounts")),
        "command": opts(item.get("command")),
        "equipment": opts(item.get("equipment")),
        "armor": opts(item.get("armor")),
        "options": options,
        "magicAllowances": allowances(item.get("items")),
        "specialRules": split_rules(item.get("specialRules")),
    }
    if lores:
        out["lores"] = lores
    if wlevel is not None:
        out["wizardLevel"] = wlevel
    return out


def load_homebrew(faction_id):
    """Return the homebrew override layer for a faction. Supports:
      units   : list -> net-new custom units (added alongside official)
      patches : {id: {field: value}} -> edit fields of an official unit
      replace : {id: {full unit}}    -> swap an official unit wholesale
      remove  : [id]                 -> hide an official unit
    All keyed by official unit id. Missing keys default empty. The old
    plain {"units": [...]} shape still works unchanged."""
    empty = {"units": [], "patches": {}, "replace": {}, "remove": []}
    path = os.path.join(HOMEBREW_DIR, f"{faction_id}.json")
    if not os.path.exists(path):
        return empty
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {
        "units": data.get("units", []),
        "patches": data.get("patches", {}) or {},
        "replace": data.get("replace", {}) or {},
        "remove": data.get("remove", []) or [],
    }


def deep_merge(base, patch):
    """Merge patch onto base in place. Nested dicts merge recursively;
    lists and scalars from patch REPLACE the base value wholesale."""
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            deep_merge(base[k], v)
        else:
            base[k] = v
    return base


def build_faction(faction_id):
    label = FACTIONS.get(faction_id, faction_id)
    raw = fetch(f"{RAW_BASE}/{faction_id}.json")

    # 1. Official units, indexed by id (dict preserves order).
    by_id = {}
    for owb_cat, our_cat in CATEGORY_MAP.items():
        for item in raw.get(owb_cat, []):
            u = transform_unit(item, our_cat)
            by_id[u["id"]] = u

    hb = load_homebrew(faction_id)
    touched = 0

    # 2. remove official units we don't field.
    for rid in hb["remove"]:
        if by_id.pop(rid, None) is not None:
            touched += 1

    # 3. replace: swap an official unit wholesale for our version.
    for rid, unit in hb["replace"].items():
        u = dict(unit)
        u.setdefault("id", rid)
        u["type"] = "homebrew"
        by_id[rid] = u
        touched += 1

    # 4. patches: edit named fields of an official unit; the rest stays from OWB.
    for pid, patch in hb["patches"].items():
        if pid in by_id:
            deep_merge(by_id[pid], dict(patch))
            by_id[pid]["type"] = "homebrew"  # flag as homebrew-modified
            touched += 1
        else:
            print(f"    ! patch for unknown id '{pid}' in {faction_id} "
                  f"(OWB renamed/removed it?) — skipped")

    # 5. net-new additions.
    units = list(by_id.values())
    units.extend(hb["units"])
    hb_total = touched + len(hb["units"])

    out = {
        "_comment": ("Auto-generated by tools/update-data.py. Do NOT hand-edit; "
                     f"add/edit custom units in data/homebrew/{faction_id}.json "
                     "(units / patches / replace / remove)."),
        "id": faction_id, "label": label, "units": units,
    }
    with open(os.path.join(FACTIONS_DIR, f"{faction_id}.json"), "w",
              encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    return label, len(units), hb_total


def build_magic_items():
    raw = fetch(MAGIC_URL)
    out = {}
    for group, items in raw.items():
        if not isinstance(items, list):
            continue
        out[group] = [{
            "name": it.get("name_en", it.get("name", "")),
            "points": it.get("points", 0),
            "type": it.get("type", ""),
            "onePerArmy": bool(it.get("onePerArmy")),
        } for it in items if it.get("name_en") or it.get("name")]
    with open(os.path.join(DATA, "magic-items.json"), "w", encoding="utf-8") as f:
        json.dump({"_comment": "Auto-generated. Magic items grouped by faction/"
                   "category.", "groups": out}, f, indent=2, ensure_ascii=False)
    return sum(len(v) for v in out.values())


def load_homebrew_rules():
    """Your own special-rule text: data/homebrew/rules.json = {"rules":
    {"Rule Name": "effect text"}}. Merged into the rules index so the app can
    show the full effect inline (yours to display). You may also add a note for
    an OFFICIAL rule name here (in your own words) — it will show inline too."""
    path = os.path.join(HOMEBREW_DIR, "rules.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return (data.get("rules", {}) if isinstance(data, dict) else {}) or {}


def build_rules_index():
    raw = fetch(RULES_URL)
    out = {}
    for name, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        path = entry.get("url", "")
        out[name] = {
            "page": entry.get("page", ""),
            "url": f"{TOW_BASE}/{path}" if path else "",
        }
    # Merge homebrew rule text on top (never touches official links; adds `desc`).
    hb = 0
    for name, val in load_homebrew_rules().items():
        desc = val.get("desc", "") if isinstance(val, dict) else val
        key = name.lower()
        official = key in out
        out[key] = {
            "page": out.get(key, {}).get("page", "") if official else "Homebrew",
            "url": out.get(key, {}).get("url", "") if official else "",
            "desc": desc,
            "homebrew": not official,  # a note on an official rule stays official
        }
        hb += 1
    with open(os.path.join(DATA, "rules-index.json"), "w", encoding="utf-8") as f:
        json.dump({"_comment": "Auto-generated. Special-rule -> book/page + "
                   "online rulebook link (tow.whfb.app). Entries with `desc` "
                   "carry inline text from data/homebrew/rules.json.",
                   "rules": out}, f, indent=2, ensure_ascii=False)
    return len(out)


def build_lores():
    raw = fetch(LORES_URL)
    out = {}
    for key, spells in raw.items():
        lst = []
        for name, info in spells.items():
            lst.append({"name": titlecase(name), "index": info.get("index"),
                        "url": f"{TOW_BASE}/spells/{slug(name)}"})

        def order(x):
            i = x.get("index")
            return -1 if i == "signature" else (int(i) if str(i).isdigit() else 99)
        lst.sort(key=order)
        out[key] = {"label": titlecase(key.replace("-", " ")), "spells": lst}
    with open(os.path.join(DATA, "lores.json"), "w", encoding="utf-8") as f:
        json.dump({"_comment": "Auto-generated. Lores of Magic with their spells "
                   "(signature + 1-6). Spell links go to tow.whfb.app.",
                   "lores": out}, f, indent=2, ensure_ascii=False)
    return len(out)


def main():
    os.makedirs(FACTIONS_DIR, exist_ok=True)
    os.makedirs(HOMEBREW_DIR, exist_ok=True)
    wanted = sys.argv[1:] or list(FACTIONS.keys())

    for fid in wanted:
        if fid not in FACTIONS:
            print(f"  ! unknown faction id: {fid} (skipping)")
            continue
        try:
            label, n, hb = build_faction(fid)
            extra = f" (+{hb} homebrew)" if hb else ""
            print(f"  ✓ {label}: {n} units{extra}")
        except Exception as e:  # noqa
            print(f"  ! {fid}: FAILED — {e}")

    # Shared datasets (only when doing a full run, or always — cheap enough).
    try:
        print(f"  ✓ Magic items: {build_magic_items()} items")
    except Exception as e:  # noqa
        print(f"  ! magic-items: FAILED — {e}")
    try:
        print(f"  ✓ Rules index: {build_rules_index()} rules")
    except Exception as e:  # noqa
        print(f"  ! rules-index: FAILED — {e}")
    try:
        print(f"  ✓ Lores of Magic: {build_lores()} lores")
    except Exception as e:  # noqa
        print(f"  ! lores: FAILED — {e}")

    index = [{"id": fid, "label": lbl} for fid, lbl in FACTIONS.items()
             if os.path.exists(os.path.join(FACTIONS_DIR, f"{fid}.json"))]
    index.sort(key=lambda x: x["label"])
    with open(os.path.join(DATA, "factions-index.json"), "w",
              encoding="utf-8") as f:
        json.dump({"factions": index}, f, indent=2, ensure_ascii=False)
    print(f"\nIndex written: {len(index)} factions available.")


if __name__ == "__main__":
    main()
