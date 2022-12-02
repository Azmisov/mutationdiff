import { BoundaryRange, BoundaryFlags as BF } from "node-boundary";

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
 * {@link MutationDiff#watch}. You need to use bitwise operations to combine these flags. For
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
		 * @type {Map<Node, PropertyCache>}
		 */
		this.props = new Map();
		/** Private structure for holding raw node additions, deletions, or movements. For
		 * performance reasons you may access this, but backwards compatibility is not guaranteed.
		 * See the source code for usage.
		 * @type {TreeMutations}
		 */
		this.tree = new TreeMutations();
	}

	/** Create and initialize a `MutationObserver` to record changes for this `MutationDiff` object.
	 * The `MutationObserver` callback will forward its records to {@link MutationDiff#record|record}.
	 * @param {Node} root The root node to observe
	 * @param {number} [filter={@link MutationDiffFlags.ALL|ALL}] A bitmask specifying which
	 *  mutations to observe, such as character data, attribute, or child list changes.
	 * @param {string[]} [attributeFilter] An array of specific attribute names to watch. Ignored
	 * 	if the {@link MutationDiffFlags.ATTRIBUTE|ATTRIBUTE} flag is not included in `filter`
	 * @returns {MutationObserver}
	 */
	watch(root, filter=ALL, attributeFilter){
		const cbk = this.record.bind(this);
		const mo = new MutationObserver(rlst => rlst.forEach(cbk));
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
		mo.observe(root, opts);
		return mo;
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
			props = new PropertyCache();
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
			// diffs from PropertyCache
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

/* Holds a record of mutations for attributes, character data, or custom properties.
 * 
 * With MutationRecord, we only get the oldValue, and need to fetch current value from
 * getAttribute/data get. The lack of point-in-time value means we cannot know if the value is
 * reverted at that point-in-time. We only are aware of a reversion *after the fact* (e.g. a new
 * MutationRecord.oldValue matches what we had cached). So unfortunately this means we'll need to
 * cache oldValue in perpetuity, even when the property is reverted.
 * 
 * You can use synchronize method to remove all reverted properties, but this should only be done if you
 * are sure all MutationRecords have been accounted for already, and the PropertyCache has an
 * accurate view of the current DOM (e.g. when MutationObserver.takeRecords() is called).
 */
class PropertyCache{
	constructor(){
		/* Each in the form: key => {value, dirty}, where dirty indicates if the value
			is different than current and needs to be reverted. Native is for attributes
			and data, with a null key indicating data. Custom is for custom user defined
			properties.
		*/
		this.native = new Map();
		this.custom = new Map();
		// number of clean/dirty properties
		this._clean = 0;
		this._dirty = 0;
	}
	// Total size of the cache
	get size(){ return this.native.size + this.custom.size; }
	// Number of dirty properties
	get dirty(){ return this._dirty; }
	// Number of clean properties
	get clean(){ return this._clean; }
	/** Mark a property for the cache
	 * @param mode "native" for attribute/data, or "custom" for custom properties
	 * @param key the attribute name, null for data, or the custom property key
	 * @param value current value, which may be several mutations ahead of old_value
	 * @param old_value previous point-in-time value
	 */
	mark(mode, key, value, old_value){
		const m = this[mode];
		const props = m.get(key);
		// unseen property
		if (!props){
			const dirty = value !== old_value;
			m.set(key, {value: old_value, dirty});
			if (dirty)
				this._dirty++;
			else this._clean++;
		}
		// previously cached; just update dirty flag
		else{
			const dirty = value !== props.value;
			if (dirty != props.dirty){
				props.dirty = dirty;
				const change = dirty ? 1 : -1;
				this._dirty += change;
				this._clean -= change;
			}
		}
	}
	/** Reset all dirty properties for a node
	 * @param node the node to revert properties for
	 * @param custom_set fn(node, key, value) callback, which can revert custom user properties
	 */
	revert(node, custom_set){
		for (const [attr,o] of this.native){
			if (!o.dirty)
				continue;
			if (attr === null)
				node.data = o.value;
			else if (o.value === null)
				node.removeAttribute(attr);
			else node.setAttribute(attr, o.value);
		}
		if (custom_set){
			for (const [key,o] of props.custom){
				if (o.dirty)
					custom_set(node, key, o.value);
			}
		}
	}
	/** Removes clean properties from the cache, returning a count of dirty properties left */
	synchronize(){
		for (const [attr,o] of this.native)
			if (!o.dirty)
				this.native.delete(attr);
		for (const [key,o] of this.custom)
			if (!o.dirty)
				this.custom.delete(key);
		this._clean = 0;
		this._dirty = this.size;
		return this._dirty;
	}
}

/** Container to encapsulate mutations to the DOM tree (node adds/removes)
 * @private
 */
class TreeMutations{
	constructor(){
		/** floating index of nodes that have been modified
		 * @type {Map<Node, MutatedNode>}
		 */
		this.floating = new Map();
		/** original indexes the graph of MutatedNode original siblings
		 * @type {SiblingIndex}
		 */
		this.original = new SiblingIndex("original");
		/** original indexes the graph of MutatedNode mutated siblings
		 * @type {SiblingIndex}
		 */
		this.mutated = new SiblingIndex("mutated");
	}

	/** Remove all mutations */
	clear(){
		this.floating.clear();
		this.original.clear();
		this.mutated.clear();
	}

	/** Storage size for mutations */
	get size(){ return this.floating.size; }
	/** Check if node position has been modified */
	has(node){ return this.floating.has(node); }
	/** Get mutations for a node */
	get(node){ return this.floating.get(node); }
	/** Iterate mutated nodes */
	nodes(){ return this.floating.keys(); }
	/** Iterate mutations */
	mutations(){ return this.floating.values(); }

	/** Add a mutation to the tree
	 * @param {Node} parent parent node where removal/insertion occurred
	 * @param {Node[]} removed an ordered list of nodes that were removed
	 * @param {Node[]} added an ordered list of nodes that were added
	 * @param {?Node} prev point-in-time previousSibling of the removed/added nodes
	 * @param {?Node} next point-in-time nextSibling of the removed/added nodes
	 */
	mutation(parent, removed, added, prev, next){
		/* TODO: Technically the removes and adds can happen in any order, and an added node
			can be inserted next to any of the removed nodes. So long as final added ordering
			remains the same, it is fine. The only side case is when a node needs to be removed
			and then readded. I'm wondering if there might be some assumptions you could make
			to maximize the number of fixed nodes. Right now the fixedness check assumes all
			removed nodes are removed first, then after all the adds; so its only propagating
			fixedness from the ends. We'd only be maximizing for the current view though (greedy),
			and my guess is you can craft arbitrary scenarios where subsequent mutations mean
			the end result fixed node count is not maximized.

			Also wondering if it is "proper" to optimize it like that. Treating it like a pure
			batch insert could mean you don't assume a particular insertion order; you can only
			infer things about the ending state.
		*/

		// MutatedNode for prev/next; undefined if it doesn't exist
		let prev_mn, next_mn;

		/* An operation may mean one or more nodes have returned to their original position, e.g.
			they have transitioned from floating to fixed. The "reverted" nodes may be beyond
			prev/next, even if no nodes could be reverted inside that range. Some cases that require
			checking for reverted nodes:
			1. A node was removed that belonged to parent; the node may have been in-between a node
			  and its original sibling; this could occur even if the removed node was previously
			  fixed itself, e.g. B[A][C], with A/C fixed, removing A makes B fixed.
			2. Unknown siblings become known:
				[fixed, prev, unknown sibling, next, floating (but should be fixed)]
			  The floating node could not finish its revert check since the unknown sibling prevented
			  us from linking it with the fixed node. Necessarily in this case, floating will be the
			  next floating node belonging to parent.
			3. A node was added that belonged to parent; the added node could become fixed
			4. A node that is inside its original parent, and its original sibling was a
			  SiblingPromise (unknown) that was just resolved. An example:
			  	[origin, prev, SiblingPromise->, next, floating, fixed original]
			  As in this example, the resolved node may be outside the prev/next range, meaning it
			  may not get caught in the prev/next revert check.

			For first two, fixedness can be propagated from the nearest floating node beyond
			prev/next. The third case we can propagate from the prev/next range. The fourth case,
			we'd need to propagate from each promise origin individually.
		*/
		// if removal/resolve allows continuation of a revert calculation (case #1)
		let revert_possible = false;
		// siblings became known (case #2)
		let siblings_known = false;
		// MutatedNode's between prev/next that may have returned to their original position (case #3)
		const candidates = [];
		// resolved promise (case #4); {MutatedNode => 0b00 bit flag for reversion, see below}
		const resolved = new Map();

		/* The current DOM state has been revealed between prev and next, so we can resolve
			any SiblingPromise's that are inside that range. We'll remove any inner nodes at
			the same time. Even if there added/removed are empty, we can still resolve promises
			for prev/next (indicated by `revert_possible` flag)
		*/
		// last seen fixed node and mutated.next SiblingPromise
		let last_fixed, last_promise;
		/** Resolve SiblingPromises between prev and next; stateful, using last_fixed, last_promise,
		 * 	and prev_mn; call this for each node in the prev/next sequence in order
		 * @param {Node | null} node
		 * @param {Boolean} handle_prev node's prev sibling can be resolved
		 * @param {Boolean} handle_next node's next sibling can be resolved
		 * @returns {MutatedNode | undefined} associated MutatedNode for `node` if one exists
		 */
		const handle_promises = (node, handle_prev, handle_next) => {
			let mn;
			if (node && (mn = this.floating.get(node))){
				const m = mn.mutated;
				// case: remove + untracked add + remove;
				// mark any sibling promises that need to be resolved
				if (handle_prev){
					if (m){
						if (m.prev === undefined)
							siblings_known = true;
						else if (m.prev instanceof SiblingPromise){
							// joint resolve: promise -> <- promise
							if (last_promise){
								last_promise.resolve(m.prev.origin, resolved);
								m.prev.resolve(last_promise.origin, resolved);
								resolved.set(last_promise.mn, 0);
								resolved.set(m.prev.mn, 0);
								last_promise = null;
							}
							// resolve: fixed node <- promise
							else if (last_fixed !== undefined){
								m.prev.resolve(last_fixed, resolved);
								resolved.set(m.prev.mn, 0);
							}
							// resume: floating node <- first promise;
							// only occurs with the first promise we see, so promise continues with prev_mn
							else if (m.prev.resume(prev_mn))
								resolved.set(m.prev.mn, 0);
						}
					}
				}
				if (handle_next){
					if (m){
						if (m.next === undefined)
							siblings_known = true;
						else if (m.next instanceof SiblingPromise)
							last_promise = m.next;
					}
				}
				// resume: last promise -> floating node
				// only occurs with the last promise we see (next_mn will be set to mn after we return)
				else if (last_promise){
					if (last_promise.resume(mn))
						resolved.set(last_promise.mn, 0);
				}
			}
			else{
				last_fixed = node;
				// resolve: promise -> fixed node
				if (last_promise){
					last_promise.resolve(node);
					resolved.set(last_promise.mn, 0);
					last_promise = null;
				}
			}
			return mn;
		};

		const fixed = [];
		prev_mn = handle_promises(prev, false, true);
		for (const node of removed){
			let mn = handle_promises(node, true, true);
			// (floating) previously moved node
			if (mn){
				this.mutated.remove(mn);
				// case: add + remove; ops cancel out
				if (!mn.original)
					this.floating.delete(node);
				else{
					// case: (remove + add)* + remove
					mn.mutated = null;
					if (mn.original.parent === parent)
						revert_possible = true;
				}
			}
			// (fixed) newly removed
			else{
				// case: add
				mn = new MutatedNode(node);
				mn.original = {parent};
				fixed.push(mn);
				this.floating.set(node, mn);
				revert_possible = true;
			}
		}
		next_mn = handle_promises(next, true, false);
		if (resolved.size)
			siblings_known = true;
		// if we know there is another unknown sibling that would stop the revert check again
		if (siblings_known && prev_mn?.mutated?.prev === undefined && next_mn?.mutated?.next === undefined)
			siblings_known = false;

		// filter out resolved promises that are known to be in incorrect position
		for (const mn of resolved.keys()){
			// we do this after removal step, so now any removed nodes will be filtered out as well;
			// (no need to do revert checks on nodes that are being removed)
			// necessarily original.parent === parent
			if (mn.mutated?.parent !== parent)
				resolved.delete(mn);
		}

		// get original siblings to mark original position for newly removed nodes
		if (fixed.length){
			let fprev = fixed[0];

			/** Set original sibling for first/last node; sibling may be unknown for these, needing
			 * a SiblingPromise; this only occurs when there is a remove + untracked add
			 * @param {"next" | "prev"} forward_dir original sibling to set
			 * @param {"prev" | "next"} backward_dir opposite of forward_dir
			 * @param {MutatedNode | Node | null} hint if we need to search for a sibling via traversal,
			 * 	this specifies the node to start the search for (same arg as SiblingPromise.resume)
			 */
			const original_promise_sibling = (forward_dir, backward_dir, hint) => {
				let sibling = this.original[backward_dir].get(fprev.node);
				if (!sibling){
					sibling = new SiblingPromise(this, fprev, forward_dir);
					// returns true when it resolves immediately; original will be set
					if (sibling.resume(hint))
						return;
				}
				else sibling = sibling.node;
				fprev.original[forward_dir] = sibling;
			};

			original_promise_sibling("prev", "next", prev_mn || prev);
			// adjacent fixed nodes
			for (let fi=1; fi<fixed.length; fi++){
				const fnext = fixed[fi];
				// original sibling(s) were removed from in between fprev-fnext
				const sibling = this.original.prev.get(fprev.node);
				if (sibling){
					fprev.original.next = sibling.node;
					fnext.original.prev = this.original.next.get(fnext.node).node;
				}
				// fprev-fnext are eachother's original sibling
				else{
					fprev.original.next = fnext.node;
					fnext.original.prev = fprev.node;
				}
				this.original.add(fprev);
				fprev = fnext;
			}
			original_promise_sibling("next", "prev", next_mn || next);
			this.original.add(fprev);
		}

		/* Added nodes may overwrite the sibling relationship from next/prev. Since update() doesn't
			check for overwrite scenarios, at the very least you need to disconnect their sibling
			first. We'll just do the update first and that takes care of it
		*/
		if (prev_mn)
			this.mutated.update(prev_mn, added[0] || next, "next", parent);
		if (next_mn)
			this.mutated.update(next_mn, added[added.length-1] || prev, "prev", parent);
		if (added.length){
			for (let ai=0; ai<added.length; ai++){
				const node = added[ai];
				let mn = this.floating.get(node);
				// case: add
				if (!mn){
					mn = new MutatedNode(node);
					this.floating.set(node, mn);
				}
				// case: remove + add;
				// add + add case not permitted, so no need to update this.mutated;
				// if returned to original parent, candidate for becoming fixed
				else if (mn.original.parent === parent)
					candidates.push(mn);
				// for nodes that are now reverted, this is unnecessary; doing unconditionally for simpler logic
				mn.mutated = {
					parent,
					prev: added[ai-1] || prev,
					next: added[ai+1] || next
				};
				this.mutated.add(mn);
			};
		}

		/* Optimizing many repeated revert_checks: Perhaps an optimal method would be to walk through
			the nodes in order; but that's not possible since our sibling graph could be incomplete.
			Some other ideas:
			1. If we see a sibling is incorrect, we could mark the direction; if a revert check comes
				in from the other direction, we know not to continue. Continuing would just traverse
				until it found that fixed node from the original direction, the number of floating
				nodes in between is probably small, so this may not help much. Overhead is high since
				we need to do the check for every traversal.
			2. Same as previous bullet, but assume the sibling is a candidate for another revert
			    check. We can set prev/next (depending on direction) to be undefined to skip a side,
			    or possibly the entire revert_check. Less overhead, though still fair amount; but
				this time I think it may be worth it. You need to remove reverted nodes from your
				list anyways, so we can just do the side-skipping logic at the same time.
			I've implemented the second idea inside `revert_check()`.

			Doing revert check on `resolved` promises first may be slightly more efficient: they will
			be outside (prev, next) range, so would more often provide a fixed node for
			`candidates`. But that comes at needing to trim `candidates`, or to just do a revert
			check from one side; add to that the case where candidates is empty. Logic will be
			complicated and may cancel out any benefits. So I'm just checking candidates first
			instead since it will be simpler.
		*/
		if (revert_possible || siblings_known || candidates.length)
			this.#revert_check(candidates, parent, resolved, prev_mn || prev, next_mn || next);
		for (const [mn, flags] of resolved)
			this.#revert_check([mn], parent, resolved, flags & 1 ? mn : undefined, flags & 2 ? mn : undefined);

		/* For debugging:
		try{
			++DBG;
			this.#assert_valid_state();
			// let found = false;
			// for (let x of this.floating.values())
			// 	if (x.node instanceof Text && x.node.uid == 29)
			// 		found = x.mutated?.parent;
			// console.log("text29 found:", found, ++DBG);
		} catch(err){
			console.log("iter #", DBG);
			console.error("invalid graph");
			throw err;
		}
		//*/
	}

	/** Resolve node positions for untracked node insertions */
	synchronize(){	
		/* Update all mutated siblings to be their correct values. Collect any
			SiblingPromise's to be resolved en-masse afterwards. We update mutated first, so
			we don't have to keep resuming SiblingPromise's
		*/
		// promise that could be reverted; {MutatedNode => 0b00 reversion flag}
		const candidates = new Map()
		// promises that need to be resolved
		const next_promises = []; // [SiblingPromise...]
		const prev_promises = new Map(); // {MutatedNode => SiblingPromise}		
		const collect_promises = (mn, dir, prev_dir) => {
			const promise = mn.mutated[dir];
			// sibling known
			const is_promise = promise instanceof SiblingPromise;
			if (!is_promise && promise !== undefined)
				return;
			// sibling was unknown
			const actual = prev_dir ? mn.node.previousSibling : mn.node.nextSibling;
			if (is_promise){
				// candidate for reversion (mutated.parent will be set)
				const pmn = promise.mn;
				if (pmn.original.parent === pmn.mutated?.parent)
					candidates.set(pmn, 0);
				// collect promises to be resolved later
				promise.resume_with = actual;
				if (prev_dir)
					prev_promises.set(mn, promise);
				else next_promises.push(promise);
			}
			// TODO: unknown node may have been preventing a revert

			// the current node 
			this.mutated.update(mn, actual, dir);
		};
		for (const mn of this.mutations()){
			const node = mn.node;
			// an untracked add is assumed to be in a different parent, so we
			// don't mark as candidate for reversion
			if (mn.mutated){
				collect_promises(mn, "prev", true);
				collect_promises(mn, "next", false);
			}
			else if (node.parentNode){
				mn.mutated = {
					parent: node.parentNode,
					next: node.nextSibling,
					prev: node.previousSibling
				}
				this.mutated.add(mn);
			}
			// DEBUGGING
			if (!node.parentNode){
				if (mn.mutated)
					throw Error("mutated shoudl be null")
			}
			else if (mn.mutated.prev !== node.previousSibling)
				throw Error("prev sibling incorrect")
			else if (mn.mutated.next !== node.nextSibling)
				throw Error("next sibling incorrect")

		}

		/* Resolve all next sibling promises. We'll handle dual promise -> <- promise resolves here.
			To do so, we need to know if there is a promise going from the opposite direction. You
			could have checked this by seeing if mutated.prev was a promise, but in the previous
			step we've set all mutated values to their live DOM nodes. So instead the prev_promise
			map gives the MutatedNode where the promise came from (E.g. promise.ptr == mutated.prev)
		*/
		for (const next of next_promises){
			let mn, prev;
			let node = next.resume_with;
			while (true){
				// resolve: promise -> fixed
				if (!node || !(mn = this.floating.get(node))){
					next.resolve(node);
					break;
				}
				// resolve: promise -> <- promise
				if (prev = prev_promises.get(mn)){
					next.resolve(prev.origin);
					prev.resolve(next.origin);
					prev_promises.delete(mn); // speedup future searches
					break;
				}
				node = mn.mutated.next;
			}
		}

		// Resolve all previous sibling promises;
		// the promise -> <- promise case is not possible, since all have been handled in second pass
		for (const prev of prev_promises.values()){
			let mn;
			let node = prev.resume_with;
			while (node && (mn = this.floating.get(node)))
				node = mn.mutated.prev;
			// resolve: fixed <- promise
			prev.resolve(node);
		}

		/* Same idea here as in the main `mutation()` method for reversion. Reverting is simpler
			here since all mutated siblings are up-to-date, and we're resolving only single
			candidates. Though for the sake of code simplicity, we'll just reuse the general method.
		*/
		for (const [mn, flags] of candidates)
			this.#revert_check([mn], mn.original.parent, candidates, flags & 1 ? mn : undefined, flags & 2 ? mn : undefined);

		/* For debugging:
		try{
			this.#assert_valid_state(true);
		} catch(err){
			console.error("invalid graph after synchronization");
			throw err;
		}
		//*/
	}

	/** Check if these nodes have returned to original position (floating to fixed). To become fixed
	 * its neighboring sibling that originated from the same parent must match its original sibling
	 * (this ignores siblings in between originating from a different parent). If a node becomes
	 * fixed, it may cause its neighbors to become fixed in a propagating chain.
	 * @param {MutatedNode[]} candidates list of adjacent MutatedNode's, all inside their original
	 * 	parent, and who are candidates to become fixed. Can be empty, in which case prev/next must
	 * 	be specified to direct where to search.
	 * @param {Node} parent parent container for which all candidates originated and are presently inside
	 * @param {Map<MutatedNode, Number>} others For multiple calls to revert_check, this is used to
	 *  remove "other" candidates that are resolved, or to mark if one of their sides is known to
	 *  not have a fixed anchor. The value for each node is a bitflag, where first bit indicates if
	 *  there is no valid prev anchor, and second bit is no valid next anchor. Initially, these
	 *  could both be unset (zero).
	 * @param {MutatedNode | Node | null | undefined} prev hints about a fixed node on the
	 *  previousSibling side of candidates:
	 *  - `MutatedNode`: We are not sure if there is a fixed anchor on this side of candidates, but
	 *    we can start searching for one here. However, if this node has been added to
	 *    `candidates` (first/last node) it signals that we know there is no valid fixed anchor on
	 *    that side, but the MutatedNode could become fixed if an anchor is found on the other side 
	 * 	- `Node` or `null`: we know this is the fixed anchor
	 *  - `undefined`: no info on fixed anchors; look for one starting with the siblings of
	 * 	  `candidates
	 * @param {MutatedNode | Node | null | undefined} next same as `prev`, only a nextSibling
	 */
	#revert_check(candidates, parent, others, prev, next){
		/** Search for a fixed node anchor on one side of `candidates`
		 * @param {MutatedNode | Node | null | undefined} mn where to start the search:
		 * 	- `MutatedNode`: start search with this node, inclusive
		 * 	- `Node` or `null`: assumes this is the fixed anchor
		 * 	- `undefined`: falls back to using `exclusive` as the start
		 * @param {MutatedNode} exclusive start of search, but not including this node
		 * @param {"next" | "prev"} dir direction to search for an anchor
		 */
		const fixed_anchor = (mn, exclusive, dir) => {
			// caller knows there is no fixed anchor, and has added the nearest
			// floating sibling to candidates already
			if (mn === exclusive)
				return;
			// caller gave us the fixed anchor, no need to search for it
			if (mn === null || mn instanceof Node)
				return {fixed: mn};
			// caller has no info on fixed anchor; search, starting with sibling of exclusive
			if (mn === undefined)
				mn = exclusive
			// caller knows to start looking for fixed anchor with this node
			else if (mn.original?.parent === parent)
				return {floating: mn};
			while (true){
				// can't traverse further; revert check is deferred until more siblings are known
				/* Originally I thought [origin, SibingPromise->] scenario indicates a revert,
					as it appears origin has returned to its original position. A counter example
					for this is: (lower case = mutated sibling unknown, * = SiblingPromise)
			  			[AxyzB] -> [x*yzB] -> [Bx*y*z] -> [BAx*y*z]
			        B remains fixed throughout; when A is moved before x*, we see the SiblingPromise
			  		and assume A has returned to its original position. While its relative position
					to the SiblingPromise is reverted, the shift in the other nodes (namely B),
					means that relative position is no longer its original position.
				*/
				let sibling;
				if (!mn.mutated || (sibling = mn.mutated[dir]) === undefined || sibling instanceof SiblingPromise)
					return;
				// fixed node found
				if (sibling === null || !(mn = this.floating.get(sibling)))
					return {fixed: sibling};
				// skip floating node that originated in another parent;
				// otherwise, it can become another candidate
				if (mn.original?.parent === parent)
					return {floating: mn};
			}
		};
		/** Propagate fixedness to `candidates` from one direction
		 * @param {Node | null | SiblingPromise} fixed a fixed node found from `fixed_anchor()`
		 * @param {Number} idx where to start propagating in candidates
		 * @param {Number} end_idx where to end propagation in candidates, can be < idx
		 * @param {"next" | "prev"} forward_dir direction to propagate
		 * @param {"prev" | "next"} backward_dir opposite of `forward_dir`
		 * @param {Boolean | MutatedNode | Node | null} extend how to handle propagation beyond
		 * 	candidates, can be one of:
		 * 	- `false`: do not propagate beyond candidates
		 * 	- `true`: continue propagating with the sibling of the end_idx candidate
		 * 	- `MutatedNode`: continue propagation starting with this node (inclusive)
		 * 	- `Node` or `null`: do not propagate further (caller found a fixed node)
		 * @returns {Number | null} null if we propagated to all candidates; otherwise,
		 * 	the idx we stopped at and did not mark as fixed
		 */
		const propagate = (fixed, idx, end_idx, forward_dir, backward_dir, extend) => {
			let mn;
			// sets side-skipping flags to optimize repeated revert_check calls
			const mark_incorrect = () => {
				/* Revert check flags:
					0b01 = prev sibling is known to be incorrect
					0b10 = next sibling is known to be incorrect
					if 0b11, both siblings are incorrect, so no need to do a revert check
				*/
				let flags = others.get(mn);
				if (flags !== undefined){
					flags &= backward_dir === "prev" ? 1 : 2
					if (flags == 3)
						others.delete(mn);
					else others.set(mn, flags);
				}
			};
			// mark node as fixed and remove from the graph 
			const mark_fixed = () => {
				fixed = mn.node;
				this.floating.delete(fixed);
				this.original.remove(mn);
				this.mutated.remove(mn);
				// remove so we don't handle in revert_check again
				others.delete(mn);
				// cleanup any promises (they may have references in another node's mutated sibling);
				// no promise in backward direction, since that's what matched the fixed ref
				const fp = mn.original[forward_dir];
				if (fp instanceof SiblingPromise)
					fp.discard();
			}
			// first propagate to candidates (known to be in correct parent)
			const inc = Math.sign(end_idx-idx);
			for (; idx != end_idx; idx += inc){
				mn = candidates[idx];
				// incorrect sibling? can try from other side instead starting with `idx`
				if (mn.original[backward_dir] !== fixed)
					return mark_incorrect(), idx;
				mark_fixed();
			}
			// all candidates reverted; propagate beyond if there may be nodes to revert there
			outer: if (extend !== false){
				// caller gave a hint as to where to start the propagation
				if (extend !== true){
					mn = extend;
					// other side is a fixed node (prev undefined is an invalid arg for this scenario)
					if (!(mn instanceof MutatedNode))
						break outer;
					// inclusive
					if (mn.original?.parent === parent){
						if (mn.original[backward_dir] !== fixed)
							return mark_incorrect(), null;
						mark_fixed();
					}
				}
				while (true){
					// filter out nodes which are not in the correct parent
					do {
						const sibling = mn.mutated[forward_dir];
						// sibling is unknown or fixed
						if (!sibling || sibling instanceof SiblingPromise || !(mn = this.floating.get(sibling)))
							break outer;
					} while (mn.original?.parent !== parent);
					if (mn.original[backward_dir] !== fixed)
						return mark_incorrect(), null;
					mark_fixed();
				}
			}
			return null;
		};

		// propagate next
		let next_end_idx = null;
		let anchor = fixed_anchor(next, candidates[candidates.length-1], "next");
		if (anchor){
			// fixed anchor found
			if (!anchor.floating){
				next_end_idx = propagate(anchor.fixed, candidates.length-1, -1, "prev", "next", prev === undefined ? true : prev);
				if (next_end_idx === null)
					return;
			}
			// floating node can be a candidate when propagating from prev side
			else candidates.push(anchor.floating);
		}
		if (!candidates.length)
			return;
		// propagate prev
		anchor = fixed_anchor(prev, candidates[0], "prev");
		if (anchor && !anchor.floating){
			// guaranteed at least one candidate when extend is true
			const extend = next_end_idx === null;
			propagate(anchor.fixed, 0, extend ? candidates.length : next_end_idx+1, "next", "prev", extend);
		}
	}

	/* For debugging only
	#assert_valid_state(synchronized = false){
		const promises = new Map();
		// check SiblingIndex's
		for (const mn of this.mutations()){
			for (const mode of ["original","mutated"]){
				const g = this[mode];
				const mnm = mn[mode];
				if (!mnm) continue;
				for (const dir of ["prev","next"]){
					const mval = mnm[dir];
					// correct type (e.g. not MutatedNode)
					if (!(mval === null || mval === undefined || mval instanceof SiblingPromise || mval instanceof Node))
						throw Error("incorrect sibling type");
					const gval = g[dir].get(mval);
					// save promises for checking them later
					if (mval instanceof SiblingPromise){
						let store = promises.get(mval);
						if (store === undefined){
							store = {mutated: [], original: []};
							promises.set(mval, store);
						}
						store[mode].push(mn);
					}
					// these don't get indexed
					if (!mval || mval instanceof SiblingPromise){
						if (mval !== null && synchronized){
							console.error(mn);
							throw Error("unknown sibling after synchronization");
						}
						if (gval !== undefined)
							throw Error("null/SiblingPromise sibling is being indexed");
					}
					// index correct?
					else if (gval !== mn){
						console.error("sibling lookup:", mode, dir)
						console.error(mn);
						console.error("expected:", mn.node);
						console.error("received:", gval ? gval.node : gval);
						throw Error("indexed sibling doesn't match MutatedNode");
					}
				}
			}
		}
		// check promises are valid
		for (const [promise, refs] of promises){
			try{
				if (!(promise.ptr instanceof MutatedNode))
					throw Error("promise pointer is not MutatedNode");
				if (!refs.mutated.length)
					throw Error("promise doesn't have a mutated pointer");
				if (refs.mutated.length > 1)
					throw Error("promise has multiple mutated pointers");
				if (promise.ptr !== refs.mutated[0])
					throw Error("promise pointer is incorrect");
				if (!refs.original.length)
					throw Error("promise origin was resolved, but pointer still set");
				if (refs.original.length > 1)
					throw Error("promise has multiple origins");
			} catch(err){
				console.error(promise);
				console.error(refs);
				throw err;
			}
		}
		// check that reverts have all been performed
		const check_anchor = (smn, dir) => {
			const node = smn.node;
			const parent = smn.original.parent;
			const target = smn.original[dir];
			let sibling = smn.mutated[dir];
			while (true){
				smn = this.floating.get(sibling);
				// fixed found
				if (!smn){
					if (target === sibling){
						console.error(node, "has sibling", target);
						throw Error("node position is reverted");
					}
					// wrong sibling
					return;
				}
				// sibling is not fixed
				if (smn.original?.parent === parent)
					return;
				// can't traverse to get a fixed anchor
				sibling = smn.mutated?.[dir];
				if (sibling === undefined || sibling instanceof SiblingPromise)
					return;
			}
		}
		for (const mn of this.mutations()){
			// candidate for being reverted?
			if (!mn.mutated || !mn.original || mn.mutated.parent !== mn.original.parent)
				continue;
			check_anchor(mn, "prev");
			check_anchor(mn, "next");
		}
	}
	//*/
}

