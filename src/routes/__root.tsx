import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";

import appCss from "../styles.css?url";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Seite nicht gefunden</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Die gesuchte Seite existiert nicht.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Wetterprognose-Tool — Oberthurgauer Wetter" },
      { name: "description", content: "Internes Redaktionstool für die Wetterprognose von oberthurgauerwetter.ch" },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Wetterprognose-Tool — Oberthurgauer Wetter" },
      { name: "twitter:title", content: "Wetterprognose-Tool — Oberthurgauer Wetter" },
      { property: "og:description", content: "Internes Redaktionstool für die Wetterprognose von oberthurgauerwetter.ch" },
      { name: "twitter:description", content: "Internes Redaktionstool für die Wetterprognose von oberthurgauerwetter.ch" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/34ef728f-128a-44b7-845e-769da1bd7682/id-preview-532d0025--b99694fd-c510-4633-a13e-bf2bfcaeb1b4.lovable.app-1776604088951.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/34ef728f-128a-44b7-845e-769da1bd7682/id-preview-532d0025--b99694fd-c510-4633-a13e-bf2bfcaeb1b4.lovable.app-1776604088951.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <Outlet />
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
