/** Generic Web navigation: each loaded module owns its registered Actions. */
export function buildModuleNavigation(modules,actions) {
  return modules.map(module=>({...module,
    actions:actions.filter(action=>action.moduleId===module.id)
  }));
}