/** Container for a node's position change
 * @private
 */
class MutatedNode{
	constructor(node){
		this.node = node;
		/* null indicates untracked DOM position (e.g. detached from DOM tree, or in a DOM tree
			whose mutations are not being observed). Otherwise, these are in the form:
				{parent, next, prev}
			giving the old or new location of the node

			When there is an untracked insertion, this.mutated will be unknown. In this case,
			prev/next will be undefined to start. A subsequent mutation may reveal what the mutated
			position currently is. When the mutated prev/next is requested, but still unknown, it is
			set to a SiblingPromise, which is essentially a function to be resumed when the sibling
			becomes known.
		*/
		this.original = null;
		this.mutated = null;
	}
}

/** Used as a placeholder to indicate that a node's current, mutated sibling is unknown. The mutated
 * sibling is only needed when determining a (different) node's original siblings. To facilitate
 * this use case, the promise object is attached to this "origin" node, the one searching for its
 * original sibling. Instead of a new promise for each unknown mutated sibling, the promise object
 * is reused, with the `resume()` method acting like a `then()` callback. When the final original
 * sibling has been found, `resolve()` is called.
 * @private
 */
class SiblingPromise{
	/**
	 * @param {TreeMutations} tree parent mutations we'll traverse over
	 * @param {MutatedNode} mn the mutated node object we want original siblings for
	 * @param {"prev" | "next"} dir which sibling this promise is for
	 */
	constructor(tree, mn, dir){
		/** tree pointer to containing tree
		 * @type {TreeMutations}
		 */
		this.tree = tree;
		/** mn origin mutated node that is searching for its origina sibling
		 * @type {MutatedNode}
		 */
		this.mn = mn;
		/** dir which sibling we're searching for
		 * @type {"prev" | "next"}
		 */
		this.dir = dir;
		/** the sibling traversal pointer; can be undefined if resolved immediately
		 * @type {MutatedNode | undefined}
		 */
		this.ptr;
		// `resume_with` is used elsewhere to cache a node that we should resume search with
	}
	/** Node that is searching for its original siblings */
	get origin(){ return this.mn.node; }
	/** Resume search for the original sibling
	 * @param {MutatedNode | Node | null} node the node to resume searching at
	 * @returns {Boolean} true if the search found results (promise resolved)
	*/
	resume(node){
		/* Note a "promise -> <- promise" resolve case is not possible while traversing in this
			manner. The reason is that a node's mutated sibling is a SiblingPromise only when the
			A<->B sibling relationship cannot be determined. So if B.prev is unknown, A.next will
			also be unknown, meaning the traversal stops at A.next = SiblingPromise and B.prev =
			SiblingPromise; neither A nor B knows the other, so the promises can't resolve each
			other here. This scenario is instead resolved inside a batch `mutation()`, which can
			reveal a A<->B sibling relationship.
		*/
		// resolve: promise -> fixed (null)
		if (node === null){
			this.resolve(null);
			return true;
		}
		// convert Node to MutatedNode
		let smn = node instanceof MutatedNode ? node : this.tree.floating.get(node);
		while (true){
			// resolve: promise -> fixed (node)
			if (!smn){
				this.resolve(node);
				return true;
			}
			// this node had an untracked add, so its sibling is unknown;
			// we'll need to resume later when its sibling is revealed
			if (!smn.mutated)
				smn.mutated = {parent: this.mn.original.parent};
			node = smn.mutated[this.dir];
			if (node === undefined){
				smn.mutated[this.dir] = this;
				this.ptr = smn;
				return false;
			}
			// resolve: promise -> fixed (null)
			if (node === null){
				this.resolve(null);
				return true;
			}
			smn = this.tree.floating.get(node);
		}
	}
	/** Original sibling found. You can optionally call discard to cleanup the pointer reference.
	 * 	That should not be necessary for normal usage though, as promise resolution typically is
	 * 	triggered by the pointer's sibling becoming known, and thus resuming the promise traversal;
	 * 	so the pointer would cleaned up from the caller instead.
	 * @param {Node | null} node the original sibling
	 */
	resolve(node){
		this.tree.original.update(this.mn, node, this.dir);
	}
	/** Call this when you need to cleanup the promise pointer, e.g. when a node becomes reverted */
	discard(){
		if (this.ptr)
			delete this.ptr.mutated[this.dir];
	}
}

