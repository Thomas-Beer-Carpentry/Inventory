import FDBKeyRange from "../FDBKeyRange.js";
import cmp from "./cmp.js";
import { ConstraintError } from "./errors.js";
const MAX_TOMBSTONE_FACTOR = 2 / 3;
const EVERYTHING_KEY_RANGE = new FDBKeyRange(undefined, undefined, false, false);
export default class BinarySearchTree {
    _root;
    _keysAreUnique;
    _numTombstones = 0;
    _numNodes = 0;
    constructor(keysAreUnique){
        this._keysAreUnique = !!keysAreUnique;
    }
    size() {
        return this._numNodes - this._numTombstones;
    }
    get(record) {
        return this._getByComparator(this._root, (otherRecord)=>this._compare(record, otherRecord));
    }
    contains(record) {
        return !!this.get(record);
    }
    _compare(a, b) {
        const keyComparison = cmp(a.key, b.key);
        if (keyComparison !== 0) {
            return keyComparison;
        }
        return this._keysAreUnique ? 0 : cmp(a.value, b.value);
    }
    _getByComparator(node, comparator) {
        let current = node;
        while(current){
            const comparison = comparator(current.record);
            if (comparison < 0) {
                current = current.left;
            } else if (comparison > 0) {
                current = current.right;
            } else {
                return current.record;
            }
        }
    }
    put(record, noOverwrite = false) {
        if (!this._root) {
            this._root = {
                record,
                left: undefined,
                right: undefined,
                parent: undefined,
                deleted: false,
                red: false
            };
            this._numNodes++;
            return;
        }
        return this._put(this._root, record, noOverwrite);
    }
    _put(node, record, noOverwrite) {
        const comparison = this._compare(record, node.record);
        if (comparison < 0) {
            if (node.left) {
                return this._put(node.left, record, noOverwrite);
            } else {
                node.left = {
                    record,
                    left: undefined,
                    right: undefined,
                    parent: node,
                    deleted: false,
                    red: true
                };
                this._onNewNodeInserted(node.left);
            }
        } else if (comparison > 0) {
            if (node.right) {
                return this._put(node.right, record, noOverwrite);
            } else {
                node.right = {
                    record,
                    left: undefined,
                    right: undefined,
                    parent: node,
                    deleted: false,
                    red: true
                };
                this._onNewNodeInserted(node.right);
            }
        } else if (node.deleted) {
            node.deleted = false;
            node.record = record;
            this._numTombstones--;
        } else if (noOverwrite) {
            throw new ConstraintError();
        } else {
            const overwrittenRecord = node.record;
            node.record = record;
            return overwrittenRecord;
        }
    }
    delete(record) {
        if (!this._root) {
            return;
        }
        this._delete(this._root, record);
        if (this._numTombstones > this._numNodes * MAX_TOMBSTONE_FACTOR) {
            const records = [
                ...this.getAllRecords()
            ];
            this._root = this._rebuild(records, undefined, false);
            this._numNodes = records.length;
            this._numTombstones = 0;
        }
    }
    _delete(node, record) {
        if (!node) {
            return;
        }
        const comparison = this._compare(record, node.record);
        if (comparison < 0) {
            this._delete(node.left, record);
        } else if (comparison > 0) {
            this._delete(node.right, record);
        } else if (!node.deleted) {
            this._numTombstones++;
            node.deleted = true;
        }
    }
    *getAllRecords(descending = false) {
        yield* this.getRecords(EVERYTHING_KEY_RANGE, descending);
    }
    *getRecords(keyRange, descending = false) {
        yield* this._getRecordsForNode(this._root, keyRange, descending);
    }
    *_getRecordsForNode(node, keyRange, descending = false) {
        if (!node) {
            return;
        }
        yield* this._findRecords(node, keyRange, descending);
    }
    *_findRecords(node, keyRange, descending = false) {
        const { lower, upper, lowerOpen, upperOpen } = keyRange;
        const { record: { key } } = node;
        const lowerComparison = lower === undefined ? -1 : cmp(lower, key);
        const upperComparison = upper === undefined ? 1 : cmp(upper, key);
        const moreLeft = this._keysAreUnique ? lowerComparison < 0 : lowerComparison <= 0;
        const moreRight = this._keysAreUnique ? upperComparison > 0 : upperComparison >= 0;
        const moreStart = descending ? moreRight : moreLeft;
        const moreEnd = descending ? moreLeft : moreRight;
        const start = descending ? "right" : "left";
        const end = descending ? "left" : "right";
        const lowerMatches = lowerOpen ? lowerComparison < 0 : lowerComparison <= 0;
        const upperMatches = upperOpen ? upperComparison > 0 : upperComparison >= 0;
        if (moreStart && node[start]) {
            yield* this._findRecords(node[start], keyRange, descending);
        }
        if (lowerMatches && upperMatches && !node.deleted) {
            yield node.record;
        }
        if (moreEnd && node[end]) {
            yield* this._findRecords(node[end], keyRange, descending);
        }
    }
    _onNewNodeInserted(newNode) {
        this._numNodes++;
        this._rebalanceTree(newNode);
    }
    _rebalanceTree(node) {
        let parent = node.parent;
        do {
            if (!parent.red) {
                return;
            }
            const grandparent = parent.parent;
            if (!grandparent) {
                parent.red = false;
                return;
            }
            const parentIsRightChild = parent === grandparent.right;
            const uncle = parentIsRightChild ? grandparent.left : grandparent.right;
            if (!uncle || !uncle.red) {
                if (node === (parentIsRightChild ? parent.left : parent.right)) {
                    this._rotateSubtree(parent, parentIsRightChild);
                    node = parent;
                    parent = parentIsRightChild ? grandparent.right : grandparent.left;
                }
                this._rotateSubtree(grandparent, !parentIsRightChild);
                parent.red = false;
                grandparent.red = true;
                return;
            }
            parent.red = false;
            uncle.red = false;
            grandparent.red = true;
            node = grandparent;
        }while (node.parent ? parent = node.parent : false)
    }
    _rotateSubtree(node, right) {
        const parent = node.parent;
        const newRoot = right ? node.left : node.right;
        const newChild = right ? newRoot.right : newRoot.left;
        node[right ? "left" : "right"] = newChild;
        if (newChild) {
            newChild.parent = node;
        }
        newRoot[right ? "right" : "left"] = node;
        newRoot.parent = parent;
        node.parent = newRoot;
        if (parent) {
            parent[node === parent.right ? "right" : "left"] = newRoot;
        } else {
            this._root = newRoot;
        }
        return newRoot;
    }
    _rebuild(records, parent, red) {
        const { length } = records;
        if (!length) {
            return undefined;
        }
        const mid = length >>> 1;
        const node = {
            record: records[mid],
            left: undefined,
            right: undefined,
            parent,
            deleted: false,
            red
        };
        const left = this._rebuild(records.slice(0, mid), node, !red);
        const right = this._rebuild(records.slice(mid + 1), node, !red);
        node.left = left;
        node.right = right;
        return node;
    }
}


//# sourceURL=src/lib/binarySearchTree.ts