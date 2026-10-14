/**
 * The navigation is Web-only: it groups exposed Action metadata by loaded
 * module. It does not change registration, permissions, or execution.
 */
export function buildModuleNavigation(modules, actions) {
  const byModule = new Map();
  for (const action of actions) {
    if (!byModule.has(action.moduleId)) byModule.set(action.moduleId, []);
    byModule.get(action.moduleId).push(action);
  }
  return modules.map(module => ({
    id: module.id,
    name: module.name,
    version: module.version,
    actions: byModule.get(module.id) ?? []
  }));
}
