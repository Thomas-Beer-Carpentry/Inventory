CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL,name TEXT NOT NULL,barcode TEXT NOT NULL,unit TEXT NOT NULL,quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity>=0),created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_items_barcode ON items(barcode);
--> statement-breakpoint
CREATE TABLE jobs (id TEXT PRIMARY KEY NOT NULL,client TEXT NOT NULL,name TEXT NOT NULL,address TEXT,status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Completed')),created_at TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE movements (id TEXT PRIMARY KEY NOT NULL,item_id TEXT NOT NULL REFERENCES items(id),job_id TEXT REFERENCES jobs(id),type TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0 AND quantity=CAST(quantity AS INTEGER)),created_at TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL,item_name TEXT NOT NULL,unit TEXT NOT NULL,client_name TEXT,job_name TEXT,before INTEGER NOT NULL,after INTEGER NOT NULL CHECK(after>=0),CHECK((type='STOCK_IN' AND job_id IS NULL) OR (type IN ('TAKEN_TO_JOB','RETURNED_TO_WORKSHOP') AND job_id IS NOT NULL)));
--> statement-breakpoint
CREATE INDEX idx_movements_job_item ON movements(job_id,item_id);
--> statement-breakpoint
CREATE TRIGGER movements_validate BEFORE INSERT ON movements BEGIN
 SELECT CASE WHEN NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jobs WHERE id=NEW.job_id) THEN RAISE(ABORT,'Select a valid job') END;
 SELECT CASE WHEN NEW.type='TAKEN_TO_JOB' AND NOT EXISTS(SELECT 1 FROM jobs WHERE id=NEW.job_id AND status='Active') THEN RAISE(ABORT,'Select an active destination job') END;
 SELECT CASE WHEN NEW.type='TAKEN_TO_JOB' AND (SELECT quantity FROM items WHERE id=NEW.item_id)<NEW.quantity THEN RAISE(ABORT,'Insufficient Workshop stock') END;
 SELECT CASE WHEN NEW.type='RETURNED_TO_WORKSHOP' AND NEW.quantity>COALESCE((SELECT SUM(CASE WHEN type='TAKEN_TO_JOB' THEN quantity ELSE -quantity END) FROM movements WHERE job_id=NEW.job_id AND item_id=NEW.item_id),0) THEN RAISE(ABORT,'Return exceeds materials held by this job') END;
 SELECT CASE WHEN NEW.before!=(SELECT quantity FROM items WHERE id=NEW.item_id) OR NEW.after!=NEW.before+(CASE WHEN NEW.type='TAKEN_TO_JOB' THEN -NEW.quantity ELSE NEW.quantity END) THEN RAISE(ABORT,'Movement quantities are inconsistent') END;
END;
--> statement-breakpoint
CREATE TRIGGER movements_apply AFTER INSERT ON movements BEGIN
 UPDATE items SET quantity=NEW.after WHERE id=NEW.item_id;
END;
--> statement-breakpoint
CREATE TRIGGER movements_no_update BEFORE UPDATE ON movements BEGIN
 SELECT RAISE(ABORT,'Transaction history is permanent');
END;
--> statement-breakpoint
CREATE TRIGGER movements_no_delete BEFORE DELETE ON movements BEGIN
 SELECT RAISE(ABORT,'Transaction history is permanent');
END;
