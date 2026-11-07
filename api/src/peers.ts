import { admits, type Network } from '@goblin/shared';

type Fetch = (request: Request) => Response | Promise<Response>;

/** The one thing a guarded fetch asks of Bun's server: who is on the other end. */
export interface PeerSource {
  requestIP(request: Request): { address: string } | null;
}

/**
 * `fetch`, answering only peers `admits` lets in. Everyone else gets a 403 in
 * the API's problem shape (ADR-0004), naming the address so the operator can
 * see which network to add.
 */
export function admitOnly(allow: Network[], fetch: Fetch) {
  return (request: Request, server: PeerSource): Response | Promise<Response> => {
    const peer = server.requestIP(request)?.address ?? '';
    if (admits(peer, allow)) return fetch(request);
    return new Response(JSON.stringify({ type: 'about:blank', title: 'Forbidden', status: 403, detail: `${peer || 'this peer'} is not in GF_ALLOW` }), {
      status: 403,
      headers: { 'content-type': 'application/problem+json' },
    });
  };
}
