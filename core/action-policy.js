/** Explicit ordinary-user shell capability; all other new writes stay denied. */
export function isUserShellAction(action) {
  return action?.id==='terminal.execute' && action.kind==='write' &&
    action.permission==='terminal:execute' && action.executionPolicy==='user-shell';
}
