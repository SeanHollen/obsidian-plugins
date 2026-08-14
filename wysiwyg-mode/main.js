"use strict";

const { Plugin, MarkdownView, Notice } = require("obsidian");
const { syntaxTree } = require("@codemirror/language");
const { Decoration, EditorView, ViewPlugin } = require("@codemirror/view");
const { StateEffect, StateField } = require("@codemirror/state");

/*
 * WYSIWYG Mode
 *
 * Obsidian's Live Preview already hides markdown markers everywhere EXCEPT the
 * line the cursor is on, where it reveals raw syntax so you can edit it. This
 * plugin adds the missing delta: hide them on the cursor line too.
 *
 * Invariant that keeps this safe: we only ever decorate lines that contain a
 * cursor or selection. Those are exactly the lines Obsidian chose to reveal, so
 * our decorations never overlap with Obsidian's own.
 */

// Shared so editors opened after the toggle inherit the current mode.
const MODE = { enabled: false };

const setWysiwyg = StateEffect.define();

const wysiwygField = StateField.define({
	create: () => MODE.enabled,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setWysiwyg)) value = e.value;
		return value;
	},
});

// Marker types with no editable payload behind them — safe to hide outright.
// Deliberately excludes links, code fences, tables and embeds: hiding those
// would remove your only way to edit the URL / language / cell content.
const HIDEABLE = [
	"formatting-strong",
	"formatting-em",
	"formatting-strikethrough",
	"formatting-highlight",
	"formatting-header",
];

const HIDE = Decoration.replace({});
const UNDERLINE = Decoration.mark({ class: "wysiwyg-underline" });

function isHideableMarker(name) {
	if (!name.includes("formatting")) return false;
	return HIDEABLE.some((h) => name.includes(h));
}

/** Line numbers touched by any cursor or selection range. */
function activeLines(state) {
	const lines = new Set();
	for (const range of state.selection.ranges) {
		const from = state.doc.lineAt(range.from).number;
		const to = state.doc.lineAt(range.to).number;
		for (let n = from; n <= to; n++) lines.add(n);
	}
	return lines;
}

function build(view) {
	const hides = [];
	const marks = [];

	if (!view.state.field(wysiwygField, false)) {
		return { decorations: Decoration.none, atomics: Decoration.none };
	}

	const state = view.state;
	const tree = syntaxTree(state);

	for (const lineNo of activeLines(state)) {
		const line = state.doc.line(lineNo);

		// 1. Emphasis / heading markers, straight off the syntax tree.
		tree.iterate({
			from: line.from,
			to: line.to,
			enter(node) {
				if (!isHideableMarker(node.type.name)) return;
				let to = node.to;
				// Heading markers own the '#'s but not the space after them.
				if (node.type.name.includes("formatting-header")) {
					while (to < line.to && state.doc.sliceString(to, to + 1) === " ") to++;
				}
				if (node.from < to) hides.push(HIDE.range(node.from, to));
			},
		});

		// 2. <u> tags. Obsidian has no emphasis token for these, so scan the
		//    line text directly — the pattern is unambiguous enough.
		const text = line.text;
		const re = /<u>([\s\S]*?)<\/u>/g;
		let m;
		while ((m = re.exec(text)) !== null) {
			const start = line.from + m.index;
			const openEnd = start + 3;
			const closeStart = start + m[0].length - 4;
			const closeEnd = start + m[0].length;
			hides.push(HIDE.range(start, openEnd));
			hides.push(HIDE.range(closeStart, closeEnd));
			if (openEnd < closeStart) marks.push(UNDERLINE.range(openEnd, closeStart));
		}
	}

	return {
		// Decoration.set sorts for us, which matters because we mix a tree walk
		// with a regex scan and the ranges come out interleaved.
		decorations: Decoration.set(hides.concat(marks), true),
		atomics: Decoration.set(hides, true),
	};
}

const markerHider = ViewPlugin.fromClass(
	class {
		constructor(view) {
			const r = build(view);
			this.decorations = r.decorations;
			this.atomics = r.atomics;
		}

		update(u) {
			const toggled =
				u.startState.field(wysiwygField, false) !==
				u.state.field(wysiwygField, false);
			if (u.docChanged || u.viewportChanged || u.selectionSet || toggled) {
				const r = build(u.view);
				this.decorations = r.decorations;
				this.atomics = r.atomics;
			}
		}
	},
	{
		decorations: (v) => v.decorations,
		provide: (plugin) =>
			// This is what makes the caret treat a hidden '**' as one unit:
			// arrow keys jump it, backspace eats it whole instead of one '*'.
			EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomics || Decoration.none),
	}
);

module.exports = class WysiwygModePlugin extends Plugin {
	async onload() {
		const saved = await this.loadData();
		MODE.enabled = saved?.enabled ?? false;

		this.registerEditorExtension([wysiwygField, markerHider]);

		this.status = this.addStatusBarItem();
		this.renderStatus();

		this.addCommand({
			id: "toggle-wysiwyg",
			name: "Toggle WYSIWYG mode",
			callback: () => this.setEnabled(!MODE.enabled),
		});

		this.addCommand({
			id: "dump-syntax-nodes",
			name: "Debug: dump syntax nodes on current line",
			editorCallback: (_editor, view) => this.dumpNodes(view),
		});
	}

	renderStatus() {
		this.status.setText(MODE.enabled ? "WYSIWYG" : "");
	}

	setEnabled(enabled) {
		MODE.enabled = enabled;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const cm = leaf.view instanceof MarkdownView ? leaf.view.editor?.cm : null;
			if (cm) cm.dispatch({ effects: setWysiwyg.of(enabled) });
		}
		this.renderStatus();
		this.saveData({ enabled });
	}

	dumpNodes(view) {
		const cm = view.editor?.cm;
		if (!cm) return;
		const line = cm.state.doc.lineAt(cm.state.selection.main.head);
		const rows = [];
		syntaxTree(cm.state).iterate({
			from: line.from,
			to: line.to,
			enter(node) {
				rows.push({
					name: node.type.name,
					from: node.from - line.from,
					to: node.to - line.from,
					text: JSON.stringify(cm.state.doc.sliceString(node.from, node.to)),
					hidden: isHideableMarker(node.type.name),
				});
			},
		});
		console.log(`[wysiwyg-mode] line ${line.number}: ${JSON.stringify(line.text)}`);
		console.table(rows);
		new Notice("Syntax nodes dumped to console (Cmd-Opt-I)");
	}
};
