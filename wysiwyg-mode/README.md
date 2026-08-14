# WYSIWYG Mode

Obsidian's Live Preview already hides markdown markers everywhere *except* the
line the cursor is on, where it reveals raw syntax so you can edit it. This
plugin adds the missing delta: a mode that hides them on the cursor line too, so
you see `**bold**` as **bold** while you're typing in it.

## Commands

| Command |
| --- |
| Toggle WYSIWYG mode |
| Debug: dump syntax nodes on current line |

## How it works

A CodeMirror 6 `ViewPlugin` walks the syntax tree and emits
`Decoration.replace` over marker nodes, plus `EditorView.atomicRanges` over the
same ranges — which is what makes the caret treat a hidden `**` as a single
unit, so arrow keys jump it and backspace deletes both asterisks instead of
corrupting the syntax into `**bold*`.

**Safety invariant:** the plugin only ever decorates lines containing a cursor
or selection. Those are exactly the lines Obsidian reveals, so these decorations
never overlap with Obsidian's own. With the mode off it emits nothing, and stock
Live Preview is restored exactly.

## Scope

Hidden on the cursor line: bold, italic, strikethrough, highlight, heading `#`s,
`<u>` tags.

Links, code fences, tables and embeds keep Obsidian's default behavior and
reveal their syntax on the cursor line, so the URL or language tag stays
editable in place.

## Known rough edges

- Heading text shifts left when the cursor enters the line, since the `#`s
  collapse to zero width. A spacer widget would fix it.
- `<u>` is matched per-line by regex, so it won't span a line break.
