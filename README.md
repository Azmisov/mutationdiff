# mutationdiff

This package provides a `MutationDiff` object which can be used to do incremental DOM diffing on a
real DOM tree. In addition to getting the diff, you can also patch a DOM given a list of
differences, revert the DOM to its original state, or query the range where mutations occurred. The
diffing is designed to take async, batched mutation records from `MutationObserver` as input for
diff calculations; you can also provide these mutation records in another manner.

How does this differ from *virtual DOM diffing* or other plain DOM diffing libraries?
- it gives the diff of a DOM tree at two points in time, rather than the delta between two different
  DOM trees
- it doesn't use a virtual DOM, only operating on a live DOM tree
- it is computationally efficient since it only does calculations on mutated nodes (as
  reported by `MutationObserver` or other method)
- it is memory efficient since it doesn't need to copy the DOM tree to diff against; only the
  diff itself needs to be stored in memory

Originally, this library was written to revert browser-made edits to a `contenteditable`
element; this would allow the edits to be performed from JavaScript in a predictable, crossbrowser
manner. A naive approach to reversion would be to rewind a log of `MutationRecord`, as suggested
in the [MDN documentation](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe#usage_notes).
Performing DOM diffing is more work than simply keeping a log, but in exchange we get exact bounds
for the range of mutations, memory usage is optimal, and reversion can directly place nodes back in
their origianl positions; it will have better worst-case behavior.

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
import { MutationDiff, MutationDiffFlags as F} from "mutationdiff";
```

If not using a bundler, you'll need to provide a path to the actual source file, e.g.
`./node_modules/mutationdiff/mutationdiff.mjs`.

### Quickstart Example

To get started using `MutationDiff`, consider the following DOM nodes as an example:

```js
// DOM: <div><span></span></div>, <span id=B></span>, #old text
const root = document.createElement("div");
const A = document.createElement("span");
root.appendChild(A);
const B = document.createElement("span");
B.id = "B";
const B_child_count = B.childNodes.length;
const txt = document.createTextNode("old text");
```

We report any mutations of interest to `MutationDiff` by calling `data`, `attribute`, `custom`, or
`children` methods. Using a `MutationObserver` is the easiest way to report mutations, but you can
also call the individual methods yourself if you happen to have some controller logic that all DOM
modifications go through. There is a `record` method specifically for `MutationRecord` which can
call these other methods for you. A convenience method `watch` can be used to initialize a
`MutationObserver`.

```js
const tracker = new MutationDiff();
const observer = tracker.watch(root);
```

Here we just watch a single node, `root`, but in practice you can watch any number of separate DOM
trees using a single `MutationDiff`. We'll observe all DOM changes, but you could specify a filter
to ignore attributes or character data changes, for example.

Now the DOM is mutated:

```js
// Mutated DOM: <div><span id=B_modified></span>#new text<span></span></div>
root.appendChild(B);
root.appendChild(txt);
A.remove();
B.id = "B_modified";
txt.after(A);
txt.data = "new text";
```

Custom, user defined properties can be tracked as well, but they'll need to be recorded manually:

```js
tracker.custom(B, "child_count", B.childNodes.length, B_child_count);
```

`MutationObserver` is async and batched, so we need to flush any remaining records to `MutationDiff`
before reading the diff results:

```js
const records = observer.takeRecords();
// optionally disconnect if we don't want to observe root anymore
observer.disconnect();
for (const r of records)
	tracker.record(r);
// signals to MutationDiff that all mutations have been recorded
tracker.synchronize();
```

Note the call to `synchronize` is optional in many cases. An explanation of what `synchronize` does
is described in the [Diffing Caveat #2](#diffing-caveat-2) and [Diffing Caveat #3](#diffing-caveat-3)
sections.

Now we can read the diffing results:

```js
console.log(tracker.mutated());
// output: true
console.log(tracker.range());
// output: BoundaryRange[(root, AFTER_OPEN), (A, BEFORE_OPEN)]
console.log(tracker.diff());
/* output:
	Map {
		B => {
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
					parent: root,
					prev: null,
					next: txt
				}
			}
		},
		txt => {
			data: {
				original: "old text",
				mutated: "new text
			},
			children: {
				mutated: {
					parent: root,
					prev: B,
					next: A
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
  respect to `root` was unchanged.
- Full text diffing is not performed for `data` changes. Only string equality is checked. If full
  text diffing is needed, you can perform it as a post-processing step using a separate text diffing 
  library (e.g. [diff-match-patch](https://github.com/google/diff-match-patch))

See the API documentation for full details on the diff output format.

For `children`, there is another method, `diff_grouped_children`, which will group adjacent children.
In many cases this can be more useful:

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
console.log(tracker.mutated);
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

`MutationDiff` does incremental diffing, meaning that every call to `children` updates the diff. A
node is considered unchanged when it is adjacent to one of its correct siblings, and that sibling is
itself unchanged. When searching for an adjacent sibling, nodes that belong to a different parent
are ignored. Each call to `children` is treated like a single, atomic operation: we log all node
removals, then node additions, and then finally perform diffing to check if any of the newly added
nodes have reverted to their original position.

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





