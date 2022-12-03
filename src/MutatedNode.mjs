/** Container for a node's position change
 * @private
 */
export default class MutatedNode{
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