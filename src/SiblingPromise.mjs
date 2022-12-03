import TreeMutations from "./TreeMutations.mjs";
import MutatedNode from "./MutatedNode.mjs";

/** Used as a placeholder to indicate that a node's current, mutated sibling is unknown. The mutated
 * sibling is only needed when determining a (different) node's original siblings. To facilitate
 * this use case, the promise object is attached to this "origin" node, the one searching for its
 * original sibling. Instead of a new promise for each unknown mutated sibling, the promise object
 * is reused, with the `resume()` method acting like a `then()` callback. When the final original
 * sibling has been found, `resolve()` is called.
 * @private
 */
export default class SiblingPromise{
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