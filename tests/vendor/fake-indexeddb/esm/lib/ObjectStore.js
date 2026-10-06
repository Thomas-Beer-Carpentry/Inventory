import FDBRecord from "../FDBRecord.js";
import { DataError } from "./errors.js";
import extractKey from "./extractKey.js";
import KeyGenerator from "./KeyGenerator.js";
import RecordStore from "./RecordStore.js";
class ObjectStore {
    deleted = false;
    rawDatabase;
    records = new RecordStore(true);
    rawIndexes = new Map();
    name;
    keyPath;
    autoIncrement;
    keyGenerator;
    constructor(rawDatabase, name, keyPath, autoIncrement){
        this.rawDatabase = rawDatabase;
        this.keyGenerator = autoIncrement === true ? new KeyGenerator() : null;
        this.deleted = false;
        this.name = name;
        this.keyPath = keyPath;
        this.autoIncrement = autoIncrement;
    }
    getKey(key) {
        const record = this.records.get(key);
        return record !== undefined ? structuredClone(record.key) : undefined;
    }
    getAllKeys(range, count, direction) {
        if (count === undefined || count === 0) {
            count = Infinity;
        }
        const records = [];
        for (const record of this.records.values(range, direction)){
            records.push(structuredClone(record.key));
            if (records.length >= count) {
                break;
            }
        }
        return records;
    }
    getValue(key) {
        const record = this.records.get(key);
        return record !== undefined ? structuredClone(record.value) : undefined;
    }
    getAllValues(range, count, direction) {
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
    getAllRecords(range, count, direction) {
        if (count === undefined || count === 0) {
            count = Infinity;
        }
        const records = [];
        for (const record of this.records.values(range, direction)){
            records.push(new FDBRecord(structuredClone(record.key), structuredClone(record.key), structuredClone(record.value)));
            if (records.length >= count) {
                break;
            }
        }
        return records;
    }
    storeRecord(newRecord, noOverwrite, rollbackLog) {
        if (this.keyPath !== null) {
            const key = extractKey(this.keyPath, newRecord.value).key;
            if (key !== undefined) {
                newRecord.key = key;
            }
        }
        const rollbackLogForThisOperation = [];
        if (this.keyGenerator !== null && newRecord.key === undefined) {
            let rolledBack = false;
            const keyGeneratorBefore = this.keyGenerator.num;
            const rollbackKeyGenerator = ()=>{
                if (rolledBack) {
                    return;
                }
                rolledBack = true;
                if (this.keyGenerator) {
                    this.keyGenerator.num = keyGeneratorBefore;
                }
            };
            rollbackLogForThisOperation.push(rollbackKeyGenerator);
            if (rollbackLog) {
                rollbackLog.push(rollbackKeyGenerator);
            }
            newRecord.key = this.keyGenerator.next();
            if (this.keyPath !== null) {
                if (Array.isArray(this.keyPath)) {
                    throw new Error("Cannot have an array key path in an object store with a key generator");
                }
                let remainingKeyPath = this.keyPath;
                let object = newRecord.value;
                let identifier;
                let i = 0;
                while(i >= 0){
                    if (typeof object !== "object") {
                        throw new DataError();
                    }
                    i = remainingKeyPath.indexOf(".");
                    if (i >= 0) {
                        identifier = remainingKeyPath.slice(0, i);
                        remainingKeyPath = remainingKeyPath.slice(i + 1);
                        if (!Object.hasOwn(object, identifier)) {
                            Object.defineProperty(object, identifier, {
                                configurable: true,
                                enumerable: true,
                                writable: true,
                                value: {}
                            });
                        }
                        object = object[identifier];
                    }
                }
                identifier = remainingKeyPath;
                Object.defineProperty(object, identifier, {
                    configurable: true,
                    enumerable: true,
                    writable: true,
                    value: newRecord.key
                });
            }
        } else if (this.keyGenerator !== null && typeof newRecord.key === "number") {
            this.keyGenerator.setIfLarger(newRecord.key);
        }
        const existingRecord = this.records.put(newRecord, noOverwrite);
        let rolledBack = false;
        const rollbackStoreRecord = ()=>{
            if (rolledBack) {
                return;
            }
            rolledBack = true;
            if (existingRecord) {
                this.storeRecord(existingRecord, false);
            } else {
                this.deleteRecord(newRecord.key);
            }
        };
        rollbackLogForThisOperation.push(rollbackStoreRecord);
        if (rollbackLog) {
            rollbackLog.push(rollbackStoreRecord);
        }
        if (existingRecord) {
            for (const rawIndex of this.rawIndexes.values()){
                rawIndex.records.deleteByValue(newRecord.key);
            }
        }
        try {
            for (const rawIndex of this.rawIndexes.values()){
                if (rawIndex.initialized) {
                    rawIndex.storeRecord(newRecord);
                }
            }
        } catch (err) {
            if (err.name === "ConstraintError") {
                for (const rollback of rollbackLogForThisOperation){
                    rollback();
                }
            }
            throw err;
        }
        return newRecord.key;
    }
    deleteRecord(key, rollbackLog) {
        const deletedRecords = this.records.delete(key);
        if (rollbackLog) {
            for (const record of deletedRecords){
                rollbackLog.push(()=>{
                    this.storeRecord(record, true);
                });
            }
        }
        for (const rawIndex of this.rawIndexes.values()){
            rawIndex.records.deleteByValue(key);
        }
    }
    clear(rollbackLog) {
        const deletedRecords = this.records.clear();
        if (rollbackLog) {
            for (const record of deletedRecords){
                rollbackLog.push(()=>{
                    this.storeRecord(record, true);
                });
            }
        }
        for (const rawIndex of this.rawIndexes.values()){
            rawIndex.records.clear();
        }
    }
    count(range) {
        if (range === undefined || range.lower === undefined && range.upper === undefined) {
            return this.records.size();
        }
        let count = 0;
        for (const record of this.records.values(range)){
            count += 1;
        }
        return count;
    }
}
export default ObjectStore;


//# sourceURL=src/lib/ObjectStore.ts