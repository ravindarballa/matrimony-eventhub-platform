import type { CookieOptions, Response } from 'express';

/**
 * The one definition of the refresh cookie.
 *
 * Every place that opens a session has to write this cookie identically - the
 * name and the path are what `/auth/refresh` looks it up by, so a handler that
 * invents its own spelling produces a session that works until the first page
 * reload and then silently disappears. Sharing it is what keeps a second
 * sign-in path from drifting away from the first.
 */
export const REFRESH_COOKIE = 'eh_rt';

const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_OPTIONS.path });
}
