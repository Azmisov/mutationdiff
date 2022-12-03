import MutatedNode from "./MutatedNode.mjs";
import SiblingPromise from "./SiblingPromise.mjs";

/** Indexes MutatedNodes by their prev/next sibling
 * @private
 */
export default class SiblingIndex{
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