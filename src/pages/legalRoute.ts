/** The public legal pages, and which one (if any) the address bar is asking for. */
export type LegalKind = 'privacy' | 'terms' | 'data-deletion';

export function legalRoute(pathname: string = window.location.pathname): LegalKind | null {
  const p = pathname.replace(/\/+$/, '');
  return p === '/privacy' ? 'privacy' : p === '/terms' ? 'terms' : p === '/data-deletion' ? 'data-deletion' : null;
}
