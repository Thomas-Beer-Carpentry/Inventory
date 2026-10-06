import FDBDatabase from "./FDBDatabase.js";
import FDBOpenDBRequest from "./FDBOpenDBRequest.js";
import FDBVersionChangeEvent from "./FDBVersionChangeEvent.js";
import cmp from "./lib/cmp.js";
import Database from "./lib/Database.js";
import enforceRange from "./lib/enforceRange.js";
import { AbortError, VersionError } from "./lib/errors.js";
import FakeEvent from "./lib/FakeEvent.js";
import { queueTask } from "./lib/scheduling.js";
import { validateRequiredArguments } from "./lib/validateRequiredArguments.js";
const runTaskInConnectionQueue = (connectionQueues, name, task)=>{
    const queue = connectionQueues.get(name) ?? Promise.resolve();
    connectionQueues.set(name, queue.then(task));
};
const waitForOthersClosedDelete = (databases, name, openDatabases, cb)=>{
    const anyOpen = openDatabases.some((openDatabase2)=>{
        return !openDatabase2._closed && !openDatabase2._closePending;
    });
    if (anyOpen) {
        queueTask(()=>waitForOthersClosedDelete(databases, name, openDatabases, cb));
        return;
    }
    databases.delete(name);
    cb(null);
};
const deleteDatabase = (databases, connectionQueues, name, request, cb)=>{
    const deleteDBTask = ()=>{
        return new Promise((resolve)=>{
            const db = databases.get(name);
            const oldVersion = db !== undefined ? db.version : 0;
            const onComplete = (err)=>{
                try {
                    if (err) {
                        cb(err);
                    } else {
                        cb(null, oldVersion);
                    }
                } finally{
                    resolve();
                }
            };
            try {
                const db = databases.get(name);
                if (db === undefined) {
                    onComplete(null);
                    return;
                }
                const openConnections = db.connections.filter((connection)=>{
                    return !connection._closed;
                });
                for (const openDatabase2 of openConnections){
                    if (!openDatabase2._closePending) {
                        queueTask(()=>{
                            const event = new FDBVersionChangeEvent("versionchange", {
                                newVersion: null,
                                oldVersion: db.version
                            });
                            openDatabase2.dispatchEvent(event);
                        });
                    }
                }
                queueTask(()=>{
                    const anyOpen = openConnections.some((openDatabase3)=>{
                        return !openDatabase3._closed && !openDatabase3._closePending;
                    });
                    if (anyOpen) {
                        queueTask(()=>{
                            const event = new FDBVersionChangeEvent("blocked", {
                                newVersion: null,
                                oldVersion: db.version
                            });
                            request.dispatchEvent(event);
                        });
                    }
                    waitForOthersClosedDelete(databases, name, openConnections, onComplete);
                });
            } catch (err) {
                onComplete(err);
            }
        });
    };
    runTaskInConnectionQueue(connectionQueues, name, deleteDBTask);
};
const runVersionchangeTransaction = (connection, version, request, cb)=>{
    connection._runningVersionchangeTransaction = true;
    const oldVersion = connection._oldVersion = connection.version;
    const openConnections = connection._rawDatabase.connections.filter((otherDatabase)=>{
        return connection !== otherDatabase;
    });
    for (const openDatabase2 of openConnections){
        if (!openDatabase2._closed && !openDatabase2._closePending) {
            queueTask(()=>{
                const event = new FDBVersionChangeEvent("versionchange", {
                    newVersion: version,
                    oldVersion
                });
                openDatabase2.dispatchEvent(event);
            });
        }
    }
    queueTask(()=>{
        const anyOpen = openConnections.some((openDatabase3)=>{
            return !openDatabase3._closed && !openDatabase3._closePending;
        });
        if (anyOpen) {
            queueTask(()=>{
                const event = new FDBVersionChangeEvent("blocked", {
                    newVersion: version,
                    oldVersion
                });
                request.dispatchEvent(event);
            });
        }
        const waitForOthersClosed = ()=>{
            const anyOpen2 = openConnections.some((openDatabase2)=>{
                return !openDatabase2._closed && !openDatabase2._closePending;
            });
            if (anyOpen2) {
                queueTask(waitForOthersClosed);
                return;
            }
            connection._rawDatabase.version = version;
            connection.version = version;
            const transaction = connection.transaction(Array.from(connection.objectStoreNames), "versionchange");
            transaction._openRequest = request;
            request.result = connection;
            request.readyState = "done";
            request.transaction = transaction;
            transaction._rollbackLog.push(()=>{
                connection._rawDatabase.version = oldVersion;
                connection.version = oldVersion;
            });
            transaction._state = "active";
            const event = new FDBVersionChangeEvent("upgradeneeded", {
                newVersion: version,
                oldVersion
            });
            let didThrow = false;
            try {
                request.dispatchEvent(event);
            } catch (_err) {
                didThrow = true;
            }
            const concludeUpgrade = ()=>{
                if (transaction._state === "active") {
                    transaction._state = "inactive";
                    if (didThrow) {
                        transaction._abort("AbortError");
                    }
                }
            };
            if (didThrow) {
                concludeUpgrade();
            } else {
                queueTask(concludeUpgrade);
            }
            transaction._prioritizedListeners.set("error", ()=>{
                connection._runningVersionchangeTransaction = false;
                connection._oldVersion = undefined;
            });
            transaction._prioritizedListeners.set("abort", ()=>{
                connection._runningVersionchangeTransaction = false;
                connection._oldVersion = undefined;
                queueTask(()=>{
                    request.transaction = null;
                    cb(new AbortError());
                });
            });
            transaction._prioritizedListeners.set("complete", ()=>{
                connection._runningVersionchangeTransaction = false;
                connection._oldVersion = undefined;
                queueTask(()=>{
                    request.transaction = null;
                    if (connection._closePending) {
                        cb(new AbortError());
                    } else {
                        cb(null);
                    }
                });
            });
        };
        waitForOthersClosed();
    });
};
const openDatabase = (databases, connectionQueues, name, version, request, cb)=>{
    const openDBTask = ()=>{
        return new Promise((resolve)=>{
            const onComplete = (err)=>{
                try {
                    if (err) {
                        cb(err);
                    } else {
                        cb(null, connection);
                    }
                } finally{
                    resolve();
                }
            };
            let db = databases.get(name);
            if (db === undefined) {
                db = new Database(name, 0);
                databases.set(name, db);
            }
            if (version === undefined) {
                version = db.version !== 0 ? db.version : 1;
            }
            if (db.version > version) {
                return onComplete(new VersionError());
            }
            const connection = new FDBDatabase(db);
            if (db.version < version) {
                runVersionchangeTransaction(connection, version, request, (err)=>{
                    onComplete(err);
                });
            } else {
                onComplete(null);
            }
        });
    };
    runTaskInConnectionQueue(connectionQueues, name, openDBTask);
};
class FDBFactory {
    _databases = new Map();
    _connectionQueues = new Map();
    cmp(first, second) {
        validateRequiredArguments(arguments.length, 2, "IDBFactory.cmp");
        return cmp(first, second);
    }
    deleteDatabase(name) {
        validateRequiredArguments(arguments.length, 1, "IDBFactory.deleteDatabase");
        const request = new FDBOpenDBRequest();
        request.source = null;
        queueTask(()=>{
            deleteDatabase(this._databases, this._connectionQueues, name, request, (err, oldVersion)=>{
                if (err) {
                    request.error = new DOMException(err.message, err.name);
                    request.readyState = "done";
                    const event = new FakeEvent("error", {
                        bubbles: true,
                        cancelable: true
                    });
                    event.eventPath = [];
                    request.dispatchEvent(event);
                    return;
                }
                request.result = undefined;
                request.readyState = "done";
                const event2 = new FDBVersionChangeEvent("success", {
                    newVersion: null,
                    oldVersion
                });
                request.dispatchEvent(event2);
            });
        });
        return request;
    }
    open(name, version) {
        validateRequiredArguments(arguments.length, 1, "IDBFactory.open");
        if (arguments.length > 1 && version !== undefined) {
            version = enforceRange(version, "MAX_SAFE_INTEGER");
        }
        if (version === 0) {
            throw new TypeError("Database version cannot be 0");
        }
        const request = new FDBOpenDBRequest();
        request.source = null;
        queueTask(()=>{
            openDatabase(this._databases, this._connectionQueues, name, version, request, (err, connection)=>{
                if (err) {
                    request.result = undefined;
                    request.readyState = "done";
                    request.error = new DOMException(err.message, err.name);
                    const event = new FakeEvent("error", {
                        bubbles: true,
                        cancelable: true
                    });
                    event.eventPath = [];
                    request.dispatchEvent(event);
                    return;
                }
                request.result = connection;
                request.readyState = "done";
                const event2 = new FakeEvent("success");
                event2.eventPath = [];
                request.dispatchEvent(event2);
            });
        });
        return request;
    }
    databases() {
        return Promise.resolve(Array.from(this._databases.entries(), ([name, database])=>{
            const activeVersionChangeConnection = database.connections.find((connection)=>connection._runningVersionchangeTransaction);
            const version = activeVersionChangeConnection ? activeVersionChangeConnection._oldVersion : database.version;
            return {
                name,
                version
            };
        }).filter(({ version })=>{
            return version > 0;
        }));
    }
    get [Symbol.toStringTag]() {
        return "IDBFactory";
    }
}
export default FDBFactory;


//# sourceURL=src/FDBFactory.ts