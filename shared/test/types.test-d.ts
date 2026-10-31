import { lifecycle, type TransitionName } from '../src/transitions';

const name: TransitionName = 'approve';
// @ts-expect-error not a verb in the table
const notAName: TransitionName = 'approv';

// @ts-expect-error judge reads the approve guard's fields off the ticket
lifecycle.judge({ status: 'todo' }, 'approve', 'human');
lifecycle.judge({ status: 'todo', app_id: 1, simple: true, design: null, description: '' }, 'approve', 'agent');
// @ts-expect-error only the two actors hold authority
lifecycle.judge({ status: 'todo', app_id: 1, simple: true, design: null, description: '' }, 'approve', 'controller');
const missing: readonly ('app' | 'intent')[] = lifecycle.missingAt('ready', { app_id: 1, simple: true, design: null, description: '' });
