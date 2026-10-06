import FakeEvent from "./lib/FakeEvent.js";
class FDBVersionChangeEvent extends FakeEvent {
    newVersion;
    oldVersion;
    constructor(type, parameters = {}){
        super(type);
        this.newVersion = parameters.newVersion !== undefined ? parameters.newVersion : null;
        this.oldVersion = parameters.oldVersion !== undefined ? parameters.oldVersion : 0;
    }
    get [Symbol.toStringTag]() {
        return "IDBVersionChangeEvent";
    }
}
export default FDBVersionChangeEvent;


//# sourceURL=src/FDBVersionChangeEvent.ts