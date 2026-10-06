export function db(env) { if(!env.DB) throw new Error('Storage is unavailable. Please try again.'); return env.DB; }
export async function state(env,user) {
 const results=await db(env).batch([
 db(env).prepare('SELECT * FROM items ORDER BY name COLLATE NOCASE'),
 db(env).prepare('SELECT * FROM jobs ORDER BY created_at DESC'),
 db(env).prepare('SELECT * FROM movements ORDER BY created_at ASC, rowid ASC')
 ]);
 return {items:results[0].results,jobs:results[1].results,movements:results[2].results,user};
}
export const insertMovementSql=`INSERT INTO movements (id,item_id,job_id,type,quantity,created_at,user_id,user_name,item_name,unit,client_name,job_name,before,after)
 SELECT ?,i.id,?,?,?,?,?,?,i.name,i.unit,j.client,j.name,i.quantity,i.quantity+?
 FROM items i LEFT JOIN jobs j ON j.id=? WHERE i.id=?`;
export async function move(env,data,user) {
 const {id,itemId,jobId=null,type,quantity}=data;
 if(!/^[a-zA-Z0-9-]{10,80}$/.test(id||'')) throw new Error('Please start a new transaction.');
 if(!['STOCK_IN','TAKEN_TO_JOB','RETURNED_TO_WORKSHOP'].includes(type)) throw new Error('Choose a valid stock movement.');
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000) throw new Error('Enter a whole quantity greater than zero.');
 if(type==='STOCK_IN' && jobId) throw new Error('Use Return Stock to return materials from a job.');
 if(type!=='STOCK_IN' && !jobId) throw new Error('Select a destination job.');
 const old=await db(env).prepare('SELECT * FROM movements WHERE id=?').bind(id).first();
 if(old){if(old.item_id!==itemId||old.job_id!==jobId||old.type!==type||old.quantity!==quantity||old.user_id!==user.id) throw new Error('This transaction reference is already in use.');return old;}
 const delta=type==='TAKEN_TO_JOB'?-quantity:quantity;
 try {
 const result=await db(env).prepare(insertMovementSql).bind(id,jobId,type,quantity,new Date().toISOString(),user.id,user.name,delta,jobId,itemId).run();
 if(!result.meta.changes) throw new Error('This item could not be found.');
 }catch(error){
 const committed=await db(env).prepare('SELECT * FROM movements WHERE id=?').bind(id).first();
 if(committed){if(committed.item_id!==itemId||committed.job_id!==jobId||committed.type!==type||committed.quantity!==quantity||committed.user_id!==user.id) throw new Error('This transaction reference is already in use.');return committed;}
 throw error;
 }
 return db(env).prepare('SELECT * FROM movements WHERE id=?').bind(id).first();
}
