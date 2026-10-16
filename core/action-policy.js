/** Explicit ordinary-user shell capability; all other new writes stay denied. */
export function isUserShellAction(action) {
  return action?.id==='terminal.execute' && action.kind==='write' &&
    action.permission==='terminal:execute' && action.executionPolicy==='user-shell';
}

/** Source-approved ordinary-user file writes, authenticated Web only. */
export function isUserFileAction(action) {
  return ['files.write','files.upload','files.create','files.rename','files.delete','files.chmod','files.chown'].includes(action?.id) && action.kind==='write' &&
    action.permission==='files:write' && action.executionPolicy==='user-files';
}
