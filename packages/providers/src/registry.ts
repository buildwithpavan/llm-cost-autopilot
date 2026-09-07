import type { ProviderAdapter } from "./abstraction/provider.js";

export interface ProviderRegistry {
  register(adapter: ProviderAdapter): void;
  get(providerId: string): ProviderAdapter | undefined;
  list(): readonly ProviderAdapter[];
}

export function createRegistry(): ProviderRegistry {
  const byId = new Map<string, ProviderAdapter>();
  return {
    register(adapter) {
      if (byId.has(adapter.providerId)) {
        throw new Error(`provider "${adapter.providerId}" is already registered`);
      }
      byId.set(adapter.providerId, adapter);
    },
    get(providerId) {
      return byId.get(providerId);
    },
    list() {
      return Array.from(byId.values());
    },
  };
}
