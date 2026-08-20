import { connect, migrate } from './sql.ts';

const sql = connect();
const applied = await migrate(sql);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'nothing to apply');
await sql.end();
