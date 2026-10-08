import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleHistoryRequest } from '../netlify/lib/history-core';

export default async function handler(req: any, res?: any): Promise<Response | void> {
  // Web Standard Request signature (Edge or modern Serverless function)
  if (req instanceof Request || (req?.headers && typeof req.headers.get === 'function')) {
    return handleHistoryRequest(req);
  }

  // Node.js IncomingMessage & ServerResponse signature
  const headers = new Headers();
  for (const [name, value] of Object.entries((req as IncomingMessage).headers || {})) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (value !== undefined) headers.set(name, value);
  }
  const host = (req as IncomingMessage).headers?.['x-forwarded-host'] ?? (req as IncomingMessage).headers?.host ?? 'localhost';
  const proto = (req as IncomingMessage).headers?.['x-forwarded-proto'] ?? 'https';
  const url = new URL(req.url ?? '/', `${proto}://${host}`);
  const webReq = new Request(url, {
    method: req.method,
    headers,
  });

  const response = await handleHistoryRequest(webReq);

  if (res && typeof (res as ServerResponse).setHeader === 'function') {
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(await response.text());
    return;
  }

  return response;
}

export { handler as GET };
