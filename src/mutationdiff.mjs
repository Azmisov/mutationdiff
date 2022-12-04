import { BoundaryRange, BoundaryFlags as BF } from "node-boundary";
import PropertyMutations from "./PropertyMutations.mjs";
import TreeMutations from "./TreeMutations.mjs";
import SiblingPromise from "./SiblingPromise.mjs";

// better to make these globals for minification
const
	ALL			= 0xFFFF,
	MUTATED		= 0b10000,
	ORIGINAL	= 0b100000,
	PROPERTY	= 0b111,
	DATA		= 0b1,
	ATTRIBUTE	= 0b10,
	CUSTOM		= 0b100,
	CHILDREN	= 0b1000;

/** Bit flags for specifying what diff information you'd like to fetch. For use with
 * {@link MutationDiff#diff}, {@link MutationDiff#diff_grouped_children}, and
 * {@link MutationDiffObserver}. You need to use bitwise operations to combine these flags. For
 * example, to get only the current position for any moved nodes:
 * 
 * ```js
 * MutationDiffFlags.MUTATED | MutationDiffFlags.CHILDREN
 * ```
 * @readonly
 * @enum
 * @alias MutationDiffFlags
 */
const Flags = {
	/** Include all diff information */
	ALL,
	/** Include the mutated (current) values */
	MUTATED,
	/** Include the original values */
	ORIGINAL,
	/** Include attribute, data, and custom property changes. This is a combination of `DATA`,
	 * `ATTRIBUTE`, and `CUSTOM` flags.
	 */
	PROPERTY,
	/** Include data changes, see {@link MutationDiff#data} */
	DATA,
	/** Include attribute changes, see {@link MutationDiff#attribute} */
	ATTRIBUTE,
	/** Include custom property changes, see {@link MutationDiff#custom} */
	CUSTOM,
	/** Include node additions, removals, or position changes, see {@link MutationDiff#children} */
	CHILDREN
};

/** For use with {@link MutationDiff#diff}
 * @callback MutationDiff~customGetCbk
 * @param {Node} node the node whose custom property value we need to fetch
 * @param key the custom property key whose value we want to fetch
 * @returns {*} the custom property's current value
 */

/** For use with {@link MutationDiff#revert}
 * @callback MutationDiff~customSetCbk
 * @param {Node} node the node whose custom property we need to set
 * @param {*} key the custom property key whose value we want to set
 * @param {*} value the value to set
 */

/** The output format returned by {@link MutationDiff#diff}
 * @typedef {Object} MutationDiff~Diff
 * @prop {MutationDiff~DiffProperty} [data] The diff for a `CharacterData`'s text content. Only
 *  present if the {@link MutationDiffFlags.DATA|DATA} flag was included. Will be missing if there
 *  were no data changes.
 * @prop {Object<string, MutationDiff~DiffProperty>} [attribute] A mapping of attribute names to
 *  their diff. Only present if the {@link MutationDiffFlags.ATTRIBUTE|ATTRIBUTE} flag was included.
 *  Will be missing if there were no attribute changes
 * @prop {Map<*,MutationDiff~DiffProperty>} [custom] A mapping of custom properties to their diff.
 *  Only present if the {@link MutationDiffFlags.CUSTOM|CUSTOM} flag was included. Will be missing
 *  if there were no custom property changes
 * @prop {MutationDiff~DiffChildren} [children] The diff for a node addition, removal, or movement.
 *  Only present if the {@link MutationDiffFlags.CHILDREN|CHILDREN} flag was included. Will be
 *  missing if the node's position is the same
 */

/** Gives the diff for a data, attribute, or custom property change; for use inside
 * {@link MutationDiff~Diff}
 * @typedef {Object} MutationDiff~DiffProperty
 * @prop {*} [original] The original value. Only present if the
 * {@link MutationDiffFlags.ORIGINAL|ORIGINAL} flag was included
 * @prop {*} [mutated] The mutated value. Only present if the
 *  {@link MutationDiffFlags.MUTATED|MUTATED} flag was included. Note that mutated values are not
 *  stored internally by {@link MutationDiff}, so the current value will be queried from the DOM (or
 *  using {@link MutationDiff~customGetCbk} for custom properties).
 */

