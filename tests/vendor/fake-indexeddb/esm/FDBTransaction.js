import FDBObjectStore from "./FDBObjectStore.js";
import FDBRequest from "./FDBRequest.js";
import { AbortError, InvalidStateError, NotFoundError, TransactionInactiveError } from "./lib/errors.js";
import FakeDOMStringList from "./lib/FakeDOMStringList.js";
import FakeEvent from "./lib/FakeEvent.js";
import FakeEventTarget from "./lib/FakeEventTarget.js";
import { queueTask } from "./lib/scheduling.js";
const prioritizedListenerTypes = [
    "error",
    "abort",
    "complete"
];
class FDBTransaction extends FakeEventTarget {
    _state = "active";
    _started = false;
    _rollbackLog = [];
    _objectStoresCache = new Map();
    _openRequest = null;
    objectStoreNames;
    mode;
    durability;
    db;
    error = null;
    onabort = null;
    oncomplete = null;
    onerror = null;
    _prioritizedListeners = new Map();
    _scope;
    _requests = [];
    _createdIndexes = new Set();
    _createdObjectStores = new Set();
    constructor(storeNames, mode, durability, db){
        super();
        this._scope = new Set(storeNames);
        this.mode = mode;
        this.durability = durability;
        this.db = db;
        this.objectStoreNames = new FakeDOMStringList(...Array.from(this._scope).sort());
        for (const type of prioritizedListenerTypes){
            this.addEventListener(type, ()=>{
                this._prioritizedListeners.get(type)?.();
            });
        }
    }
    _abort(errName) {
        for (const f of this._rollbackLog.reverse()){
            f();
        }
        if (errName !== null) {
            const e = new DOMException(undefined, errName);
            this.error = e;
        }
        for (const { request } of this._requests){
            if (request.readyState !== "done") {
                request.readyState = "done";
                if (request.source) {
                    queueTask(()=>{
                        request.result = undefined;
                        request.error = new AbortError();
                        const event = new FakeEvent("error", {
                            bubbles: true,
                            cancelable: true
                        });
                        event.eventPath = [
                            this.db,
                            this
                        ];
                        try {
                            request.dispatchEvent(event);
                        } catch (_err) {
                            if (this._state === "active") {
                                this._abort("AbortError");
                            }
                        }
                    });
                }
            }
        }
        queueTask(()=>{
            const isUpgradeTransaction = this.mode === "versionchange";
            if (isUpgradeTransaction) {
                this.db._rawDatabase.connections = this.db._rawDatabase.connections.filter((connection)=>!connection._rawDatabase.transactions.includes(this));
            }
            const event = new FakeEvent("abort", {
                bubbles: true,
                cancelable: false
            });
            event.eventPath = [
                this.db
            ];
            this.dispatchEvent(event);
            if (isUpgradeTransaction) {
                const request = this._openRequest;
                request.transaction = null;
                request.result = undefined;
            }
        });
        this._state = "finished";
    }
    abort() {
        if (this._state === "committing" || this._state === "finished") {
            throw new InvalidStateError();
        }
        this._state = "active";
        this._abort(null);
    }
    objectStore(name) {
        if (this._state !== "active") {
            throw new InvalidStateError();
        }
        const objectStore = this._objectStoresCache.get(name);
        if (objectStore !== undefined) {
            return objectStore;
        }
        const rawObjectStore = this.db._rawDatabase.rawObjectStores.get(name);
        if (!this._scope.has(name) || rawObjectStore === undefined) {
            throw new NotFoundError();
        }
        const objectStore2 = new FDBObjectStore(this, rawObjectStore);
        this._objectStoresCache.set(name, objectStore2);
        return objectStore2;
    }
    _execRequestAsync(obj) {
        const source = obj.source;
        const operation = obj.operation;
        let request = Object.hasOwn(obj, "request") ? obj.request : null;
        if (this._state !== "active") {
            throw new TransactionInactiveError();
        }
        if (!request) {
            if (!source) {
                request = new FDBRequest();
            } else {
                request = new FDBRequest();
                request.source = source;
                request.transaction = source.transaction;
            }
        }
        this._requests.push({
            operation,
            request
        });
        return request;
    }
    _start() {
        this._started = true;
        let operation;
        let request;
        while(this._requests.length > 0){
            const r = this._requests.shift();
            if (r && r.request.readyState !== "done") {
                request = r.request;
                operation = r.operation;
                break;
            }
        }
        if (request && operation) {
            if (!request.source) {
                operation();
            } else {
                let defaultAction;
                let event;
                try {
                    const result = operation();
                    request.readyState = "done";
                    request.result = result;
                    request.error = undefined;
                    if (this._state === "inactive") {
                        this._state = "active";
                    }
                    event = new FakeEvent("success", {
                        bubbles: false,
                        cancelable: false
                    });
                } catch (err) {
                    request.readyState = "done";
                    request.result = undefined;
                    request.error = err;
                    if (this._state === "inactive") {
                        this._state = "active";
                    }
                    event = new FakeEvent("error", {
                        bubbles: true,
                        cancelable: true
                    });
                    defaultAction = this._abort.bind(this, err.name);
                }
                try {
                    event.eventPath = [
                        this.db,
                        this
                    ];
                    request.dispatchEvent(event);
                } catch (_err) {
                    if (this._state === "active") {
                        this._abort("AbortError");
                        defaultAction = undefined;
                    }
                }
                if (!event.canceled) {
                    if (defaultAction) {
                        defaultAction();
                    }
                }
            }
            queueTask(this._start.bind(this));
            return;
        }
        if (this._state !== "finished") {
            this._state = "finished";
            if (!this.error) {
                const event = new FakeEvent("complete");
                this.dispatchEvent(event);
            }
        }
    }
    commit() {
        if (this._state !== "active") {
            throw new InvalidStateError();
        }
        this._state = "committing";
    }
    get [Symbol.toStringTag]() {
        return "IDBTransaction";
    }
}
export default FDBTransaction;


//# sourceURL=src/FDBTransaction.ts