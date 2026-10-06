class FDBRecord {
    _key;
    _primaryKey;
    _value;
    constructor(key, primaryKey, value){
        this._key = key;
        this._primaryKey = primaryKey;
        this._value = value;
    }
    get key() {
        return this._key;
    }
    set key(_) {}
    get primaryKey() {
        return this._primaryKey;
    }
    set primaryKey(_) {}
    get value() {
        return this._value;
    }
    set value(_) {}
    get [Symbol.toStringTag]() {
        return "IDBRecord";
    }
}
export default FDBRecord;


//# sourceURL=src/FDBRecord.ts