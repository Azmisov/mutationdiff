import SiblingIndex from "./SiblingIndex.mjs";
import SiblingPromise from "./SiblingPromise.mjs";
import MutatedNode from "./MutatedNode.mjs";

/** Container to encapsulate mutations to the DOM tree (node adds/removes)
 * @private
 */
export default class TreeMutations{
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
		for (const [mn, flags] of resolved){
			resolved.delete(mn);
			this.#revert_check([mn], parent, resolved, flags & 1 ? mn : undefined, flags & 2 ? mn : undefined);
		}

		//* For debugging:
		try{
			this.#assert_valid_state();
		} catch(err){
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
		/* A sibling relationship that is newly discovered could have been the cause of a revert
			check stopping early. Each discovery is always a pair of (Node, Node), one of which must
			be a MutatedNode. Revert check or fixed propagation would have stopped, e.g. for pair
			(A, B): A->B or A<-B check was stopped; no need to check <-A or B-> given just this
			information (though another revert scenario could make that necessary). How we handle
			continuation depends on whether A/B are inside their original parent:
			- both A and B: neither is fixed, so would not revert
			- neither A or B: revert check occurred may have occurred further out; A/B are the
			  prev/next hints you'd pass to revert_check; they are from the wrong parent, so
			  will not be inside `candidates`, so no need to handle that
			- one of A or B: we want to find a fixed candidate on the other side, so technically
			  you'd handle this the same as the "neither" case; the A/B that is in its original
			  parent could also be in `candidates`, or could be reverted by another unrelated
			  revert check; so simpler to just add it to `candidates`; we may be doing a redundant
			  check on the other side (e.g. <-A or B->)

			We'll handle this by processing (A, B) pair together. If A handled the pair, we'll
			mark that (?,B) does not need to be processed.

			We do similar logic inside mutated, but that logic there will be possibly N newly
			added nodes in between A-B; so its handled differently.
		*/
		const pair_hints = []; // [{prev, next}, ...]
		const pair_handled = {prev: new Set(), next: new Set()};
		// promises that need to be resolved
		const next_promises = []; // [SiblingPromise...]
		const prev_promises = new Map(); // {MutatedNode => SiblingPromise}		
		const collect_promises = (mn, forward_dir, backward_dir, prev_dir) => {
			const promise = mn.mutated[forward_dir];
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
			// unknown sibling could have been preventing a revert check;
			// not already handled by `actual`?
			if (!pair_handled[forward_dir].delete(mn)){
				const parent = mn.mutated.parent;
				const mn_correct = parent === mn.original?.parent;
				// the pair whose sibling that also became known
				let pmn, pmn_correct = false;
				if (actual && (pmn = this.floating.get(actual)))
					pmn_correct = parent === pmn.original?.parent;
				if (!mn_correct || !pmn_correct){
					// both incorrect
					if (mn_correct == pmn_correct){
						if (pmn)
							pair_handled[backward_dir].add(pmn);
						else pmn = actual;
						pair_hints.push({
							[forward_dir]: pmn,
							[backward_dir]: mn,
							parent
						});
					}
					else candidates.set(mn_correct ? mn : pmn, 0);
				}
			}
			// the current node 
			this.mutated.update(mn, actual, forward_dir);
		};
		for (const mn of this.mutations()){
			const node = mn.node;
			// an untracked add is assumed to be in a different parent, so we
			// don't mark as candidate for reversion
			if (mn.mutated){
				collect_promises(mn, "prev", "next", true);
				collect_promises(mn, "next", "prev", false);
			}
			else if (node.parentNode){
				mn.mutated = {
					parent: node.parentNode,
					next: node.nextSibling,
					prev: node.previousSibling
				}
				this.mutated.add(mn);
			}
			//* For debugging
			if (!node.parentNode){
				if (mn.mutated)
					throw Error("mutated should be null")
			}
			else if (mn.mutated.prev !== node.previousSibling)
				throw Error("prev sibling incorrect")
			else if (mn.mutated.next !== node.nextSibling)
				throw Error("next sibling incorrect")
			//*/
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
					// won't need to handle this promise in next step
					prev_promises.delete(mn);
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
		for (const [mn, flags] of candidates){
			candidates.delete(mn);
			this.#revert_check([mn], mn.original.parent, candidates, flags & 1 ? mn : undefined, flags & 2 ? mn : undefined);
		}
		/* These are the pairs that could have blocked a revert check previously. As mentioned in
			`mutation()` the optimization strategy #1 could possibly eliminate some of these checks.
			But I decided that optimization would probably be too costly for the average case to
			make it worth it
		*/
		for (const {prev, next, parent} of pair_hints)
			this.#revert_check([], parent, null, prev, next);

		//* For debugging:
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
	 * 	be specified to direct where to search. Note: array may be modified
	 * @param {Node} parent parent container for which all candidates originated and are presently inside
	 * @param {Map<MutatedNode, Number>} [others] For multiple calls to revert_check, this is used to
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
				if (!others) return;
				let flags = others.get(mn);
				if (flags !== undefined){
					flags |= backward_dir === "prev" ? 0b01 : 0b10
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
				if (others)
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

	//* For debugging only
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