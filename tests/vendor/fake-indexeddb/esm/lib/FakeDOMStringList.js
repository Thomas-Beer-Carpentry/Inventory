class FakeDOMStringList {
    _values;
    constructor(...values){
        this._values = values;
        for(let i = 0; i < values.length; i++){
            this[i] = values[i];
        }
    }
    contains(value) {
        return this._values.includes(value);
    }
    item(i) {
        if (i < 0 || i >= this._values.length) {
            return null;
        }
        return this._values[i];
    }
    get length() {
        return this._values.length;
    }
    [Symbol.iterator]() {
        return this._values[Symbol.iterator]();
    }
    _push(...values) {
        for(let i = 0; i < values.length; i++){
            this[this._values.length + i] = values[i];
        }
        this._values.push(...values);
    }
    _sort(...values) {
        this._values.sort(...values);
        for(let i = 0; i < this._values.length; i++){
            this[i] = this._values[i];
        }
        return this;
    }
}
export default FakeDOMStringList;


//# sourceURL=src/lib/FakeDOMStringList.ts