/** Gives the diff for a node addition, removal, or movement; for use inside {@link MutationDiff~Diff}
 * @typedef {Object} MutationDiff~DiffChildren
 * @prop {MutationDiff~DiffPosition} [original] The node's original position. Only present if the
 *  {@link MutationDiffFlags.ORIGINAL|ORIGINAL} flag was included.
 * @prop {MutationDiff~DiffPosition} [mutated] The node's mutated position. Only present if the
 *  {@link MutationDiffFlags.MUTATED|MUTATED} flag was included.
 */

/** Gives a node's position in the DOM; for use inside {@link MutationDiff~DiffChildren} and yielded
 * from {@link MutationDiff#diff_grouped_children|diff_grouped_children}.
 * @typedef {Object} MutationDiff~DiffPosition
 * @prop {?Node} [parent] The node's `parentNode`. If the node was/is not present in the
 *  DOM at this point, the parent property will be missing (e.g. the node was removed or newly
 *  inserted). This will only be null when output from {@link MutationDiff#diff_grouped_children|diff_grouped_children},
 * 	and `include_removed` was set to true; a null parent indicates a removed node.
 * @prop {?Node} [next] The node's `nextSibling`. Will be missing if `parent` is not
 *  given. If `parent` is given, it could be missing if the sibling is unknown, in which case you
 *  should call {@link MutationDiff#synchronize|synchronize} if you want to know the sibling.
 * @prop {?Node} [prev] The node's `previousSibling`. Will be missing if `parent` is
 *  not given. If `parent` is given, it could be missing if the sibling is unknown, in which case
 *  you should call {@link MutationDiff#synchronize|synchronize} if you want to know the sibling.
 * @prop {Node[]} [nodes] An ordered list of adjacent nodes that the position is defined for. The
 *  `prev` and `next` properties, if present, are the siblings of the first and last nodes of the
 *  list respectively. This is only present when yielded from
 *  {@link MutationDiff#diff_grouped_children|diff_grouped_children}
 */

/** Helper object to setup a `MutationObserver` to report mutations to {@link MutationDiff}. This is
 * useful for simple cases where you don't need to reuse the `MutationObserver` for other purposes,
 * or you don't need to do advanced filtering of the mutation records.
 */
