# mutationdiff

This package allows you to do incremental DOM diffing on a live DOM tree. It is designed to take
async, batched mutation records from `MutationObserver` as input for diff calculations; but you can
also report individual mutations manually if desired. In addition to getting the diff, you can also
patch a DOM given a list of differences, revert the DOM to its original state, or query the range
where mutations occurred. It can also be used just to summarize and simplify the log of mutations
given by `MutationObserver`.

How does this package differ from *virtual DOM diffing* or other diffing libraries?
- it gives the diff of a DOM tree at two points in time, rather than the delta between two different
  DOM trees
- it doesn't use a virtual DOM, only operating on a live DOM tree
- it is computationally efficient since it only does calculations on mutated nodes (as
  reported by `MutationObserver` or other method)
- it is memory efficient since it doesn't make a copy of the DOM tree to diff against (only the
  differing nodes and their corresponding diff metadata needs to be stored)

Benchmarks in Chrome v108 for a typical use case:
- Processing a `MutationRecord`: 261k per/sec
- Retrieving full diff results: 107k per/sec
- Check if DOM has changed: 493k per/sec
- Get the extent/range of DOM changes: 52.3k per/sec
- Revert DOM changes: 12.6k per/sec

Originally, this library was written to revert browser-made edits to a `contenteditable` element. A
naive approach to reversion would be to rewind a log of `MutationRecord`, as suggested in the [MDN
documentation](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe#usage_notes).
Performing DOM diffing is more work than simply keeping a log, but in exchange we get exact bounds
for the range of mutations, memory usage is optimal, and reversion can directly place nodes back in
their original positions; it will have better worst-case behavior.

[API documentation](https://azmisov.github.io/mutationdiff) |
[npm package](https://www.npmjs.com/package/mutationdiff) |
[GitHub source code](https://www.github.com/Azmisov/mutationdiff)

## Installation

```
npm i mutationdiff
```

This project uses ES 2015+ class features. A Babel transpiled and minified version is provided as
`mutationdiff.compat.min.js`, with exports under `MutationDiff`; though I highly recommend building
a bundle yourself to customize the target and reduce code size. A plain minified version is provided
as `mutationdiff.min.js`.

## Usage

```js
// an alias is recommended for MutationDiffFlags
import { MutationDiff, MutationDiffObserver, MutationDiffFlags as F } from "mutationdiff";
```

If not using a bundler, you'll need to import from the minified version, which is pre-bundled.

### Quickstart Method Reference

- `record`, `data`, `attribute`, `custom`, `children`: report a DOM mutation
- `mutated`: check if there are any differences
- `range`: get the extent of any differences
- `diff`: get diff results
- `diff_grouped_children`: group node movement diffs
- `patch_grouped_children`: apply grouped node movements
- `revert`: undo any diff
- `clear`: reset diff tracking

### Quickstart Example

Make sure to check the API documentation for full details.

```js
// a small DOM for this example
const dom = init_dom();
// create our diff tracking object
const tracker = new MutationDiff();
```

Report any mutations of interest to `MutationDiff` by calling `data`, `attribute`, `custom`, or
`children` methods. Most likely, you'll want to get mutations using a `MutationObserver`, but you
could also have some controller logic that all DOM modifications go through.

If you're using `MutationObserver`, there is a helper class `MutationDiffObserver` which can be used
for simple cases. It will initialize a `MutationObserver` and setup all the hooks to report to
`MutationDiff` for you. That would look like this:

```js
// setup our helper object
const observer = new MutationDiffObserver(tracker, dom.root);
// DOM is mutated...
dom.mutate();
// custom, user-defined properties always need to be recorded manually
tracker.custom(dom.B, "child_count", dom.B.childNodes.length, dom.B_old_child_count);
// flush results and synchronize tracker
observer.flush();
// stop observing (optional)
observer.stop();
```

If you have more advanced use cases and want to reuse the `MutationObserver`, or filter/process the
`MutationRecord`s before passing to `MutationDiff`, then you might consider doing the setup
yourself. That would look like this:

```js
function handle_records(records){
	for (const r of records){
		// custom, user-defined properties always need to be recorded manually
		if (r.target === dom.B && r.type === "childList")
			tracker.custom(dom.B, "child_count", dom.B.childNodes.length, dom.B_old_child_count);
		tracker.record(r);
		// you could also process records manually and call data, attribute, custom, children
	}
}
// setup the MutationObserver
const observer = new MutationObserver(handle_records);
observer.observe(dom.root, {
	subtree: true,
	childList: true,
	attributes: true,
	attributeOldValue: true,
	characterData: true,
	characterDataOldValue: true
});
// DOM is mutated...
dom.mutate();
// flush MutationObserver
handle_records(observer.takeRecords());
// signals to MutationDiff that all mutations have been recorded
tracker.synchronize();
// stop observing (optional)
observer.disconnect();
```

Here we just watch a single node, `root`, but in practice you can watch any number of separate DOM
trees using a single `MutationDiff`. We're also observing all DOM changes, but you could specify a
filter to ignore attributes or character data changes, for example.

The `record` method is a convenient helper which calls `data`, `attribute`, and `children` methods
appropriately for a `MutationRecord`.

Since `MutationObserver` is async and batched, we need to flush any pending `MutationRecord`s prior
to reading the results. Note also the call to `synchronize` after flushing; the call to
`synchronize` is only needed if:
1. You want to accurately revert or patch DOM trees besides `root` (or the set of root nodes you're
   observing).
2. You want to reduce memory usage for property (data, attribute, custom) diff information

For our example, if all we wanted to do was revert `root`, the `synchronize` call would not be
necessary. A more detailed explanation of what `synchronize` does is described in the [Diffing
Caveat #2](#diffing-caveat-2) and [Diffing Caveat #3](#diffing-caveat-3) sections. When in doubt,
you can always call `synchronize`, with just a minor increase in computation.

The `init_dom` function is defined as:

```js
function init_dom(){
	// Original DOM: <div><span></span></div>, <span id=B></span>, #old text
	const root = document.createElement("div");
	const A = document.createElement("span");
	root.appendChild(A);
	const B = document.createElement("span");
	B.id = "B";
	const B_old_child_count = B.childNodes.length;
	const txt = document.createTextNode("old text");

	function mutate(){
		// Mutated DOM: <div><span id=B_modified></span>#new text<span></span></div>
		root.appendChild(B);
		root.appendChild(txt);
		A.remove();
		B.id = "B_modified";
		txt.after(A);
		txt.data = "new text";
	}

	return {root, A, B, txt, B_old_child_count, mutate};
}
```

Now we can read the diffing results:

```js
console.log(tracker.mutated());
// output: true
console.log(tracker.range());
// output: BoundaryRange[(root, AFTER_OPEN), (A, BEFORE_OPEN)]
console.log(tracker.diff());
/* output:
	Map {
		dom.B => {
			attribute: {
				id: {
					original: "B",
					mutated: "B_modified"
				}
			},
			custom: Map {
				child_count => {
					original: 0,
					mutated: 1
				}
			}
			children: {
				mutated: {
					parent: dom.root,
					prev: null,
					next: dom.txt
				}
			}
		},
		dom.txt => {
			data: {
				original: "old text",
				mutated: "new text
			},
			children: {
				mutated: {
					parent: dom.root,
					prev: dom.B,
					next: dom.A
				}
			}
		}
	}
*/
```

Use `mutated` to check if there are any differences and `range` to get the extent of those
differences. Both take a `root` node argument to optionally confine the results, but in this example
it was not needed; if we were tracking multiple disconnected DOM trees (e.g. `Node.getRootNode` is
different), it would be necessary.

The main diff results are given by `diff`. Here we're returning all results, but you can pass a
filter to the method to limit what is returned (for example, excluding the "original" values).
You'll notice several things from this example:
- The original node position (inside `children`) for `B` and `txt` is missing; this is
  because the nodes were originally orphaned, having no parent node.
- `A` does not appear in the diff, since even though it was moved, its relative position with
  respect to `root` was unchanged. **A node is considered "unchanged" when it is next to one of its
  original siblings (ignoring any newly inserted siblings in-between), and that sibling is itself
  unchanged.**
- Full text diffing is not performed for `data` changes. Only string equality is checked. If full
  text diffing is needed, you can perform it as a post-processing step using a separate text diffing 
  library (e.g. [diff-match-patch](https://github.com/google/diff-match-patch))

As a final note about `synchronize`, if you did not call it, any ill affected nodes will have either
a missing `mutated` children value, or the `original` `next`/`prev` siblings may be missing.

For `children`, there is another method, `diff_grouped_children`, which will group adjacent node
movements. In many cases this can be more useful:

```js
const grouped = Array.from(tracker.diff_grouped_children(F.MUTATED));
console.log(grouped);
/* output:
	[{
		nodes: [B, txt],
		parent: root,
		prev: null,
		next: A
	}]
*/
```

To revert the DOM back to its original state, simply call `revert`:

```js
tracker.revert();
console.log(tracker.mutated());
// output: false
```

You can apply the output of `diff_grouped_children`, or a similary formed iterable, to patch a DOM
tree's node positions:

```js
MutationDiff.patch_grouped_children(grouped);
```

While you can't patch an unrelated DOM tree out-of-the-box, you can easily remap the nodes of
`diff_grouped_children` to work on the unrelated tree. See `patch_grouped_children` method
documentation for more details.

### Diffing Caveat #1

The first caveat arises when you have a sequence of sibling nodes that have been rearranged. Consider
the following:

```txt
[A, B, C, D] -> rearranged to -> [B, C, D, A]
```

We could interpret this as a single move of `A` to the back of the list, a movement of `[B, C, D]`
to the front, or a bulk movement of all the nodes. While the first option gives the minimal number
of node movements, this is not necessarily what `MutationDiff` will return.

`MutationDiff` does incremental diffing, meaning that every call to `children` updates the diff.
Each call to `children` is treated like a single, atomic operation: we log all node removals, then
node additions, and then finally perform diffing to check if any of the newly added nodes have
reverted to their original position.

How the rearrangement example above will be interpreted depends on what mutations were reported to
`children`, and in what order. The diff given by `MutationDiff` is thus a *true* representation of
the actual mutations that occurred. If the rearrangement was due to a bulk movement of all nodes
(e.g. via `Node.replaceChildren`), then it will be reflected as such in the diff; currently, there
is no post-processing step to "reinterpret" an operation to minimize the number of node movements.

You could implement the Myers' diff algorithm on top of `MutationDiff` results if minimizing node
movements is necessary, assuming the extra computational cost is worth it.

### Diffing Caveat #2:

The second caveat arises specifically when using `MutationObserver` with multiple disconnected DOM
trees. If only one of the trees is being observed, its possible a node insertion could go untracked.
For example, using the same starting DOM as in the [Quickstart Example](#quickstart-example):

```js
// A is removed, but since B is not currently being observed, its insertion
// into B will go untracked
B.appendChild(A);
// B has been added to root, so it is now being observed
root.appendChild(B);
// txt's previousSibling is A, revealing that A was not removed after all
A.after(txt);
```

Diffing will only work properly if all the node insertions and removals are accurately reported. The
diffing algorithm uses the point-in-time `nextSibling` and `previousSibling` to calculate the diff.

Unfortunately, `MutationObserver` is designed to observe changes to a node's `childList`,
not movements of the node itself. In this particular instance, we miss the insertion of `A`, and
so its siblings are unknown. Since `MutationObserver` is async and batched, we can't look back in
time to see what the siblings were when `A` was inserted.

One solution is to observe `B` from the start, so that the insertion of `A` is sure to be tracked:

```js
observer.observe(B);
```

But in some cases, the fact that `B` will be inserted into `root` at some future time cannot be
known ahead of time.

Since this scenario can arise so easily when using `MutationObserver`, the diffing algorithm
includes code to specifically address this case. When it detects a node whose insertion was not
tracked, it creates a `Promise` object to later perform diffing calculations when the node's
siblings become known. In subsequent calls to `children`, those siblings may be revealed.

In the event the siblings are *not* revealed, a call to `diff` may output undefined for the mutated
or original siblings of a node. This can prevent DOM reversion or patching from working properly.
Importantly, this only affects diffing in the disconnected DOM tree; in our example, `B` could
not be reverted correctly, but `root` would be. For some use cases, you may be fine with this.

To allow correct reversion of the disconnected tree, there is a method `synchronize`, which signals
to `MutationDiff` that all mutations have been reported. `MutationDiff` is then free to consult the
DOM to resolve any unknown siblings or parents by checking their current `previousSibling`,
`nextSibling`, or `parentNode` values. It can then finalize all pending diff calculations and give
a complete diff result.

```
// call this after MutationObserver.takeRecords()
tracker.synchronize();
```

### Diffing Caveat #3

`MutationObserver` does not give you point-in-time *mutated* values for attributes or character
data. Only the old point-in-time value is included in the `MutationRecord`. Unfortunately given the 
async batched nature of `MutationObserver`, this means we need to cache the original values even
when they are unchanged. Calling `synchronize` however will signal to `MutationDiff` that all
mutations have been recorded, and so it will finally be able to discard any unchanged property
values.

```
// call this after MutationObserver.takeRecords()
tracker.synchronize();
```

If you will immediately call `revert` or `clear`, then synchronizing will not help in this case,
as the cached values will be discarded following those methods anyways.





