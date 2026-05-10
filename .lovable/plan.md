## Problem

The new `OpenMeteoUsageCard` uses `useQuery` from TanStack Query, but the root layout (`src/routes/__root.tsx`) does not wrap the app in a `QueryClientProvider`. Result: opening `/settings` crashes with "No QueryClient set, use QueryClientProvider to set one".

## Fix

Add a `QueryClientProvider` around `<Outlet />` in `src/routes/__root.tsx`:

1. Create a singleton `QueryClient` (module-level, with sensible defaults: `staleTime: 30s`, no refetch on window focus).
2. Wrap `<Outlet />` inside `<AuthProvider>` with `<QueryClientProvider client={queryClient}>`.
3. No router context refactor needed — the card uses `useQuery` directly, no loader integration.

That's all — single-file change, fixes the crash without touching the card or any other code.