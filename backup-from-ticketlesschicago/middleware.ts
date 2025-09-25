import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const { pathname } = request.nextUrl;

  // Public routes that don't require authentication
  const publicRoutes = ['/', '/how-it-works', '/pricing', '/support', '/auth/signin', '/auth/error', '/api/auth', '/api/stripe-webhook'];
  
  // Check if current path is public
  const isPublicRoute = publicRoutes.some(route => 
    pathname === route || pathname.startsWith('/api/auth/') || pathname.startsWith('/_next/')
  );

  if (isPublicRoute) {
    return NextResponse.next();
  }

  // If no token, redirect to sign in
  if (!token) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', request.url);
    return NextResponse.redirect(signInUrl);
  }

  // TicketLess-specific protected routes
  const ticketlessRoutes = ['/claims', '/insurance-dashboard'];
  const isTicketlessRoute = ticketlessRoutes.some(route => pathname.startsWith(route));

  if (isTicketlessRoute) {
    // Check if user has TicketLess access
    const hasAccess = token.service_access?.ticketless || false;
    
    if (!hasAccess) {
      // Redirect to pricing page if they don't have TicketLess access
      const pricingUrl = new URL('/pricing', request.url);
      pricingUrl.searchParams.set('upgrade', 'ticketless');
      return NextResponse.redirect(pricingUrl);
    }
  }

  // MyStreetCleaning-specific routes (if any are added in the future)
  const mscRoutes = ['/street-cleaning'];
  const isMscRoute = mscRoutes.some(route => pathname.startsWith(route));

  if (isMscRoute) {
    // Check if user has MSC access (either through TicketLess or direct MSC subscription)
    const hasAccess = token.service_access?.mystreetcleaning || token.service_access?.ticketless || false;
    
    if (!hasAccess) {
      // Redirect to MSC signup if they don't have access
      const mscUrl = new URL('https://mystreetcleaning.com', request.url);
      return NextResponse.redirect(mscUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (auth endpoints)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|public).*)',
  ],
};