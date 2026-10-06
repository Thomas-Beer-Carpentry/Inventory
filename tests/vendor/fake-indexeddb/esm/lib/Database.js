import { queueTask } from "./scheduling.js";
import { intersection } from "./intersection.js";
class Database {
    transactions = [];
    rawObjectStores = new Map();
    connections = [];
    name;
    version;
    constructor(name, version){
        this.name = name;
        this.version = version;
        this.processTransactions = this.processTransactions.bind(this);
    }
    processTransactions() {
        queueTask(()=>{
            const running = this.transactions.filter((transaction)=>transaction._started && transaction._state !== "finished");
            const waiting = this.transactions.filter((transaction)=>!transaction._started && transaction._state !== "finished");
            const next = waiting.find((transaction, i)=>{
                const anyRunning = running.some((other)=>!(transaction.mode === "readonly" && other.mode === "readonly") && intersection(other._scope, transaction._scope).size > 0);
                if (anyRunning) {
                    return false;
                }
                const anyWaiting = waiting.slice(0, i).some((other)=>intersection(other._scope, transaction._scope).size > 0);
                return !anyWaiting;
            });
            if (next) {
                next.addEventListener("complete", this.processTransactions);
                next.addEventListener("abort", this.processTransactions);
                next._start();
            }
        });
    }
}
export default Database;


//# sourceURL=src/lib/Database.ts