import FDBKeyRange from "../FDBKeyRange.js";
import cmp from "./cmp.js";
import BinarySearchTree from "./binarySearchTree.js";
class RecordStore {
    keysAreUnique;
    records;
    constructor(keysAreUnique){
        this.keysAreUnique = keysAreUnique;
        this.records = new BinarySearchTree(this.keysAreUnique);
    }
    get(key) {
        const range = key instanceof FDBKeyRange ? key : FDBKeyRange.only(key);
        return this.records.getRecords(range).next().value;
    }
    put(newRecord, noOverwrite = false) {
        return this.records.put(newRecord, noOverwrite);
    }
    delete(key) {
        const range = key instanceof FDBKeyRange ? key : FDBKeyRange.only(key);
        const deletedRecords = [
            ...this.records.getRecords(range)
        ];
        for (const record of deletedRecords){
            this.records.delete(record);
        }
        return deletedRecords;
    }
    deleteByValue(key) {
        const range = key instanceof FDBKeyRange ? key : FDBKeyRange.only(key);
        const deletedRecords = [];
        for (const record of this.records.getAllRecords()){
            if (range.includes(record.value)) {
                this.records.delete(record);
                deletedRecords.push(record);
            }
        }
        return deletedRecords;
    }
    clear() {
        const deletedRecords = [
            ...this.records.getAllRecords()
        ];
        this.records = new BinarySearchTree(this.keysAreUnique);
        return deletedRecords;
    }
    values(range, direction = "next") {
        const descending = direction === "prev" || direction === "prevunique";
        const records = range ? this.records.getRecords(range, descending) : this.records.getAllRecords(descending);
        return {
            [Symbol.iterator]: ()=>{
                const next = ()=>{
                    return records.next();
                };
                if (direction === "next" || direction === "prev") {
                    return {
                        next
                    };
                }
                if (direction === "nextunique") {
                    let previousValue = undefined;
                    return {
                        next: ()=>{
                            let current = next();
                            while(!current.done && previousValue !== undefined && cmp(previousValue.key, current.value.key) === 0){
                                current = next();
                            }
                            previousValue = current.value;
                            return current;
                        }
                    };
                }
                let current = next();
                let nextResult = next();
                return {
                    next: ()=>{
                        while(!nextResult.done && cmp(current.value.key, nextResult.value.key) === 0){
                            current = nextResult;
                            nextResult = next();
                        }
                        const result = current;
                        current = nextResult;
                        nextResult = next();
                        return result;
                    }
                };
            }
        };
    }
    size() {
        return this.records.size();
    }
}
export default RecordStore;


//# sourceURL=src/lib/RecordStore.ts