/* Holds a record of mutations for attributes, character data, or custom properties.
 * 
 * With MutationRecord, we only get the oldValue, and need to fetch current value from
 * getAttribute/data get. The lack of point-in-time value means we cannot know if the value is
 * reverted at that point-in-time. We only are aware of a reversion *after the fact* (e.g. a new
 * MutationRecord.oldValue matches what we had cached). So unfortunately this means we'll need to
 * cache oldValue in perpetuity, even when the property is reverted.
 * 
 * You can use synchronize method to remove all reverted properties, but this should only be done if you
 * are sure all MutationRecords have been accounted for already, and the PropertyMutations has an
 * accurate view of the current DOM (e.g. when MutationObserver.takeRecords() is called).
 */
export default class PropertyMutations{
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