class MutationDiffObserver{
	/** Construct a new observer and begin observing
	 * @param {MutationDiff} tracker the MutationDiff object to attach to
	 * @param {Node | Node[]} roots a single or list of root nodes to observe
	 * @param {number} [filter={@link MutationDiffFlags.ALL|ALL}] A bitmask specifying which
	 *  mutations to observe, such as character data, attribute, or child list changes.
	 * @param {string[]} [attributeFilter] An array of specific attribute names to watch. Ignored
	 * 	if the {@link MutationDiffFlags.ATTRIBUTE|ATTRIBUTE} flag is not included in `filter`
	 */
	constructor(tracker, root, filter=ALL, attributeFilter){
		/** The {@link MutationDiff} object that mutations are being reported to
		 * @type {MutationDiff}
		 */
		this.tracker = tracker;
		if (!Array.isArray(root))
			root = [root]
		/** A list of root nodes that are being observed
		 * @type {Node[]}
		 */
		this.root = root;
		/** The internal `MutationObserver` object that is observing {@link MutationDiffObserver#root|root}
		 * @type {MutationObserver}
		 */
		this.observer = new MutationObserver(this.#record.bind(this));
		// build observer options
		const opts = { subtree: true };
		if (filter & DATA)
			opts.characterData = opts.characterDataOldValue = true;
		if (filter & ATTRIBUTE){
			opts.attributes = opts.attributeOldValue = true;
			if (attributeFilter)
				opts.attributeFilter = attributeFilter;
		}
		if (filter & CHILDREN)
			opts.childList = true;
		/** The observer options passed to [MutationObserver.observe()](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe)
		 * @type {Object}
		 */
		this.options = opts;
		// start observer
		this.reattach();
	}
	/** Flush any pending `MutationRecord`s so that {@link MutationDiff} is up-to-date. This is
	 * necessary because `MutationObserver` is async and batched, so the records lag behind the
	 * actual DOM mutations.
	 * @param {boolean} [synchronize=true] Whether to call {@link MutationDiff#synchronize} after
	 * 	flushing the records
	 */
	flush(synchronize=true){
		this.#record(this.observer.takeRecords());
		if (synchronize)
			this.tracker.synchronize();
	}
	/** `MutationObserver` will observe descendants of {@link MutationDiffObserver#root|root}, and
	 * continues observing those descendants even when they are moved to a different part of the DOM
	 * tree ([see explanation on MDN](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe#observation_follows_nodes_when_disconnected)).
	 * This method will reattach the `MutationObserver` so that it is only observing the current
	 * descendants of {@link MutationDiffObserver#root|root}.
	 */
	reattach(){
		this.stop();
		for (const root of this.root)
			this.observer.observe(root, this.options);
	}
	/** Stop the observer. You can call {@link MutationDiffObserver#reattach|reattach}
	 * to start observing again. Make sure to call `stop` when you are done, otherwise the object
	 * will not get garbage collected!
	 */
	stop(){ this.observer.disconnect(); }
	/** Report MutationRecord's to the MutationDiff */
	#record(records){
		for (const r of records)
			this.tracker.record(r);
	}
}

/** Tracks mutations performed on the DOM, giving you the delta between original and mutated DOM,
 * allowing DOM to be reverted to its initial state, or a range to be queried with the extent of
 * DOM mutations. The interface is designed to take input from `MutationObserver`, but this is up to
 * the user.
 *
 * Tracking is optimal, in that we only store the delta between the original and current
 * DOM. Reverting the DOM can be done directly, without needing to rewind a log of all
 * mutations. Additionally, mutation range queries give exact bounds, and can detect
 * when mutations cancel out.
 */
class MutationDiff{
	/** Construct a new `MutationDiff` object */
	constructor(){
		/** Private structure for holding raw attribute, character, or custom property changes. For
		 * performance reasons you may access this, but backwards compatibility is not guaranteed. See
		 * the source code for usage.
		 * @type {Map<Node, PropertyMutations>}
		 */
		this.props = new Map();
		/** Private structure for holding raw node additions, deletions, or movements. For
		 * performance reasons you may access this, but backwards compatibility is not guaranteed.
		 * See the source code for usage.
		 * @type {TreeMutations}
		 */
		this.tree = new TreeMutations();
	}

	/** Add the changes indicated by a `MutationRecord`. Note for `attributes` and `characterData`
	 * records, you need to include the old value for diffing to function correctly.
	 * @param {MutationRecord} r the record to add
	 */
	record(r){
		switch (r.type){
			case "attributes":
				let name = r.attributeName;
				if (r.attributeNamespace)
					name = r.attributeNamespace+':'+name;
				this.attribute(r.target, name, r.oldValue);
				break;
			case "characterData":
				this.data(r.target, r.oldValue);
				break;
			case "childList":
				this.children(r.target, r.removedNodes, r.addedNodes, r.previousSibling, r.nextSibling);
				break;
		}
	}

	/** Indicate nodes were added or removed as children of some parent node
	 * @param {Node} parent point-in-time `parentNode` where removal/insertion occurred
	 * @param {Node[]} removed an ordered list of nodes that were removed
	 * @param {Node[]} added an ordered list of nodes that were added
	 * @param {?Node} prev point-in-time `previousSibling` of the removed/added nodes
	 * @param {?Node} next point-in-time `nextSibling` of the removed/added nodes
	 */
	children(parent, removed, added, prev, next){
		this.tree.mutation(parent, removed, added, prev, next);
	}