/** Indexes MutatedNodes by their prev/next sibling
 * @private
 */
class SiblingIndex{
	/** Create a new index
	 * @param {"original" | "mutated"} mode which siblings to index on
	 */
	constructor(mode){
		this.mode = mode;
		this.prev = new Map(); // MutatedNode[mode].prev -> MutatedNode
		this.next = new Map(); // MutatedNode[mode].next -> MutatedNode
	}
	/** Return true if the sibling should be indexed */
	#index(sibling){
		return sibling && !(sibling instanceof SiblingPromise);
	}
	/** Remove a nodes siblings from the index; does not check that
	 * 	the siblings were indexed prior (use `remove_safe()` for that)
	 * @param {MutatedNode} node 
	 */
	remove(node){
		const op = node[this.mode];
		if (!op) return;
		if (this.#index(op.prev))
			this.prev.delete(op.prev);
		if (this.#index(op.next))
			this.next.delete(op.next);
	}
	/** Add a nodes siblings to the index
	 * @param {MutatedNode} node 
	 */
	add(node){
		const op = node[this.mode]
		if (!op) return;
		if (this.#index(op.prev))
			this.prev.set(op.prev, node);
		if (this.#index(op.next))
			this.next.set(op.next, node);
	}
	/** Update a node's sibling to another. It only operates on one side, and will modify `node`
	 * @param {MutatedNode} node the node to update its sibling
	 * @param {Node | null} sibling the new sibling
	 * @param {"next" | "prev"} side which sibling to update
	 * @param {Node} parent parent of `node`, used to initialize MutatedNode[mode] if needed
	 */
	update(node, sibling, side, parent){
		let op = node[this.mode];
		// there was an untracked node insertion
		if (!op)
			op = node[this.mode] = {parent};
		const old = op[side];
		if (old === sibling)
			return;
		op[side] = sibling;
		if (this.#index(old))
			this[side].delete(old);
		if (this.#index(sibling))
			this[side].set(sibling, node);
	}
	/** Remove all siblings from index */
	clear(){
		this.prev.clear();
		this.next.clear();
	}
}

const Flags_readonly = Object.freeze(Flags);
export {Flags_readonly as MutationDiffFlags, MutationDiff};