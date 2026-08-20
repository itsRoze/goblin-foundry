import { ANYONE_CAN_DO_ANYTHING, definePermissions } from '@rocicorp/zero';
import { schema, type Schema } from './zero.ts';

// Single user, single box. Permissions exist to satisfy zero-cache, not to
// divide anyone from anything — real gating lives in the API's write endpoints.
export const permissions = definePermissions<unknown, Schema>(schema, () =>
  Object.fromEntries(Object.keys(schema.tables).map(t => [t, ANYONE_CAN_DO_ANYTHING])));

export { schema };
export default { schema, permissions };
