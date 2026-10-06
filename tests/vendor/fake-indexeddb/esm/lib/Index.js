import FDBRecord from "../FDBRecord.js";
import { ConstraintError } from "./errors.js";
import extractKey from "./extractKey.js";
import RecordStore from "./RecordStore.js";
import valueToKey from "./valueToKey.js";
class Index {
    deleted = false;
    initialized = false;
    rawObjectStore;
    records;
    name;
    keyPath;
    multiEntry;
    unique;
    constructor(rawObjectStore, name, keyPath, multiEntry, unique){
        this.rawObjectStore = rawObjectStore;
        this.name = name;
        this.keyPath = keyPath;
        this.multiEntry = multiEntry;
        this.unique = unique;
        this.records = new RecordStore(unique);
    }
    getKey(key) {
        const record = this.records.get(key);
        return record !== undefined ? record.value : undefined;
    }
    getAllKeys(range, count, direction) {
        if (count === undefined || count === 0) {
            count = Infinity;
        }
        const records = [];
        for (const record of this.records.values(range, direction)){
            records.push(structuredClone(record.value));
            if (records.length >= count) {
                break;
            }
        }
        return records;
    }
    getValue(key) {
        const record = this.records.get(key);
        return record !== undefined ? this.rawObjectStore.getValue(record.value) : undefined;
    }
    getAllValues(range, count, direction) {
        if (count === undefined || count === 0) {
            count = Infinity;
        }
        const records = [];
        for (const record of this.records.values(range, direction)){
            records.push(this.rawObjectStore.getValue(record.value));
            if (records.length >= count) {
                break;
            }
        }
        return records;
    }
    getAllRecords(range, count, direction) {
        if (count === undefined || count === 0) {
            count = Infinity;
        }
        const records = [];
        for (const record of this.records.values(range, direction)){
            records.push(new FDBRecord(structuredClone(record.key), structuredClone(this.rawObjectStore.getKey(record.value)), this.rawObjectStore.getValue(record.value)));
            if (records.length >= count) {
                break;
            }
        }
        return records;
    }
    storeRecord(newRecord) {
        let indexKey;
        try {
            indexKey = extractKey(this.keyPath, newRecord.value).key;
        } catch (err) {
            if (err.name === "DataError") {
                return;
            }
            throw err;
        }
        if (!this.multiEntry || !Array.isArray(indexKey)) {
            try {
                valueToKey(indexKey);
            } catch (e) {
                return;
            }
        } else {
            const keep = [];
            for (const part of indexKey){
                if (keep.indexOf(part) < 0) {
                    try {
                        keep.push(valueToKey(part));
                    } catch (err) {}
                }
            }
            indexKey = keep;
        }
        if (!this.multiEntry || !Array.isArray(indexKey)) {
            if (this.unique) {
                const existingRecord = this.records.get(indexKey);
                if (existingRecord) {
                    throw new ConstraintError();
                }
            }
        } else {
            if (this.unique) {
                for (const individualIndexKey of indexKey){
                    const existingRecord = this.records.get(individualIndexKey);
                    if (existingRecord) {
                        throw new ConstraintError();
                    }
                }
            }
        }
        if (!this.multiEntry || !Array.isArray(indexKey)) {
            this.records.put({
                key: indexKey,
                value: newRecord.key
            });
        } else {
            for (const individualIndexKey of indexKey){
                this.records.put({
                    key: individualIndexKey,
                    value: newRecord.key
                });
            }
        }
    }
    initialize(transaction) {
        if (this.initialized) {
            throw new Error("Index already initialized");
        }
        transaction._execRequestAsync({
            operation: ()=>{
                try {
                    for (const record of this.rawObjectStore.records.values()){
                        this.storeRecord(record);
                    }
                    this.initialized = true;
                } catch (err) {
                    transaction._abort(err.name);
                }
            },
            source: null
        });
    }
    count(range) {
        let count = 0;
        for (const record of this.records.values(range)){
            count += 1;
        }
        return count;
    }
}
export default Index;


//# sourceURL=src/lib/Index.ts