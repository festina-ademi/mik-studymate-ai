import { describe, expect, it, vi } from 'vitest';

import { ApiError, getHealth } from './api';

describe('getHealth', () => {
  it('returns the parsed health response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ status: 'ok', version: '1.2.3' }))),
    );

    await expect(getHealth()).resolves.toEqual({ status: 'ok', version: '1.2.3' });
  });

  it('turns the standard error envelope into an ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: { code: 'not_found', message_key: 'errors.not_found', details: { a: 1 } } },
            { status: 404 },
          ),
        ),
      ),
    );

    await expect(getHealth()).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      messageKey: 'errors.not_found',
      details: { a: 1 },
    });
  });

  it('reports an unreachable server as a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const error = await getHealth().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'network', messageKey: 'errors.network' });
  });

  it('rejects a response that does not match the expected shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ hello: 'world' }))),
    );

    await expect(getHealth()).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('falls back to a generic error when the body is not the standard envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }))),
    );

    await expect(getHealth()).rejects.toMatchObject({ status: 502, code: 'http_error' });
  });
});
