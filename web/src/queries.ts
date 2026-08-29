import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AppSchema,
  EventSchema,
  ProjectSchema,
  SettingsSchema,
  TicketSchema,
  type CreateAppBody,
  type CreateProjectBody,
  type CreateTicketBody,
  type EntityKind,
  type PatchAppBody,
  type PatchProjectBody,
  type PatchSettingsBody,
  type PatchTicketBody,
} from '@goblin/shared';
import * as api from './api';

const Apps = z.array(AppSchema);
const Projects = z.array(ProjectSchema);
const Events = z.array(EventSchema);
const Tickets = z.array(TicketSchema);
const Trash = z.object({ apps: Apps, projects: Projects, tickets: Tickets });

/** Everything recoverable; `kind` is what the restore intent addresses. */
export type TrashKind = 'app' | 'project' | 'ticket';

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get('/api/settings', SettingsSchema) });

export const useApps = (archived = false) =>
  useQuery({ queryKey: ['apps', { archived }], queryFn: () => api.get(`/api/apps${archived ? '?archived=1' : ''}`, Apps) });
export const useApp = (id: number | null) =>
  useQuery({ queryKey: ['app', id], queryFn: () => api.get(`/api/apps/${id}`, AppSchema), enabled: id !== null, retry: false });

export const useProjects = (filter: { archived?: boolean; app_id?: number | null } = {}) => {
  const q = new URLSearchParams();
  if (filter.archived) q.set('archived', '1');
  if (filter.app_id !== undefined) q.set('app_id', String(filter.app_id));
  const qs = q.toString();
  return useQuery({ queryKey: ['projects', filter], queryFn: () => api.get(`/api/projects${qs ? `?${qs}` : ''}`, Projects) });
};
export const useProject = (id: number | null) =>
  useQuery({ queryKey: ['project', id], queryFn: () => api.get(`/api/projects/${id}`, ProjectSchema), enabled: id !== null, retry: false });

/**
 * Live tickets, optionally scoped to an app or a project. The board polls
 * (5 s, foreground only) so a `goblin` CLI write shows up without a reload;
 * the scoped tiles do not.
 */
export const useTickets = (filter: { app_id?: number | null; project_id?: number | null } = {}, poll = false) => {
  const q = new URLSearchParams();
  for (const [name, value] of Object.entries(filter)) if (value !== undefined) q.set(name, String(value));
  const qs = q.toString();
  return useQuery({
    queryKey: ['tickets', filter],
    queryFn: () => api.get(`/api/tickets${qs ? `?${qs}` : ''}`, Tickets),
    refetchInterval: poll ? 5_000 : false,
    refetchIntervalInBackground: false,
  });
};

/** `key` may be stale or bare (`GF-7`, `SR-7`, `7`); the answer carries the canonical one. */
export const useTicket = (key: string) =>
  useQuery({ queryKey: ['ticket', key], queryFn: () => api.get(`/api/tickets/${key}`, TicketSchema), retry: false });

export const useEvents = (kind: EntityKind, id: number) =>
  useQuery({ queryKey: ['events', kind, id], queryFn: () => api.get(`/api/${kind}s/${id}/events`, Events) });

export const useTrash = () => useQuery({ queryKey: ['trash'], queryFn: () => api.get('/api/trash', Trash) });

/** Every write invalidates everything; the data set is tiny and the API is local (ADR-0004: plain fetch + a query cache). */
function useWrite<Vars, Result>(fn: (vars: Vars) => Promise<Result>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries() });
}

export const usePatchSettings = () => useWrite((body: PatchSettingsBody) => api.patch('/api/settings', body).then((r) => SettingsSchema.parse(r)));

export const useCreateTicket = () => useWrite((body: CreateTicketBody) => api.post('/api/tickets', body).then((r) => TicketSchema.parse(r)));
export const usePatchTicket = (key: string) => useWrite((body: PatchTicketBody) => api.patch(`/api/tickets/${key}`, body));
/** A ticket is never archived (CONTEXT.md): trash and restore are all it has. */
export const useTicketIntent = (key: string) =>
  useWrite((intent: 'trash' | 'restore') => (intent === 'trash' ? api.del(`/api/tickets/${key}`) : api.post(`/api/tickets/${key}/restore`)));

export const useCreateApp = () => useWrite((body: CreateAppBody) => api.post('/api/apps', body).then((r) => AppSchema.parse(r)));
export const usePatchApp = (id: number) => useWrite((body: PatchAppBody) => api.patch(`/api/apps/${id}`, body));
export const useCreateProject = () => useWrite((body: CreateProjectBody) => api.post('/api/projects', body).then((r) => ProjectSchema.parse(r)));
export const usePatchProject = (id: number) => useWrite((body: PatchProjectBody) => api.patch(`/api/projects/${id}`, body));

/** archive · unarchive · trash · restore on an app or project. */
export const useIntent = (kind: 'app' | 'project', id: number) =>
  useWrite((intent: 'archive' | 'unarchive' | 'trash' | 'restore') =>
    intent === 'trash' ? api.del(`/api/${kind}s/${id}`) : api.post(`/api/${kind}s/${id}/${intent}`),
  );
export const useRestore = () => useWrite(({ kind, id }: { kind: TrashKind; id: number }) => api.post(`/api/${kind}s/${id}/restore`));
