# The specage language

A specage file is a human-written tree of statements. Each statement has prose and, optionally, an ID.
The skeleton (nesting, IDs, markers) is fixed. Everything else is prose.

```
file      = { statement } ;
statement = leaf | block ;
leaf      = text , id_clause , ";" ;
block     = text , id_clause , "{" , { statement } , "}" , ";" ;
id_clause = "@" , id , [ "<-" , id , { "," , id } ] ;
id        = segment , { "." , segment } ;      segment = /[a-z][a-z0-9_-]*/
text      = [ marker ] , prose ;
```

## Lexical

- UTF-8, normalized to NFC before hashing.
- Comment: `#` at the start of a line or after whitespace, to end of line. Excluded from hashes.
- Reserved characters in text: `{ } ; @ #`. Escape with a backslash: `\; \{ \} \@ \# \\`.
- Indentation and line breaks are cosmetic.

## IDs

- IDs are optional. An explicit ID (`@name`) works like a YAML anchor: a human-chosen name other parts of the spec and the trail can reference. Untracked asides go in comments.
- A statement without an ID gets a **derived name** `s-<8 hex>`: `sha256(lowercase(own_text))[:8]`. Whitespace and case don't change it; any other wording change does. Identical ID-less statements in one file get `-2`, `-3`, ... suffixes in file order. Derived names key trace, diffs, CLI output and coverage, but are not anchors: no uniqueness (E003), retirement (E004), prefix (W101) or lineage checks apply.
- Because rewording an ID-less statement changes its name, the diff shows remove + add. Treat it as *possibly the same statement reworded* (see PROTOCOL reconcile ladder). Give a statement an explicit ID to track it across rewording.
- An ID is a name, not a path. A child usually extends its parent's prefix (warning if not).
- IDs are unique and never reused. A removed node's ID is retired in `trace.yaml` on the project's trail branch.
- A moved node keeps its ID.

## Markers

First token of a leaf's text. Blocks carry none in v0.

| Marker | Meaning |
|---|---|
| (none) | Behaviour, as a player or developer sees it |
| `!constraint:` | Hard rule. Never trade it away |
| `!impl:` | Pins how something is built |
| `!invariant:` | Must hold for all inputs |
| `!proof <kind>:` | The human must see this artifact before a PR touching the parent subtree merges. Kinds: video, screenshot, demo, snippet, transcript, walkthrough |
| `?` | Open question or undecided. Don't implement it |
| `>later:` | Known follow-up. Don't build it until the marker is removed |

## Lineage (renames, splits, merges)

```
burst cap ... @shoot.cap <- shoot.burst.cap;                 # rename
gate by FOV ... @shoot.gate.fov <- shoot.gate;               # split: both halves name the old ID
gate by range ... @shoot.gate.range <- shoot.gate;
lock-on ... @shoot.lock <- shoot.lock.stage, shoot.lock.torso;   # merge
```

Remove the `<-` clause after one dispatch has consumed it.

## Hashing

`own_text` = marker + prose, with comments and the ID clause removed (derived names hash the lowercased text), escapes unescaped, whitespace runs collapsed to one space, trimmed. Case preserved.

- `hash = sha256(own_text)[:12]`
- `subtree_hash = sha256(hash + "\n" + join("\n", child subtree_hashes))[:12]`

## Lint

| Code | Level | Rule |
|---|---|---|
| E001 | error | Parse error |
| E002 | error | Empty statement |
| E003 | error | Duplicate ID |
| E004 | error | Retired ID reused (needs `--state`) |
| E005 | error | Unknown marker |
| E006 | error | `<-` names an ID that still exists |
| W101 | warn | ID doesn't extend its parent's prefix |
| W102 | warn | Leaf over 280 characters |
| W103 | warn | Leaf contains a file path, `#123` reference or URL |
| W104 | warn | Unknown `!proof` kind |
| W105 | warn | `<-` survived the dispatch that consumed it (needs `--state`) |
| W106 | warn | Marker on a block (ignored) |

Run `specage lint <file>`; add `--json` for machine output.
