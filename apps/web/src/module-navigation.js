/**
 * The navigation is Web-only: it groups exposed Action metadata by loaded
 * module, with storage shown inside System Overview when both are loaded.
 * Action ownership, registration, permissions and execution stay unchanged.
 */
export function buildModuleNavigation(modules, actions) {
  const byModule = new Map();
  for (const action of actions) {
    if (!byModule.has(action.moduleId)) byModule.set(action.moduleId, []);
    byModule.get(action.moduleId).push(action);
  }
  const includeStorageInOverview = modules.some(module => module.id === 'system') &&
    modules.some(module => module.id === 'storage');
  return modules.filter(module => !includeStorageInOverview || module.id !== 'storage').map(module => ({
    id: module.id,
    name: module.name,
    version: module.version,
    actions: includeStorageInOverview && module.id === 'system'
      ? [...(byModule.get('system') ?? []), ...(byModule.get('storage') ?? [])]
      : byModule.get(module.id) ?? []
  }));
}
