# obsidian-plugins

Personal Obsidian plugins.

| Plugin | What it does |
| --- | --- |
| [wysiwyg-mode](wysiwyg-mode/) | A third editing mode that keeps markdown markers hidden even on the cursor line. |

## Development

These are plain CommonJS plugins with no build step — Obsidian resolves
`obsidian` and `@codemirror/*` at runtime, so `main.js` loads as written.

Symlink a plugin into a vault to work on it live:

```sh
ln -s "$PWD/wysiwyg-mode" "/path/to/vault/.obsidian/plugins/wysiwyg-mode"
```

Then reload Obsidian (`Cmd-P` → "Reload app without saving") after each edit.