	/** Shared method for tracking attribute and data changes
	 * @private
	 */
	#prop(node, mode, key, value, old_value){
		let props = this.props.get(node);
		if (!props){
			props = new PropertyMutations();
			this.props.set(node, props);
		}
		props.mark(mode, key, value, old_value)
	}
	/** Indicate HTML attribute changed. Note this uses the current `node.getAttribute()`
	 * 	value for detecting when the attribute is modified.
	 * @param {Node} node node whose attribute changed
	 * @param {string} key namespace qualified attribute name, e.g. "namespace:name"; the namespace
	 * 	can be ommitted if not needed
	 * @param {string} old_value previous value of this attribute; when attribute is first seen,
	 *  this is stored as the *original value*, and used to detect when the attribute reverts
	 */
	attribute(node, key, old_value){
		return this.#prop(node, "native", key, node.getAttribute(key), old_value);
	}
	/** Indicate data change for a `CharacterData` node (e.g. text content has changed). Note this
	 *  uses the current `node.data` value for detecting when the text is modified.
	 * @param {Node} node node whose data (text content) changed
	 * @param {string} old_value previous text content; when this node's text is first seen, this is
	 * 	stored as the *original value*, and used to detect when the text reverts
	 */
	data(node, old_value){
		// we use null as the key for data
		return this.#prop(node, "native", null, node.data, old_value);
	}
	/** Indicate some custom property for the node has changed. A custom property is any user
	 *  defined value derived from, or associated with a node. Custom properties are not
	 *  automatically reverted; you must provide a callback to revert them yourself, see
	 *  {@link MutationDiff#revert|revert}
	 * @param {Node} node node whose property changed
	 * @param {*} key any `Map` compatible key
	 * @param {*} value current value for this property; this can be the value several mutations
	 * 	after `old_value` was read, as would be the case for `MutationRecord`
	 * @param {*} old_value previous value of this property; when property is first seen, this is
	 * 	stored as the *original value*, and used to detect when the property reverts
	 */
	custom(node, key, value, old_value){
		return this.#prop(node, "custom", key, value, old_value);
	}

	/** Check if the DOM is mutated. If the DOM was changed, but the changes put the DOM back in its
	 * original state, the DOM is *not* mutated.
	 * @param {Node} [root] If provided, only mutations that are inside `root` are considered;
	 *  this is useful when using `MutationObserver`, which in certain situations can track
	 *  mutations outside of its root node
	 * @returns {boolean} true if DOM is different from how it started
	 */
	mutated(root){
		if (root){
			for (const [node,props] of this.props){
				// if node was moved out of root, then we'll catch that later in the tree mutations
				if (props.dirty && root.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_CONTAINED_BY)
					return true;
			}
			for (const op of this.tree.mutations()){
				// we can just check parent here; parent == root is okay;
				// if root has been affected, at least one parent out of all mutations will still be contained in root
				if (op.original && root.contains(op.original.parent) || op.node.parentNode && root.contains(op.node.parentNode))
					return true;
			}
			return false;
		}
		if (this.tree.size)
			return true;
		for (let props of this.props.values())
			if (props.dirty)
				return true;
		return false;
	}

	/** Get a `BoundaryRange` indicating bounds of the mutated parts of the DOM. You must call this
	 * prior to {@link MutationDiff#revert|revert}, since reverting resets diff tracking. The range
	 * returned is a `BoundaryRange`, utilizing the [node-boundary](https://www.npmjs.com/package/node-boundary)
	 * package. A `BoundaryRange` is similar to a builtin `Range`, but uses a different internal
	 * representation that makes it robust to mutations. The range can still be used if the DOM
	 * is reverted, or additional changes occur within the range.
	 * @param {Node} [root] If provided, only mutations that are inside `root` are considered;
	 *  this is useful when using `MutationObserver`, which in certain situations can track
	 *  mutations outside of its root node
	 * @returns {?BoundaryRange} Returns null if the DOM is not mutated (see
	 *  {@link MutationDiff#mutated|mutated}). The range can be collapsed, which indicates nodes have
	 *  been removed at that position. The range is exclusive normalized so that the range bounds
	 *  are not affected by any mutations inside the range (see `BoundaryRange.normalize` documentation).
	 * @throws If a `root` is not specified and mutations affect disconnected DOM trees, there would
	 *  be multiple disconnected ranges for the mutations; an error is thrown in this case.
	 * 
	 *  Node movements to an "orphaned" DOM are not included in the range, so will not generate this
	 *  error; examples being a node that is newly added (no prior DOM), or a node is removed (no
	 *  current DOM). In the case of an error, specify `root` parameter, which could simply be the
	 *  `document` of interest.
	 */
	range(root){
		let fr = new BoundaryRange(), // full range of all mutations
			sr = new BoundaryRange(); // range for single mutation
		/** Include node that is inside root */
		const include = (node) => {
			return !root || root.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_CONTAINED_BY;
		};
		for (const [node,props] of this.props){
			if (props.dirty && include(node)){
				sr.selectNode(node, true);
				fr.extend(sr);
			}
		}
		const fixed_sibling = (s) => {
			return s !== undefined && !(s instanceof SiblingPromise) && (s === null || !this.tree.has(s));
		};
		for (let op of this.tree.mutations()){
			// current position
			if (op.node.parentNode && !this.props.get(op.node)?.dirty && include(op.node)){
				sr.selectNode(op.node, true);
				fr.extend(sr);
			}
			/* Original position: Only care about fixed nodes when marking the original bounds.
				If prev/next bounds have been moved, then the bounds get extended to *their* siblings,
				so we delegate the bound extension to those siblings instead. Eventually, a fixed
				node will be found that is a candidate.
			*/
			if (!op.original)
				continue;
			op = op.original;
			const p = op.parent;
			if (p){
				const prev_fixed = fixed_sibling(op.prev);
				const next_fixed = fixed_sibling(op.next);
				if (!prev_fixed && !next_fixed)
					continue;
				// parent == root okay in this case
				if (root && !root.contains(p))
					continue;
				// if we only have one side, we collapse; the other side will be handled later by another node
				if (prev_fixed)
					sr.setStart(op.prev || p, op.prev ? BF.AFTER_CLOSE : BF.AFTER_OPEN);
				if (next_fixed){
					sr.setEnd(op.next || p, op.next ? BF.BEFORE_OPEN : BF.BEFORE_CLOSE);
					if (!prev_fixed)
						sr.collapse(false);
				}
				else sr.collapse(true);
				fr.extend(sr);
			}
		}
		if (fr.isNull())
			return null;
		fr.normalize();
		return fr;
	}

	/** Get the current diff. Mutated properties are not cached, so requesting {@link MutationDiffFlags.MUTATED|MUTATED}
	 * will mean the DOM will be queried for the current value. Additionally, you may consider using
	 * {@link MutationDiff#diff_grouped_children|diff_grouped_children} instead for the
	 * {@link MutationDiffFlags.CHILDREN|CHILDREN} diff, as that may be more useful for downstream tasks.
	 * @param {number} [filter={@link MutationDiffFlags.ALL|ALL}] A bitmask for which differences to
	 *  return, as given by {@link MutationDiffFlags}
	 * @param {MutationDiff~customGetCbk} [custom_get] A callback to fetch the mutated value for custom properties. Only
	 *  used when `filter` contains {@link MutationDiffFlags.MUTATED|MUTATED} and
	 *  {@link MutationDiffFlags.CUSTOM|CUSTOM} flags. If not provided, their mutated value will not be set.
	 * @returns {Map<Node, MutationDiff~Diff>} A Map giving the changes for each node. The output
	 *  may be freely modified, as it is a copied view. For performance, you may consider accessing
	 *  the raw internal mutation data instead, but backward compatibility is not guaranteed.
	 */
	diff(filter=ALL, custom_get){
		/* We could mirror this format for the internal structure, possibly as its own class with
			access methods and all. The advantage being we could just return it mostly in its raw
			form with minimal reformatting. The problem though is JavaScript doesn't let you specify
			friend classes, so user would have full access to modify and possibly corrupt the
			internal state. Seems like you'd need to clone no matter what, so this would be as good
			as any
		*/
		const out = new Map();
		const FORIGINAL = filter & ORIGINAL;
		const FMUTATED = filter & MUTATED;
		if (FORIGINAL || FMUTATED){
			// diffs from PropertyMutations
			if (filter & PROPERTY){
				for (const [node, cache] of this.props){
					if (!cache.dirty)
						continue;
					let has_diff = false;
					const log = {};
					// data
					if (filter & DATA){
						const op = cache.native.get(null);
						if (op && op.dirty){
							has_diff = true;
							const d = log.data = {};
							if (FORIGINAL)
								d.original = op.value;
							if (FMUTATED)
								d.mutated = node.data;
						}
					}
					// attributes
					if (filter & ATTRIBUTE){
						let has_attrs = false;
						const attrs = {};
						for (const [key, op] of cache.native){
							if (!op.dirty || key === null)
								continue;
							has_attrs = true;
							const d = attrs[key] = {};
							if (FORIGINAL)
								d.original = op.value;
							if (FMUTATED)
								d.mutated = node.getAttribute(key);
						}
						if (has_attrs){
							log.attribute = attrs;
							has_diff = true;
						}
					}
					// custom properties
					if (filter & CUSTOM){
						const custom = new Map();
						for (const [key, op] of cache.custom){
							if (!op.dirty)
								continue;
							const d = {};
							custom.set(key, d);
							if (FORIGINAL)
								d.original = op.value;
							if (FMUTATED && custom_get)
								d.mutated = custom_get(node, key);
						}
						if (custom.size){
							log.custom = custom;
							has_diff = true;
						}
					}
					if (has_diff)
						out.set(node, log);
				}
			}
			// diffs from TreeMutations
			if (filter & CHILDREN){
				const copy_obj = (o) => {
					if (!o) return;
					const oc = {parent: o.parent};
					if (!(o.prev === undefined || o.prev instanceof SiblingPromise))
						oc.prev = o.prev;
					if (!(o.next === undefined || o.next instanceof SiblingPromise))
						oc.next = o.next;
					return oc;
				};
				for (const op of this.tree.mutations()){
					const node = op.node;
					let log = out.get(node);
					if (!log){
						log = {};
						out.set(node, log);
					}
					const d = log.children = {};
					let v;
					if (FORIGINAL && (v = copy_obj(op.original)))
						d.original = v;
					if (FMUTATED && (v = copy_obj(op.mutated)))
						d.mutated = v;
				}
			}
		}
		return out;
	}

	/** Generator which yields groups of **adjacent** nodes whose DOM position was altered. When
	 * patching a DOM and rearranging the nodes to new positions, it is necessary to link adjacent
	 * nodes first. The reason is that DOM insertions require a reference sibling, e.g.
	 * `Node.insertBefore()`. If a reference sibling has not been patched first, a node could be
	 * moved to the incorrect position.
	 * 
	 * You can fetch groups of nodes for either the original or mutated DOM tree. The groups will
	 * not necessarily be the same.
	 * 
	 * This is implemented as a generator in case you want to process groups as they come and reduce
	 * memory usage. You can loop over the return value like any other iterable. If you'd like to
	 * get an array instead, simply use:
	 * ```js
	 * Array.from(diff.diff_grouped_children())
	 * ```
	 * 
	 * See {@link MutationDiff.patch_grouped_children} for using the result to patch a (possibly
	 * different) DOM.
	 * @param {MutationDiffFlags.ORIGINAL | MutationDiffFlags.MUTATED} [mode={@link MutationDiffFlags.ORIGINAL|ORIGINAL}]
	 * 	whether to group nodes' by their original or mutated positions
	 * @param {boolean} [include_removed=true] setting this to true will include an additional group
	 *  for "removed" nodes: nodes that are not present in the original/mutated DOM
	 * @yields {MutationDiff~DiffPosition}
	 */
	*diff_grouped_children(mode=ORIGINAL, include_removed=true){
		if (mode & ORIGINAL)
			mode = "original";
		else if (mode & MUTATED)
			mode = "mutated";
		else return;

		const skip = new Set();
		// walk through prev/next and link up any ones that are floating as well
		const link_siblings = (group, op, dir, arrfn) => {
			arrfn = group.nodes[arrfn].bind(group.nodes);
			let bop = op;
			while (true){
				const link = bop[dir];
				if (link === undefined || link instanceof SiblingPromise)
					return;
				if (link === null || !(bop = this.tree.get(link))){
					// inherit the linked ops prev/next
					group[dir] = link;
					break;
				}
				bop = bop[mode];
				// we'll take over handling the node
				skip.add(link)
				arrfn(link);
			}
		};
		const removed = [];
		for (let op of this.tree.mutations()){
			const node = op.node;
			// this node already grouped
			if (skip.has(node)){
				skip.delete(node);
				continue;
			}
			op = op[mode];
			// removed nodes
			if (!op){
				if (include_removed)
					removed.push(node);
				continue;
			}
			const group = {nodes: [node], parent: op.parent};
			link_siblings(group, op, "prev", "unshift");
			link_siblings(group, op, "next", "push");
			yield group;
		}
		if (removed.length)
			yield {nodes: removed, parent: null};
	}

	/** Moves groups of nodes inside the current DOM to new positions. You can use this to revert nodes' DOM positions,
	 * or apply mutated positions to an unchanged DOM. Out-of-the-box this does not support patching an unrelated DOM
	 * tree. However, this could be done easily by mapping nodes from one tree to another:
	 * ```js
	 * *function remapped_diff(){
	 * 	for (const group of diff.diff_grouped_children()){
	 * 		group.nodes = group.nodes.map(remap_fn)
	 * 		yield group;
	 * 	}
	 * }
	 * diff.patch_grouped_children(remapped_diff());
	 * ```
	 * The `remap_fn` might consult a `Map<Node,Node>` or fetch a unique identifier for the node that we can find a
	 * correspondence to in the other DOM.
	 * @param {Iterable<MutationDiff~DiffPosition>} groups This can be any iterable, such as an array or generator. The
	 * `nodes` property must be set, so the output of {@link MutationDiff#diff|diff} will not work; you can use the
	 * output of {@link MutationDiff#diff_grouped_children|diff_grouped_children}.
	 */
	static patch_grouped_children(groups){
		/* Order of node movements can matter:
			1. If a node will be inserted next to a sibling, but that sibling is floating, the sibling
				needs to be resolved first. We can easily handle this by linking up nodes by their
				prev/next siblings and inserting them as a group.
			2. The order we process parents matters when an ancestor has become a descendant of its
				descendant. In this case you'll get an error, "new child is an ancestor of the parent"
				Determining the ordering of parents is complex, since we need to check descendants/ancestors
				both in the current position, and possibly in the new position. I cannot think of an efficient
				algorithm to do it currently. An alternative is simply to remove those descendants first
				(which is feasible, albeit with non-negligble overhead), thus severing the problematic ancestor
				connection. An even simpler alternative is just to remove all floating nodes. Every node
				insertion requires a removal first, so this is what the browser is going to do anyways. The only
				reason to try to discover the parent ordering is to optimize a remove+append into a single
				append. Given the complexity of computing the parent ordering, the overhead for that does
				not seem worth it; even determining *which* parents should be removed is costly. So we'll just
				remove all nodes to make parent ordering irrelevant.

				It could actually save time as well, since it reduces the amount of hierarchy checks the browser
				has to do on its end.
		*/
		const add = []; // [{group, next: bool}]
		for (const g of groups){
			for (const n of g.nodes)
				n.remove();
			if (g.parent){
				// sibling may be undefined for untracked adds; we'll just skip those nodes
				const next_set = g.next !== undefined;
				if (!next_set){
					if (g.prev === undefined){
						console.warn("MutationDiff: siblings unknown, can't patch")
						throw Error("assertion error");
						continue;
					}
				}
				add.push({group: g, next: next_set});
			}
		}
		/* If nodes are already inside the correct parent, you could reduce the number of moves. E.g. [BCA],
			assuming all have moved, can be optimized to a single movement of A, rather than setting child
			list to [ABC]. Another might be combining two inserts into one by reinserting any nodes between,
			e.g. [AB],CD,[EF] -> [ABCDEF]. However, I think detecting this kind of optimization will end up
			being more computation than just moving all the children. So we won't optimize node ops any further.
		*/
		// perform node movements
		for (const op of add){
			const g = op.group;
			if (op.next){
				if (g.next)
					g.next.before(...g.nodes);
				else g.parent.append(...g.nodes);
			}
			else{
				if (g.prev)
					g.prev.after(...g.nodes);
				else g.parent.prepend(...g.nodes);
			}
		}
	}

	/** Revert the DOM to its original state. This also produces the effects of {@link MutationDiff#clear|clear}. As
	 * noted in {@link MutationDiff#clear|clear} you may wish to reattach a corresponding `MutationObserver`.
	 * @param {MutationDiff~customSetCbk} [custom_set] A callback to set the mutated value for
	 *  custom properties. This is used for any properties modified from
	 *  {@link MutationDiff#custom|custom}. If not provided, these properties are not reverted.
	 */
	revert(custom_set){
		// TODO: `root` option? might be possible if parents are ordered by rootNode or something
		// revert properties
		for (const [node,props] of this.props)
			props.revert(node, custom_set);
		this.props.clear();

		// This can be a little more efficient if the methods were inlined, as I used to have it;
		// but for the sake of less code duplication and simpler maintenance, we'll just use these
		MutationDiff.patch_grouped_children(this.diff_grouped_children(ORIGINAL, true));
		this.tree.clear();
	}

	/** Clear the internal log of mutations, effectively "committing" the current DOM. You may also
	 * wish to reattach a corresponding `MutationObserver`, as it can track DOM nodes outside root.
	 * After clearing/reverting, these disconnected trees do not matter anymore. See the MDN documetation for 
	 * [MutationObserver.observe()](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe)
	 * for details.
	 */
	clear(){
		this.props.clear();
		this.tree.clear();
	}

	/** For memory optimization: Returns a value indicating the size of internal storage for
	 * tracking the mutations. You could use this to trigger periodic reversion/clearing or
	 * other mutation processing to keep memory lower.
	 * @type {number}
	 */
	get storage_size(){
		return this.props.size + this.tree.size;
	}

	/** Signals that all mutations have been recorded and the view of the DOM given to
	 * `MutationDiff` is up-to-date with the current DOM. This would be the case after
	 * [MutationObserver.takeRecords()](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/takeRecords)
	 * has been called, for example. This allows us to release some cached information about
	 * data/attributes/properties. This also can resolves untracked add mutations, which allows DOM
	 * trees disconnected from the root to be reverted correctly.
	 */
	synchronize(){
		for (let [node,props] of this.props){
			if (!props.synchronize())
				this.props.delete(node);
		}
		this.tree.synchronize();
	}
}

const Flags_readonly = Object.freeze(Flags);
export {Flags_readonly as MutationDiffFlags, MutationDiff, MutationDiffObserver};